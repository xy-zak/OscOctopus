// Dev gallery entry (not part of the app build). Open /src/dev/gallery/ on the Vite dev
// server; `?skin=glass` for a skin, `?mode=light` for light mode, `?only=<scenario id>` for
// one scenario.
//
// `window.gallery` is the screenshot script's handle (scripts/shots.mjs): the scenario list,
// `show(id)` to render one, and `freeze(ms)` to hold every animation at a fixed moment.
import { mount, unmount } from 'svelte';
import '../../app.css';
import { BUILTIN_SKIN_IDS, BUILTIN_SKIN_LIST, resolveSkin } from '../../lib/skins/builtin';
import { DEFAULT_ACCENT, DEFAULT_PALETTE, PALETTES, paletteVars } from '../../lib/theme/palettes';
import { measureCharWidth } from '../../lib/ui/textfit';
import Gallery from './Gallery.svelte';
import { SCENARIOS } from './scenarios';

declare global {
  interface Window {
    gallery: {
      scenarios: { id: string; gesture?: unknown; freeze?: number; size: [number, number] }[];
      skins: readonly string[];
      show(id: string | null): Promise<void>;
      freeze(ms?: number): void;
    };
  }
}

const q = new URLSearchParams(location.search);
const root = document.documentElement;
root.dataset.mode = q.get('mode') === 'light' ? 'light' : 'dark';
const vars = paletteVars(PALETTES[DEFAULT_PALETTE].colors, DEFAULT_ACCENT);
for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);

const skin = resolveSkin(q.get('skin'), BUILTIN_SKIN_LIST);

const target = document.getElementById('gallery')!;
let app: ReturnType<typeof mount> | null = null;

const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Finished transitions end where they were going; running animations stop `ms` in. */
function freeze(ms?: number) {
  for (const a of document.getAnimations()) {
    if (ms === undefined || a instanceof CSSTransition) {
      // Infinite animations can't finish: hold them at their start.
      if (a.effect?.getComputedTiming().endTime === Infinity) {
        a.pause();
        a.currentTime = 0;
      } else a.finish();
    } else {
      a.pause();
      a.currentTime = ms;
    }
  }
}

async function show(id: string | null) {
  if (app) await unmount(app);
  app = mount(Gallery, { target, props: { only: id, skin } });
  await frames();
  freeze();
}

window.gallery = {
  scenarios: SCENARIOS.map((s) => ({
    id: s.id,
    gesture: s.gesture,
    freeze: s.freeze,
    size: s.size,
  })),
  skins: BUILTIN_SKIN_IDS,
  show,
  freeze,
};

await measureCharWidth();
await show(q.get('only'));
document.body.dataset.ready = 'true';
