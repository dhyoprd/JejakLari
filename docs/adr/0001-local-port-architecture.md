# ADR 0001 — Local port architecture

Status: accepted (2026-11-26)

## Context

The target is a production Next.js studio whose engine combines FIT/GPX parsing, raster tile
stitching, a Three.js diorama, procedural chibi runners, a canvas HUD, and WebCodecs export.
The goal is a **local, inspectable, fully functional port**, not a pixel clone or a deployment of
the original. The original relies on Strava OAuth, an Overpass-backed landmark service, reverse
geocoding, a tile proxy, and hosted assets; those are service/secret-dependent.

## Decisions

1. **Vite + React + TypeScript, no Next.js.** The renderer needs no server rendering or routing.
   A small Express bridge handles only two things a static client cannot: the Strava client-secret
   OAuth exchange and a cached Overpass proxy (see ADR 0002).
2. **Plain Three.js scene class, not React Three Fiber.** The scene is a deterministic imperative
   frame function; keeping it outside React makes export stepping and disposal explicit. Geometry,
   camera formulas, and runner scaling follow the observed behavior.
3. **Raster tile stitching into one canvas, then a `CanvasTexture`.** This is what the original
   does. It keeps camera/route math independent of a map SDK and makes offline fallback trivial.
4. **Direct CORS tile URLs, no `/api/map-tile` proxy.** Esri, OSM, CARTO, and CyclOSM were verified
   to return `Access-Control-Allow-Origin: *`. A proxy can be added if a provider changes policy.
5. **mp4-muxer 5.2.2 for MP4.** It is the muxer observed in the original and its API is verified.
   The package is deprecated in favor of Mediabunny; this is recorded as a maintenance risk.
   WebCodecs is the primary encoder; MediaRecorder WebM is the fallback.
6. **Deterministic 30 fps timeline.** Intro (3.5 s or 25%), run, finisher (4 s or 25%). Export
   advances by frame index, never wall clock; preview uses the same function.
7. **Procedural runner and synthesized music.** No original model or audio asset is copied.
   Character looks are parameterized; the default beat is generated with Web Audio.
8. **A minimal local backend only.** Strava OAuth and Overpass buildings are implemented through
   the local bridge. Reverse geocoding, OSM roads/areas, waitlist, and share/analytics remain gaps.

## Consequences

- Chrome/Edge 119+ is required for MP4 (WebCodecs + `Promise.withResolvers`); other browsers use
  the WebM fallback.
- Tiles require network access; the app remains usable with a generated offline map.
- OSM footprints are extruded as one merged building mesh; road/area layers and reverse-geocoded
  street names are not ported. The 9:16 composition, telemetry, and route/runner/camera behavior
  are preserved.
- Strava tokens live only in server memory; restarting the server requires reconnecting.
- Replacing `mp4-muxer` with Mediabunny later is localized to `engine/exporter.ts`.
- Adding a second exporter or map style requires no changes to domain or UI code.
