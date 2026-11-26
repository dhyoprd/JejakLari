import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createCoreApp } from '../server/app';
import { OverpassService, parseOverpassBuildings } from '../server/overpass-service';
import { StravaSessionStore } from '../server/strava-sessions';
import { CookieJar, request, startServer, type RunningServer } from './helpers';

let queryCount = 0;

async function readBody(requestMessage: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of requestMessage) body += String(chunk);
  return body;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const ELEMENTS = [
  {
    type: 'way',
    id: 101,
    tags: { building: 'yes', height: '18 m' },
    geometry: [
      { lat: -6.2, lon: 106.8 },
      { lat: -6.1998, lon: 106.8 },
      { lat: -6.1998, lon: 106.8002 },
      { lat: -6.2, lon: 106.8002 },
    ],
  },
  {
    type: 'way',
    id: 102,
    tags: { building: 'apartments', 'building:levels': '4' },
    geometry: [
      { lat: -6.201, lon: 106.801 },
      { lat: -6.2008, lon: 106.801 },
      { lat: -6.2008, lon: 106.8012 },
      { lat: -6.201, lon: 106.8012 },
    ],
  },
  {
    type: 'way',
    id: 103,
    tags: { building: 'no' },
    geometry: [
      { lat: -6.202, lon: 106.802 },
      { lat: -6.2018, lon: 106.802 },
      { lat: -6.2018, lon: 106.8022 },
    ],
  },
];

async function mockOverpass(
  requestMessage: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(requestMessage.url ?? '/', 'http://mock');
  if (requestMessage.method !== 'POST' || url.pathname !== '/api/interpreter') {
    json(response, 404, { message: 'not found' });
    return;
  }
  const body = await readBody(requestMessage);
  if (!body.includes('way%5B%22building%22%5D')) {
    json(response, 400, { message: 'unexpected query' });
    return;
  }
  if (requestMessage.headers['user-agent'] === undefined) {
    json(response, 403, { message: 'missing user agent' });
    return;
  }
  queryCount += 1;
  json(response, 200, {
    version: 0.6,
    elements: ELEMENTS,
  });
}

describe('Overpass service', () => {
  const servers: RunningServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    queryCount = 0;
  });

  it('parses and caches building footprints', async () => {
    const mock = await startServer((requestMessage, response) => {
      void mockOverpass(requestMessage, response);
    });
    servers.push(mock);
    const service = new OverpassService({
      endpoint: `${mock.baseUrl}/api/interpreter`,
      fallbackEndpoint: '',
      requestTimeoutMs: 3000,
    });
    const bbox = { south: -6.205, west: 106.795, north: -6.19, east: 106.81 };

    const first = await service.getBuildings(bbox);
    expect(first.buildings).toHaveLength(2);
    expect(first.buildings[0].heightMeters).toBe(18);
    expect(first.buildings[1].heightMeters).toBeCloseTo(14.8, 1);
    expect(first.buildings[0].polygon).toHaveLength(4);
    expect(first.truncated).toBe(false);
    expect(queryCount).toBe(1);

    const second = await service.getBuildings(bbox);
    expect(second.cached).toBe(true);
    expect(second.buildings).toHaveLength(2);
    expect(queryCount).toBe(1);
  });

  it('keeps a shared query alive when one caller aborts', async () => {
    const mock = await startServer(async (requestMessage, response) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await mockOverpass(requestMessage, response);
    });
    servers.push(mock);
    const service = new OverpassService({
      endpoint: `${mock.baseUrl}/api/interpreter`,
      fallbackEndpoint: '',
      requestTimeoutMs: 3000,
    });
    const bbox = { south: -6.205, west: 106.795, north: -6.19, east: 106.81 };
    const first = new AbortController();
    const second = new AbortController();
    const firstRequest = service.getBuildings(bbox, { signal: first.signal });
    const secondRequest = service.getBuildings(bbox, { signal: second.signal });
    first.abort();
    await expect(firstRequest).rejects.toMatchObject({ name: 'AbortError' });
    const result = await secondRequest;
    expect(result.buildings).toHaveLength(2);
    expect(queryCount).toBe(1);
  });

  it('deduplicates a query that outlives its aborted caller', async () => {
    const mock = await startServer(async (requestMessage, response) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await mockOverpass(requestMessage, response);
    });
    servers.push(mock);
    const service = new OverpassService({
      endpoint: `${mock.baseUrl}/api/interpreter`,
      fallbackEndpoint: '',
      requestTimeoutMs: 3000,
    });
    const bbox = { south: -6.205, west: 106.795, north: -6.19, east: 106.81 };
    const controller = new AbortController();
    const aborted = service.getBuildings(bbox, { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const late = await service.getBuildings(bbox);
    expect(late.buildings).toHaveLength(2);
    expect(queryCount).toBe(1);
  });

  it('rejects an oversized bounding box', async () => {
    const service = new OverpassService({
      endpoint: 'http://127.0.0.1:1/api/interpreter',
      fallbackEndpoint: '',
    });
    await expect(
      service.getBuildings({ south: -7, west: 106, north: -5, east: 108 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('caps building count and exposes truncation', () => {
    const parsed = parseOverpassBuildings({ elements: ELEMENTS }, 1);
    expect(parsed.buildings).toHaveLength(1);
    expect(parsed.truncated).toBe(true);
  });

  it('serves the HTTP endpoint with caching', async () => {
    const mock = await startServer((requestMessage, response) => {
      void mockOverpass(requestMessage, response);
    });
    servers.push(mock);
    const service = new OverpassService({
      endpoint: `${mock.baseUrl}/api/interpreter`,
      fallbackEndpoint: '',
      requestTimeoutMs: 3000,
    });
    const app = await startServer(
      createCoreApp({
        strava: null,
        sessions: new StravaSessionStore(),
        overpass: service,
        secureCookies: false,
      }),
    );
    servers.push(app);
    const body = JSON.stringify({ south: -6.205, west: 106.795, north: -6.19, east: 106.81 });
    const first = await request(app.baseUrl, '/api/osm/buildings', new CookieJar(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { buildings: unknown[] }).buildings).toHaveLength(2);
    const second = await request(app.baseUrl, '/api/osm/buildings', new CookieJar(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(second.status).toBe(200);
    expect(queryCount).toBe(1);

    const refreshed = await request(app.baseUrl, '/api/osm/buildings', new CookieJar(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        south: -6.205,
        west: 106.795,
        north: -6.19,
        east: 106.81,
        refresh: true,
      }),
    });
    expect(refreshed.status).toBe(200);
    expect(queryCount).toBe(2);
  });

  it('maps invalid bbox input to 400', async () => {
    const service = new OverpassService({
      endpoint: 'http://127.0.0.1:1/api/interpreter',
      fallbackEndpoint: '',
    });
    const app = await startServer(
      createCoreApp({
        strava: null,
        sessions: new StravaSessionStore(),
        overpass: service,
        secureCookies: false,
      }),
    );
    servers.push(app);
    const response = await request(app.baseUrl, '/api/osm/buildings', new CookieJar(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ south: -5, west: 106, north: -7, east: 108 }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toHaveProperty('error');
  });
});
