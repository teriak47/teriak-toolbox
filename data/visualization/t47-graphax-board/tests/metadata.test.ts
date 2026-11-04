import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkValueForKey,
  collectMetadataKeys,
  describeValue,
  detectValueType,
  matchesMetadataQuery,
  parseMetadataQuery,
  valueLink,
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
    assert.equal(parseMetadataQuery('ChimeraLoader'), null);
  });

  it('matches metadata by key and value, ignoring case, accents and defanging', () => {
    const meta = { Fiabilité: 'Confirmé (A1)', Domaine: 'telemetry[.]example' };
    assert.ok(matchesMetadataQuery(meta, parseMetadataQuery('fiabilite:confirme')!));
    assert.ok(matchesMetadataQuery(meta, parseMetadataQuery('domaine:telemetry.example')!));
    assert.ok(matchesMetadataQuery(meta, parseMetadataQuery('Domaine:')!));
    assert.ok(!matchesMetadataQuery(meta, parseMetadataQuery('IP:')!));
    assert.ok(!matchesMetadataQuery(meta, parseMetadataQuery('fiabilite:probable')!));
  });
});
