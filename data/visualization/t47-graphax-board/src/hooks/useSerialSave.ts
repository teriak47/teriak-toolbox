import { useRef } from 'react';

interface SerialSaveRequest<T> {
  /** The new value, shown at once */
  value: T;
  /** The stored value, shown back if saving fails */
  stored: T;
  save: (value: T) => Promise<T>;
  /** Shows a value (optimistic, saved, or the stored one after a failure) */
  apply: (value: T) => void;
  onError: (err: unknown) => void;
}

// Saves of one value that is replaced as a whole (a project's link types or saved views):
// requests are sent one after the other, the next edit builds on the latest value shown,
// and only the response to the latest request updates what is shown. A failure puts back
// the last stored value.
export function useSerialSave<T>() {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const seq = useRef(0);
  const pending = useRef<{ value: T } | null>(null);
  const confirmed = useRef<{ value: T } | null>(null);

  return {
    /** The value the next edit should start from */
    latest: (fallback: T): T => (pending.current ? pending.current.value : fallback),

    submit: ({ value, stored, save, apply, onError }: SerialSaveRequest<T>): Promise<boolean> => {
      if (!pending.current) confirmed.current = { value: stored };
      pending.current = { value };
      apply(value);
      const n = ++seq.current;
      const done = queue.current.then(async () => {
        try {
          const saved = await save(value);
          confirmed.current = { value: saved };
          if (n === seq.current) {
            pending.current = null;
            apply(saved);
          }
          return true;
        } catch (err) {
          if (n === seq.current) {
            pending.current = null;
            apply((confirmed.current ?? { value: stored }).value);
          }
          onError(err);
          return false;
        }
      });
      queue.current = done;
      return done;
    },
  };
}
