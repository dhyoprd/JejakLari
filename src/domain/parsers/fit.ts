import FitParser from 'fit-file-parser';
import type { RawActivity, RawTrackPoint } from '../activity';
import { ActivityParseError } from '../activity';
import { sanitizeName } from '../format';

const SEMICIRCLE_TO_DEGREES = 180 / 2 ** 31;

function toDegrees(value: number): number {
  return Math.abs(value) > 180 ? value * SEMICIRCLE_TO_DEGREES : value;
}

export async function parseFit(bytes: Uint8Array, fileName: string): Promise<RawActivity> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  let data;
  try {
    const parser = new FitParser({
      force: true,
      speedUnit: 'm/s',
      lengthUnit: 'm',
      mode: 'list',
    });
    data = await parser.parseAsync(buffer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ActivityParseError(`Gagal membaca file .FIT: ${detail}`);
  }

  const records = data.records ?? [];
  const points: RawTrackPoint[] = [];
  for (const record of records) {
    if (record.position_lat === undefined || record.position_long === undefined) continue;
    const lat = toDegrees(record.position_lat);
    const lng = toDegrees(record.position_long);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const time = record.timestamp instanceof Date ? record.timestamp.getTime() : null;
    points.push({
      lat,
      lng,
      timeMs: time,
      ele: record.enhanced_altitude ?? record.altitude ?? null,
      hr: record.heart_rate ?? null,
      cad: record.cadence ?? null,
      distMeters: record.distance ?? null,
    });
  }

  if (points.length < 2) {
    throw new ActivityParseError('File .fit tidak memiliki data record timeline lari.');
  }

  const session = data.sessions?.[0];
  return {
    name: sanitizeName(fileName),
    points,
    sessionDistanceMeters: session?.total_distance ?? null,
    sessionDurationSec: session?.total_elapsed_time ?? session?.total_timer_time ?? null,
  };
}
