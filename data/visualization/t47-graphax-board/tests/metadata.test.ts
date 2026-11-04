import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeCategoryKeys, normalizeKeyList } from '../shared/types.ts';
import {
  cardEntries,
  checkValueForKey,
  collectMetadataKeys,
  describeValue,
  detectValueType,
  matchesMetadataQuery,
  missingCategoryKeys,
  parseMetadataQuery,
  valueLink,
  withCategoryKeys,
} from '../src/lib/metadata.ts';

describe('metadata value types', () => {
  it('recognises common investigation values', () => {
    const cases: Array<[string, string]> = [
      ['https://example.org/a?b=1', 'url'],
      ['hxxps://telemetry[.]example/x', 'url'],
      ['analyst@example.org', 'email'],
      ['192.0.2.42', 'ipv4'],
      ['192.0.2.0/24', 'ipv4'],
      ['2001:db8::1', 'ipv6'],
      ['2001:db8:1:2:3:4:5::', 'ipv6'],
      ['::2001:db8:1:2:3:4:5', 'ipv6'],
      ['::', 'ipv6'],
      ['::1', 'ipv6'],
      ['fe80::/10', 'ipv6'],
      ['2001:db8:0:0:0:0:0:1', 'ipv6'],
      ['2001:db8:1:2:3:4:5:6:7', 'text'],
      [':2001:db8:1:2:3:4:5:6', 'text'],
      ['2001:db8:1:2:3:4:5:6::', 'text'],
      ['2001::db8::1', 'text'],
      ['64:ff9b::192.0.2.1', 'ipv6'],
      ['::ffff:192.0.2.1', 'ipv6'],
      ['1:2:3:4:5:6:192.0.2.1', 'ipv6'],
      ['fe80::1%eth0', 'ipv6'],
      ['::ffff:192.0.2.300', 'text'],
      ['1:2:3:4:5:6:7:192.0.2.1', 'text'],
      ['2001:db8::/129', 'text'],
      ['12:30', 'text'],
      ['2026-10-22', 'date'],
      ['2026-10-22 08:14 UTC', 'date'],
      ['22/10/2026', 'date'],
      ['d41d8cd98f00b204e9800998ecf8427e', 'md5'],
      ['da39a3ee5e6b4b0d3255bfef95601890afd80709', 'sha1'],
      ['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sha256'],
      ['8443', 'number'],
      ['Confirmé (A1)', 'text'],
      ['256.1.1.1', 'text'],
      ['2026-13-40', 'text'],
    ];
    for (const [value, type] of cases) assert.equal(detectValueType(value), type, value);
  });

  it('flags a value that does not fit its key, and nothing else', () => {
    assert.match(checkValueForKey('Date', 'hier') ?? '', /Date attendue/);
    assert.match(checkValueForKey('IP', 'serveur') ?? '', /IP attendue/);
    assert.match(checkValueForKey('URL', 'example.org') ?? '', /URL attendue/);
    assert.equal(checkValueForKey('Date', '2026-10-22'), null);
    assert.equal(checkValueForKey('IP / Hash', '192.0.2.42'), null);
    assert.equal(checkValueForKey('IP / Hash', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'), null);
    assert.equal(checkValueForKey('SHA-256', '9f86d081884c7d659a2f...'), null, 'truncated values are allowed');
    assert.equal(checkValueForKey('Date', ''), null);
    assert.equal(checkValueForKey('Statut', 'n’importe quoi'), null);
    assert.equal(checkValueForKey('Description', 'texte libre'), null);
  });

  it('only links plain http(s) values, never defanged ones', () => {
    assert.equal(valueLink('https://example.org/a'), 'https://example.org/a');
    assert.equal(valueLink('hxxps://telemetry[.]example/x'), null);
    assert.equal(valueLink('https://telemetry[.]example/x'), null);
    assert.equal(describeValue('hxxps://telemetry[.]example/x'), 'URL désamorcée');
    assert.equal(describeValue('192.0.2[.]42'), 'IPv4 désamorcée');
    assert.equal(describeValue('192.0.2.42'), 'IPv4');
    assert.equal(describeValue('Confirmé'), null);
    assert.equal(valueLink('javascript:alert(1)'), null);
    assert.equal(valueLink('example.org'), null);
  });
});

describe('metadata keys and search', () => {
  it('suggests project keys, most used first, in their usual spelling', () => {
    const keys = collectMetadataKeys([
      { metadata: { IP: '1', Statut: 'a' } },
      { metadata: { ip: '2', Fiabilité: 'b' } },
      { metadata: { IP: '3' } },
      { metadata: {} },
    ]);
    assert.equal(keys[0], 'IP');
    assert.deepEqual(new Set(keys.slice(1)), new Set(['Statut', 'Fiabilité']));
    assert.equal(keys.length, 3);
  });

  it('parses key:value queries and leaves URLs, IPv6 and plain text alone', () => {
    assert.deepEqual(parseMetadataQuery('IP:192.0.2'), { key: 'ip', value: '192.0.2' });
    assert.deepEqual(parseMetadataQuery('Fiabilité : confirmé'), { key: 'fiabilite', value: 'confirme' });
    assert.deepEqual(parseMetadataQuery('Statut:'), { key: 'statut', value: '' });
    assert.equal(parseMetadataQuery('https://example.org'), null);
    assert.equal(parseMetadataQuery('2001:db8::1'), null);
    assert.equal(parseMetadataQuery('2001:db8:1:2:3:4:5::'), null);
    assert.equal(parseMetadataQuery('64:ff9b::192.0.2.1'), null);
    assert.equal(parseMetadataQuery('fe80::1%eth0'), null);
    assert.equal(parseMetadataQuery('ChimeraLoader'), null);
    // A recognised value after the key is still a key:value query
    assert.deepEqual(parseMetadataQuery('Email:alice@example.org'), { key: 'email', value: 'alice@example.org' });
    assert.deepEqual(parseMetadataQuery('Date:2026-10-22'), { key: 'date', value: '2026-10-22' });
  });

  it('matches metadata by key and value, ignoring case, accents and defanging', () => {
    const meta = { Fiabilité: 'Confirmé (A1)', Domaine: 'telemetry[.]example' };
    assert.ok(matchesMetadataQuery(meta, parseMetadataQuery('fiabilite:confirme')!));
    assert.ok(matchesMetadataQuery(meta, parseMetadataQuery('domaine:telemetry.example')!));
    assert.ok(matchesMetadataQuery(meta, parseMetadataQuery('domaine:telemetry[.]example')!), 'defanged query');
    assert.ok(
      matchesMetadataQuery({ Domaine: 'telemetry.example' }, parseMetadataQuery('Domaine:telemetry[.]example')!),
      'defanged query against a plain value'
    );
    assert.ok(matchesMetadataQuery({ Email: 'alice@example.org' }, parseMetadataQuery('Email:alice@example.org')!));
    assert.ok(matchesMetadataQuery(meta, parseMetadataQuery('Domaine:')!));
    assert.ok(!matchesMetadataQuery(meta, parseMetadataQuery('IP:')!));
    assert.ok(!matchesMetadataQuery(meta, parseMetadataQuery('fiabilite:probable')!));
    // An empty default field does not count as having the key
    assert.ok(!matchesMetadataQuery({ IP: '', Pays: ' ' }, parseMetadataQuery('IP:')!));
    assert.ok(!matchesMetadataQuery({ Pays: '' }, parseMetadataQuery('Pays:')!));
  });
});

describe('category default keys', () => {
  it('cleans key lists', () => {
    assert.deepEqual(normalizeKeyList(['  IP ', 'ip', 'Pays', 3, '', 'Première vue', 'premiere VUE'], 12), [
      'IP',
      'Pays',
      'Première vue',
    ]);
    assert.deepEqual(normalizeKeyList('IP', 12), []);
    assert.deepEqual(normalizeKeyList(['a', 'b', 'c'], 2), ['a', 'b']);
    assert.equal(normalizeKeyList(['x'.repeat(100)], 12)[0].length, 60);
  });

  it('keeps card keys among the default keys, two at most', () => {
    assert.deepEqual(normalizeCategoryKeys(['IP', 'ASN', 'Pays'], ['ip', 'Port', 'Pays', 'ASN']), {
      metadataKeys: ['IP', 'ASN', 'Pays'],
      cardKeys: ['IP', 'Pays'],
    });
    assert.deepEqual(normalizeCategoryKeys(undefined, ['IP']), { metadataKeys: [], cardKeys: [] });
  });

  it('adds missing default keys without touching existing values', () => {
    const cat = { metadataKeys: ['IP', 'ASN', 'Première vue'], cardKeys: ['IP'] };
    const meta = { ip: '192.0.2.1', Note: 'x', 'premiere vue': '' };
    assert.deepEqual(missingCategoryKeys(cat, meta), ['ASN']);
    assert.deepEqual(withCategoryKeys(cat, meta), { ...meta, ASN: '' });
    assert.deepEqual(withCategoryKeys(null, meta), meta);
    assert.deepEqual(withCategoryKeys(cat, undefined), { IP: '', ASN: '', 'Première vue': '' });
  });

  it('lists the card values that are filled, in the category order', () => {
    const cat = { metadataKeys: ['IP', 'Pays'], cardKeys: ['Pays', 'IP'] };
    assert.deepEqual(cardEntries(cat, { IP: ' 192.0.2.1 ', pays: 'FR' }), [
      { key: 'pays', value: 'FR' },
      { key: 'IP', value: '192.0.2.1' },
    ]);
    assert.deepEqual(cardEntries(cat, { IP: '', Pays: '  ' }), []);
    assert.deepEqual(cardEntries(undefined, { IP: '1' }), []);
  });
});
