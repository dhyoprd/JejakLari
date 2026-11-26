import type { RawActivity, RawTrackPoint } from '../activity';
import { ActivityParseError } from '../activity';
import { asArray, child, parseXml, pointsFromTrackPoints, textOf } from './xml';

export function parseGpx(text: string, fileName: string): RawActivity {
  let root;
  try {
    root = parseXml(text);
  } catch {
    throw new ActivityParseError('Gagal membaca file GPX. Pastikan XML valid.');
  }
  const gpx = child(root, 'gpx');
  if (!gpx) throw new ActivityParseError('File GPX tidak memiliki elemen <gpx>.');

  const tracks = asArray(child(gpx, 'trk'));
  const routes = asArray(child(gpx, 'rte'));
  const points: RawTrackPoint[] = [];
  let name: string | null = null;

  for (const track of tracks) {
    name = name ?? textOf(track, 'name');
    for (const segment of asArray(child(track, 'trkseg'))) {
      points.push(...pointsFromTrackPoints(asArray(child(segment, 'trkpt'))));
    }
  }
  for (const route of routes) {
    name = name ?? textOf(route, 'name');
    points.push(...pointsFromTrackPoints(asArray(child(route, 'rtept'))));
  }

  if (points.length < 2) {
    throw new ActivityParseError('Koordinat GPS valid di dalam file aktivitas kurang dari 2 titik.');
  }

  const metadata = child(gpx, 'metadata');
  const metadataName = metadata ? textOf(metadata, 'name') : null;

  return {
    name: metadataName ?? name ?? fileName,
    points,
  };
}
