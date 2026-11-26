import type { Diorama } from '../engine/geo';
import type { OsmBuilding } from '../shared/osm';

const PAD_METERS = 130;
const MAX_SPAN_DEGREES = 0.25;
const MAX_AREA_DEGREES = 0.03;
const CACHE_LIMIT = 8;
const cache = new Map<string, OsmBuilding[]>();

export interface OsmBbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

function bboxFor(diorama: Diorama): OsmBbox {
  const latPad = PAD_METERS / 111_320;
  const lngPad = PAD_METERS / (111_320 * Math.max(0.2, Math.cos((diorama.centerLat * Math.PI) / 180)));
  return {
    south: diorama.minLat - latPad,
    west: diorama.minLng - lngPad,
    north: diorama.maxLat + latPad,
    east: diorama.maxLng + lngPad,
  };
}

function bboxKey(bbox: OsmBbox): string {
  return [bbox.south, bbox.west, bbox.north, bbox.east]
    .map((value) => value.toFixed(5))
    .join(',');
}

function parseBuildings(body: unknown): OsmBuilding[] {
  if (!body || typeof body !== 'object' || !('buildings' in body)) {
    throw new Error('Respons OSM tidak valid.');
  }
  const buildings = body.buildings;
  if (!Array.isArray(buildings)) throw new Error('Respons OSM tidak valid.');
  return buildings.filter((building): building is OsmBuilding => {
    if (!building || typeof building !== 'object') return false;
    if (!('polygon' in building) || !Array.isArray(building.polygon)) return false;
    if (!('heightMeters' in building) || typeof building.heightMeters !== 'number') return false;
    if (!('colorHex' in building) || typeof building.colorHex !== 'string') return false;
    if (!('id' in building) || typeof building.id !== 'number') return false;
    return building.polygon.length >= 3;
  });
}

export async function fetchOsmBuildings(
  diorama: Diorama,
  signal: AbortSignal,
  force = false,
): Promise<OsmBuilding[]> {
  const bbox = bboxFor(diorama);
  const spanLat = bbox.north - bbox.south;
  const spanLng = bbox.east - bbox.west;
  if (
    spanLat > MAX_SPAN_DEGREES ||
    spanLng > MAX_SPAN_DEGREES ||
    spanLat * spanLng > MAX_AREA_DEGREES
  ) {
    throw new Error('Rute terlalu luas untuk query bangunan Overpass.');
  }
  const key = bboxKey(bbox);
  if (!force) {
    const cached = cache.get(key);
    if (cached) return cached;
  }

  let response: Response;
  try {
    response = await fetch('/api/osm/buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...bbox, refresh: force }),
      signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Server OSM tidak aktif. Jalankan server lokal (npm run dev).');
  }

  let body: unknown = null;
  let parsed = false;
  try {
    body = await response.json();
    parsed = true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // Fall through to the status check.
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Overpass HTTP ${response.status}`;
    throw new Error(message);
  }
  if (!parsed) throw new Error('Respons OSM tidak valid.');

  const buildings = parseBuildings(body);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, buildings);
  return buildings;
}
