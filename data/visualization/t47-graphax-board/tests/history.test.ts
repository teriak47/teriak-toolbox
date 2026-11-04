import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UndoHistory } from '../src/lib/history.ts';

// A tiny "document": a value changed through recorded actions
function setup(limit?: number, mergeWindowMs?: number) {
  const history = new UndoHistory(limit, mergeWindowMs);
  const state = { value: 0 };
  const set = (next: number, opts: { mergeKey?: string; at?: number } = {}) => {
    const prev = state.value;
    state.value = next;
    history.record({
      label: `valeur ${next}`,
      undo: () => set(prev),
      redo: () => set(next),
      ...opts,
    });
  };
  return { history, state, set };
}

describe('undo history', () => {
  it('undoes and redoes in order, without recording the replayed changes', () => {
    const { history, state, set } = setup();
    set(1);
    set(2);
    assert.equal(history.undoLabel, 'valeur 2');
    assert.equal(history.undo(), 'valeur 2');
    assert.equal(state.value, 1);
    assert.equal(history.undo(), 'valeur 1');
    assert.equal(state.value, 0);
    assert.equal(history.undo(), null);
    assert.equal(history.redo(), 'valeur 1');
    assert.equal(history.redo(), 'valeur 2');
    assert.equal(state.value, 2);
    assert.equal(history.canRedo, false);
    // Undo then redo again: the replayed set() calls added nothing to the history
    history.undo();
    history.undo();
    assert.equal(history.canUndo, false);
  });

  it('drops the redo list when a new action is recorded', () => {
    const { history, set } = setup();
    set(1);
    set(2);
    history.undo();
    set(5);
    assert.equal(history.canRedo, false);
    assert.equal(history.undoLabel, 'valeur 5');
  });

  it('merges close edits with the same key into one entry', () => {
    const { history, state, set } = setup(100, 1000);
    set(1, { mergeKey: 'title', at: 0 });
    set(2, { mergeKey: 'title', at: 500 });
    set(3, { mergeKey: 'title', at: 1200 });
    set(4, { mergeKey: 'other', at: 1300 });
    set(5, { mergeKey: 'title', at: 1400 });
    set(6, { mergeKey: 'title', at: 5000 });
    // 6 | 5 | 4 | 1→3
    history.undo();
    assert.equal(state.value, 5);
    history.undo();
    assert.equal(state.value, 4);
    history.undo();
    assert.equal(state.value, 3);
    history.undo();
    assert.equal(state.value, 0, 'the merged entry goes back to the value before the first edit');
    history.redo();
    assert.equal(state.value, 3, 'and redoes to the last one');
  });

  it('keeps at most `limit` entries', () => {
    const { history, state, set } = setup(3);
    for (let i = 1; i <= 5; i++) set(i);
    while (history.undo()) {
      /* undo everything kept */
    }
    assert.equal(state.value, 2);
  });

  it('puts an entry back when its replay fails, so it can be tried again', async () => {
    const history = new UndoHistory();
    let changes = 0;
    history.onChange = () => changes++;
    let ok = false;
    history.record({ label: 'inversion', undo: () => Promise.resolve(ok), redo: () => true });
    assert.equal(history.undo(), 'inversion');
    assert.equal(history.isBusy, true, 'nothing else until the undo is saved');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(history.canUndo, true, 'failed undo goes back to the undo list');
    assert.equal(history.canRedo, false);
    assert.equal(changes, 1);
    ok = true;
    history.undo();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(history.canUndo, false);
    assert.equal(history.canRedo, true);
    // A failed redo goes back to the redo list; a rejected promise counts as a failure
    history.record({ label: 'autre', undo: () => {}, redo: () => Promise.reject(new Error('x')) });
    history.undo();
    history.redo();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(history.redoLabel, 'autre');
    assert.equal(history.undoLabel, null);
  });

  it('waits for a replay being saved before the next undo or redo', async () => {
    const history = new UndoHistory();
    let finish: (ok: boolean) => void = () => {};
    let redone = 0;
    history.record({
      label: 'inversion',
      undo: () => new Promise<boolean>((r) => (finish = r)),
      redo: () => void redone++,
    });
    history.undo();
    assert.equal(history.isBusy, true);
    assert.equal(history.canRedo, false);
    assert.equal(history.redo(), null, 'redo is ignored while the undo is saved');
    assert.equal(redone, 0);
    finish(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(history.isBusy, false);
    assert.equal(history.undoLabel, 'inversion', 'the failed undo is back');
    assert.equal(history.canRedo, false);
  });
});
