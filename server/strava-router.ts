import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { StravaStatus } from '../src/shared/strava';
import { StravaApiError, StravaService } from './strava-service';
import { StravaSessionStore, type StravaSession } from './strava-sessions';

export const STRAVA_SESSION_COOKIE = 'jejak_strava_sid';
export const STRAVA_STATE_COOKIE = 'jejak_strava_state';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

interface RouterOptions {
  secureCookies: boolean;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function cookieOptions(secure: boolean, maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

function sendError(response: Response, status: number, error: string, code?: string): void {
  response.status(status).json(code ? { error, code } : { error });
}

function requireSession(
  request: Request,
  response: Response,
  sessions: StravaSessionStore,
): StravaSession | null {
  const id = readCookie(request, STRAVA_SESSION_COOKIE);
  const session = id ? sessions.get(id) : null;
  if (!session) {
    sendError(response, 401, 'Hubungkan Strava terlebih dahulu.', 'strava_required');
    return null;
  }
  return session;
}

function redirectResult(response: Response, result: 'connected' | 'error', reason?: string): void {
  const url = new URL(result === 'connected' ? '/?strava=connected' : '/?strava=error', 'http://local');
  if (reason) url.searchParams.set('reason', reason);
  response.redirect(302, `${url.pathname}${url.search}`);
}

function clearSessionOnAuthError(
  error: unknown,
  request: Request,
  response: Response,
  sessions: StravaSessionStore,
  secureCookies: boolean,
): void {
  if (!(error instanceof StravaApiError) || error.status !== 401) return;
  const id = readCookie(request, STRAVA_SESSION_COOKIE);
  if (id) sessions.delete(id);
  response.clearCookie(STRAVA_SESSION_COOKIE, cookieOptions(secureCookies));
}

export function createStravaRouter(
  service: StravaService | null,
  sessions: StravaSessionStore,
  options: RouterOptions,
): Router {
  const router = Router();

  router.get('/status', async (request, response) => {
    if (!service) {
      response.json({ configured: false, connected: false } satisfies StravaStatus);
      return;
    }
    const id = readCookie(request, STRAVA_SESSION_COOKIE);
    const session = id ? sessions.get(id) : null;
    if (!session) {
      response.json({ configured: true, connected: false } satisfies StravaStatus);
      return;
    }
    try {
      const tokens = await service.ensureFreshTokens(session);
      response.json({
        configured: true,
        connected: true,
        athlete: tokens.athlete,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      } satisfies StravaStatus);
    } catch (error) {
      const transient =
        !(error instanceof StravaApiError) || error.status >= 500 || error.status === 429;
      if (transient) {
        response.json({ configured: true, connected: false } satisfies StravaStatus);
        return;
      }
      if (id) sessions.delete(id);
      response.clearCookie(STRAVA_SESSION_COOKIE, cookieOptions(options.secureCookies));
      response.json({ configured: true, connected: false } satisfies StravaStatus);
    }
  });

  router.get('/auth', (_request, response) => {
    if (!service) {
      sendError(response, 503, 'Strava belum dikonfigurasi di server.', 'strava_unconfigured');
      return;
    }
    const state = randomBytes(16).toString('hex');
    response.cookie(STRAVA_STATE_COOKIE, state, cookieOptions(options.secureCookies, STATE_MAX_AGE_MS));
    response.redirect(302, service.createAuthorizationUrl(state));
  });

  router.get('/callback', async (request, response) => {
    if (!service) {
      sendError(response, 503, 'Strava belum dikonfigurasi di server.', 'strava_unconfigured');
      return;
    }
    try {
      const expectedState = readCookie(request, STRAVA_STATE_COOKIE);
      response.clearCookie(STRAVA_STATE_COOKIE, cookieOptions(options.secureCookies));
      const error = typeof request.query.error === 'string' ? request.query.error : null;
      if (error) {
        redirectResult(response, 'error', error);
        return;
      }
      const code = typeof request.query.code === 'string' ? request.query.code : '';
      const state = typeof request.query.state === 'string' ? request.query.state : '';
      if (!code || !expectedState || state !== expectedState) {
        redirectResult(response, 'error', 'invalid_state');
        return;
      }
      const tokens = await service.exchangeCode(code);
      const sessionId = sessions.create(tokens);
      response.cookie(
        STRAVA_SESSION_COOKIE,
        sessionId,
        cookieOptions(options.secureCookies, SESSION_MAX_AGE_MS),
      );
      redirectResult(response, 'connected');
    } catch (error) {
      console.error('Strava callback failed:', error instanceof Error ? error.message : error);
      redirectResult(response, 'error', 'oauth_failed');
    }
  });

  router.get('/activities', async (request, response, next) => {
    if (!service) {
      sendError(response, 503, 'Strava belum dikonfigurasi di server.', 'strava_unconfigured');
      return;
    }
    const session = requireSession(request, response, sessions);
    if (!session) return;
    const page = Math.max(1, Math.min(50, Number(request.query.page) || 1));
    const perPage = Math.max(1, Math.min(50, Number(request.query.per_page) || 30));
    try {
      const activities = await service.listActivities(session, page, perPage);
      response.json({ activities });
    } catch (error) {
      clearSessionOnAuthError(error, request, response, sessions, options.secureCookies);
      next(error);
    }
  });

  router.get('/activities/:id/streams', async (request, response, next) => {
    if (!service) {
      sendError(response, 503, 'Strava belum dikonfigurasi di server.', 'strava_unconfigured');
      return;
    }
    const session = requireSession(request, response, sessions);
    if (!session) return;
    const id = request.params.id;
    if (!/^\d{1,20}$/.test(id)) {
      sendError(response, 400, 'ID aktivitas Strava tidak valid.', 'invalid_activity_id');
      return;
    }
    try {
      const [activity, streams] = await Promise.all([
        service.getActivity(session, id),
        service.getStreams(session, id),
      ]);
      response.json({ activity, streams });
    } catch (error) {
      clearSessionOnAuthError(error, request, response, sessions, options.secureCookies);
      next(error);
    }
  });

  router.post('/disconnect', async (request, response) => {
    const id = readCookie(request, STRAVA_SESSION_COOKIE);
    const session = id ? sessions.get(id) : null;
    if (session && service) {
      try {
        await service.deauthorize(session.tokens);
      } catch {
        // Local disconnect must still succeed if Strava is unreachable.
      }
    }
    if (id) sessions.delete(id);
    response.clearCookie(STRAVA_SESSION_COOKIE, cookieOptions(options.secureCookies));
    response.json({ ok: true });
  });

  router.use((_request, response) => {
    sendError(response, 404, 'Endpoint Strava tidak ditemukan.', 'not_found');
  });

  return router;
}

export function stravaErrorStatus(error: unknown): { status: number; message: string; code: string } {
  if (error instanceof StravaApiError) {
    if (error.status === 401) {
      return { status: 401, message: 'Sesi Strava berakhir. Hubungkan ulang.', code: 'strava_auth' };
    }
    if (error.status === 429) {
      return { status: 429, message: 'Batas permintaan Strava tercapai. Coba lagi nanti.', code: 'strava_rate_limit' };
    }
    return { status: 502, message: error.message, code: 'strava_api' };
  }
  return { status: 500, message: 'Terjadi kesalahan server.', code: 'server_error' };
}
