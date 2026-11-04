import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exportFileName, moveItem, slugify } from '../src/lib/utils.ts';

describe('export file name', () => {
  it('keeps accented letters readable', () => {
    assert.equal(slugify('Opération Chimère — Enquête Cyber & Intrusion'), 'operation-chimere-enquete-cyber-intrusion');
  });

  it('falls back to "projet" for a name without letters or digits', () => {
    assert.equal(exportFileName('— ✦ —', new Date('2026-11-04T10:00:00Z')), 'graphax-projet-2026-11-04.json');
  });

  it('adds the date', () => {
    assert.equal(exportFileName('Lore', new Date('2026-01-02T00:00:00Z')), 'graphax-lore-2026-01-02.json');
  });
});

describe('moveItem', () => {
  it('moves an item without changing the original list', () => {
    const list = ['a', 'b', 'c', 'd'];
    assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(moveItem(list, 3, 0), ['d', 'a', 'b', 'c']);
    assert.deepEqual(moveItem(list, 1, 99), ['a', 'c', 'd', 'b']);
    assert.deepEqual(moveItem(list, 7, 0), list);
    assert.deepEqual(list, ['a', 'b', 'c', 'd']);
  });
});
