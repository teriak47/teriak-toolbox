// Helpers for node metadata (free key/value pairs): recognising value types, checking a
// value against what its key suggests, project-wide key suggestions and "key:value" search.
// Pure functions without React, so they can be unit tested.

import type { NodeMetadata } from '../../shared/types.ts';

export type MetaValueType =
  | 'url'
  | 'email'
  | 'ipv4'
  | 'ipv6'
  | 'date'
  | 'md5'
  | 'sha1'
  | 'sha256'
  | 'sha512'
  | 'number'
  | 'text';

export const META_TYPE_LABELS: Record<MetaValueType, string> = {
  url: 'URL',
  email: 'E-mail',
  ipv4: 'IPv4',
  ipv6: 'IPv6',
  date: 'Date',
  md5: 'MD5',
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha512: 'SHA-512',
  number: 'Nombre',
  text: 'Texte',
};

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(\/([0-9]|[12]\d|3[0-2]))?$/;
const IPV4_ADDRESS = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// Address, optional zone (fe80::1%eth0), optional prefix length
const IPV6 = /^([0-9a-f:.]+)(%[0-9a-z._-]+)?(\/(\d{1,3}))?$/i;
const HEXTET = /^[0-9a-f]{1,4}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])([ T]\d{2}:\d{2}(:\d{2})?( ?UTC|Z)?)?$/i;
const FR_DATE = /^(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/\d{4}$/;
const HEX = /^[0-9a-f]+$/i;
const NUMBER = /^-?\d+([.,]\d+)?$/;

function isValidIpv6(value: string): boolean {
  const match = IPV6.exec(value);
  if (!match || !match[1].includes(':') || (match[4] && Number(match[4]) > 128)) return false;
  let address = match[1];
  // A dotted IPv4 tail (64:ff9b::192.0.2.1) stands for the last two groups
  const lastColon = address.lastIndexOf(':');
  const tail = address.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!IPV4_ADDRESS.test(tail)) return false;
    address = `${address.slice(0, lastColon + 1)}0:0`;
  }
  // At most one "::", which stands for one or more zero groups; it may sit at either end
  const halves = address.split('::');
  if (halves.length > 2) return false;
  const hextets = halves.flatMap((half) => (half === '' ? [] : half.split(':')));
  if (!hextets.every((g) => HEXTET.test(g))) return false;
  return halves.length === 2 ? hextets.length <= 7 : hextets.length === 8;
}

// Defanged indicators (hxxp, [.]) are common in investigation notes; read them as the real thing
export function refang(value: string): string {
  return value
    .trim()
    .replace(/^hxxp/i, 'http')
    .replace(/\[\.\]|\(\.\)|\{\.\}/g, '.')
    .replace(/\[:\]/g, ':');
}

export function detectValueType(raw: string): MetaValueType {
  const value = refang(raw);
  if (!value) return 'text';
  if (/^https?:\/\/[^\s]+$/i.test(value)) return 'url';
  if (EMAIL.test(value)) return 'email';
  if (IPV4.test(value)) return 'ipv4';
  if (isValidIpv6(value)) return 'ipv6';
  if (ISO_DATE.test(value) || FR_DATE.test(value)) return 'date';
  if (HEX.test(value)) {
    if (value.length === 32) return 'md5';
    if (value.length === 40) return 'sha1';
    if (value.length === 64) return 'sha256';
    if (value.length === 128) return 'sha512';
  }
  if (NUMBER.test(value)) return 'number';
  return 'text';
}

// Expected value kinds suggested by common key names (French and English)
const KEY_EXPECTATIONS: Array<{ pattern: RegExp; accepts: MetaValueType[]; hint: string }> = [
  { pattern: /\b(date|jour|horodatage|timestamp|cr[ée]ation)\b/i, accepts: ['date'], hint: 'Date attendue (AAAA-MM-JJ ou JJ/MM/AAAA).' },
  { pattern: /\b(ip|ipv4|ipv6|adresse ip)\b/i, accepts: ['ipv4', 'ipv6', 'md5', 'sha1', 'sha256', 'sha512'], hint: 'Adresse IP attendue (ex. 192.0.2.10 ou 2001:db8::1).' },
  { pattern: /\b(url|lien|site|link)\b/i, accepts: ['url'], hint: 'URL attendue, commençant par http:// ou https://.' },
  { pattern: /\b(e-?mail|courriel)\b/i, accepts: ['email'], hint: 'Adresse e-mail attendue.' },
  { pattern: /\b(md5|sha-?1|sha-?256|sha-?512|hash|empreinte)\b/i, accepts: ['md5', 'sha1', 'sha256', 'sha512'], hint: 'Empreinte hexadécimale attendue (MD5, SHA-1, SHA-256 ou SHA-512).' },
];

// Returns a hint when the key suggests a kind of value that the value is not; null otherwise.
// Empty values and values ending with "…" (truncated on purpose) are never flagged.
export function checkValueForKey(key: string, value: string): string | null {
  const v = value.trim();
  if (!v || v.endsWith('…') || v.endsWith('...')) return null;
  const type = detectValueType(v);
  for (const rule of KEY_EXPECTATIONS) {
    if (rule.pattern.test(key)) return rule.accepts.includes(type) ? null : rule.hint;
  }
  return null;
}

// True when a value was deliberately defanged (hxxp, [.]) so it cannot be opened by mistake
export function isDefanged(value: string): boolean {
  return refang(value) !== value.trim();
}

// Link target for a value, or null when it is not an http(s) URL. Defanged URLs are never
// linked: they were written that way so that nobody opens them by accident.
export function valueLink(value: string): string | null {
  const v = value.trim();
  return !isDefanged(v) && /^https?:\/\/[^\s]+$/i.test(v) ? v : null;
}

// Short description shown under a metadata value
export function describeValue(value: string): string | null {
  const type = detectValueType(value);
  if (type === 'text') return null;
  return isDefanged(value) ? `${META_TYPE_LABELS[type]} désamorcée` : META_TYPE_LABELS[type];
}

// Comparable form of a key or value: case and accents ignored
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Keys used in the project, most used first, spelled as they are most often written
export function collectMetadataKeys(nodes: Array<{ metadata?: NodeMetadata }>): string[] {
  const counts = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const n of nodes) {
    for (const key of Object.keys(n.metadata ?? {})) {
      const folded = foldText(key);
      if (!folded) continue;
      const entry = counts.get(folded) ?? { count: 0, spellings: new Map<string, number>() };
      entry.count += 1;
      entry.spellings.set(key, (entry.spellings.get(key) ?? 0) + 1);
      counts.set(folded, entry);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .map((e) => [...e.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}

export interface MetadataQuery {
  key: string;
  value: string;
}

// "IP:192.0.2" searches the value of matching keys; "IP:" finds nodes that have the key.
// Anything else is a plain text query (returns null). URLs and IPv6 values are not split.
export function parseMetadataQuery(query: string): MetadataQuery | null {
  const q = query.trim();
  const match = /^([^:\s][^:]*?)\s*:\s*(.*)$/.exec(q);
  if (!match) return null;
  const [, key, value] = match;
  // Only a whole URL or IPv6 address is a plain query; "Email:a@b.org" is still key:value
  const whole = detectValueType(q);
  if (/^(https?|hxxps?)$/i.test(key) || whole === 'url' || whole === 'ipv6') return null;
  // Defanging is ignored on both sides: "telemetry[.]example" finds "telemetry.example"
  return { key: foldText(key), value: foldText(refang(value)) };
}

// An empty field (a default key not filled yet) never matches, not even "Clé:"
export function matchesMetadataQuery(metadata: NodeMetadata | undefined, query: MetadataQuery): boolean {
  return Object.entries(metadata ?? {}).some(([k, v]) => {
    const value = foldText(refang(v));
    return value !== '' && foldText(k).includes(query.key) && value.includes(query.value);
  });
}

// ---- Category default keys (V6) ----

type CategoryKeys = { metadataKeys?: string[]; cardKeys?: string[] } | null | undefined;

// Default keys of the category that the node does not have yet (case and accents ignored)
export function missingCategoryKeys(category: CategoryKeys, metadata: NodeMetadata | undefined): string[] {
  const present = new Set(Object.keys(metadata ?? {}).map(foldText));
  return (category?.metadataKeys ?? []).filter((k) => !present.has(foldText(k)));
}

// Metadata with the category's missing default keys added, empty, after the existing ones
export function withCategoryKeys(category: CategoryKeys, metadata: NodeMetadata | undefined): NodeMetadata {
  const out: NodeMetadata = { ...(metadata ?? {}) };
  for (const key of missingCategoryKeys(category, metadata)) out[key] = '';
  return out;
}

// Values shown on the node card: the category's card keys that hold a value, in their order
export function cardEntries(
  category: CategoryKeys,
  metadata: NodeMetadata | undefined
): Array<{ key: string; value: string }> {
  const entries = Object.entries(metadata ?? {});
  const out: Array<{ key: string; value: string }> = [];
  for (const cardKey of category?.cardKeys ?? []) {
    const folded = foldText(cardKey);
    const found = entries.find(([k, v]) => foldText(k) === folded && v.trim());
    if (found) out.push({ key: found[0], value: found[1].trim() });
  }
  return out;
}
