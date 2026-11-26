import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: true,
});

export type XmlNode = Record<string, unknown>;

export function parseXml(text: string): XmlNode {
  return parser.parse(text) as XmlNode;
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function child(node: unknown, key: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  return (node as Record<string, unknown>)[key];
}

export function textOf(node: unknown, key: string): string | null {
  const value = child(node, key);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) {
    const text = (value as Record<string, unknown>)['#text'];
    if (typeof text === 'string' || typeof text === 'number') return String(text);
  }
  return null;
}

export function numberOf(node: unknown, key: string): number | null {
  const value = child(node, key);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const NORMALIZE_KEY = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * GPX extensions vary by vendor (gpxtpx, ns3, garmin_tpx...). After namespace
 * stripping, search the subtree for the first numeric heart-rate/cadence key.
 */
export function findNumericDeep(
  node: unknown,
  keys: readonly string[],
  depth = 0,
): number | null {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  const wanted = new Set(keys.map(NORMALIZE_KEY));
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (wanted.has(NORMALIZE_KEY(key))) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      if (value && typeof value === 'object' && '#text' in value) {
        const parsed = Number((value as Record<string, unknown>)['#text']);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    if (value && typeof value === 'object') {
      const nested = findNumericDeep(value, keys, depth + 1);
      if (nested !== null) return nested;
    }
  }
  return null;
}

export function pointsFromTrackPoints(nodes: unknown[]): Array<{
  lat: number;
  lng: number;
  ele: number | null;
  timeMs: number | null;
  hr: number | null;
  cad: number | null;
  distMeters: number | null;
}> {
  const points = [];
  for (const node of nodes) {
    const rawLat = child(node, '@_lat');
    const rawLng = child(node, '@_lon');
    const lat = typeof rawLat === 'number' ? rawLat : Number(rawLat);
    const lng = typeof rawLng === 'number' ? rawLng : Number(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const timeText = textOf(node, 'time');
    const timeMs = timeText ? Date.parse(timeText) : Number.NaN;
    const extensions = child(node, 'extensions');
    const distanceMeters = numberOf(node, 'DistanceMeters');
    points.push({
      lat,
      lng,
      ele: numberOf(node, 'ele') ?? numberOf(node, 'AltitudeMeters'),
      timeMs: Number.isFinite(timeMs) ? timeMs : null,
      hr:
        numberOf(node, 'hr') ??
        findNumericDeep(extensions, ['hr', 'heartrate', 'heartRateBpm']) ??
        numberOf(node, 'HeartRateBpm'),
      cad:
        numberOf(node, 'cad') ??
        findNumericDeep(extensions, ['cad', 'cadence']) ??
        numberOf(node, 'Cadence'),
      distMeters: distanceMeters,
    });
  }
  return points;
}
