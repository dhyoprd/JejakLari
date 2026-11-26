import { formatClock } from '../domain/format';
import type { StravaActivitySummary, StravaStatus } from '../shared/strava';
import { Section } from './controls';

interface StravaSectionProps {
  status: StravaStatus | null;
  activities: StravaActivitySummary[];
  loading: boolean;
  error: string | null;
  importingId: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onImport: (activity: StravaActivitySummary) => void;
}

function activitiesLabel(count: number): string {
  return count === 1 ? '1 lari terbaru' : `${count} lari terbaru`;
}

export function StravaSection({
  status,
  activities,
  loading,
  error,
  importingId,
  onConnect,
  onDisconnect,
  onRefresh,
  onImport,
}: StravaSectionProps) {
  const connected = Boolean(status?.configured && status.connected && status.athlete);
  const initials = status?.athlete
    ? `${status.athlete.firstname?.[0] ?? ''}${status.athlete.lastname?.[0] ?? ''}`.toUpperCase()
    : 'ST';

  return (
    <Section title="Strava" hint="OAuth lokal">
      {!status && !error ? <p className="micro-copy">Memeriksa koneksi Strava...</p> : null}
      {error ? <p className="error-line">{error}</p> : null}

      {status && !status.configured ? (
        <div className="setup-note">
          <p className="micro-copy">
            Server lokal belum memiliki kredensial Strava. Buat API application di Strava, lalu
            isi <code>.env</code>:
          </p>
          <pre className="env-hint">{`STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
STRAVA_REDIRECT_URI=${window.location.origin}/api/strava/callback`}</pre>
          <p className="micro-copy">
            Authorization Callback Domain di Strava harus cocok dengan{' '}
            <code>{window.location.hostname}</code>. Restart <code>npm run dev</code> setelah
            mengisi <code>.env</code>.
          </p>
        </div>
      ) : null}

      {status?.configured && !connected ? (
        <>
          <button type="button" className="btn btn-primary btn-wide" onClick={onConnect}>
            Hubungkan Strava
          </button>
          <p className="micro-copy">
            Scope <code>read,activity:read_all</code>. Client secret tetap di server lokal; browser
            hanya memegang cookie sesi httpOnly.
          </p>
        </>
      ) : null}

      {connected && status?.athlete ? (
        <>
          <div className="strava-account">
            <div className="strava-avatar" aria-hidden>
              {initials || 'ST'}
            </div>
            <div className="strava-account-text">
              <strong>
                {status.athlete.firstname} {status.athlete.lastname}
              </strong>
              <span>Terhubung • token hanya di memori server</span>
            </div>
            <button type="button" className="btn btn-ghost" onClick={onDisconnect} disabled={loading}>
              Putuskan
            </button>
          </div>

          <div className="row gap strava-toolbar">
            <button type="button" className="btn btn-ghost" onClick={onRefresh} disabled={loading}>
              {loading ? 'Memuat...' : 'Muat ulang'}
            </button>
            <span className="micro-copy">{activitiesLabel(activities.length)}</span>
          </div>

          {activities.length > 0 ? (
            <div className="strava-list">
              {activities.map((activity) => (
                <button
                  type="button"
                  key={activity.id}
                  className="strava-row"
                  onClick={() => onImport(activity)}
                  disabled={importingId !== null}
                >
                  <span className="strava-row-main">
                    <strong>{activity.name}</strong>
                    <small>
                      {new Date(activity.startDateLocal).toLocaleDateString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}{' '}
                      • {activity.sportType}
                    </small>
                  </span>
                  <span className="strava-row-meta">
                    <strong>{(activity.distanceMeters / 1000).toFixed(2)} km</strong>
                    <small>{formatClock(activity.movingTimeSec)}</small>
                  </span>
                  {importingId === activity.id ? <span className="spinner spinner-small" /> : null}
                </button>
              ))}
            </div>
          ) : loading ? null : (
            <p className="micro-copy">Belum ada aktivitas lari di akun ini.</p>
          )}
          <p className="micro-copy">
            Data dari Strava API. Impor memakai stream GPS, elevasi, HR, cadence, dan waktu.
          </p>
        </>
      ) : null}
    </Section>
  );
}
