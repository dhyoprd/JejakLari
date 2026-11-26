import type { RawActivity, RawTrackPoint } from '../activity';
import { ActivityParseError } from '../activity';
import { sanitizeName } from '../format';
import { asArray, child, numberOf, parseXml, textOf } from './xml';

function readTrackPoints(track: unknown): RawTrackPoint[] {
  const points: RawTrackPoint[] = [];
  for (const node of asArray(child(track, 'Trackpoint'))) {
    const position = child(node, 'Position');
    const lat = position ? numberOf(position, 'LatitudeDegrees') : null;
    const lng = position ? numberOf(position, 'LongitudeDegrees') : null;
    if (lat === null || lng === null) continue;
    const timeText = textOf(node, 'Time');
    const timeMs = timeText ? Date.parse(timeText) : Number.NaN;
    const heartRateNode = child(node, 'HeartRateBpm');
    points.push({
      lat,
      lng,
      ele: numberOf(node, 'AltitudeMeters'),
      timeMs: Number.isFinite(timeMs) ? timeMs : null,
      hr: heartRateNode ? numberOf(heartRateNode, 'Value') : numberOf(node, 'HeartRateBpm'),
      cad: numberOf(node, 'Cadence'),
      distMeters: numberOf(node, 'DistanceMeters'),
    });
  }
  return points;
}

export function parseTcx(text: string, fileName: string): RawActivity {
  let root;
  try {
    root = parseXml(text);
  } catch {
    throw new ActivityParseError('Gagal membaca file TCX. Pastikan XML valid.');
  }
  const training = child(root, 'TrainingCenterDatabase');
  if (!training) {
    throw new ActivityParseError('File TCX tidak memiliki TrainingCenterDatabase.');
  }

  const points: RawTrackPoint[] = [];
  let name: string | null = null;
  let lapDistanceTotal = 0;
  let lapDurationTotal = 0;
  let lapDistanceSeen = false;
  let lapDurationSeen = false;

  for (const activity of asArray(child(training, 'Activities'))) {
    for (const item of asArray(child(activity, 'Activity'))) {
      for (const lap of asArray(child(item, 'Lap'))) {
        const lapDistance = numberOf(lap, 'DistanceMeters');
        if (lapDistance !== null) {
          lapDistanceTotal += lapDistance;
          lapDistanceSeen = true;
        }
        const lapDuration = numberOf(lap, 'TotalTimeSeconds');
        if (lapDuration !== null) {
          lapDurationTotal += lapDuration;
          lapDurationSeen = true;
        }
        for (const track of asArray(child(lap, 'Track'))) {
          points.push(...readTrackPoints(track));
        }
      }
    }
  }

  for (const courses of asArray(child(training, 'Courses'))) {
    for (const course of asArray(child(courses, 'Course'))) {
      name = name ?? textOf(course, 'Name');
      for (const track of asArray(child(course, 'Track'))) {
        points.push(...readTrackPoints(track));
      }
    }
  }

  if (points.length < 2) {
    throw new ActivityParseError('Koordinat GPS valid di dalam file aktivitas kurang dari 2 titik.');
  }

  return {
    name: name ?? sanitizeName(fileName),
    points,
    sessionDistanceMeters: lapDistanceSeen ? lapDistanceTotal : null,
    sessionDurationSec: lapDurationSeen ? lapDurationTotal : null,
  };
}
