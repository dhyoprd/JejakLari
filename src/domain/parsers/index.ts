import type { RawActivity } from '../activity';
import { ActivityParseError } from '../activity';
import { parseArchiveBytes, parseGzipBytes } from './archive';
import { parseFit } from './fit';
import { parseGpx } from './gpx';
import { parseTcx } from './tcx';

const MAX_FILE_BYTES = 40 * 1024 * 1024;

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function hasZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03;
}

function hasGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function hasFitMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === '.FIT';
}

function resolveFormat(bytes: Uint8Array, fileName: string): 'fit' | 'gpx' | 'tcx' | 'zip' | 'gz' | null {
  if (hasZipMagic(bytes)) return 'zip';
  if (hasGzipMagic(bytes)) return 'gz';
  if (hasFitMagic(bytes) || /\.fit$/i.test(fileName)) return 'fit';
  if (/\.gpx$/i.test(fileName)) return 'gpx';
  if (/\.tcx$/i.test(fileName)) return 'tcx';
  const head = decodeText(bytes.slice(0, 8192)).toLowerCase();
  if (head.includes('<gpx')) return 'gpx';
  if (head.includes('trainingcenterdatabase')) return 'tcx';
  return null;
}

export async function parseActivityBytes(
  bytes: Uint8Array,
  fileName: string,
): Promise<RawActivity> {
  if (bytes.byteLength < 16) {
    throw new ActivityParseError('File terlalu kecil atau kosong. Pastikan file aktivitas lari valid.');
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ActivityParseError('File terlalu besar. Batas maksimal 40 MB.');
  }

  const format = resolveFormat(bytes, fileName);
  if (!format) {
    throw new ActivityParseError('Format file tidak dikenali. Gunakan .FIT, .GPX, .TCX, atau .ZIP.');
  }

  try {
    switch (format) {
      case 'zip':
        return await parseArchiveBytes(bytes);
      case 'gz':
        return await parseGzipBytes(bytes, fileName);
      case 'fit':
        return await parseFit(bytes, fileName);
      case 'gpx':
        return parseGpx(decodeText(bytes), fileName);
      case 'tcx':
        return parseTcx(decodeText(bytes), fileName);
    }
  } catch (error) {
    if (error instanceof ActivityParseError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new ActivityParseError(
      `Gagal membaca file aktivitas. Pastikan formatnya valid. (${detail})`,
    );
  }
}

export async function parseActivityFile(file: File): Promise<RawActivity> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseActivityBytes(bytes, file.name);
}
