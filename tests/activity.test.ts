import { readFile } from 'node:fs/promises';
import { gzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { normalizeActivity } from '../src/domain/normalize';
import { parseActivityBytes } from '../src/domain/parsers';
import { compareRace } from '../src/domain/race';
import { buildDiorama, buildRoute, interpolateActivity, projectPoint, sampleRoute } from '../src/engine/geo';

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);

async function loadActivity(name: string) {
  const bytes = new Uint8Array(await readFile(fixture(name)));
  const raw = await parseActivityBytes(bytes, name);
  return { raw, activity: normalizeActivity(raw, { activityName: raw.name }) };
}

describe('GPX parser', () => {
  it('parses a 5 km run with heart rate and cadence', async () => {
    const { activity } = await loadActivity('sample-5k.gpx');
    expect(activity.totalDistanceKm).toBeGreaterThan(4.9);
    expect(activity.totalDistanceKm).toBeLessThan(5.1);
    expect(activity.totalDurationSec).toBeGreaterThan(1400);
    expect(activity.totalDurationSec).toBeLessThan(1500);
    expect(activity.avgHeartRate).toBeGreaterThan(120);
    expect(activity.avgCadence).toBeGreaterThan(150);
    expect(activity.timeline.length).toBeGreaterThan(100);
    expect(activity.timeline.at(-1)?.distanceKm).toBeCloseTo(activity.totalDistanceKm, 1);
    const altitudes = activity.timeline.map((point) => point.altitude);
    expect(Math.max(...altitudes) - Math.min(...altitudes)).toBeGreaterThan(1);
  });

  it('parses a TCX run', async () => {
    const { activity } = await loadActivity('sample-5k.tcx');
    expect(activity.totalDistanceKm).toBeGreaterThan(4.9);
    expect(activity.timeline.length).toBeGreaterThan(80);
  });

  it('parses a FIT run read from a Garmin device', async () => {
    const { activity } = await loadActivity('sample-run.fit');
    expect(activity.totalDistanceKm).toBeGreaterThan(5.3);
    expect(activity.totalDistanceKm).toBeLessThan(5.5);
    expect(activity.totalDurationSec).toBeGreaterThan(1600);
    expect(activity.timeline.length).toBeGreaterThan(400);
    expect(activity.avgHeartRate).toBeGreaterThan(100);
  });

  it('reads activity files inside a ZIP archive', async () => {
    const bytes = new Uint8Array(await readFile(fixture('sample-5k.gpx')));
    const zipped = zipSync({ 'run/activity.gpx': bytes });
    const raw = await parseActivityBytes(zipped, 'bundle.zip');
    const activity = normalizeActivity(raw);
    expect(activity.totalDistanceKm).toBeGreaterThan(4.9);
  });

  it('sums auto-lap TCX totals instead of collapsing to the first lap', async () => {
    const lap = (start: string, end: string, from: number, to: number) => `
      <Lap>
        <TotalTimeSeconds>300</TotalTimeSeconds>
        <DistanceMeters>1000</DistanceMeters>
        <Track>
          <Trackpoint><Time>${start}</Time><Position><LatitudeDegrees>${from}</LatitudeDegrees><LongitudeDegrees>106.8026</LongitudeDegrees></Position></Trackpoint>
          <Trackpoint><Time>${end}</Time><Position><LatitudeDegrees>${to}</LatitudeDegrees><LongitudeDegrees>106.8026</LongitudeDegrees></Position></Trackpoint>
        </Track>
      </Lap>`;
    const tcx = `<?xml version="1.0"?>
      <TrainingCenterDatabase><Activities><Activity Sport="Running">
      ${lap('2025-01-01T00:00:00Z', '2025-01-01T00:05:00Z', -6.2186, -6.2276)}
      ${lap('2025-01-01T00:05:00Z', '2025-01-01T00:10:00Z', -6.2276, -6.2366)}
      </Activity></Activities></TrainingCenterDatabase>`;
    const raw = await parseActivityBytes(new TextEncoder().encode(tcx), 'auto-lap.tcx');
    expect(raw.sessionDistanceMeters).toBe(2000);
    expect(raw.sessionDurationSec).toBe(600);
    const activity = normalizeActivity(raw);
    expect(activity.totalDistanceKm).toBeGreaterThan(1.9);
    expect(activity.totalDistanceKm).toBeLessThan(2.1);
    expect(activity.totalDurationSec).toBeGreaterThanOrEqual(600);
  });

  it('rejects activity files nested too deeply in a ZIP', async () => {
    const bytes = new Uint8Array(await readFile(fixture('sample-5k.gpx')));
    const zipped = zipSync({ 'a/b/c/activity.gpx': bytes });
    await expect(parseActivityBytes(zipped, 'deep.zip')).rejects.toThrow(/terlalu dalam/);
  });

  it('reads a gzipped GPX activity', async () => {
    const bytes = new Uint8Array(await readFile(fixture('sample-5k.gpx')));
    const gzipped = gzipSync(bytes);
    const raw = await parseActivityBytes(gzipped, 'activity.gpx.gz');
    const activity = normalizeActivity(raw);
    expect(activity.totalDistanceKm).toBeGreaterThan(4.9);
  });

  it('rejects a file with no usable GPS points', async () => {
    const content = new TextEncoder().encode(
      '<gpx><trk><trkseg><trkpt lat="0" lon="0"></trkpt></trkseg></trk></gpx>',
    );
    await expect(parseActivityBytes(content, 'empty.gpx')).rejects.toThrow(/kurang dari 2 titik/);
  });
});

describe('normalization', () => {
  it('derives a timeline when timestamps are missing', async () => {
    const raw = {
      name: 'No timestamps',
      points: Array.from({ length: 200 }, (_, i) => ({
        lat: -6.2186 + i * 0.00005,
        lng: 106.8026 + i * 0.00005,
      })),
    };
    const activity = normalizeActivity(raw);
    expect(activity.missingTimestamps).toBe(true);
    expect(activity.totalDurationSec).toBeGreaterThan(10);
    expect(activity.timeline.at(-1)?.elapsedSec).toBe(activity.totalDurationSec);
  });

  it('interpolates speed, heart rate and position', async () => {
    const { activity } = await loadActivity('sample-5k.gpx');
    const middle = interpolateActivity(activity.timeline, activity.totalDurationSec / 2);
    expect(middle.heartRate).toBeGreaterThan(100);
    expect(middle.distanceKm).toBeGreaterThan(1);
    expect(middle.speed).toBeGreaterThan(1);
  });
});

describe('geo', () => {
  it('projects the route around a local diorama and smooths it', async () => {
    const { activity } = await loadActivity('sample-5k.gpx');
    const diorama = buildDiorama(activity.timeline);
    expect(diorama.spanMetersX).toBeGreaterThan(300);
    const route = buildRoute(activity.timeline, diorama);
    const start = route[0];
    const finish = route.at(-1);
    expect(start && finish).toBeTruthy();
    expect(Math.hypot(start.x, start.z)).toBeLessThan(2200);
    const projected = projectPoint(diorama.centerLat, diorama.centerLng, diorama);
    expect(Math.hypot(projected.x, projected.z)).toBeLessThan(1);
    const half = sampleRoute(route, activity.totalDurationSec / 2);
    expect(Math.abs(half.x) + Math.abs(half.z)).toBeGreaterThan(10);
  });
});

describe('race', () => {
  it('compares durations when distances match', async () => {
    const primary = (await loadActivity('sample-5k.gpx')).activity;
    const rival = (await loadActivity('rival-5k.gpx')).activity;
    const outcome = compareRace(primary, rival, 'KUBITA', 'RIVAL');
    expect(outcome.winner).toBe('rival');
    expect(outcome.marginLabel).toMatch(/UNGGUL|PHOTO FINISH/);
    expect(outcome.rivalPaceSecPerKm).toBeLessThan(outcome.p1PaceSecPerKm);
  });

  it('compares pace when distances differ', async () => {
    const primary = (await loadActivity('sample-5k.gpx')).activity;
    const rival = (await loadActivity('rival-5k.gpx')).activity;
    const shortRival = { ...rival, totalDistanceKm: 3.2 };
    const outcome = compareRace(primary, shortRival, 'A', 'B');
    expect(outcome.marginLabel).toContain('PACE');
  });
});
