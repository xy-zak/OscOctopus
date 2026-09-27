// The stylesheets of the user skins: one <style data-skin-sheet="<id>"> each in <head>, from
// compile.ts. Kept in step with the store (App.svelte), rewriting only what changed.
import { compileSkin } from './compile';
import type { Skin } from './schema';

const sheets = new Map<string, { css: string; el: HTMLStyleElement }>();

export function applySkinSheets(skins: readonly Skin[]) {
  if (typeof document === 'undefined') return;
  const want = new Map(skins.map((s) => [s.id, compileSkin(s)]));
  for (const [id, sheet] of sheets) {
    if (want.has(id)) continue;
    sheet.el.remove();
    sheets.delete(id);
  }
  for (const [id, css] of want) {
    let sheet = sheets.get(id);
    if (!sheet) {
      const el = document.createElement('style');
      el.dataset.skinSheet = id;
      document.head.appendChild(el);
      sheet = { css: '', el };
      sheets.set(id, sheet);
    }
    if (sheet.css !== css) {
      sheet.el.textContent = css;
      sheet.css = css;
    }
  }
}
