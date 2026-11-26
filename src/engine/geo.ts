import type { ActivityPoint } from '../domain/activity';

export interface Diorama {
  centerLat: number;
  centerLng: number;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  spanMetersX: number;
  spanMetersZ: number;
}

export interface RoutePoint {
  x: number;
  z: number;
  elapsedSec: number;
  distanceKm: number;
}

export interface RouteTransform {
  x: number;
  z: number;
  rotationY: number;
}

const WEB_MERCATOR_RADIUS = 6_378_137;

function mercator(lat: number, lng: number): { mx: number; my: number } {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return {
    mx: (WEB_MERCATOR_RADIUS * (lng * Math.PI)) / 180,
    my:
      WEB_MERCATOR_RADIUS *
      Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360)),
  };
}

export function buildDiorama(timeline: ActivityPoint[]): Diorama {
  if (timeline.length === 0) {
    return {
      centerLat: -6.2186,
      centerLng: 106.8026,
      minLat: -6.224,
      maxLat: -6.213,
      minLng: 106.796,
      maxLng: 106.809,
      spanMetersX: 1200,
      spanMetersZ: 1200,
    };
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const point of timeline) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const cos = Math.cos((centerLat * Math.PI) / 180);
  const topLeft = mercator(minLat, minLng);
  const bottomRight = mercator(maxLat, maxLng);
  return {
    centerLat,
    centerLng,
    minLat,
    maxLat,
    minLng,
    maxLng,
    spanMetersX: Math.max(300, Math.abs(bottomRight.mx - topLeft.mx) * cos),
    spanMetersZ: Math.max(300, Math.abs(bottomRight.my - topLeft.my) * cos),
  };
}

export function projectPoint(lat: number, lng: number, diorama: Diorama): { x: number; z: number } {
  const cos = Math.cos((diorama.centerLat * Math.PI) / 180);
  const center = mercator(diorama.centerLat, diorama.centerLng);
  const point = mercator(lat, lng);
  return {
    x: (point.mx - center.mx) * cos,
    z: -(point.my - center.my) * cos,
  };
}

export function buildRoute(timeline: ActivityPoint[], diorama: Diorama): RoutePoint[] {
  if (timeline.length === 0) return [];
  const stride = Math.max(1, Math.floor(timeline.length / 4500));
  const route: RoutePoint[] = [];
  for (let i = 0; i < timeline.length; i += stride) {
    const point = projectPoint(timeline[i].lat, timeline[i].lng, diorama);
    route.push({
      x: point.x,
      z: point.z,
      elapsedSec: timeline[i].elapsedSec,
      distanceKm: timeline[i].distanceKm,
    });
  }
  const last = timeline[timeline.length - 1];
  if (route[route.length - 1]?.elapsedSec !== last.elapsedSec) {
    const point = projectPoint(last.lat, last.lng, diorama);
    route.push({
      x: point.x,
      z: point.z,
      elapsedSec: last.elapsedSec,
      distanceKm: last.distanceKm,
    });
  }
  return smoothRoute(route);
}

/**
 * Angle-aware smoothing: keep straights straight, allow corners to round.
 * GPS wobble is the main visual artifact in a route render.
 */
export function smoothRoute(input: RoutePoint[]): RoutePoint[] {
  const length = input.length;
  if (length < 5) return input;
  const radius = Math.min(6, Math.max(2, Math.floor(length / 120)));
  let current = input.map((point) => ({ ...point }));
  for (let pass = 0; pass < 8; pass++) {
    const next = current.map((point) => ({ ...point }));
    for (let i = 1; i < length - 1; i++) {
      const left = Math.max(0, i - radius);
      const right = Math.min(length - 1, i + radius);
      const ax = current[i].x - current[left].x;
      const az = current[i].z - current[left].z;
      const bx = current[right].x - current[i].x;
      const bz = current[right].z - current[i].z;
      const aLen = Math.hypot(ax, az);
      const bLen = Math.hypot(bx, bz);
      let factor = 0.45;
      if (aLen > 0.5 && bLen > 0.5) {
        const cosine = (ax * bx + az * bz) / (aLen * bLen);
        factor = cosine > 0.93 ? 0.5 : cosine > 0.72 ? 0.24 : 0.03;
      }
      const midX = (current[i - 1].x + current[i + 1].x) * 0.5;
      const midZ = (current[i - 1].z + current[i + 1].z) * 0.5;
      next[i].x = current[i].x + (midX - current[i].x) * factor;
      next[i].z = current[i].z + (midZ - current[i].z) * factor;
    }
    current = next;
  }
  return current;
}

export function sampleRoute(route: RoutePoint[], elapsedSec: number): RouteTransform {
  if (route.length === 0) return { x: 0, z: 0, rotationY: 0 };
  const t = Math.max(0, Math.min(route[route.length - 1].elapsedSec, elapsedSec));
  let low = 0;
  let high = route.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (route[mid].elapsedSec <= t) low = mid;
    else high = mid;
  }
  const a = route[low];
  const b = route[Math.min(route.length - 1, low + 1)];
  const span = Math.max(1e-4, b.elapsedSec - a.elapsedSec);
  const ratio = Math.max(0, Math.min(1, (t - a.elapsedSec) / span));
  const x = a.x + (b.x - a.x) * ratio;
  const z = a.z + (b.z - a.z) * ratio;
  const back = route[Math.max(0, low - 4)];
  const ahead = route[Math.min(route.length - 1, low + 6)];
  const dx = ahead.x - back.x;
  const dz = ahead.z - back.z;
  return {
    x,
    z,
    rotationY: Math.hypot(dx, dz) > 0.05 ? Math.atan2(-dx, -dz) : 0,
  };
}

export function interpolateActivity(timeline: ActivityPoint[], elapsedSec: number): ActivityPoint {
  if (timeline.length === 0) {
    throw new Error('Activity timeline is empty');
  }
  if (elapsedSec <= timeline[0].elapsedSec) return timeline[0];
  const last = timeline[timeline.length - 1];
  if (elapsedSec >= last.elapsedSec) return last;
  let low = 0;
  let high = timeline.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (timeline[mid].elapsedSec <= elapsedSec) low = mid;
    else high = mid;
  }
  const a = timeline[low];
  const b = timeline[Math.min(timeline.length - 1, low + 1)];
  const span = Math.max(1e-4, b.elapsedSec - a.elapsedSec);
  const ratio = Math.max(0, Math.min(1, (elapsedSec - a.elapsedSec) / span));
  const speed = a.speed + (b.speed - a.speed) * ratio;
  return {
    elapsedSec,
    timestamp: a.timestamp,
    speed: Number(speed.toFixed(2)),
    paceMinPerKm: Number((1000 / speed / 60).toFixed(2)),
    paceFormatted: a.paceFormatted,
    heartRate: Math.round(a.heartRate + (b.heartRate - a.heartRate) * ratio),
    distanceKm: Number((a.distanceKm + (b.distanceKm - a.distanceKm) * ratio).toFixed(3)),
    elevationGain: Math.round(a.elevationGain + (b.elevationGain - a.elevationGain) * ratio),
    altitude: Number((a.altitude + (b.altitude - a.altitude) * ratio).toFixed(1)),
    cadence: Math.round(a.cadence + (b.cadence - a.cadence) * ratio),
    lat: a.lat + (b.lat - a.lat) * ratio,
    lng: a.lng + (b.lng - a.lng) * ratio,
  };
}
