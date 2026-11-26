import type { RawActivity, RawTrackPoint } from '../activity';
import { ActivityParseError } from '../activity';
import type { StravaStreamsPayload, StravaStreamsResponse } from '../../shared/strava';

function streamData(streams: StravaStreamsPayload, type: string): unknown[] {
  if (Array.isArray(streams)) {
    for (const item of streams) {
      if (!item || typeof item !== 'object' || !('type' in item) || item.type !== type) continue;
      if ('data' in item && Array.isArray(item.data)) return item.data;
    }
    return [];
  }
  if (!streams || typeof streams !== 'object') return [];
  const value = Reflect.get(streams, type);
  if (value && typeof value === 'object' && 'data' in value && Array.isArray(value.data)) {
    return value.data;
  }
  return [];
}

function numericAt(values: unknown[], index: number): number | null {
  const value = values[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pairAt(values: unknown[], index: number): [number, number] | null {
  const value = values[index];
  if (!Array.isArray(value) || value.length < 2) return null;
  const lat = value[0];
  const lng = value[1];
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

export function parseStravaStreams(payload: StravaStreamsResponse): RawActivity {
  const { activity, streams } = payload;
  const latlng = streamData(streams, 'latlng');
  const times = streamData(streams, 'time');
  const altitudes = streamData(streams, 'altitude');
  const heartRates = streamData(streams, 'heartrate');
  const cadences = streamData(streams, 'cadence');
  const distances = streamData(streams, 'distance');
  const startMs = Date.parse(activity.startDate);

  const points: RawTrackPoint[] = [];
  for (let index = 0; index < latlng.length; index++) {
    const pair = pairAt(latlng, index);
    if (!pair) continue;
    const timeSec = numericAt(times, index);
    points.push({
      lat: pair[0],
      lng: pair[1],
      timeMs:
        Number.isFinite(startMs) && timeSec !== null ? startMs + timeSec * 1000 : null,
      ele: numericAt(altitudes, index),
      hr: numericAt(heartRates, index),
      cad: numericAt(cadences, index),
      distMeters: numericAt(distances, index),
    });
  }

  if (points.length < 2) {
    throw new ActivityParseError('Aktivitas Strava ini tidak memiliki data GPS yang bisa dirender.');
  }

  return {
    name: activity.name?.trim() || 'Aktivitas Strava',
    points,
    sessionDistanceMeters: activity.distanceMeters > 50 ? activity.distanceMeters : null,
    sessionDurationSec:
      activity.elapsedTimeSec > 10
        ? activity.elapsedTimeSec
        : activity.movingTimeSec > 10
          ? activity.movingTimeSec
          : null,
    source: 'strava',
  };
}
