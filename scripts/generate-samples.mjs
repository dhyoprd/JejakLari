import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const CENTER = { lat: -6.2186, lng: 106.8026 };
const TARGET_METERS = 5000;
const EARTH_RADIUS = 6371000;

function metersToLat(m) {
  return (m / EARTH_RADIUS) * (180 / Math.PI);
}
function metersToLng(m, lat) {
  return (m / (EARTH_RADIUS * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
}
function haversine(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function buildLoop({ a = 860, b = 600, wobble = 35, points = 1400 } = {}) {
  const raw = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const radial = 1 + 0.08 * Math.sin(angle * 3) + 0.05 * Math.cos(angle * 5);
    const x = a * radial * Math.cos(angle) + wobble * Math.sin(angle * 7);
    const z = b * radial * Math.sin(angle);
    raw.push({ lat: CENTER.lat + metersToLat(z), lng: CENTER.lng + metersToLng(x, CENTER.lat) });
  }
  let measured = 0;
  for (let i = 1; i < raw.length; i++) measured += haversine(raw[i - 1], raw[i]);
  const scale = TARGET_METERS / measured;
  return raw.map((point) => ({
    lat: CENTER.lat + (point.lat - CENTER.lat) * scale,
    lng: CENTER.lng + (point.lng - CENTER.lng) * scale,
  }));
}

function cumulative(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + haversine(points[i - 1], points[i]));
  }
  return distances;
}

function sampleAt(points, distances, fraction) {
  const target = distances[distances.length - 1] * fraction;
  let low = 0;
  let high = distances.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (distances[mid] <= target) low = mid;
    else high = mid;
  }
  const span = Math.max(1e-6, distances[high] - distances[low]);
  const ratio = Math.max(0, Math.min(1, (target - distances[low]) / span));
  return {
    lat: points[low].lat + (points[high].lat - points[low].lat) * ratio,
    lng: points[low].lng + (points[high].lng - points[low].lng) * ratio,
  };
}

function buildTrack({ durationSec, startIso, hrBase, cadenceBase, seed }) {
  const loop = buildLoop();
  const distances = cumulative(loop);
  const samples = [];
  for (let t = 0; t <= durationSec; t += 5) {
    const progress = t / durationSec;
    const speedFactor = 1 + 0.045 * Math.sin(progress * Math.PI * 8 + seed) + 0.018 * Math.cos(progress * Math.PI * 21);
    const distanceFraction = Math.min(1, (progress * 1000 + (speedFactor - 1) * 18) / 1000);
    const position = sampleAt(loop, distances, distanceFraction);
    const elevation = 12 + 7 * Math.sin(progress * Math.PI * 4) + 2.4 * Math.sin(progress * Math.PI * 13);
    const heartRate = Math.round(
      Math.min(186, Math.max(112, hrBase + 24 * Math.min(1, progress * 3) + 7 * Math.sin(progress * Math.PI * 9 + seed))),
    );
    const cadence = Math.round(cadenceBase + 5 * Math.sin(progress * Math.PI * 11 + seed));
    samples.push({
      ...position,
      elevation,
      heartRate,
      cadence,
      time: new Date(Date.parse(startIso) + t * 1000).toISOString(),
    });
  }
  return samples;
}

function gpx(points, name) {
  const body = points
    .map(
      (p) => `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">
        <ele>${p.elevation.toFixed(1)}</ele>
        <time>${p.time}</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>${p.heartRate}</gpxtpx:hr>
            <gpxtpx:cad>${p.cadence}</gpxtpx:cad>
          </gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="JejakLari Local sample generator"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata>
    <name>${name}</name>
    <type>running</type>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${body}
    </trkseg>
  </trk>
</gpx>
`;
}

function tcx(points, sport = 'Running') {
  const sampled = points.filter((_, index) => index % 3 === 0 || index === points.length - 1);
  const body = sampled
    .map(
      (p) => `        <Trackpoint>
          <Time>${p.time}</Time>
          <Position>
            <LatitudeDegrees>${p.lat.toFixed(7)}</LatitudeDegrees>
            <LongitudeDegrees>${p.lng.toFixed(7)}</LongitudeDegrees>
          </Position>
          <AltitudeMeters>${p.elevation.toFixed(1)}</AltitudeMeters>
          <HeartRateBpm><Value>${p.heartRate}</Value></HeartRateBpm>
          <Cadence>${p.cadence}</Cadence>
        </Trackpoint>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="${sport}">
      <Lap StartTime="${sampled[0].time}">
        <TotalTimeSeconds>${1500}</TotalTimeSeconds>
        <DistanceMeters>5000</DistanceMeters>
        <Track>
${body}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
}

await mkdir(resolve(root, 'public/samples'), { recursive: true });
await mkdir(resolve(root, 'tests/fixtures'), { recursive: true });

const primary = buildTrack({
  durationSec: 1480,
  startIso: '2025-05-18T06:15:00+07:00',
  hrBase: 138,
  cadenceBase: 172,
  seed: 0.4,
});
const rival = buildTrack({
  durationSec: 1450,
  startIso: '2025-05-18T06:20:00+07:00',
  hrBase: 144,
  cadenceBase: 176,
  seed: 1.7,
});

await writeFile(resolve(root, 'public/samples/sample-5k.gpx'), gpx(primary, 'Morning 5K Tempo Run'));
await writeFile(resolve(root, 'public/samples/rival-5k.gpx'), gpx(rival, 'Rival 5K Tempo'));
await writeFile(resolve(root, 'tests/fixtures/sample-5k.gpx'), gpx(primary, 'Morning 5K Tempo Run'));
await writeFile(resolve(root, 'tests/fixtures/sample-5k.tcx'), tcx(primary));
console.log('Wrote sample GPX/TCX fixtures');
