// Undo / redo history: a pure list of entries, each able to undo and redo one user action.
// No React here, so it can be unit tested; the workspace keeps an instance in a ref.

export interface HistoryEntry {
  /** Short French description, shown in the button tooltip (e.g. "Déplacement du nœud") */
  label: string;
  undo: () => void;
  redo: () => void;
  /**
   * Entries with the same key recorded close together are merged into one (typing in a
   * field is saved in several bursts but is undone as a single edit)
   */
  mergeKey?: string;
  at: number;
}

export const HISTORY_LIMIT = 100;
export const MERGE_WINDOW_MS = 1500;

export class UndoHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private applying = false;
  private readonly limit: number;
  private readonly mergeWindowMs: number;

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
    this.run(entry.undo);
    this.future.push(entry);
    return entry.label;
  }

  redo(): string | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.run(entry.redo);
    // A redone entry is not merged with the next action
    this.past.push({ ...entry, mergeKey: undefined });
    return entry.label;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  private run(fn: () => void): void {
    this.applying = true;
    try {
      fn();
    } finally {
      this.applying = false;
    }
  }
}
