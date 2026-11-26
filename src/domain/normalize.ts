import type { Activity, ActivityPoint, RawActivity, RawTrackPoint } from './activity';
import { ActivityParseError } from './activity';
import { formatActivityDate, formatPace } from './format';

export interface NormalizeOptions {
  activityName?: string;
  locationName?: string;
  startMsOverride?: number;
  totalDistanceMetersOverride?: number | null;
  totalDurationSecOverride?: number | null;
  totalElevationGainOverride?: number | null;
  timeZone?: string;
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function validPoint(point: RawTrackPoint): boolean {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return false;
  return !(Math.abs(point.lat) < 1e-4 && Math.abs(point.lng) < 1e-4);
}

/**
 * Fill sparse timestamps by index so a missing sample does not create a zero-duration
 * segment. Returns null when the file cannot provide a usable time base.
 */
function resolveTimeBase(points: RawTrackPoint[]): number[] | null {
  const known: Array<{ index: number; value: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const value = points[i].timeMs;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      known.push({ index: i, value });
    }
  }
  if (known.length < 2 || known.length < points.length * 0.5) return null;
  const first = known[0];
  const last = known[known.length - 1];
  if (last.value <= first.value) return null;

  const times = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) times[i] = Number.NaN;
  for (const item of known) times[item.index] = item.value;
  for (let k = 0; k < known.length - 1; k++) {
    const left = known[k];
    const right = known[k + 1];
    const span = right.index - left.index;
    for (let i = left.index; i <= right.index; i++) {
      const ratio = span > 0 ? (i - left.index) / span : 0;
      times[i] = left.value + (right.value - left.value) * ratio;
    }
  }
  for (let i = 0; i < first.index; i++) times[i] = times[first.index];
  for (let i = last.index + 1; i < points.length; i++) times[i] = times[last.index];
  return times;
}

function elevationProfile(
  elevations: Array<number | null | undefined>,
  fallback: number,
): { gains: number[]; altitudes: number[] } {
  const gains: number[] = [];
  const altitudes: number[] = [];
  let smoothed = fallback;
  let reference = fallback;
  let gain = 0;
  for (let i = 0; i < elevations.length; i++) {
    const raw = elevations[i];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : smoothed;
    smoothed = i === 0 ? value : smoothed * 0.78 + value * 0.22;
    if (i > 0) {
      const delta = smoothed - reference;
      if (delta >= 1.5) {
        gain += delta;
        reference = smoothed;
      } else if (delta <= -1.5) {
        reference = smoothed;
      }
    }
    gains.push(Math.round(gain));
    altitudes.push(smoothed);
  }
  return { gains, altitudes };
}

export function normalizeActivity(raw: RawActivity, options: NormalizeOptions = {}): Activity {
  const points = raw.points.filter(validPoint);
  if (points.length < 2) {
    throw new ActivityParseError('Koordinat GPS valid di dalam file aktivitas kurang dari 2 titik.');
  }

  const times = resolveTimeBase(points);
  const startMs = options.startMsOverride ?? times?.[0] ?? points[0].timeMs ?? Date.now();

  let measuredMeters = 0;
  for (let i = 1; i < points.length; i++) {
    const step = haversineMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    if (step < 80) measuredMeters += step;
  }
  const measuredKm = Math.max(0.05, measuredMeters / 1000);
  const density = points.length / measuredKm;
  const syntheticTiming = !times && density >= 175 && density <= 950;

  const distances = new Array<number>(points.length).fill(0);
  const elapsed = new Array<number>(points.length).fill(0);
  let distance = 0;
  let clock = 0;
  let lastTime = times?.[0] ?? startMs;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (i > 0) {
      const previous = points[i - 1];
      let step = haversineMeters(previous.lat, previous.lng, point.lat, point.lng);
      let delta: number;
      if (times) {
        const currentTime = times[i];
        delta = Math.max(0, (currentTime - lastTime) / 1000);
        lastTime = currentTime;
      } else if (syntheticTiming) {
        delta = step >= 0.45 ? 1 : 0.12;
      } else {
        delta = step / 2.78;
      }
      if (delta > 0 && step / delta > 12) step = Math.min(step, 5 * delta);

      const provided = point.distMeters;
      if (
        typeof provided === 'number' &&
        Number.isFinite(provided) &&
        provided >= distance &&
        provided - distance < 500
      ) {
        distance = provided;
      } else {
        distance += step;
      }
      clock += delta;
    } else if (typeof point.distMeters === 'number' && Number.isFinite(point.distMeters)) {
      distance = Math.max(0, point.distMeters);
    }
    distances[i] = distance;
    elapsed[i] = clock;
  }

  const overrideDistance = options.totalDistanceMetersOverride ?? raw.sessionDistanceMeters ?? null;
  const totalMeters = overrideDistance !== null && overrideDistance > 50 ? overrideDistance : distance;
  const scale = distance > 20 ? totalMeters / distance : 1;
  const totalKm = Math.max(0.05, totalMeters / 1000);
  const measuredDuration = Math.ceil(elapsed[elapsed.length - 1]);
  const sessionDuration =
    typeof raw.sessionDurationSec === 'number' && raw.sessionDurationSec > 10
      ? Math.ceil(raw.sessionDurationSec)
      : 0;
  const totalDurationSec = Math.max(
    10,
    options.totalDurationSecOverride && options.totalDurationSecOverride > 10
      ? Math.round(options.totalDurationSecOverride)
      : Math.max(measuredDuration, sessionDuration),
  );

  const altFallback =
    points.find((p) => typeof p.ele === 'number' && Number.isFinite(p.ele))?.ele ?? 30;
  const profile = elevationProfile(
    points.map((p) => p.ele),
    altFallback,
  );
  const gains = profile.gains;

  const stride = Math.max(1, Math.floor(points.length / 3600));
  const timeline: ActivityPoint[] = [];
  let heartSum = 0;
  let cadenceSum = 0;
  const fallbackSpeed = Math.max(0.9, Math.min(7.5, totalMeters / Math.max(1, totalDurationSec)));

  for (let i = 0; i < points.length; i += stride) {
    const point = points[i];
    const left = Math.max(0, i - 3);
    const right = Math.min(points.length - 1, i + 3);
    const seconds = elapsed[right] - elapsed[left];
    let speed = seconds > 0 ? ((distances[right] - distances[left]) * scale) / seconds : 0;
    if (!Number.isFinite(speed) || speed < 0.6 || speed > 9.5) speed = fallbackSpeed;
    const pace = 1000 / speed / 60;
    const heartRate =
      typeof point.hr === 'number' && Number.isFinite(point.hr)
        ? point.hr
        : Math.round(Math.min(188, Math.max(115, 128 + (speed - 2) * 16)));
    const cadence =
      typeof point.cad === 'number' && Number.isFinite(point.cad)
        ? point.cad
        : Math.round(Math.min(196, Math.max(148, 158 + (speed - 2) * 9)));
    heartSum += heartRate;
    cadenceSum += cadence;
    timeline.push({
      elapsedSec: Math.round(elapsed[i] * 10) / 10,
      timestamp: new Date(startMs + 1000 * elapsed[i]).toISOString(),
      speed: Number(speed.toFixed(2)),
      paceMinPerKm: Number(pace.toFixed(2)),
      paceFormatted: formatPace(pace),
      heartRate,
      distanceKm: Number(((distances[i] * scale) / 1000).toFixed(3)),
      elevationGain: gains[i],
      altitude: Number((profile.altitudes[i] ?? altFallback).toFixed(1)),
      cadence,
      lat: point.lat,
      lng: point.lng,
    });
  }

  const lastIndex = points.length - 1;
  const lastPoint = points[lastIndex];
  if (timeline[timeline.length - 1].elapsedSec < totalDurationSec - 0.5) {
    const finalSpeed = Math.max(1, totalMeters / Math.max(1, totalDurationSec));
    timeline.push({
      elapsedSec: totalDurationSec,
      timestamp: new Date(startMs + 1000 * totalDurationSec).toISOString(),
      speed: Number(finalSpeed.toFixed(2)),
      paceMinPerKm: Number((1000 / finalSpeed / 60).toFixed(2)),
      paceFormatted: formatPace(1000 / finalSpeed / 60),
      heartRate:
        typeof lastPoint.hr === 'number' && Number.isFinite(lastPoint.hr)
          ? lastPoint.hr
          : Math.round(heartSum / Math.max(1, timeline.length)),
      distanceKm: Number(totalKm.toFixed(3)),
      elevationGain: Math.round(
        options.totalElevationGainOverride ?? gains[gains.length - 1] ?? 0,
      ),
      altitude: Number((profile.altitudes[lastIndex] ?? altFallback).toFixed(1)),
      cadence:
        typeof lastPoint.cad === 'number' && Number.isFinite(lastPoint.cad)
          ? lastPoint.cad
          : Math.round(cadenceSum / Math.max(1, timeline.length)),
      lat: lastPoint.lat,
      lng: lastPoint.lng,
    });
  }

  const averagePace = totalDurationSec / 60 / totalKm;
  const name = options.activityName ?? raw.name ?? 'Aktivitas Lari';

  return {
    activityName: name.slice(0, 60),
    dateFormatted: formatActivityDate(startMs, options.timeZone),
    locationName:
      options.locationName ??
      `${points[0].lat.toFixed(3)}°, ${points[0].lng.toFixed(3)}°`,
    totalDistanceKm: Number(totalKm.toFixed(2)),
    totalDurationSec,
    totalElevationGain: Math.round(
      options.totalElevationGainOverride ?? gains[gains.length - 1] ?? 0,
    ),
    avgPaceFormatted: formatPace(averagePace),
    avgHeartRate: Math.round(heartSum / Math.max(1, timeline.length)),
    avgCadence: Math.round(cadenceSum / Math.max(1, timeline.length)),
    timeline,
    missingTimestamps: !times,
    startTimeMs: startMs,
    source: raw.source ?? 'file',
  };
}
