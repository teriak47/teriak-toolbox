const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script id="generator">([\s\S]*?)<\/script>/);
assert.ok(match, 'Generator script must exist in the standalone page');
const context = vm.createContext({});
vm.runInContext(match[1], context);
const { build } = context.ZircoSQL;

const defaults = {
  mode: 'shares', machine: '', rule: '', match: 'exact', level: '', guid: '',
  ip: '', channel: '', eventId: '', recordId: '', after: '', before: '',
  limit: '50', order: 'time',
};
const config = (values) => ({ ...defaults, ...values });
const guid = '{12345678-1234-1234-1234-123456789abc}';

test('all nine templates build a bounded SELECT for the intended event types', () => {
  const templates = [
    [{ mode: 'shares' }, /'5145'/],
    [{ mode: 'rules' }, /JOIN rules r USING \(rule_idx\)/],
    [{ mode: 'ruleEvents', rule: 'Example rule' }, /SELECT DISTINCT/],
    [{ mode: 'start', guid }, /ProcessGuid/],
    [{ mode: 'children', guid }, /ParentProcessGuid/],
    [{ mode: 'files', guid }, /TargetFileName/],
    [{ mode: 'network', guid }, /IN \('3', '22'\)/],
    [{ mode: 'logons' }, /IN \('4624', '4625'\)/],
    [{ mode: 'event', machine: 'host', channel: 'Security', eventId: '4624', recordId: '42' }, /EventRecordID/],
  ];
  for (const [values, expected] of templates) {
    const sql = build(config(values));
    assert.match(sql, /^SELECT /, values.mode);
    assert.match(sql, expected, values.mode);
    assert.match(sql, /LIMIT 50;$/, values.mode);
  }
});

test('summary aliases and their sort references use English names', () => {
  const shares = build(config({ mode: 'shares', order: 'rare' }));
  assert.match(shares, /AS source_ip/);
  assert.match(shares, /AS share_name/);
  assert.match(shares, /AS distinct_paths/);
  assert.match(shares, /ORDER BY access_count, first_seen_utc/);
  const rules = build(config({ mode: 'rules', order: 'rare' }));
  assert.match(rules, /AS rule_title/);
  assert.match(rules, /AS rule_level/);
  assert.match(rules, /ORDER BY event_count, first_seen_utc/);
  assert.match(build(config({ mode: 'logons' })), /AS time_utc/);
});

test('rule severity and process filters produce the requested scope', () => {
  const rules = build(config({ mode: 'rules', level: 'high', rule: 'Test rule' }));
  assert.match(rules, /LOWER\(r\.level\) IN \('high', 'critical'\)/);
  assert.match(rules, /LOWER\('Test rule'\)/);
  const children = build(config({ mode: 'children', guid: guid.slice(1, -1) }));
  assert.ok(children.includes("LOWER('{12345678-1234-1234-1234-123456789abc}')"));
  assert.match(children, /LOWER\(CAST\(e\.ParentProcessGuid AS VARCHAR\)\)/);
});

test('quoted inputs and wildcard searches remain literal', () => {
  const sql = build(config({ mode: 'ruleEvents', machine: "host'one", rule: "a'!%_b", match: 'contains' }));
  assert.ok(sql.includes("LOWER('host''one')"));
  assert.ok(sql.includes("ILIKE '%a''!!!%!_b%' ESCAPE '!'"));
});

test('dates are valid UTC ranges with inclusive start and exclusive end', () => {
  const sql = build(config({ after: '2024-02-29T00:00', before: '2024-03-01T12:30:00.000001' }));
  assert.match(sql, /e\._zl_time >= TIMESTAMP '2024-02-29 00:00:00'/);
  assert.match(sql, /e\._zl_time < TIMESTAMP '2024-03-01 12:30:00\.000001'/);
  assert.throws(() => build(config({ after: '2023-02-29T00:00' })));
  assert.throws(() => build(config({ after: '2024-01-01T00:00:00.1', before: '2024-01-01T00:00:00.10' })));
  assert.throws(() => build(config({ after: '2024-01-01T00:00:00.100001', before: '2024-01-01T00:00:00.1' })));
  assert.doesNotThrow(() => build(config({ after: '2024-01-01T00:00:00.1', before: '2024-01-01T00:00:00.100001' })));
});

test('invalid modes, limits, GUIDs and missing required inputs are rejected', () => {
  for (const limit of ['0', '5001', '-1', '1.5', '1e2', '']) {
    assert.throws(() => build(config({ limit })), `limit ${limit}`);
  }
  assert.throws(() => build(config({ mode: 'unknown' })));
  assert.throws(() => build(config({ mode: 'ruleEvents' })));
  assert.throws(() => build(config({ mode: 'start', guid: '{12345678-1234-1234-1234-123456789abc' })));
  assert.throws(() => build(config({ mode: 'event', machine: 'host', channel: 'Security', eventId: 'x', recordId: '42' })));
});
