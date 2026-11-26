import type { OsmBuilding, OsmBuildingsResponse } from '../src/shared/osm';

export interface OverpassBbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OverpassServiceOptions {
  endpoint?: string;
  fallbackEndpoint?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  maxBuildings?: number;
  cacheTtlMs?: number;
  now?: () => number;
  requestTimeoutMs?: number;
}

export class OverpassError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OverpassError';
    this.status = status;
  }
}

const DEFAULT_ENDPOINT = 'https://ovp.dresel.systems/api-as/interpreter';
const DEFAULT_FALLBACK =
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter';
const USER_AGENT = 'JejakLariLocal/0.2 (local development; cached Overpass queries)';
const BUILDING_COLORS = ['#cbd5e1', '#d8c7a8', '#b9c6d8', '#e0d6c8', '#aebdc9', '#cdbfae', '#d5dde5'];
const MAX_CACHE_ENTRIES = 24;

interface OverpassElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat?: number; lon?: number }>;
}

interface CacheEntry {
  response: OsmBuildingsResponse;
  expiresAt: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseTagLength(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.replace(',', '.').match(/(-?\d+(?:\.\d+)?)\s*(m|meter|metres|ft|feet|')?/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const unit = (match[2] ?? 'm').toLowerCase();
  return unit === 'ft' || unit === 'feet' || unit === "'" ? numeric * 0.3048 : numeric;
}

function buildingHeight(tags: Record<string, string>, id: number): number {
  const explicit = parseTagLength(tags.height);
  if (explicit !== null) return clamp(explicit, 3, 180);
  const levels = Number.parseFloat((tags['building:levels'] ?? '').replace(',', '.'));
  if (Number.isFinite(levels) && levels > 0) return clamp(levels * 3.2 + 2, 3, 180);
  return 8 + (id % 17);
}

function buildingColor(tags: Record<string, string>, id: number): string {
  const tagged = tags['building:colour'] ?? tags['building:color'];
  if (tagged && /^#[0-9a-f]{6}$/i.test(tagged)) return tagged;
  return BUILDING_COLORS[id % BUILDING_COLORS.length];
}

function cleanPolygon(points: Array<{ lat?: number; lon?: number }>): Array<{ lat: number; lng: number }> {
  const polygon: Array<{ lat: number; lng: number }> = [];
  for (const point of points) {
    if (typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    const previous = polygon[polygon.length - 1];
    if (previous && Math.abs(previous.lat - point.lat) < 1e-9 && Math.abs(previous.lng - point.lon) < 1e-9) continue;
    polygon.push({ lat: point.lat, lng: point.lon });
  }
  if (polygon.length > 1) {
    const first = polygon[0];
    const last = polygon[polygon.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lng - last.lng) < 1e-9) polygon.pop();
  }
  return polygon;
}

function isOverpassElement(value: unknown): value is OverpassElement {
  return Boolean(value) && typeof value === 'object';
}

export function parseOverpassBuildings(
  payload: unknown,
  maxBuildings = 1200,
): { buildings: OsmBuilding[]; truncated: boolean } {
  if (!payload || typeof payload !== 'object' || !('elements' in payload)) {
    throw new OverpassError(502, 'Respons Overpass tidak valid.');
  }
  const elements = payload.elements;
  if ('remark' in payload && typeof payload.remark === 'string') {
    if (!Array.isArray(elements) || elements.length === 0) {
      throw new OverpassError(502, payload.remark.slice(0, 220));
    }
  }
  if (!Array.isArray(elements)) {
    throw new OverpassError(502, 'Respons Overpass tidak memiliki elements.');
  }

  const buildings: OsmBuilding[] = [];
  let truncated = false;
  for (const raw of elements) {
    if (!isOverpassElement(raw) || raw.type !== 'way' || typeof raw.id !== 'number') continue;
    const tags: Record<string, string> = Object.create(null);
    if (raw.tags && typeof raw.tags === 'object') {
      for (const [key, value] of Object.entries(raw.tags)) {
        if (typeof value === 'string') tags[key] = value;
      }
    }
    if (!tags.building || tags.building === 'no') continue;
    const polygon = cleanPolygon(Array.isArray(raw.geometry) ? raw.geometry : []);
    if (polygon.length < 3) continue;
    if (buildings.length >= maxBuildings) {
      truncated = true;
      break;
    }
    buildings.push({
      id: raw.id,
      heightMeters: Number(buildingHeight(tags, raw.id).toFixed(1)),
      colorHex: buildingColor(tags, raw.id),
      polygon,
    });
  }
  return { buildings, truncated };
}

function validateBbox(bbox: OverpassBbox): void {
  const values = [bbox.south, bbox.west, bbox.north, bbox.east];
  if (!values.every((value) => Number.isFinite(value))) {
    throw new OverpassError(400, 'Bounding box tidak valid.');
  }
  if (bbox.south >= bbox.north || bbox.west >= bbox.east) {
    throw new OverpassError(400, 'Bounding box terbalik.');
  }
  if (bbox.south < -90 || bbox.north > 90 || bbox.west < -180 || bbox.east > 180) {
    throw new OverpassError(400, 'Bounding box di luar koordinat bumi.');
  }
  const spanLat = bbox.north - bbox.south;
  const spanLng = bbox.east - bbox.west;
  if (spanLat > 0.25 || spanLng > 0.25 || spanLat * spanLng > 0.03) {
    throw new OverpassError(400, 'Area terlalu luas untuk query Overpass lokal.');
  }
}

function waitForResult<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException('Overpass dibatalkan.', 'AbortError'));
  }
  const { promise: aborted, reject } = Promise.withResolvers<never>();
  const onAbort = () => {
    signal.removeEventListener('abort', onAbort);
    reject(new DOMException('Overpass dibatalkan.', 'AbortError'));
  };
  signal.addEventListener('abort', onAbort, { once: true });
  return Promise.race([
    promise.finally(() => signal.removeEventListener('abort', onAbort)),
    aborted,
  ]);
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint.slice(0, 40);
  }
}

function responseFailure(status: number, body: string): string {
  if (status === 429) return 'rate limit (429)';
  if (status === 504) return 'timeout (504)';
  if (status === 502 || status === 503) return `sibuk (${status})`;
  const text = body
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return text ? `HTTP ${status}: ${text}` : `HTTP ${status}`;
}

function describeFailure(error: unknown): string {
  if (error instanceof OverpassError) return error.message;
  if (error instanceof Error) {
    if (/fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(error.message)) {
      return 'tidak dapat dihubungi';
    }
    return error.message.slice(0, 80);
  }
  return 'gagal';
}

export class OverpassService {
  private readonly endpoints: string[];
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBuildings: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<OsmBuildingsResponse>>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: OverpassServiceOptions = {}) {
    const primary = options.endpoint ?? DEFAULT_ENDPOINT;
    const fallbacks = (options.fallbackEndpoint ?? DEFAULT_FALLBACK)
      .split(',')
      .map((endpoint) => endpoint.trim())
      .filter(Boolean);
    this.endpoints = [...new Set([primary, ...fallbacks])];
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxBuildings = options.maxBuildings ?? 1200;
    this.cacheTtlMs = options.cacheTtlMs ?? 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async getBuildings(
    bbox: OverpassBbox,
    options: { signal?: AbortSignal; refresh?: boolean } = {},
  ): Promise<OsmBuildingsResponse> {
    validateBbox(bbox);
    const key = [bbox.south, bbox.west, bbox.north, bbox.east]
      .map((value) => value.toFixed(5))
      .join(',');
    if (!options.refresh) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > this.now()) {
        return { ...cached.response, cached: true };
      }
    }
    const pending = this.inFlight.get(key);
    if (pending) return waitForResult(pending, options.signal);

    const query = this.queryAndCache(key, bbox);
    const tracked = query.then(
      (result) => {
        this.inFlight.delete(key);
        return result;
      },
      (error) => {
        this.inFlight.delete(key);
        throw error;
      },
    );
    this.inFlight.set(key, tracked);
    try {
      return await waitForResult(tracked, options.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const stale = this.cache.get(key);
      if (stale) return { ...stale.response, cached: true, stale: true };
      throw error;
    }
  }

  private async queryAndCache(
    key: string,
    bbox: OverpassBbox,
  ): Promise<OsmBuildingsResponse> {
    await this.acquire();
    try {
      const query = `[out:json][timeout:30];way["building"](${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)});out tags geom 1500;`;
      const errors: string[] = [];
      let emptyRegion: OsmBuildingsResponse | null = null;
      for (const endpoint of this.endpoints) {
        try {
          const payload = await this.request(endpoint, query);
          const parsed = parseOverpassBuildings(payload, this.maxBuildings);
          const response: OsmBuildingsResponse = {
            source: 'openstreetmap',
            buildings: parsed.buildings,
            truncated: parsed.truncated,
            fetchedAt: new Date(this.now()).toISOString(),
          };
          if (parsed.buildings.length === 0) {
            // Regional mirrors (e.g. api-as) return an empty set outside their
            // coverage; try the next endpoint before accepting "no buildings".
            emptyRegion ??= response;
            continue;
          }
          this.remember(key, response);
          return response;
        } catch (error) {
          errors.push(`${hostOf(endpoint)}: ${describeFailure(error)}`);
        }
      }
      if (emptyRegion) {
        this.remember(key, emptyRegion);
        return emptyRegion;
      }
      throw new OverpassError(502, `Overpass gagal: ${errors.join(' | ').slice(0, 260)}`);
    } finally {
      this.release();
    }
  }

  private async request(endpoint: string, query: string): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
      body: new URLSearchParams({ data: query }),
      signal: timeout,
    });
    const body = await response.text();
    if (body.length > 8 * 1024 * 1024) {
      throw new OverpassError(502, 'Respons Overpass terlalu besar.');
    }
    if (!response.ok) {
      throw new OverpassError(
        response.status === 429 ? 429 : 502,
        responseFailure(response.status, body),
      );
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new OverpassError(502, 'Respons Overpass bukan JSON.');
    }
  }

  private remember(key: string, response: OsmBuildingsResponse): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { response, expiresAt: this.now() + this.cacheTtlMs });
  }

  private async acquire(): Promise<void> {
    if (this.active < 1) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}
