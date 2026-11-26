import type { Diorama } from './geo';
import { projectPoint } from './geo';

export type MapStyleId = 'satellite' | 'streets' | 'topo' | 'dark';

export interface TileLayer {
  url: (z: number, x: number, y: number) => string;
}

export interface MapStyle {
  id: MapStyleId;
  label: string;
  hint: string;
  background: string;
  base: TileLayer[];
  overlay: TileLayer[];
  filter: string;
  attribution: string;
}

export interface StitchedMap {
  canvas: HTMLCanvasElement;
  centerX: number;
  centerZ: number;
  widthMeters: number;
  heightMeters: number;
  zoom: number;
  tileCount: number;
  styleId: MapStyleId;
  fallback: boolean;
  degraded: boolean;
}

const esri = (service: string): TileLayer => ({
  url: (z, x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/${z}/${y}/${x}`,
});

const carto = (style: string): TileLayer => ({
  url: (z, x, y) => {
    const sub = ['a', 'b', 'c'][Math.abs(x + y) % 3];
    return `https://${sub}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}.png`;
  },
});

export const MAP_STYLES: Record<MapStyleId, MapStyle> = {
  satellite: {
    id: 'satellite',
    label: 'Satelit',
    hint: 'Citra bumi + label jalan',
    background: '#18241d',
    base: [esri('World_Imagery')],
    overlay: [
      esri('Reference/World_Transportation'),
      esri('Reference/World_Boundaries_and_Places'),
    ],
    filter: 'none',
    attribution: 'Esri World Imagery',
  },
  streets: {
    id: 'streets',
    label: 'Jalan',
    hint: 'Gaya peta kota terang',
    background: '#e5eadf',
    base: [
      { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
      carto('rastertiles/voyager'),
    ],
    overlay: [],
    filter: 'saturate(108%) contrast(104%)',
    attribution: 'OpenStreetMap · CARTO',
  },
  topo: {
    id: 'topo',
    label: 'Topo',
    hint: 'Kontur hijau untuk trail',
    background: '#f4ede2',
    base: [
      {
        url: (z, x, y) =>
          `https://${['a', 'b', 'c'][Math.abs(x + y) % 3]}.tile-cyclosm.openstreetmap.fr/cyclosm/${z}/${x}/${y}.png`,
      },
      { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
    ],
    overlay: [],
    filter: 'contrast(105%) saturate(108%)',
    attribution: 'CyclOSM · OpenStreetMap',
  },
  dark: {
    id: 'dark',
    label: 'Malam',
    hint: 'Peta gelap sinematik',
    background: '#0f172a',
    base: [carto('dark_all')],
    overlay: [],
    filter: 'contrast(106%) brightness(96%)',
    attribution: 'CARTO Dark Matter',
  },
};

const tileCache = new Map<string, StitchedMap>();
const MAX_CACHE_ENTRIES = 4;

export function lonToTileX(lng: number, zoom: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom);
}

export function latToTileY(lat: number, zoom: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom,
  );
}
export function tileXToLng(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

function chooseZoom(diorama: Diorama): number {
  const span = Math.max(diorama.spanMetersX, diorama.spanMetersZ);
  if (span <= 1050) return 16;
  if (span <= 2900) return 15;
  return 14;
}


function loadImage(url: string, timeoutMs = 6500): Promise<HTMLImageElement | null> {
  const { promise, resolve } = Promise.withResolvers<HTMLImageElement | null>();
  let settled = false;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    image.src = '';
    resolve(null);
  }, timeoutMs);
  image.onload = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(image.naturalWidth > 0 ? image : null);
  };
  image.onerror = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(null);
  };
  image.src = url;
  return promise;
}


async function drawTiles(
  ctx: CanvasRenderingContext2D,
  tiles: Array<{ x: number; y: number }>,
  layers: TileLayer[],
  zoom: number,
  style: MapStyle,
  originX: number,
  originY: number,
  signal?: AbortSignal,
  stack = false,
): Promise<number> {
  let drawn = 0;
  const batchSize = 6;

  const drawOne = async (tile: { x: number; y: number }): Promise<boolean> => {
    if (signal?.aborted) return false;
    let painted = false;
    for (const layer of layers) {
      const image = await loadImage(layer.url(zoom, tile.x, tile.y));
      if (signal?.aborted) return false;
      if (image) {
        ctx.save();
        ctx.filter = style.filter;
        ctx.drawImage(
          image,
          (tile.x - originX) * 256,
          (tile.y - originY) * 256,
          256,
          256,
        );
        ctx.restore();
        painted = true;
        if (!stack) return true;
      }
    }
    return painted;
  };

  for (let i = 0; i < tiles.length; i += batchSize) {
    if (signal?.aborted) break;
    const results = await Promise.all(tiles.slice(i, i + batchSize).map(drawOne));
    drawn += results.filter(Boolean).length;
  }
  return drawn;
}

export async function stitchMap(
  diorama: Diorama,
  styleId: MapStyleId,
  signal?: AbortSignal,
): Promise<StitchedMap> {
  const style = MAP_STYLES[styleId];
  let zoom = chooseZoom(diorama);
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  let cols = 0;
  let rows = 0;

  for (; zoom >= 10; zoom--) {
    const margin = zoom >= 15 ? 2 : 1;
    const maxTile = 2 ** zoom - 1;
    const a = {
      x: lonToTileX(diorama.minLng, zoom),
      y: latToTileY(diorama.maxLat, zoom),
    };
    const b = {
      x: lonToTileX(diorama.maxLng, zoom),
      y: latToTileY(diorama.minLat, zoom),
    };
    minX = Math.max(0, Math.min(a.x, b.x) - margin);
    maxX = Math.min(maxTile, Math.max(a.x, b.x) + margin);
    minY = Math.max(0, Math.min(a.y, b.y) - margin);
    maxY = Math.min(maxTile, Math.max(a.y, b.y) + margin);
    cols = maxX - minX + 1;
    rows = maxY - minY + 1;
    if (cols <= 10 && rows <= 10) break;
  }

  const key = [
    styleId,
    zoom,
    `${minX},${minY},${maxX},${maxY}`,
    diorama.centerLat.toFixed(5),
    diorama.centerLng.toFixed(5),
  ].join(':');
  const cached = tileCache.get(key);
  if (cached) {
    if (signal?.aborted) throw new DOMException('Tile stitch dibatalkan.', 'AbortError');
    return cached;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256 * cols;
  canvas.height = 256 * rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D tidak tersedia');

  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tiles: Array<{ x: number; y: number }> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) tiles.push({ x: minX + col, y: minY + row });
  }

  const drawn = await drawTiles(ctx, tiles, style.base, zoom, style, minX, minY, signal, false);
  if (signal?.aborted) throw new DOMException('Tile stitch dibatalkan.', 'AbortError');
  if (drawn > 0 && style.overlay.length > 0) {
    await drawTiles(ctx, tiles, style.overlay, zoom, style, minX, minY, signal, true);
  }
  if (signal?.aborted) throw new DOMException('Tile stitch dibatalkan.', 'AbortError');

  const centerTileX = (minX + maxX + 1) / 2;
  const centerTileY = (minY + maxY + 1) / 2;
  const centerLat = tileYToLat(centerTileY, zoom);
  const centerLng = tileXToLng(centerTileX, zoom);
  const center = projectPoint(centerLat, centerLng, diorama);
  const mpp = metersPerPixel(centerLat, zoom);

  const result: StitchedMap = {
    canvas,
    centerX: center.x,
    centerZ: center.z,
    widthMeters: cols * 256 * mpp,
    heightMeters: rows * 256 * mpp,
    zoom,
    tileCount: drawn,
    styleId,
    fallback: drawn === 0,
    degraded: drawn > 0 && drawn < Math.ceil(tiles.length * 0.8),
  };

  if (drawn >= Math.ceil(tiles.length * 0.8)) {
    if (tileCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = tileCache.keys().next().value;
      if (oldest) tileCache.delete(oldest);
    }
    tileCache.set(key, result);
  }
  return result;
}

export function createFallbackMap(diorama: Diorama, styleId: MapStyleId): StitchedMap {
  const style = MAP_STYLES[styleId];
  const aspect = Math.max(0.6, Math.min(1.6, diorama.spanMetersX / Math.max(1, diorama.spanMetersZ)));
  const longest = 1400;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(longest * Math.min(1, aspect));
  canvas.height = Math.round(longest * Math.min(1, 1 / aspect));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, style.background);
    grad.addColorStop(1, styleId === 'dark' ? '#1e293b' : '#dbe7d4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = styleId === 'dark' ? 'rgba(148,163,184,0.18)' : 'rgba(71,85,105,0.16)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    const blob = (cx: number, cy: number, radius: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, radius * 0.62, 0.4, 0, Math.PI * 2);
      ctx.fill();
    };
    blob(canvas.width * 0.28, canvas.height * 0.34, canvas.width * 0.22, 'rgba(16,185,129,0.16)');
    blob(canvas.width * 0.7, canvas.height * 0.66, canvas.width * 0.26, 'rgba(14,165,233,0.14)');

    ctx.fillStyle = styleId === 'dark' ? 'rgba(226,232,240,0.55)' : 'rgba(30,41,59,0.5)';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PETA OFFLINE — TILE TIDAK TERSEDIA', canvas.width / 2, canvas.height / 2);
  }

  const mpp = Math.max(diorama.spanMetersX / canvas.width, diorama.spanMetersZ / canvas.height);
  return {
    canvas,
    centerX: 0,
    centerZ: 0,
    widthMeters: canvas.width * mpp,
    heightMeters: canvas.height * mpp,
    zoom: 0,
    tileCount: 0,
    styleId,
    fallback: true,
    degraded: false,
  };
}
