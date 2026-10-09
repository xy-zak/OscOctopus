// The tour's controller: which step shows, and moving between them. What it does to the app
// comes in through `TourOps` (app.svelte.ts wires the real ones), so it is tested with fakes
// (tour.svelte.test.ts).
//
// Starting snapshots where the UI is and opens a TUTORIAL desk, remembered in the settings
// until the tour ends; leaving (Done, Exit, Esc) puts the UI back and deletes that desk. A desk
// left over by an app that died mid-tour is deleted at the next startup (`recover`).
import { levelRanges, type Level, type Place, type TourStep } from './steps';

export interface TourOps {
  /** The tour can't start now (FROZEN, presenting). */
  blocked(): boolean;
  /** Takes a snapshot of the UI; the function returned puts it back. */
  snapshot(): () => void;
  /** Opens the TUTORIAL desk and returns its id. */
  openDesk(): Promise<string>;
  /** Deletes the TUTORIAL desk. */
  removeDesk(id: string): Promise<void>;
  /** Moves the UI to where a step shows, on the TUTORIAL desk. */
  apply(place: Place, deskId: string): void;
  /** Remembers the TUTORIAL desk across restarts (null: none). */
  remember(deskId: string | null): Promise<void>;
  recall(): Promise<string | null>;
}

export class Tour {
  active = $state(false);
  index = $state(0);
  private desk: string | null = null;
  private restore: (() => void) | null = null;
  private starting = false;

  constructor(
    readonly steps: readonly TourStep[],
    private ops: TourOps,
  ) {}

  get step(): TourStep {
    return this.steps[this.index]!;
  }

  get last(): boolean {
    return this.index === this.steps.length - 1;
  }

  /** Whether the tour can start now. */
  get available(): boolean {
    return !this.active && !this.ops.blocked();
  }

  /** Starts at the first step. False if it can't start now. */
  async start(): Promise<boolean> {
    if (this.active || this.starting || this.ops.blocked()) return false;
    this.starting = true;
    const restore = this.ops.snapshot();
    try {
      this.desk = await this.ops.openDesk();
      await this.ops.remember(this.desk);
    } catch (e) {
      restore();
      if (this.desk) await this.ops.removeDesk(this.desk);
      this.desk = null;
      throw e;
    } finally {
      this.starting = false;
    }
    this.restore = restore;
    this.active = true;
    this.go(0);
    return true;
  }

  /** Shows step `i` (clamped to the steps there are). */
  go(i: number) {
    if (!this.active || !this.desk) return;
    this.index = Math.max(0, Math.min(i, this.steps.length - 1));
    this.ops.apply(this.step.at, this.desk);
  }

  /** The next step; after the last, the tour ends. */
  next() {
    if (this.last) void this.exit();
    else this.go(this.index + 1);
  }

  back() {
    if (this.index > 0) this.go(this.index - 1);
  }

  /** The first step of a level. */
  jump(level: Level) {
    const range = levelRanges(this.steps).find((r) => r.level === level);
    if (range && range.start >= 0) this.go(range.start);
  }

  /** Ends the tour: the UI goes back to where it was, and the TUTORIAL desk is deleted. */
  async exit() {
    if (!this.active) return;
    this.active = false;
    const desk = this.desk;
    this.desk = null;
    this.restore?.();
    this.restore = null;
    if (desk) await this.ops.removeDesk(desk);
    await this.ops.remember(null);
  }

  /** At startup: deletes a TUTORIAL desk left by an app that died mid-tour. */
  async recover() {
    const desk = await this.ops.recall();
    if (!desk) return;
    await this.ops.removeDesk(desk);
    await this.ops.remember(null);
  }
}
