import type { Activity } from '../domain/activity';
import type { RaceOutcome } from '../domain/race';
import { formatClock, formatPace } from '../domain/format';
import type { Diorama, RoutePoint } from './geo';
import type { FrameSnapshot } from './scene';
import type { RunnerLook } from './theme';
import type { MapStyleId } from './tiles';
import { MAP_STYLES } from './tiles';

export interface HudOptions {
  activity: Activity;
  rival: Activity | null;
  primaryLook: RunnerLook;
  rivalLook: RunnerLook;
  diorama: Diorama;
  route: RoutePoint[];
  rivalRoute: RoutePoint[] | null;
  outcome: RaceOutcome | null;
  mapStyle: MapStyleId;
  skyLabel: string;
  osmActive?: boolean;
}

const COLORS = {
  ink: '#f8fafc',
  muted: '#94a3b8',
  teal: '#2dd4bf',
  mint: '#5eead4',
  amber: '#fbbf24',
  rose: '#fb7185',
  purple: '#c084fc',
  green: '#34d399',
  sky: '#38bdf8',
  border: 'rgba(255,255,255,0.15)',
  glass: 'rgba(2, 6, 23, 0.78)',
  glassSoft: 'rgba(2, 6, 23, 0.55)',
};

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.max(0, Math.min(radius, width / 2, height / 2)));
}

function glass(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill = COLORS.glass,
  border = COLORS.border,
  lineWidth = 1,
): void {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lineWidth > 0) {
    ctx.strokeStyle = border;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function easeOutCubic(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return 1 - (1 - t) ** 3;
}

export class HudRenderer {
  private readonly options: HudOptions;
  private readonly minimapBounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  private logoGradient: CanvasGradient | null = null;
  private osmActive: boolean;

  constructor(options: HudOptions) {
    this.options = options;
    this.osmActive = Boolean(options.osmActive);
    let minX = Infinity;
    let minZ = Infinity;

    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const point of [...options.route, ...(options.rivalRoute ?? [])]) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    if (!Number.isFinite(minX)) {
      minX = -500;
      maxX = 500;
      minZ = -500;
      maxZ = 500;
    }
    const padX = Math.max(50, (maxX - minX) * 0.12);
    const padZ = Math.max(50, (maxZ - minZ) * 0.12);
    this.minimapBounds = {
      minX: minX - padX,
      maxX: maxX + padX,
      minZ: minZ - padZ,
      maxZ: maxZ + padZ,
    };
  }

  setRunnerLooks(primaryLook: RunnerLook, rivalLook: RunnerLook, outcome: RaceOutcome | null): void {
    this.options.primaryLook = primaryLook;
    this.options.rivalLook = rivalLook;
    this.options.outcome = outcome;
  }

  setOsmActive(active: boolean): void {
    this.osmActive = active;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    snapshot: FrameSnapshot,
    introProgress: number,
    finishProgress: number,
  ): void {
    const scale = width / 540;
    const fs = (value: number) => value * scale;
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = 'alphabetic';

    const topFade = ctx.createLinearGradient(0, 0, 0, fs(330));
    topFade.addColorStop(0, 'rgba(2,6,23,0.72)');
    topFade.addColorStop(0.62, 'rgba(2,6,23,0.25)');
    topFade.addColorStop(1, 'rgba(2,6,23,0)');
    ctx.fillStyle = topFade;
    ctx.fillRect(0, 0, width, fs(330));

    const bottomFade = ctx.createLinearGradient(0, height - fs(430), 0, height);
    bottomFade.addColorStop(0, 'rgba(2,6,23,0)');
    bottomFade.addColorStop(0.45, 'rgba(2,6,23,0.56)');
    bottomFade.addColorStop(1, 'rgba(2,6,23,0.88)');
    ctx.fillStyle = bottomFade;
    ctx.fillRect(0, height - fs(430), width, fs(430));

    this.drawBrand(ctx, width, fs);
    this.drawTitle(ctx, fs);
    this.drawMiniMap(ctx, width, height, fs, snapshot);
    this.drawStatsStrip(ctx, width, fs, snapshot);
    this.drawProgress(ctx, width, fs, snapshot);
    this.drawLandmark(ctx, width, height, fs, snapshot);
    this.drawBottomCard(ctx, width, height, fs, snapshot);
    this.drawDuel(ctx, width, fs, snapshot);

    if (snapshot.phase === 'intro') {
      this.drawIntro(ctx, width, height, fs, introProgress);
    }
    if (snapshot.phase === 'finish') {
      this.drawFinish(ctx, width, height, fs, finishProgress);
    }

    this.drawAttribution(ctx, width, height, fs);
  }

  private drawBrand(
    ctx: CanvasRenderingContext2D,
    width: number,
    fs: (value: number) => number,
  ): void {
    const x = fs(20);
    const y = fs(22);
    if (!this.logoGradient) {
      this.logoGradient = ctx.createLinearGradient(x, y, x + fs(38), y + fs(38));
      this.logoGradient.addColorStop(0, '#059669');
      this.logoGradient.addColorStop(1, '#0ea5e9');
    }
    roundedRect(ctx, x, y, fs(38), fs(38), fs(12));
    ctx.fillStyle = this.logoGradient;
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = fs(3.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + fs(10), y + fs(29));
    ctx.lineTo(x + fs(18), y + fs(19));
    ctx.lineTo(x + fs(24), y + fs(24));
    ctx.lineTo(x + fs(30), y + fs(11));
    ctx.stroke();

    ctx.fillStyle = COLORS.ink;
    ctx.font = `900 ${fs(15)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText('JEJAKLARI', x + fs(48), y + fs(17));
    ctx.fillStyle = COLORS.teal;
    ctx.font = `800 ${fs(7.5)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText('LOCAL STUDIO • 3D', x + fs(48), y + fs(30));

    const chipWidth = fs(72);
    const chipX = width - fs(20) - chipWidth;
    glass(ctx, chipX, y + fs(1), chipWidth, fs(24), fs(12), COLORS.glassSoft);
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.font = `800 ${fs(8.5)}px system-ui, sans-serif`;
    ctx.fillText(`${this.options.skyLabel.toUpperCase()} • 9:16`, chipX + chipWidth / 2, y + fs(16));
    ctx.textAlign = 'left';

  }

  private drawTitle(
    ctx: CanvasRenderingContext2D,
    fs: (value: number) => number,
  ): void {
    const activity = this.options.activity;
    const x = fs(20);
    const y = fs(82);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `900 ${fs(17)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(activity.activityName.slice(0, 28), x, y);
    ctx.fillStyle = COLORS.teal;
    ctx.font = `800 ${fs(10)}px system-ui, sans-serif`;
    const runner = `${this.options.primaryLook.name.toUpperCase()} • BIB #${this.options.primaryLook.bib || '0000'}`;
    ctx.fillText(runner, x, y + fs(17));
    ctx.fillStyle = COLORS.muted;
    ctx.font = `600 ${fs(8.8)}px system-ui, sans-serif`;
    ctx.fillText(`${activity.dateFormatted}`, x, y + fs(32));
    const location = activity.locationName.length > 6 ? activity.locationName : 'RUTE LOKAL';
    ctx.fillText(location.slice(0, 40), x, y + fs(44));
  }

  private drawStatsStrip(
    ctx: CanvasRenderingContext2D,
    width: number,
    fs: (value: number) => number,
    snapshot: FrameSnapshot,
  ): void {
    const point = snapshot.point;
    const gap = fs(6);
    const x = fs(20);
    const y = fs(148);
    const total = width - fs(40);
    const boxWidth = (total - gap * 3) / 4;
    const boxHeight = fs(44);
    const entries = [
      { label: 'PACE', value: point.paceFormatted, unit: '/km', color: COLORS.amber },
      { label: 'HEART', value: `${point.heartRate}`, unit: 'bpm', color: COLORS.rose },
      { label: 'CADENCE', value: `${point.cadence}`, unit: 'spm', color: COLORS.purple },
      { label: 'ELEV', value: `+${Math.round(point.elevationGain)}`, unit: 'm', color: COLORS.sky },
    ];
    entries.forEach((entry, index) => {
      const boxX = x + index * (boxWidth + gap);
      glass(ctx, boxX, y, boxWidth, boxHeight, fs(9), 'rgba(15,23,42,0.62)');
      ctx.fillStyle = COLORS.muted;
      ctx.font = `700 ${fs(7)}px system-ui, sans-serif`;
      ctx.fillText(entry.label, boxX + fs(9), y + fs(13));
      ctx.fillStyle = entry.color;
      ctx.font = `900 ${fs(15)}px system-ui, sans-serif`;
      ctx.fillText(entry.value, boxX + fs(9), y + fs(30));
      const valueWidth = ctx.measureText(entry.value).width;
      ctx.fillStyle = COLORS.muted;
      ctx.font = `700 ${fs(6.8)}px system-ui, sans-serif`;
      ctx.fillText(entry.unit, boxX + fs(9) + valueWidth + fs(3), y + fs(30));
    });
  }

  private drawProgress(
    ctx: CanvasRenderingContext2D,
    width: number,
    fs: (value: number) => number,
    snapshot: FrameSnapshot,
  ): void {
    const x = fs(20);
    const y = fs(202);
    const barWidth = width - fs(40);
    const barHeight = fs(5);
    roundedRect(ctx, x, y, barWidth, barHeight, fs(3));
    ctx.fillStyle = 'rgba(15,23,42,0.72)';
    ctx.fill();

    const progress = Math.max(0.01, snapshot.progress);
    roundedRect(ctx, x, y, barWidth * progress, barHeight, fs(3));
    ctx.fillStyle = COLORS.teal;
    ctx.fill();

    const knobX = x + barWidth * progress;
    ctx.beginPath();
    ctx.arc(knobX, y + barHeight / 2, fs(4.2), 0, Math.PI * 2);
    ctx.fillStyle = '#f0fdfa';
    ctx.fill();

    ctx.fillStyle = COLORS.muted;
    ctx.font = `700 ${fs(7.5)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(progress * 100)}%`, x, y + fs(16));
    ctx.textAlign = 'right';
    ctx.fillText(
      `${(snapshot.point.distanceKm).toFixed(2)} / ${this.options.activity.totalDistanceKm.toFixed(2)} KM`,
      x + barWidth,
      y + fs(16),
    );
    ctx.textAlign = 'left';
  }

  private drawMiniMap(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    fs: (value: number) => number,
    snapshot: FrameSnapshot,
  ): void {
    const size = fs(112);
    const x = width - fs(20) - size;
    const y = fs(72);
    if (y + size > height - fs(400)) return;
    glass(ctx, x, y, size, size, fs(16), 'rgba(2,6,23,0.72)', 'rgba(255,255,255,0.18)', fs(1));

    const inner = size - fs(16);
    const bounds = this.minimapBounds;
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
    const fit = Math.min(inner / spanX, inner / spanZ);
    const offsetX = x + fs(8) + (inner - spanX * fit) / 2;
    const offsetY = y + fs(8) + (inner - spanZ * fit) / 2;
    const toMap = (px: number, pz: number) => ({
      x: offsetX + (px - bounds.minX) * fit,
      y: offsetY + (pz - bounds.minZ) * fit,
    });

    ctx.save();
    roundedRect(ctx, x, y, size, size, fs(16));
    ctx.clip();

    ctx.strokeStyle = 'rgba(226,232,240,0.3)';
    ctx.lineWidth = fs(2.2);
    ctx.beginPath();
    this.options.route.forEach((point, index) => {
      const mapped = toMap(point.x, point.z);
      if (index === 0) ctx.moveTo(mapped.x, mapped.y);
      else ctx.lineTo(mapped.x, mapped.y);
    });
    ctx.stroke();

    if (this.options.rivalRoute) {
      ctx.strokeStyle = 'rgba(249,115,22,0.45)';
      ctx.lineWidth = fs(1.8);
      ctx.beginPath();
      this.options.rivalRoute.forEach((point, index) => {
        const mapped = toMap(point.x, point.z);
        if (index === 0) ctx.moveTo(mapped.x, mapped.y);
        else ctx.lineTo(mapped.x, mapped.y);
      });
      ctx.stroke();
    }

    ctx.strokeStyle = COLORS.teal;
    ctx.lineWidth = fs(3);
    ctx.beginPath();
    let started = false;
    for (const point of this.options.route) {
      if (point.distanceKm > snapshot.point.distanceKm) break;
      const mapped = toMap(point.x, point.z);
      if (!started) {
        ctx.moveTo(mapped.x, mapped.y);
        started = true;
      } else ctx.lineTo(mapped.x, mapped.y);
    }
    ctx.stroke();

    const currentPoint =
      this.options.route.find((entry) => entry.distanceKm >= snapshot.point.distanceKm) ??
      this.options.route[this.options.route.length - 1];
    const current = toMap(currentPoint?.x ?? 0, currentPoint?.z ?? 0);
    if (snapshot.rivalPoint && this.options.rivalRoute) {
      const rivalSample = this.options.rivalRoute.find(
        (point) => point.distanceKm >= (snapshot.rivalPoint?.distanceKm ?? 0),
      );
      if (rivalSample) {
        const rival = toMap(rivalSample.x, rivalSample.z);
        ctx.beginPath();
        ctx.arc(rival.x, rival.y, fs(3.4), 0, Math.PI * 2);
        ctx.fillStyle = '#f97316';
        ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.arc(current.x, current.y, fs(5), 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = fs(1.5);
    ctx.strokeStyle = COLORS.teal;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = COLORS.muted;
    ctx.font = `700 ${fs(6.8)}px system-ui, sans-serif`;
    ctx.fillText('RUTE', x + fs(9), y + size - fs(7));
  }

  private drawLandmark(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    fs: (value: number) => number,
    snapshot: FrameSnapshot,
  ): void {
    const distance = snapshot.point.distanceKm;
    const km = Math.floor(distance);
    if (km < 1) return;
    const into = distance - km;
    if (into > 0.1) return;
    const label = `KM ${km} • ${formatClock(snapshot.point.elapsedSec)}`;
    ctx.font = `800 ${fs(11)}px system-ui, sans-serif`;
    const pillWidth = ctx.measureText(label).width + fs(36);
    const x = (width - pillWidth) / 2;
    const y = height - fs(352);
    glass(ctx, x, y, pillWidth, fs(30), fs(15), 'rgba(15,23,42,0.9)', 'rgba(45,212,191,0.55)', fs(1.2));
    ctx.beginPath();
    ctx.arc(x + fs(15), y + fs(15), fs(3), 0, Math.PI * 2);
    ctx.fillStyle = COLORS.teal;
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(`📍 ${label}`, x + fs(24), y + fs(19));
  }

  private drawBottomCard(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    fs: (value: number) => number,
    snapshot: FrameSnapshot,
  ): void {
    const cardX = fs(20);
    const cardWidth = width - fs(40);
    const cardHeight = fs(292);
    const cardY = height - fs(20) - cardHeight;
    glass(ctx, cardX, cardY, cardWidth, cardHeight, fs(22), COLORS.glass, COLORS.border, fs(1.2));

    const point = snapshot.point;
    const innerX = cardX + fs(16);
    const innerWidth = cardWidth - fs(32);

    ctx.fillStyle = COLORS.muted;
    ctx.font = `800 ${fs(7.5)}px system-ui, sans-serif`;
    ctx.fillText('DISTANCE', innerX, cardY + fs(22));
    ctx.fillStyle = COLORS.ink;
    ctx.font = `900 ${fs(34)}px system-ui, sans-serif`;
    const distanceText = point.distanceKm.toFixed(2);
    ctx.fillText(distanceText, innerX, cardY + fs(58));
    const distanceWidth = ctx.measureText(distanceText).width;
    ctx.fillStyle = COLORS.green;
    ctx.font = `800 ${fs(13)}px system-ui, sans-serif`;
    ctx.fillText(
      `/ ${this.options.activity.totalDistanceKm.toFixed(2)} KM`,
      innerX + distanceWidth + fs(7),
      cardY + fs(55),
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `900 ${fs(22)}px system-ui, sans-serif`;
    ctx.fillText(formatClock(point.elapsedSec), cardX + cardWidth - fs(16), cardY + fs(50));
    ctx.fillStyle = COLORS.muted;
    ctx.font = `700 ${fs(8)}px system-ui, sans-serif`;
    ctx.fillText('WAKTU LARI', cardX + cardWidth - fs(16), cardY + fs(63));
    ctx.textAlign = 'left';

    const barY = cardY + fs(74);
    roundedRect(ctx, innerX, barY, innerWidth, fs(7), fs(4));
    ctx.fillStyle = 'rgba(30,41,59,0.95)';
    ctx.fill();
    roundedRect(ctx, innerX, barY, innerWidth * Math.max(0.02, snapshot.progress), fs(7), fs(4));
    ctx.fillStyle = COLORS.green;
    ctx.fill();

    const gap = fs(6);
    const tileWidth = (innerWidth - gap * 2) / 3;
    const tileHeight = fs(62);
    const gridY = barY + fs(18);
    const tiles: Array<{ label: string; value: string; color: string }> = [
      { label: 'PACE /KM', value: point.paceFormatted, color: COLORS.amber },
      { label: 'HEART RATE', value: `${point.heartRate} bpm`, color: COLORS.rose },
      { label: 'CADENCE', value: `${point.cadence} spm`, color: COLORS.purple },
      { label: 'DISTANCE', value: `${point.distanceKm.toFixed(2)} km`, color: COLORS.green },
      { label: 'ELEV GAIN', value: `+${Math.round(point.elevationGain)} m`, color: COLORS.sky },
      { label: 'TIME', value: formatClock(point.elapsedSec), color: COLORS.teal },
    ];
    tiles.forEach((tile, index) => {
      const x = innerX + (index % 3) * (tileWidth + gap);
      const y = gridY + Math.floor(index / 3) * (tileHeight + gap);
      glass(ctx, x, y, tileWidth, tileHeight, fs(12), 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.09)', fs(0.9));
      ctx.fillStyle = COLORS.muted;
      ctx.font = `700 ${fs(6.6)}px system-ui, sans-serif`;
      ctx.fillText(tile.label, x + fs(9), y + fs(14));
      ctx.fillStyle = tile.color;
      ctx.font = `900 ${fs(13)}px system-ui, sans-serif`;
      ctx.fillText(tile.value, x + fs(9), y + fs(35));
    });

    const footerY = cardY + cardHeight - fs(12);
    ctx.fillStyle = 'rgba(226,232,240,0.55)';
    ctx.font = `700 ${fs(7)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('DIBUAT DENGAN JEJAKLARI LOCAL STUDIO', cardX + cardWidth / 2, footerY);
    ctx.textAlign = 'left';
  }

  private drawDuel(
    ctx: CanvasRenderingContext2D,
    width: number,
    fs: (value: number) => number,
    snapshot: FrameSnapshot,
  ): void {
    const outcome = this.options.outcome;
    if (!outcome || !snapshot.rivalPoint) return;
    const primaryName = this.options.primaryLook.name.toUpperCase().slice(0, 12);
    const rivalName = this.options.rivalLook.name.toUpperCase().slice(0, 12);

    const gapKm = snapshot.point.distanceKm - snapshot.rivalPoint.distanceKm;
    const leadName = gapKm >= 0 ? primaryName : rivalName;
    const leadMeters = Math.abs(gapKm * 1000);
    const finishLabel = outcome.winner === 'tie'
      ? `HASIL SERI • ${outcome.marginLabel}`
      : `${outcome.winnerName} MENANG • ${outcome.marginLabel}`;
    const liveLabel = snapshot.phase === 'finish'
      ? finishLabel
      : leadMeters < 8
        ? 'POSISI SEIMBANG'
        : `GAP ${leadMeters < 1000 ? `${Math.round(leadMeters)} M` : `${(leadMeters / 1000).toFixed(2)} KM`} • ${leadName} DI DEPAN`;

    const label = `⚔️ DUEL 1V1 • ${primaryName} VS ${rivalName}`;
    ctx.font = `900 ${fs(9)}px system-ui, sans-serif`;
    const pillWidth = Math.max(ctx.measureText(label).width + fs(30), fs(270));
    const x = (width - pillWidth) / 2;
    const y = fs(218);
    glass(ctx, x, y, pillWidth, fs(30), fs(15), 'rgba(2,6,23,0.9)', 'rgba(251,191,36,0.55)', fs(1.2));
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.fillText(label, width / 2, y + fs(13));
    ctx.fillStyle = snapshot.phase === 'finish' ? COLORS.amber : COLORS.mint;
    ctx.font = `800 ${fs(7.2)}px system-ui, sans-serif`;
    ctx.fillText(liveLabel.slice(0, 58), width / 2, y + fs(24));
    ctx.textAlign = 'left';
  }

  private drawIntro(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    fs: (value: number) => number,
    introProgress: number,
  ): void {
    const fadeIn = Math.min(1, introProgress * 4);
    const fadeOut = 1 - Math.max(0, (introProgress - 0.72) / 0.28);
    const alpha = Math.max(0, Math.min(1, fadeIn * fadeOut));
    if (alpha <= 0.01) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(2,6,23,0.58)';
    ctx.fillRect(0, 0, width, height);

    const y = height * 0.3;
    const glow = ctx.createRadialGradient(width / 2, y, 10, width / 2, y, fs(260));
    glow.addColorStop(0, 'rgba(45,212,191,0.28)');
    glow.addColorStop(1, 'rgba(45,212,191,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, y - fs(260), width, fs(520));

    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.teal;
    ctx.font = `900 ${fs(9)}px system-ui, sans-serif`;
    ctx.fillText('JEJAKLARI LOCAL STUDIO', width / 2, y - fs(40));

    ctx.fillStyle = COLORS.ink;
    ctx.font = `900 ${fs(31)}px system-ui, sans-serif`;
    const name = this.options.activity.activityName.toUpperCase().slice(0, 26);
    ctx.fillText(name, width / 2, y + fs(6));

    ctx.fillStyle = COLORS.teal;
    ctx.font = `900 ${fs(15)}px system-ui, sans-serif`;
    ctx.fillText(`BIB #${this.options.primaryLook.bib || '0000'} • ${this.options.primaryLook.name.toUpperCase()}`, width / 2, y + fs(32));

    ctx.fillStyle = COLORS.muted;
    ctx.font = `700 ${fs(9)}px system-ui, sans-serif`;
    ctx.fillText(this.options.activity.dateFormatted, width / 2, y + fs(54));
    ctx.fillText(`${this.options.activity.totalDistanceKm.toFixed(2)} KM • ${formatClock(this.options.activity.totalDurationSec)}`, width / 2, y + fs(70));

    const lineY = y + fs(96);
    ctx.strokeStyle = 'rgba(45,212,191,0.55)';
    ctx.lineWidth = fs(1.4);
    ctx.beginPath();
    ctx.moveTo(width / 2 - fs(66), lineY);
    ctx.lineTo(width / 2 + fs(66), lineY);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.restore();
  }

  private drawFinish(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    fs: (value: number) => number,
    finishProgress: number,
  ): void {
    const alpha = easeOutCubic(Math.min(1, finishProgress * 2.4));
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(2,6,23,0.9)');
    gradient.addColorStop(0.55, 'rgba(2,6,23,0.92)');
    gradient.addColorStop(1, 'rgba(2,6,23,0.96)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const activity = this.options.activity;
    const cardWidth = width - fs(52);
    const cardX = fs(26);
    const cardY = fs(150);
    const cardHeight = height - fs(300);
    glass(ctx, cardX, cardY, cardWidth, cardHeight, fs(26), 'rgba(15,23,42,0.9)', 'rgba(251,191,36,0.5)', fs(1.8));

    ctx.textAlign = 'center';
    const centerX = width / 2;
    const medalY = cardY + fs(48);
    const medal = ctx.createRadialGradient(centerX, medalY, 2, centerX, medalY, fs(36));
    medal.addColorStop(0, 'rgba(251,191,36,0.35)');
    medal.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = medal;
    ctx.beginPath();
    ctx.arc(centerX, medalY, fs(36), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(centerX, medalY, fs(24), 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = fs(2);
    ctx.stroke();
    ctx.fillStyle = COLORS.amber;
    ctx.font = `900 ${fs(18)}px system-ui, sans-serif`;
    ctx.fillText('★', centerX, medalY + fs(6));

    ctx.fillStyle = COLORS.amber;
    ctx.font = `900 ${fs(10)}px system-ui, sans-serif`;
    ctx.fillText('FINISHER', centerX, medalY + fs(48));

    ctx.fillStyle = COLORS.ink;
    ctx.font = `900 ${fs(26)}px system-ui, sans-serif`;
    ctx.fillText(this.options.primaryLook.name.toUpperCase().slice(0, 18), centerX, medalY + fs(82));
    ctx.fillStyle = COLORS.muted;
    ctx.font = `700 ${fs(8.5)}px system-ui, sans-serif`;
    ctx.fillText(`BIB #${this.options.primaryLook.bib || '0000'} • ${activity.dateFormatted}`, centerX, medalY + fs(98));

    ctx.fillStyle = COLORS.ink;
    ctx.font = `900 ${fs(48)}px system-ui, sans-serif`;
    ctx.fillText(formatClock(activity.totalDurationSec), centerX, medalY + fs(150));
    ctx.fillStyle = COLORS.green;
    ctx.font = `800 ${fs(12)}px system-ui, sans-serif`;
    ctx.fillText(`${activity.totalDistanceKm.toFixed(2)} KM • ${activity.avgPaceFormatted}/KM`, centerX, medalY + fs(170));

    const statY = medalY + fs(206);
    const statWidth = (cardWidth - fs(48)) / 3;
    const stats = [
      { label: 'AVG HR', value: `${activity.avgHeartRate} bpm`, color: COLORS.rose },
      { label: 'CADENCE', value: `${activity.avgCadence} spm`, color: COLORS.purple },
      { label: 'ELEV GAIN', value: `+${activity.totalElevationGain} m`, color: COLORS.sky },
    ];
    stats.forEach((stat, index) => {
      const x = cardX + fs(24) + index * statWidth;
      glass(ctx, x, statY, statWidth - fs(8), fs(60), fs(14), 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.1)', fs(0.9));
      ctx.fillStyle = COLORS.muted;
      ctx.font = `700 ${fs(7.4)}px system-ui, sans-serif`;
      ctx.fillText(stat.label, x + (statWidth - fs(8)) / 2, statY + fs(21));
      ctx.fillStyle = stat.color;
      ctx.font = `900 ${fs(13)}px system-ui, sans-serif`;
      ctx.fillText(stat.value, x + (statWidth - fs(8)) / 2, statY + fs(41));
    });

    const outcome = this.options.outcome;
    if (outcome) {
      const rival = this.options.rival;
      const duelY = statY + fs(80);
      glass(ctx, cardX + fs(24), duelY, cardWidth - fs(48), fs(88), fs(16), 'rgba(2,6,23,0.7)', 'rgba(251,191,36,0.35)', fs(1.1));
      ctx.fillStyle = COLORS.amber;
      ctx.font = `900 ${fs(10)}px system-ui, sans-serif`;
      ctx.fillText(outcome.winner === 'tie' ? '⚔️ DUEL 1V1 • HASIL SERI' : `⚔️ DUEL 1V1 • ${outcome.winnerName} MENANG`, centerX, duelY + fs(20));
      ctx.fillStyle = COLORS.ink;
      ctx.font = `900 ${fs(12)}px system-ui, sans-serif`;
      ctx.fillText(outcome.marginLabel, centerX, duelY + fs(39));
      if (rival) {
        ctx.fillStyle = COLORS.muted;
        ctx.font = `700 ${fs(8)}px system-ui, sans-serif`;
        ctx.fillText(
          `${this.options.primaryLook.name.toUpperCase()} ${formatClock(activity.totalDurationSec)} • ${this.options.rivalLook.name.toUpperCase()} ${formatClock(rival.totalDurationSec)} • ${formatPace(outcome.p1PaceSecPerKm / 60)} vs ${formatPace(outcome.rivalPaceSecPerKm / 60)}`,
          centerX,
          duelY + fs(62),
        );
      }
    }

    this.drawFinishRoute(ctx, cardX, cardY, cardWidth, cardHeight, fs);

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(226,232,240,0.6)';
    ctx.font = `700 ${fs(7.5)}px system-ui, sans-serif`;
    ctx.fillText('JEJAKLARI LOCAL STUDIO • RENDER 9:16', centerX, cardY + cardHeight - fs(18));
    ctx.textAlign = 'left';
    ctx.restore();
  }

  private drawFinishRoute(
    ctx: CanvasRenderingContext2D,
    cardX: number,
    cardY: number,
    cardWidth: number,
    cardHeight: number,
    fs: (value: number) => number,
  ): void {
    const x = cardX + fs(24);
    const width = cardWidth - fs(48);
    const height = fs(138);
    const y = cardY + cardHeight - fs(174);
    glass(ctx, x, y, width, height, fs(14), 'rgba(2,6,23,0.62)', 'rgba(255,255,255,0.12)', fs(1));

    ctx.fillStyle = COLORS.muted;
    ctx.font = `800 ${fs(7.4)}px system-ui, sans-serif`;
    ctx.fillText('RUTE LARI', x + fs(12), y + fs(17));
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.green;
    ctx.fillText(`${this.options.activity.totalDistanceKm.toFixed(2)} KM`, x + width - fs(12), y + fs(17));

    const bounds = this.minimapBounds;
    const innerX = x + fs(14);
    const innerY = y + fs(26);
    const innerWidth = width - fs(28);
    const innerHeight = height - fs(36);
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
    const fit = Math.min(innerWidth / spanX, innerHeight / spanZ);
    const offsetX = innerX + (innerWidth - spanX * fit) / 2;
    const offsetY = innerY + (innerHeight - spanZ * fit) / 2;
    const project = (px: number, pz: number) => ({
      x: offsetX + (px - bounds.minX) * fit,
      y: offsetY + (pz - bounds.minZ) * fit,
    });

    const start = this.options.route[0];
    const finish = this.options.route[this.options.route.length - 1];
    ctx.strokeStyle = 'rgba(94,234,212,0.18)';
    ctx.lineWidth = fs(6);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.options.route.forEach((entry, index) => {
      const mapped = project(entry.x, entry.z);
      if (index === 0) ctx.moveTo(mapped.x, mapped.y);
      else ctx.lineTo(mapped.x, mapped.y);
    });
    ctx.stroke();

    ctx.strokeStyle = COLORS.teal;
    ctx.lineWidth = fs(2.2);
    ctx.stroke();

    if (start && finish) {
      const startPoint = project(start.x, start.z);
      const finishPoint = project(finish.x, finish.z);
      ctx.beginPath();
      ctx.arc(startPoint.x, startPoint.y, fs(3.5), 0, Math.PI * 2);
      ctx.fillStyle = COLORS.green;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(finishPoint.x, finishPoint.y, fs(4), 0, Math.PI * 2);
      ctx.fillStyle = COLORS.amber;
      ctx.fill();
    }
    ctx.textAlign = 'left';
  }

  private drawAttribution(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    fs: (value: number) => number,
  ): void {
    const style = MAP_STYLES[this.options.mapStyle];
    const credits = [style.attribution];
    if (this.osmActive) credits.push('BANGUNAN © OSM');
    if (this.options.activity.source === 'strava') credits.push('DATA © STRAVA');
    credits.push('GPS MILIK PENGGUNA');
    ctx.fillStyle = 'rgba(226,232,240,0.42)';
    ctx.font = `600 ${fs(6.4)}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(credits.join(' • '), width - fs(20), height - fs(6));
    ctx.textAlign = 'left';
  }
}
