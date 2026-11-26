import { Gunzip, unzipSync } from 'fflate';
import type { RawActivity } from '../activity';
import { ActivityParseError } from '../activity';
import { parseFit } from './fit';
import { parseGpx } from './gpx';
import { parseTcx } from './tcx';

const SUPPORTED = /\.(fit|gpx|tcx)$/i;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 120;
const MAX_DEPTH = 2;
const MAX_TOTAL_UNCOMPRESSED = 64 * 1024 * 1024;

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

export async function parseArchiveBytes(bytes: Uint8Array): Promise<RawActivity> {
  let totalUncompressed = 0;
  let entryCount = 0;
  const entries = Object.entries(
    unzipSync(bytes, {
      filter: (file) => {
        const normalized = file.name.replace(/\\/g, '/');
        if (normalized.startsWith('__MACOSX/') || normalized.endsWith('/')) return false;
        if (!SUPPORTED.test(normalized)) return false;
        if (normalized.split('/').filter(Boolean).length > MAX_DEPTH) {
          throw new ActivityParseError(
            'Arsip file terlalu dalam. Ekstrak file .fit/.gpx terlebih dahulu.',
          );
        }
        entryCount += 1;
        if (entryCount > MAX_ENTRIES) {
          throw new ActivityParseError('Arsip ZIP berisi terlalu banyak file aktivitas.');
        }
        if (file.originalSize > MAX_ENTRY_BYTES) {
          throw new ActivityParseError('File di dalam ZIP terlalu besar untuk diproses.');
        }
        totalUncompressed += file.originalSize;
        if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
          throw new ActivityParseError('Total isi ZIP terlalu besar untuk diproses.');
        }
        return true;
      },
    }),
  );

  if (entries.length === 0) {
    throw new ActivityParseError('ZIP tidak berisi file .FIT, .GPX, atau .TCX.');
  }

  // Prefer the largest activity, which is usually the full run rather than a warm-up.
  entries.sort((a, b) => b[1].byteLength - a[1].byteLength);
  const [entryName, entryBytes] = entries[0];

  if (/\.fit$/i.test(entryName)) return parseFit(entryBytes, entryName);
  if (/\.gpx$/i.test(entryName)) return parseGpx(decodeText(entryBytes), entryName);
  return parseTcx(decodeText(entryBytes), entryName);
}

export async function parseGzipBytes(
  bytes: Uint8Array,
  fileName: string,
): Promise<RawActivity> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const stream = new Gunzip((chunk) => {
      total += chunk.byteLength;
      if (total > MAX_ENTRY_BYTES) {
        throw new ActivityParseError('Isi file .gz terlalu besar untuk diproses.');
      }
      chunks.push(chunk);
    });
    stream.push(bytes, true);
  } catch (error) {
    if (error instanceof ActivityParseError) throw error;
    throw new ActivityParseError('Gagal membuka file .gz. Pastikan arsip valid.');
  }
  if (chunks.length === 0) {
    throw new ActivityParseError('File .gz kosong atau tidak valid.');
  }
  const inner = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    inner.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const base = fileName.replace(/\.gz$/i, '');
  if (/\.fit$/i.test(base)) return parseFit(inner, base);
  if (/\.gpx$/i.test(base)) return parseGpx(decodeText(inner), base);
  if (/\.tcx$/i.test(base)) return parseTcx(decodeText(inner), base);
  throw new ActivityParseError('File .gz harus berisi .FIT, .GPX, atau .TCX.');
}
