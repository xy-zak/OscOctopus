// PRESENTING fills the screen: on desktop the window goes fullscreen with it, and back when it
// ends, unless it was fullscreen already (phones are full screen anyway). Calls run one at a
// time, so a quick on-off-on still ends in the right state.
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Whether this module made the window fullscreen, so leaving undoes only that. */
let madeFullscreen = false;
let queue: Promise<void> = Promise.resolve();

async function apply(on: boolean) {
  const win = getCurrentWindow();
  if (on && !(await win.isFullscreen())) {
    await win.setFullscreen(true);
    madeFullscreen = true;
  } else if (!on && madeFullscreen) {
    madeFullscreen = false;
    await win.setFullscreen(false);
  }
}

/** Makes the window follow PRESENTING, after every earlier call; a failure rejects this one. */
export function followPresenting(on: boolean): Promise<void> {
  const done = queue.then(() => apply(on));
  queue = done.catch(() => {});
  return done;
}
