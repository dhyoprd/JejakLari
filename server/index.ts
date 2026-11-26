import 'dotenv/config';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createCoreApp } from './app';
import { OverpassService } from './overpass-service';
import { StravaService } from './strava-service';
import { StravaSessionStore } from './strava-sessions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 5187);
const host = process.env.HOST ?? '127.0.0.1';
const secureCookies = process.env.COOKIE_SECURE === '1';

const redirectUri =
  process.env.STRAVA_REDIRECT_URI ?? `http://${host}:${port}/api/strava/callback`;

const strava =
  process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET
    ? new StravaService({
        clientId: process.env.STRAVA_CLIENT_ID,
        clientSecret: process.env.STRAVA_CLIENT_SECRET,
        redirectUri,
      })
    : null;

const overpass = new OverpassService({
  endpoint: process.env.OVERPASS_URL,
  fallbackEndpoint: process.env.OVERPASS_FALLBACK_URL,
  userAgent: process.env.OVERPASS_USER_AGENT,
});

const app = createCoreApp({
  strava,
  sessions: new StravaSessionStore(),
  overpass,
  secureCookies,
});

const server = createHttpServer(app);

if (!production) {
  // Dev-only dependency: a production install may omit Vite entirely.
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root,
    appType: 'spa',
    server: {
      middlewareMode: true,
      ws: { server },
    },
  });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.use((request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next();
      return;
    }
    response.sendFile(path.join(dist, 'index.html'));
  });
}

server.listen(port, host, () => {
  console.log(`JejakLari Local: http://${host}:${port}`);
  console.log(
    strava
      ? `Strava bridge: enabled (${redirectUri})`
      : 'Strava bridge: disabled — set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env',
  );
  console.log(
    `Overpass: ${process.env.OVERPASS_URL ?? 'https://ovp.dresel.systems/api-as/interpreter'}`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
