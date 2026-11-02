import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

let formatForObsidian;
const scores = { avg7Point: 5, avg10Point: 7, avg5Point: 3.7 };
const criteria = [
  { id: 'story', label: 'Histoire', score: 5, weight: 2 },
  { id: 'music', label: 'Musique', score: 0, weight: 1 },
];

before(async () => {
  const result = await build({ entryPoints: ['src/services/obsidianExport.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
  ({ formatForObsidian } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`));
});

test('exports rated criteria without a vault-specific cover or CSS class', () => {
  const note = formatForObsidian(scores, criteria, 'Example', 'Films');
  assert.match(note, /# Example/);
  assert.match(note, /Histoire \| 5\/7 \| ×2/);
  assert.doesNotMatch(note, /\| Musique \|/);
  assert.match(note, /1 critère\(s\) noté\(s\) sur 2/);
  assert.doesNotMatch(note, /image_cover:|cssclasses:/);
});

test('encodes an optional cover image safely in YAML frontmatter', () => {
  const note = formatForObsidian(scores, criteria, 'Example', 'Films', 'covers/"example".png');
  assert.ok(note.includes('image_cover: "covers/\\"example\\".png"'));
});
