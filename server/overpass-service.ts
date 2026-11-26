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

const DEFAULT_ENDPOINT = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const DEFAULT_FALLBACK = 'https://overpass-api.de/api/interpreter';
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
    const fallback = options.fallbackEndpoint ?? DEFAULT_FALLBACK;
    this.endpoints = [...new Set([primary, fallback].filter(Boolean))];
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxBuildings = options.maxBuildings ?? 1200;
    this.cacheTtlMs = options.cacheTtlMs ?? 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 45_000;
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
      if (cached) this.cache.delete(key);
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
    return await waitForResult(tracked, options.signal);
  }

  private async queryAndCache(
    key: string,
    bbox: OverpassBbox,
  ): Promise<OsmBuildingsResponse> {
    await this.acquire();
    try {
      const query = `[out:json][timeout:40];way["building"](${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)});out tags geom 2000;`;
      const errors: string[] = [];
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
          this.remember(key, response);
          return response;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      throw new OverpassError(502, `Overpass gagal: ${errors.join(' | ').slice(0, 300)}`);
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
        `Overpass HTTP ${response.status}: ${body.slice(0, 180)}`,
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
