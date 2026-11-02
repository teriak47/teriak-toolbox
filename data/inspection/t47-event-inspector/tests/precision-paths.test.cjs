const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Test the actual inline implementation without loading or modifying the page.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
function between(start, end) {
  const first = html.indexOf(start);
  const last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source section: ${start}`);
  return html.slice(first, last);
}
const source = [
  "const SESSION_NONCE = '__test_number__'; const hasOwn = Object.prototype.hasOwnProperty; const DEFAULT_MAX_VISIBLE_COLS = 100; function parseHighPrecisionTimestamp() { return null; } const state = { compare: { datasetIdA: 'A', datasetIdB: 'B' } }; function getDatasetById(id) { return globalThis.datasets[id]; } function getColumnByLabel(ds, label) { return ds && ds.columns.find(c => c.label === label) || null; }",
  between('  function isPlainObject(', '  /* =========================================================================\n   * 3.'),
  between('  const MAX_NESTED_DEPTH =', '  function isValueAbsentOrEmpty('),
  between('  function encodeValueAtom(', '  function resolveComparisonSideIndices('),
  between('  function getUnionColumnLabels(', '  function refreshCompareSelectors('),
  between('  function makeFallbackColumnDescriptor(', '  async function executeComparison('),
  'globalThis.testApi = { RawNumber, parseJsonPreservingPrecision, formatJson, compareExactNumeric, encodeValueAtom, createSchemaBuilder, detectDefaultTemporalField, getFieldValue, getUnionColumnLabels, makeFallbackColumnDescriptor };'
].join('\n');
const context = vm.createContext({});
vm.runInContext(source, context);
const api = context.testApi;

test('timestamp detection uses the original field path rather than its display label', () => {
  const columns = [
    { id: '["date"]', path: ['date'], label: 'date', sampleChecked: 1, sampleTimeHits: 1 },
    { id: '["@timestamp"]', path: ['@timestamp'], label: '["@timestamp"]', sampleChecked: 1, sampleTimeHits: 1 },
    { id: '["nested","timestamp"]', path: ['nested', 'timestamp'], label: 'nested.timestamp', sampleChecked: 1, sampleTimeHits: 1 },
  ];
  assert.equal(api.detectDefaultTemporalField(columns.slice(0, 2)), columns[1].id);
  assert.equal(api.detectDefaultTemporalField(columns), columns[2].id);
});

test('tiny nonzero numbers survive JSON import and output', () => {
  for (const raw of ['1e-400', '-1e-9999', '1e-324', '9e-324', '0.' + '0'.repeat(323) + '1']) {
    const parsed = api.parseJsonPreservingPrecision('{"x":' + raw + '}');
    assert.equal(api.formatJson(parsed, 0), '{"x":' + raw + '}');
    assert.notEqual(api.compareExactNumeric(parsed.x, 0), 0);
  }
  assert.equal(api.compareExactNumeric(api.parseJsonPreservingPrecision('{"x":0e-400}').x, 0), 0);
});

test('numeric ordering handles huge exponents without expanding zeroes', () => {
  const compare = api.compareExactNumeric;
  assert.equal(compare('1e9999999999', '1'), 1);
  assert.equal(compare('1e-9999999999', '0'), 1);
  assert.equal(compare('-1e9999999999', '-1'), -1);
  assert.equal(compare('12e9999999999', '1.2e10000000000'), 0);
  assert.equal(compare('0.00120', '12e-4'), 0);
  assert.equal(compare('0', '-1e-9999999999'), 1);
});

test('comparison keys and field values use numeric value, not its spelling', () => {
  const parse = (raw) => api.parseJsonPreservingPrecision('{"n":' + raw + '}').n;
  const atom = (raw) => api.encodeValueAtom(parse(raw));
  for (const [left, right] of [['1e-400', '10e-401'], ['1e400', '10e399'], ['1.0', '1'], ['-0', '0']]) {
    const a = atom(left), b = atom(right);
    // The same identity is used for composite event keys and field value sets.
    assert.equal(JSON.stringify([a.key]), JSON.stringify([b.key]), `key: ${left}, ${right}`);
    assert.equal(new Map([[a.key, 'present']]).get(b.key), 'present', `value: ${left}, ${right}`);
  }
  for (const [left, right] of [['1e-400', '2e-400'], ['1e400', '2e400'], ['-1e-400', '1e-400'], ['0', '1e-400']]) {
    assert.notEqual(atom(left).key, atom(right).key, `${left}, ${right}`);
  }
  assert.equal(atom('10e-401').display, '10e-401');
  assert.notEqual(api.encodeValueAtom('1').key, atom('1').key);
});

test('literal dots and nested paths remain distinct on both sides', () => {
  const a = { id: 1, 'a.b': 'same', a: { b: 'before' }, 'x["y"]': 1 };
  const b = { id: 1, a: { b: 'after' }, 'a.b': 'same', 'x["y"]': 2 };
  const make = (row) => { const builder = api.createSchemaBuilder(); builder.registerRow(row); return { columns: builder.buildColumns() }; };
  const dsA = make(a), dsB = make(b);
  const fields = Array.from(api.getUnionColumnLabels(dsA, dsB));
  assert.ok(fields.includes('["a.b"]'));
  assert.ok(fields.includes('a.b'));
  assert.notEqual(fields.indexOf('["a.b"]'), fields.indexOf('a.b'));
  for (const ds of [dsA, dsB]) {
    const literal = ds.columns.find((c) => c.label === '["a.b"]');
    const nested = ds.columns.find((c) => c.label === 'a.b');
    assert.equal(api.getFieldValue(ds === dsA ? a : b, literal), 'same');
    assert.equal(api.getFieldValue(ds === dsA ? a : b, nested), ds === dsA ? 'before' : 'after');
  }
  assert.equal(new Set(fields).size, fields.length);
});

test('missing fields retain the path descriptor from the other side', () => {
  const builder = api.createSchemaBuilder();
  builder.registerRow({ 'a.b': 'literal', a: { b: 'nested' } });
  context.datasets = { A: { columns: [] }, B: { columns: builder.buildColumns() } };
  assert.equal(api.getFieldValue({ 'a.b': 'literal', a: { b: 'nested' } }, api.makeFallbackColumnDescriptor('["a.b"]')), 'literal');
  assert.equal(api.getFieldValue({ 'a.b': 'literal', a: { b: 'nested' } }, api.makeFallbackColumnDescriptor('a.b')), 'nested');
});
