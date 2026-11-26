import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { createOverpassRouter } from './overpass-router';
import type { OverpassService } from './overpass-service';
import { createStravaRouter, stravaErrorStatus } from './strava-router';
import type { StravaService } from './strava-service';
import type { StravaSessionStore } from './strava-sessions';

export interface CoreAppOptions {
  strava: StravaService | null;
  sessions: StravaSessionStore;
  overpass: OverpassService | null;
  secureCookies: boolean;
}

export function createCoreApp(options: CoreAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'POST') {
      next();
      return;
    }
    const origin = request.headers.origin;
    if (!origin) {
      next();
      return;
    }
    try {
      if (new URL(origin).host !== request.headers.host) {
        response.status(403).json({ error: 'Origin tidak cocok.', code: 'bad_origin' });
        return;
      }
    } catch {
      response.status(403).json({ error: 'Origin tidak valid.', code: 'bad_origin' });
      return;
    }
    next();
  });

  app.use(
    '/api/strava',
    createStravaRouter(options.strava, options.sessions, {
      secureCookies: options.secureCookies,
    }),
  );
  app.use('/api/osm', createOverpassRouter(options.overpass));

  app.use('/api', (_request: Request, response: Response) => {
    response.status(404).json({ error: 'API tidak ditemukan.', code: 'not_found' });
  });

  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({ error: 'JSON permintaan tidak valid.', code: 'invalid_json' });
      return;
    }
    const mapped = stravaErrorStatus(error);
    if (mapped.status >= 500) {
      console.error('API error:', error instanceof Error ? error.message : error);
    }
    response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  });

  return app;
}
