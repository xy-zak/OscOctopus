// Autosave for open desks. Every edit bumps the desk's revision and restarts a short debounce.
// Guarantees:
//   - saves of one desk never overlap: each waits for the one before it, and snapshots the
//     desk only when it starts, so the newest state always wins;
//   - a save clears "dirty" only if no edit arrived while it ran, so an edit made mid-save is
//     picked up by the next save instead of being forgotten;
//   - flush()/flushAll() resolve once everything pending has been written (closing a desk,
//     quitting the app).

/** Writes one desk (snapshotting it synchronously first); resolves whether it was saved. */
export type WriteDesk = (id: string) => Promise<boolean>;

export class Autosave {
  /** Desk ids with unsaved changes (reactive: the tabs show a marker). */
  dirty: Record<string, boolean> = $state({});

  private revisions = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private chains = new Map<string, Promise<void>>();

  constructor(
    private readonly write: WriteDesk,
    private readonly delayMs: number,
  ) {}

  /** A desk changed: mark it dirty and save it after the debounce. */
  touch(id: string) {
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    this.dirty[id] = true;
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => void this.save(id), this.delayMs),
    );
  }

  /** Saves now (after any save of this desk already running). */
  save(id: string): Promise<void> {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const previous = this.chains.get(id) ?? Promise.resolve();
    // A failed save must not stop the ones queued behind it.
    const next = previous.catch(() => {}).then(() => this.run(id));
    this.chains.set(id, next);
    return next;
  }

  /** Saves the desk if it has unsaved changes, and waits for any save in progress. */
  async flush(id: string): Promise<void> {
    if (this.dirty[id] || this.timers.has(id)) return this.save(id);
    await this.chains.get(id);
  }

  flushAll(): Promise<void> {
    const ids = new Set([...Object.keys(this.dirty), ...this.timers.keys(), ...this.chains.keys()]);
    return Promise.all([...ids].map((id) => this.flush(id))).then(() => {});
  }

  /** Drops all state of a desk that was closed (flush it first). */
  forget(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.revisions.delete(id);
    this.chains.delete(id);
    delete this.dirty[id];
  }

  private async run(id: string) {
    const revision = this.revisions.get(id) ?? 0;
    const saved = await this.write(id);
    if (saved && (this.revisions.get(id) ?? 0) === revision) delete this.dirty[id];
  }
}
