// Screenshots of every widget scenario in the dev gallery (src/dev/gallery), in every built-in
// skin, dark and light, to catch visual changes (.shots/<set>/<skin>/<mode>/<scenario>.png).
//
//   npm run shots                     → .shots/current/
//   npm run shots -- save baseline    → .shots/baseline/
//   npm run shots -- compare          → shoot current, diff against baseline
//   npm run shots -- compare a b      → diff two existing sets, no shooting
//
// Differences are listed and written as images to .shots/diff/ (changed pixels in red).
// SHOTS_TOLERANCE=<levels> lets a channel move that much before a pixel counts as changed
// (default 0: exact), for effects that rasterise slightly differently from run to run.
// SHOTS_SKINS=neon,crt shoots only those skins (a quick look while making one); compare then
// only checks what was shot.
// Uses an installed Chromium-family browser: SHOTS_BROWSER=<path to exe>, or Chrome, Edge or
// Brave found in the usual places. Shots are machine-specific (fonts, GPU): keep a baseline
// per machine; .shots/ is not committed.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const OUT = '.shots';
const TOLERANCE = Number(process.env.SHOTS_TOLERANCE ?? 0);
const MODES = ['dark', 'light'];

const CANDIDATES = [
  process.env.SHOTS_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

async function launch() {
  const exe = CANDIDATES.find((p) => p && existsSync(p));
  if (!exe) throw new Error('No Chromium browser found: set SHOTS_BROWSER to its executable');
  return chromium.launch({ executablePath: exe, headless: true });
}

/** Performs a scenario's gesture with the real mouse; returns whether a button is still down. */
async function gesture(page, g, stage) {
  const at = ([fx, fy]) => [stage.x + fx * stage.width, stage.y + fy * stage.height];
  if (g?.kind === 'press' || g?.kind === 'tap') {
    await page.mouse.move(...at(g.at));
    await page.mouse.down();
    if (g.kind === 'tap') await page.mouse.up();
    return g.kind === 'press';
  }
  if (g?.kind === 'drag') {
    await page.mouse.move(...at(g.path[0]));
    await page.mouse.down();
    for (const p of g.path.slice(1)) await page.mouse.move(...at(p), { steps: 2 });
    return true;
  }
  return false;
}

/** Shoots every scenario in every skin and both modes into .shots/<name>/. */
async function shoot(name) {
  const dir = join(OUT, name);
  await rm(dir, { recursive: true, force: true });
  const server = await createServer({
    server: { port: 5299, strictPort: false },
    logLevel: 'error',
  });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const browser = await launch();
  let count = 0;
  try {
    const probe = await browser.newPage();
    await probe.goto(`${base}src/dev/gallery/?only=none`);
    await probe.waitForSelector('body[data-ready]');
    const only = process.env.SHOTS_SKINS?.split(',').map((s) => s.trim());
    const skins = (await probe.evaluate(() => window.gallery.skins)).filter(
      (s) => !only || only.includes(s),
    );
    await probe.close();
    for (const skin of skins) {
      for (const mode of MODES) {
        const out = join(dir, skin, mode);
        await mkdir(out, { recursive: true });
        const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(`${base}src/dev/gallery/?skin=${skin}&mode=${mode}&only=none`);
        await page.waitForSelector('body[data-ready]');
        const scenarios = await page.evaluate(() => window.gallery.scenarios);
        for (const s of scenarios) {
          await page.evaluate((id) => window.gallery.show(id), s.id);
          const shot = page.locator(`[data-shot="${s.id}"]`);
          const held = await gesture(page, s.gesture, await shot.locator('.stage').boundingBox());
          await page.evaluate((ms) => window.gallery.freeze(ms), s.freeze);
          await shot.screenshot({ path: join(out, `${s.id}.png`) });
          if (held) await page.mouse.up();
          await page.mouse.move(0, 0);
          count++;
        }
        if (errors.length) console.warn(`${skin}/${mode}: page errors:`, errors);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`${count} shots in ${dir}`);
}

/** Every .png under `dir`, as paths relative to it. */
async function pngs(dir) {
  const found = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && e.name.endsWith('.png'))
      found.push(relative(dir, join(e.parentPath, e.name)));
  }
  return found.sort();
}

/** Pixel-compares two shot sets in the browser; returns the shots that differ. */
async function compare(a, b) {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setContent('<canvas></canvas>');
  await rm(join(OUT, 'diff'), { recursive: true, force: true });
  const changed = [];
  try {
    const only = process.env.SHOTS_SKINS?.split(',').map((s) => s.trim());
    for (const f of await pngs(join(OUT, a))) {
      if (only && !only.includes(f.split(/[\\/]/)[0])) continue;
      const pb = join(OUT, b, f);
      if (!existsSync(pb)) {
        changed.push(`${f} (missing in ${b})`);
        continue;
      }
      const [ia, ib] = await Promise.all([readFile(join(OUT, a, f)), readFile(pb)]);
      if (ia.equals(ib)) continue;
      const result = await page.evaluate(
        async ([da, db, tolerance]) => {
          const load = (d) =>
            new Promise((res, rej) => {
              const img = new Image();
              img.onload = () => res(img);
              img.onerror = rej;
              img.src = `data:image/png;base64,${d}`;
            });
          const [x, y] = await Promise.all([load(da), load(db)]);
          if (x.width !== y.width || x.height !== y.height) {
            return { pixels: -1, size: `${x.width}×${x.height} vs ${y.width}×${y.height}` };
          }
          const c = document.querySelector('canvas');
          c.width = x.width;
          c.height = x.height;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(x, 0, 0);
          const px = g.getImageData(0, 0, c.width, c.height);
          g.clearRect(0, 0, c.width, c.height);
          g.drawImage(y, 0, 0);
          const py = g.getImageData(0, 0, c.width, c.height);
          let pixels = 0;
          let most = 0;
          for (let i = 0; i < px.data.length; i += 4) {
            let delta = 0;
            for (let k = 0; k < 4; k++)
              delta = Math.max(delta, Math.abs(px.data[i + k] - py.data[i + k]));
            most = Math.max(most, delta);
            if (delta > tolerance) {
              pixels++;
              py.data.set([255, 0, 64, 255], i);
            } else {
              py.data[i + 3] = 60;
            }
          }
          g.putImageData(py, 0, 0);
          return { pixels, most, diff: c.toDataURL('image/png').split(',')[1] };
        },
        [ia.toString('base64'), ib.toString('base64'), TOLERANCE],
      );
      if (result.pixels === 0) continue;
      changed.push(
        `${f}: ${result.pixels < 0 ? `size ${result.size}` : `${result.pixels} px (up to ${result.most} levels)`}`,
      );
      if (result.diff) {
        const out = join(OUT, 'diff', f);
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, Buffer.from(result.diff, 'base64'));
      }
    }
  } finally {
    await browser.close();
  }
  return changed;
}

const [cmd = 'save', x, y] = process.argv.slice(2);
if (cmd === 'save') {
  await shoot(x ?? 'current');
} else if (cmd === 'compare') {
  const a = y ? x : 'baseline';
  const b = y ?? 'current';
  if (!y) await shoot('current');
  const changed = await compare(a, b);
  if (changed.length === 0) console.log(`no differences between ${a} and ${b}`);
  else {
    console.log(`${changed.length} differ (${a} → ${b}), see ${OUT}/diff/:`);
    for (const c of changed) console.log(`  ${c}`);
    process.exitCode = 1;
  }
} else {
  console.error('usage: npm run shots -- [save <name> | compare [<a> <b>]]');
  process.exitCode = 2;
}
