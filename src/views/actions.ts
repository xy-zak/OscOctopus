// What the views' actions share (deskActions.ts, lookActions.ts): ask first where it can't be
// undone, run, and report a failure as an error toast. Each resolves true when the action went
// through.
import { save } from '@tauri-apps/plugin-dialog';
import { confirmAction, toast } from '../lib/state/ui.svelte';
import { errorText } from '../lib/util';

/** Runs `fn`, turning a failure into an error toast. Resolves whether it succeeded. */
export async function runAction(what: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    toast(`${what} failed: ${errorText(e)}`, 'error');
    return false;
  }
}

/** Asks first, then runs `fn` like `runAction`. Resolves false when it wasn't confirmed. */
export async function ifConfirmed(
  what: string,
  ask: Parameters<typeof confirmAction>[0],
  fn: () => Promise<unknown>,
): Promise<boolean> {
  return (await confirmAction(ask)) && runAction(what, fn);
}

/** The file dialog filter for one kind of OscOctopus file (they are all JSON). */
export const jsonFiles = (kind: string) => [{ name: `OscOctopus ${kind}`, extensions: ['json'] }];

/**
 * Asks where to save a `kind` file, suggesting `name` made safe as a file name, then writes it
 * there with `write`.
 */
export const exportJson = (kind: string, name: string, write: (path: string) => Promise<void>) =>
  runAction('Export', async () => {
    const safe = name.replace(/[^\w\- ]+/g, '').trim() || kind;
    const path = await save({ defaultPath: `${safe}.json`, filters: jsonFiles(kind) });
    if (!path) return;
    await write(path);
    toast(`Exported to ${path}`);
  });
