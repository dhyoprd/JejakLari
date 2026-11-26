import { describe, expect, it } from 'vitest';
import { normalizeActivity } from '../src/domain/normalize';
import { parseStravaStreams } from '../src/domain/parsers/strava';
import type { StravaStreamsResponse } from '../src/shared/strava';

const ACTIVITY = {
  id: '111',
  name: 'Morning Run',
  sportType: 'Run',
  distanceMeters: 1000,
  movingTimeSec: 600,
  elapsedTimeSec: 610,
  elevationGainMeters: 24,
  startDate: '2026-01-01T00:00:00Z',
  startDateLocal: '2026-01-01T07:00:00Z',
};

const LATLNG: Array<[number, number]> = [
  [-6.2, 106.8],
  [-6.202, 106.802],
  [-6.204, 106.804],
];

const PAYLOAD: StravaStreamsResponse = {
  activity: ACTIVITY,
  streams: {
    latlng: { data: LATLNG },
    time: { data: [0, 300, 600] },
    distance: { data: [0, 500, 1000] },
    altitude: { data: [10, 12, 14] },
    heartrate: { data: [120, 140, 150] },
    cadence: { data: [170, 174, 176] },
  },
};

describe('Strava stream parser', () => {
  it('maps streams into a normalized activity', () => {
    const raw = parseStravaStreams(PAYLOAD);
    expect(raw.name).toBe('Morning Run');
    expect(raw.points).toHaveLength(3);
    expect(raw.points[1].hr).toBe(140);
    expect(raw.points[1].distMeters).toBe(500);

    const activity = normalizeActivity(raw);
    expect(activity.totalDistanceKm).toBeCloseTo(1, 1);
    expect(activity.totalDurationSec).toBe(610);
    expect(activity.timeline).toHaveLength(4);
    expect(activity.timeline[3].elapsedSec).toBe(610);
    expect(activity.timeline[1].heartRate).toBe(140);
    expect(activity.timeline[1].cadence).toBe(174);
    expect(activity.missingTimestamps).toBe(false);
  });

  it('supports the array form of stream sets', () => {
    const raw = parseStravaStreams({
      activity: ACTIVITY,
      streams: [
        { type: 'latlng', data: LATLNG },
        { type: 'time', data: [0, 300, 600] },
        { type: 'heartrate', data: [120, 140, 150] },
      ],
    });
    expect(raw.points).toHaveLength(3);
    expect(raw.points[2].hr).toBe(150);
  });

  it('rejects an activity without GPS', () => {
    expect(() =>
      parseStravaStreams({
        activity: ACTIVITY,
        streams: { time: { data: [0, 1] } },
      }),
    ).toThrow(/tidak memiliki data GPS/);
  });
});
