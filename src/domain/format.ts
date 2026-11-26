const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function formatPace(minPerKm: number): string {
  if (!Number.isFinite(minPerKm) || minPerKm <= 0 || minPerKm >= 18) return "--'--\"";
  const total = Math.round(60 * minPerKm);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}'${seconds.toString().padStart(2, '0')}"`;
}

export function formatClock(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(t / 3600);
  const minutes = Math.floor((t % 3600) / 60);
  const seconds = t % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}


export function formatActivityDate(ms: number, timeZone?: string): string {
  const date = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const monthIndex = Math.max(0, Math.min(11, Number(get('month')) - 1));
  return `${get('day')} ${MONTHS_ID[monthIndex]} ${get('year')} • ${get('hour')}:${get('minute')}`;
}


export function sanitizeName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base.length > 0 ? base.slice(0, 48) : 'Aktivitas Lari';
}
