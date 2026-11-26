import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createCoreApp } from '../server/app';
import { StravaService } from '../server/strava-service';
import {
  STRAVA_SESSION_COOKIE,
  STRAVA_STATE_COOKIE,
} from '../server/strava-router';
import { StravaSessionStore } from '../server/strava-sessions';
import { CookieJar, request, startServer, type RunningServer } from './helpers';

const TOKEN_REQUESTS: URLSearchParams[] = [];
let tokenCalls = 0;

async function readBody(request: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  return body;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function mockStrava(
  requestMessage: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(requestMessage.url ?? '/', 'http://mock');
  if (requestMessage.method === 'POST' && url.pathname === '/oauth/token') {
    const form = new URLSearchParams(await readBody(requestMessage));
    TOKEN_REQUESTS.push(form);
    tokenCalls += 1;
    const refresh = form.get('grant_type') === 'refresh_token';
    json(response, 200, {
      token_type: 'Bearer',
      access_token: refresh ? 'access-refreshed' : 'access-initial',
      refresh_token: refresh ? 'refresh-2' : 'refresh-1',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      scope: 'read activity:read_all',
      ...(refresh
        ? {}
        : { athlete: { id: 7, firstname: 'Test', lastname: 'Runner' } }),
    });
    return;
  }
  if (requestMessage.method === 'POST' && url.pathname === '/oauth/revoke') {
    response.writeHead(200);
    response.end();
    return;
  }
  if (requestMessage.headers.authorization !== 'Bearer access-initial' &&
      requestMessage.headers.authorization !== 'Bearer access-refreshed') {
    json(response, 401, { message: 'Unauthorized' });
    return;
  }
  if (url.pathname === '/api/v3/athlete/activities') {
    json(response, 200, [
      {
        id: 111,
        name: 'Morning Run',
        sport_type: 'Run',
        distance: 5000,
        moving_time: 1500,
        elapsed_time: 1600,
        total_elevation_gain: 30,
        start_date: '2026-01-01T00:00:00Z',
        start_date_local: '2026-01-01T07:00:00Z',
      },
      {
        id: 222,
        name: 'Trail Run',
        sport_type: 'TrailRun',
        distance: 8000,
        moving_time: 3000,
        elapsed_time: 3200,
        total_elevation_gain: 200,
        start_date: '2026-01-02T00:00:00Z',
        start_date_local: '2026-01-02T07:00:00Z',
      },
      {
        id: 333,
        name: 'Ride',
        sport_type: 'Ride',
        distance: 20000,
        moving_time: 3000,
        elapsed_time: 3200,
        start_date: '2026-01-03T00:00:00Z',
        start_date_local: '2026-01-03T07:00:00Z',
      },
    ]);
    return;
  }
  const streamMatch = url.pathname.match(/^\/api\/v3\/activities\/(\d+)\/streams$/);
  if (streamMatch) {
    json(response, 200, {
      latlng: { data: [[-6.2, 106.8], [-6.201, 106.801], [-6.202, 106.802]] },
      time: { data: [0, 300, 600] },
      distance: { data: [0, 500, 1000] },
      altitude: { data: [10, 12, 13] },
      heartrate: { data: [120, 140, 150] },
      cadence: { data: [170, 174, 176] },
    });
    return;
  }
  const activityMatch = url.pathname.match(/^\/api\/v3\/activities\/(\d+)$/);
  if (activityMatch) {
    json(response, 200, {
      id: Number(activityMatch[1]),
      name: 'Morning Run',
      sport_type: 'Run',
      distance: 5000,
      moving_time: 1500,
      elapsed_time: 1600,
      total_elevation_gain: 30,
      start_date: '2026-01-01T00:00:00Z',
      start_date_local: '2026-01-01T07:00:00Z',
    });
    return;
  }
  json(response, 404, { message: 'not found' });
}

describe('Strava OAuth bridge', () => {
  const servers: RunningServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    TOKEN_REQUESTS.length = 0;
    tokenCalls = 0;
  });

  it('runs the OAuth exchange, lists runs, refreshes, streams, and disconnects', async () => {
    const mock = await startServer((requestMessage, response) => {
      void mockStrava(requestMessage, response);
    });
    servers.push(mock);

    const sessions = new StravaSessionStore();
    const service = new StravaService({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://127.0.0.1:5187/api/strava/callback',
      oauthBaseUrl: mock.baseUrl,
      apiBaseUrl: `${mock.baseUrl}/api/v3`,
      requestTimeoutMs: 3000,
    });
    const app = await startServer(
      createCoreApp({ strava: service, sessions, overpass: null, secureCookies: false }),
    );
    servers.push(app);
    const jar = new CookieJar();

    const status = await request(app.baseUrl, '/api/strava/status', jar);
    expect(await status.json()).toEqual({ configured: true, connected: false });

    const auth = await request(app.baseUrl, '/api/strava/auth', jar);
    expect(auth.status).toBe(302);
    const authUrl = new URL(auth.headers.get('location') ?? '');
    expect(authUrl.searchParams.get('scope')).toBe('read,activity:read_all');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    const state = authUrl.searchParams.get('state') ?? '';
    expect(jar.get(STRAVA_STATE_COOKIE)).toBe(state);

    const callback = await request(
      app.baseUrl,
      `/api/strava/callback?code=abc&state=${state}`,
      jar,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/?strava=connected');
    expect(jar.get(STRAVA_SESSION_COOKIE)).toBeTruthy();

    const connected = await request(app.baseUrl, '/api/strava/status', jar);
    const connectedBody = (await connected.json()) as {
      configured: boolean;
      connected: boolean;
      athlete: { firstname: string };
    };
    expect(connectedBody.configured).toBe(true);
    expect(connectedBody.connected).toBe(true);
    expect(connectedBody.athlete.firstname).toBe('Test');

    const activities = await request(app.baseUrl, '/api/strava/activities', jar);
    const activityBody = (await activities.json()) as { activities: Array<{ id: string; name: string }> };
    expect(activityBody.activities.map((activity) => activity.id)).toEqual(['111', '222']);

    const streams = await request(app.baseUrl, '/api/strava/activities/111/streams', jar);
    const streamBody = (await streams.json()) as {
      activity: { name: string };
      streams: { latlng: { data: unknown[] } };
    };
    expect(streamBody.activity.name).toBe('Morning Run');
    expect(streamBody.streams.latlng.data).toHaveLength(3);

    const sid = jar.get(STRAVA_SESSION_COOKIE) ?? '';
    const session = sessions.get(sid);
    expect(session).not.toBeNull();
    if (session) session.tokens.expiresAt = 0;
    const refreshed = await request(app.baseUrl, '/api/strava/activities', jar);
    expect(refreshed.status).toBe(200);
    expect(TOKEN_REQUESTS.some((form) => form.get('grant_type') === 'refresh_token')).toBe(true);
    expect(tokenCalls).toBeGreaterThan(1);

    const refreshCountBefore = TOKEN_REQUESTS.filter(
      (form) => form.get('grant_type') === 'refresh_token',
    ).length;
    if (session) session.tokens.expiresAt = 0;
    const [concurrentActivities, concurrentStreams] = await Promise.all([
      request(app.baseUrl, '/api/strava/activities', jar),
      request(app.baseUrl, '/api/strava/activities/111/streams', jar),
    ]);
    expect(concurrentActivities.status).toBe(200);
    expect(concurrentStreams.status).toBe(200);
    const refreshCountAfter = TOKEN_REQUESTS.filter(
      (form) => form.get('grant_type') === 'refresh_token',
    ).length;
    expect(refreshCountAfter - refreshCountBefore).toBe(1);

    const blocked = await request(app.baseUrl, '/api/strava/disconnect', jar, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect(blocked.status).toBe(403);

    const disconnect = await request(app.baseUrl, '/api/strava/disconnect', jar, {
      method: 'POST',
    });
    expect(disconnect.status).toBe(200);
    expect(jar.get(STRAVA_SESSION_COOKIE)).toBeNull();
    const after = await request(app.baseUrl, '/api/strava/status', jar);
    expect(await after.json()).toEqual({ configured: true, connected: false });
  });

  it('rejects a callback with the wrong state', async () => {
    const mock = await startServer((requestMessage, response) => {
      void mockStrava(requestMessage, response);
    });
    servers.push(mock);
    const app = await startServer(
      createCoreApp({
        strava: new StravaService({
          clientId: 'id',
          clientSecret: 'secret',
          redirectUri: 'http://127.0.0.1/cb',
          oauthBaseUrl: mock.baseUrl,
          apiBaseUrl: `${mock.baseUrl}/api/v3`,
        }),
        sessions: new StravaSessionStore(),
        overpass: null,
        secureCookies: false,
      }),
    );
    servers.push(app);
    const jar = new CookieJar();
    await request(app.baseUrl, '/api/strava/auth', jar);
    const callback = await request(
      app.baseUrl,
      '/api/strava/callback?code=abc&state=wrong',
      jar,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toContain('strava=error');
    expect(jar.get(STRAVA_SESSION_COOKIE)).toBeNull();
  });
});
