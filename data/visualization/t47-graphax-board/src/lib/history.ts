// Undo / redo history: a pure list of entries, each able to undo and redo one user action.
// No React here, so it can be unit tested; the workspace keeps an instance in a ref.

export interface HistoryEntry {
  /** Short French description, shown in the button tooltip (e.g. "Déplacement du nœud") */
  label: string;
  /**
   * May return a promise: when it resolves to false (the change could not be saved), the
   * entry goes back where it was, so the same undo or redo can be tried again
   */
  undo: () => ReplayResult;
  redo: () => ReplayResult;
  /**
   * Entries with the same key recorded close together are merged into one (typing in a
   * field is saved in several bursts but is undone as a single edit)
   */
  mergeKey?: string;
  at: number;
}

export type ReplayResult = void | boolean | Promise<void | boolean>;

export const HISTORY_LIMIT = 100;
export const MERGE_WINDOW_MS = 1500;

export class UndoHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private applying = false;
  private readonly limit: number;
  private readonly mergeWindowMs: number;
  /** Called when a failed replay puts an entry back, so the buttons can be refreshed */
  onChange: (() => void) | null = null;

  constructor(limit = HISTORY_LIMIT, mergeWindowMs = MERGE_WINDOW_MS) {
    this.limit = limit;
    this.mergeWindowMs = mergeWindowMs;
  }

  /** True while an undo or redo runs: changes it makes must not be recorded again */
  get isApplying(): boolean {
    return this.applying;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }

  /** Adds a new action; it drops whatever could be redone. Ignored during undo/redo. */
  record(entry: Omit<HistoryEntry, 'at'> & { at?: number }): void {
    if (this.applying) return;
    const at = entry.at ?? Date.now();
    const last = this.past.at(-1);
    this.future = [];
    if (
      last &&
      entry.mergeKey &&
      last.mergeKey === entry.mergeKey &&
      at - last.at <= this.mergeWindowMs
    ) {
      // Keep the oldest "undo" and the newest "redo"
      this.past[this.past.length - 1] = { ...last, redo: entry.redo, label: entry.label, at };
      return;
    }
    this.past.push({ ...entry, at });
    if (this.past.length > this.limit) this.past.shift();
  }

  undo(): string | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push(entry);
    this.settle(this.run(entry.undo), entry, this.future, this.past);
    return entry.label;
  }

  redo(): string | null {
    const popped = this.future.pop();
    if (!popped) return null;
    // A redone entry is not merged with the next action
    const entry = { ...popped, mergeKey: undefined };
    this.past.push(entry);
    this.settle(this.run(popped.redo), entry, this.past, this.future);
    return entry.label;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  private run(fn: () => ReplayResult): ReplayResult {
    this.applying = true;
    try {
      return fn();
    } finally {
      this.applying = false;
    }
  }

  // A replay that reports a failure moves its entry back to the list it came from
  private settle(
    result: ReplayResult,
    entry: HistoryEntry,
    movedTo: HistoryEntry[],
    cameFrom: HistoryEntry[]
  ): void {
    const back = () => {
      const index = movedTo.lastIndexOf(entry);
      if (index < 0) return; // dropped since (a new action cleared the redo list)
      movedTo.splice(index, 1);
      cameFrom.push(entry);
      this.onChange?.();
    };
    if (result === false) back();
    else if (result instanceof Promise) {
      result.then((ok) => ok === false && back(), back);
    }
  }
}
