import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'saved' | 'saving' | 'error';

type SaveOp = () => Promise<unknown>;

export interface SaveQueue {
  saveState: SaveState;
  saveError: string | null;
  /**
   * Runs one persistence call. A failure is reported, never hidden as "saved".
   * `retryKey` keeps the operation so "Réessayer" can replay it; `rethrow` lets
   * a caller (e.g. a modal) stay open on failure.
   */
  runSave: <T>(
    op: () => Promise<T>,
    opts?: { retryKey?: string; rethrow?: boolean }
  ) => Promise<T | undefined>;
  /** Replays every failed operation that has a retry key */
  retryFailedSaves: () => Promise<void>;
  /** Hides an error that cannot be retried */
  dismissSaveError: () => void;
  /** Keeps an operation for "Réessayer" and shows the error state */
  keepForRetry: (retryKey: string, op: SaveOp) => void;
  /** True when at least one failed operation can be replayed */
  hasRetryableSaves: () => boolean;
  /** True while saves are running or some changes failed to save */
  hasUnsavedChanges: () => boolean;
  /** Resolves once no save is running, or after `timeoutMs` */
  waitForIdle: (timeoutMs: number) => Promise<void>;
}

// Tracks saves for the workspace: how many are in flight, which failed (kept for retry),
// and the resulting status shown in the top bar. Warns before closing the tab while
// changes are unsaved.
export function useSaveQueue(): SaveQueue {
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);

  const inFlightRef = useRef(0);
  const failedRef = useRef(new Map<string, SaveOp>());
  const unretryableErrorRef = useRef(false);

  const settleSaveState = useCallback(() => {
    if (inFlightRef.current > 0) return;
    const failed = failedRef.current.size > 0 || unretryableErrorRef.current;
    setSaveState(failed ? 'error' : 'saved');
    if (!failed) setSaveError(null);
  }, []);

  const runSave = useCallback(
    async <T,>(
      op: () => Promise<T>,
      opts: { retryKey?: string; rethrow?: boolean } = {}
    ): Promise<T | undefined> => {
      inFlightRef.current += 1;
      setSaveState('saving');
      try {
        const result = await op();
        if (opts.retryKey) failedRef.current.delete(opts.retryKey);
        return result;
      } catch (err) {
        console.error('[Graphax] Enregistrement impossible :', err);
        if (opts.retryKey) failedRef.current.set(opts.retryKey, op);
        else unretryableErrorRef.current = true;
        setSaveError(err instanceof Error ? err.message : 'Erreur inconnue.');
        if (opts.rethrow) throw err;
        return undefined;
      } finally {
        inFlightRef.current -= 1;
        settleSaveState();
      }
    },
    [settleSaveState]
  );

  const retryFailedSaves = useCallback(async () => {
    const pending = [...failedRef.current.entries()];
    unretryableErrorRef.current = false;
    for (const [retryKey, op] of pending) {
      await runSave(op, { retryKey });
    }
    settleSaveState();
  }, [runSave, settleSaveState]);

  const dismissSaveError = useCallback(() => {
    unretryableErrorRef.current = false;
    settleSaveState();
  }, [settleSaveState]);

  const keepForRetry = useCallback((retryKey: string, op: SaveOp) => {
    failedRef.current.set(retryKey, op);
    setSaveState('error');
  }, []);

  const hasRetryableSaves = useCallback(() => failedRef.current.size > 0, []);

  const hasUnsavedChanges = useCallback(
    () => inFlightRef.current > 0 || failedRef.current.size > 0 || unretryableErrorRef.current,
    []
  );

  const waitForIdle = useCallback(async (timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (inFlightRef.current > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }, []);

  // Warn before closing the tab while changes are unsaved
  useEffect(() => {
    if (saveState === 'saved') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveState]);

  return {
    saveState,
    saveError,
    runSave,
    retryFailedSaves,
    dismissSaveError,
    keepForRetry,
    hasRetryableSaves,
    hasUnsavedChanges,
    waitForIdle,
  };
}
