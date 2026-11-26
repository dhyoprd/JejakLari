import type {
  StravaActivitySummary,
  StravaAthlete,
  StravaStreamsPayload,
} from '../src/shared/strava';
import type { StravaSession, StravaTokens } from './strava-sessions';

export class StravaApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'StravaApiError';
    this.status = status;
  }
}

export interface StravaServiceConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  oauthBaseUrl?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

interface RawTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  expires_in?: number;
  scope?: string;
  athlete?: StravaAthlete;
}

interface RawActivity {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  start_date?: string;
  start_date_local?: string;
}

const RUN_SPORTS: Record<string, true> = { run: true, trailrun: true, virtualrun: true };
const USER_AGENT = 'JejakLariLocal/0.2 (local OAuth bridge)';

function joinUrl(base: string, path: string): string {
  return new URL(path.replace(/^\/+/, ''), base.endsWith('/') ? base : `${base}/`).toString();
}

function isRun(activity: RawActivity): boolean {
  const sport = (activity.sport_type ?? activity.type ?? '').toLowerCase();
  return RUN_SPORTS[sport] === true;
}

function mapActivity(activity: RawActivity): StravaActivitySummary {
  return {
    id: String(activity.id),
    name: activity.name?.trim() || 'Aktivitas Strava',
    sportType: activity.sport_type ?? activity.type ?? 'Run',
    distanceMeters: Number(activity.distance ?? 0),
    movingTimeSec: Number(activity.moving_time ?? 0),
    elapsedTimeSec: Number(activity.elapsed_time ?? activity.moving_time ?? 0),
    elevationGainMeters: Number(activity.total_elevation_gain ?? 0),
    startDate: activity.start_date ?? new Date(0).toISOString(),
    startDateLocal: activity.start_date_local ?? activity.start_date ?? new Date(0).toISOString(),
  };
}

function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      errors?: Array<{ resource?: string; field?: string; code?: string }>;
    };
    const detail = parsed.errors?.map((entry) => entry.code ?? entry.field).filter(Boolean).join(', ');
    return parsed.message ?? detail ?? `Strava API error ${status}`;
  } catch {
    return body.slice(0, 200) || `Strava API error ${status}`;
  }
}

export class StravaService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly oauthBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;

  constructor(config: StravaServiceConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config.redirectUri;
    this.oauthBaseUrl = config.oauthBaseUrl ?? 'https://www.strava.com';
    this.apiBaseUrl = config.apiBaseUrl ?? 'https://www.strava.com/api/v3';
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? Date.now;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 20_000;
  }

  createAuthorizationUrl(state: string): string {
    const url = new URL(joinUrl(this.oauthBaseUrl, 'oauth/authorize'));
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('approval_prompt', 'auto');
    url.searchParams.set('scope', 'read,activity:read_all');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<StravaTokens> {
    const response = await this.requestTokens({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: 'authorization_code',
    });
    return this.toTokens(response);
  }

  private async refreshTokens(current: StravaTokens): Promise<StravaTokens> {
    const response = await this.requestTokens({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: current.refreshToken,
      grant_type: 'refresh_token',
    });
    const refreshed = this.toTokens(response, current);
    return {
      ...refreshed,
      refreshToken: response.refresh_token ?? current.refreshToken,
      athlete: response.athlete ?? current.athlete,
      scopes: response.scope ? response.scope.split(/[\s,]+/).filter(Boolean) : current.scopes,
    };
  }

  private toTokens(response: RawTokenResponse, fallback?: StravaTokens): StravaTokens {
    const athlete = response.athlete ?? fallback?.athlete;
    if (!athlete) throw new StravaApiError(502, 'Respons token Strava tanpa data atlet.');
    const expiresAt =
      response.expires_at ||
      Math.floor(this.now() / 1000) + Number(response.expires_in ?? 21_600);
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? fallback?.refreshToken ?? '',
      expiresAt,
      scopes: response.scope
        ? response.scope.split(/[\s,]+/).filter(Boolean)
        : (fallback?.scopes ?? []),
      athlete,
    };
  }

  private async requestTokens(form: Record<string, string>): Promise<RawTokenResponse> {
    const response = await this.fetchImpl(joinUrl(this.oauthBaseUrl, 'oauth/token'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new StravaApiError(response.status, errorMessage(response.status, body));
    }
    try {
      return JSON.parse(body) as RawTokenResponse;
    } catch {
      throw new StravaApiError(502, 'Respons token Strava tidak valid.');
    }
  }

  private async refreshSession(session: StravaSession): Promise<StravaTokens> {
    if (!session.refreshPromise) {
      session.refreshPromise = this.refreshTokens(session.tokens)
        .then((tokens) => {
          session.tokens = tokens;
          return tokens;
        })
        .finally(() => {
          session.refreshPromise = undefined;
        });
    }
    return session.refreshPromise;
  }

  private async accessToken(session: StravaSession, force = false): Promise<string> {
    const now = Math.floor(this.now() / 1000);
    if (!force && session.tokens.expiresAt > now + 60) return session.tokens.accessToken;
    const tokens = await this.refreshSession(session);
    return tokens.accessToken;
  }

  private async apiGet<T>(
    session: StravaSession,
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<T> {
    let lastStatus = 401;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(session);
      const url = new URL(joinUrl(this.apiBaseUrl, path));
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
      const response = await this.fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      lastStatus = response.status;
      const body = await response.text();
      if (response.status === 401 && attempt === 0) {
        await this.refreshSession(session);
        continue;
      }
      if (!response.ok) {
        throw new StravaApiError(response.status, errorMessage(response.status, body));
      }
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new StravaApiError(502, 'Respons Strava tidak valid.');
      }
    }
    throw new StravaApiError(lastStatus, 'Sesi Strava tidak valid. Hubungkan ulang.');
  }

  async ensureFreshTokens(session: StravaSession): Promise<StravaTokens> {
    await this.accessToken(session);
    return session.tokens;
  }

  async listActivities(
    session: StravaSession,
    page: number,
    perPage: number,
  ): Promise<StravaActivitySummary[]> {
    const activities = await this.apiGet<RawActivity[]>(session, 'athlete/activities', {
      page,
      per_page: perPage,
    });
    return activities.filter(isRun).map(mapActivity);
  }

  async getActivity(session: StravaSession, id: string): Promise<StravaActivitySummary> {
    const activity = await this.apiGet<RawActivity>(session, `activities/${encodeURIComponent(id)}`);
    return mapActivity(activity);
  }

  async getStreams(session: StravaSession, id: string): Promise<StravaStreamsPayload> {
    return this.apiGet<StravaStreamsPayload>(
      session,
      `activities/${encodeURIComponent(id)}/streams`,
      {
        keys: 'latlng,altitude,time,heartrate,cadence,distance',
        key_by_type: 'true',
      },
    );
  }

  async deauthorize(tokens: StravaTokens): Promise<void> {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await this.fetchImpl(joinUrl(this.oauthBaseUrl, 'oauth/revoke'), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({ token: tokens.refreshToken }),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new StravaApiError(response.status, 'Gagal mencabut akses Strava.');
    }
  }
}
