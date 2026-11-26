# ADR 0002 — Local API bridge for Strava and Overpass

Status: accepted (2026-11-26)

## Context

Two requested engine features cannot be implemented safely or reliably as static browser code:

- **Strava OAuth** requires a client secret for the token exchange and refresh. Shipping the secret
  to the browser would let anyone who opens the page extract it. Tokens also need a confidential
  store and a refresh path.
- **Overpass** public instances enforce usage policies (identifying User-Agent, caching, no parallel
  bulk scripts, area limits) and are frequently saturated. A browser client cannot set a
  meaningful User-Agent, and parallel tabs would violate the policy.

The rest of the pipeline (parsing, rendering, HUD, WebCodecs export) is intentionally browser-local.

## Decision

Run a small **Express 5** server in the same process as Vite in development, and as the static file
server in production.

- `server/strava-service.ts` owns OAuth URL construction, code exchange, token refresh, activity
  listing, streams, and revocation. It is injected with `fetch`, so tests use a mock Strava.
- `server/strava-sessions.ts` stores tokens in memory keyed by a random session id. The browser gets
  an httpOnly, SameSite=Lax cookie. OAuth uses a separate short-lived state cookie (CSRF).
- `server/strava-router.ts` exposes only same-origin endpoints and maps errors to JSON.
- `server/overpass-service.ts` validates the route bbox, queries one endpoint at a time, identifies
  the app in `User-Agent`, caches results for one hour, deduplicates in-flight queries, and caps
  buildings at 1,200. `server/overpass-router.ts` exposes `POST /api/osm/buildings`.
- `src/api/*` is the only browser code that talks to these routes. `src/engine/osm.ts` turns
  normalized footprints into one merged Three.js mesh; the scene can add/remove it at runtime.
- Shared request/response types live in `src/shared/` for both sides of the bridge.

## Alternatives rejected

- **Put the Strava secret in the client.** Unacceptable; secret disclosure and token abuse.
- **Use a hosted OAuth proxy.** Adds an external trust/availability dependency to a local port.
- **Call Overpass directly from the browser.** CORS is unreliable, User-Agent is not settable, and
  the public policy requires caching/rate limiting that a tab cannot enforce.
- **Adopt a commercial map SDK for buildings.** Replaces the observed tile/OSM pipeline and adds a
  key/provider dependency; the source engine uses Overpass.

## Consequences

- `npm run dev` and `npm start` now run a Node server; a pure static deploy loses Strava and OSM
  buildings (the rest of the studio still renders).
- Tokens are memory-only: a server restart or 30-day session expiry requires reconnecting.
- Single-user/local by design; the in-memory session map is not suitable for multi-tenant hosting.
- `.env` holds the Strava secret and is gitignored. The browser never receives it.
- Overpass availability still varies; the app reports failure and keeps rendering without buildings.
- Strava API terms, OSM ODbL attribution, and each Overpass instance's usage policy apply.
