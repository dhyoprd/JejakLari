# Context — JejakLari Local Studio

A local reconstruction of the JejakLari Studio rendering engine: activity file or Strava run →
3D 9:16 running video. The studio and renderer run in the browser; a small local Express server
owns the OAuth secret exchange and the Overpass proxy. No hosted accounts, telemetry, or upload
endpoint.

## Ubiquitous language

- **Activity** — normalized run: header metrics + `timeline` of `ActivityPoint`s.
- **RawActivity** — format-specific output before normalization (lat/lng/time/ele/hr/cad).
- **Diorama** — local metric frame around the route: center, bbox, X/Z spans.
- **Route** — projected and smoothed points in diorama meters with elapsed time and distance.
- **Timeline** — deterministic video clock: intro, run, finish, and activity time per frame.
- **FrameComposer** — owns one scene + HUD + WebGL renderer; draws one time position.
- **Runner** — procedural chibi model; visual config is `RunnerLook`.
- **Duel** — second activity sampled at the same elapsed time, plus result by time or pace.
- **OsmBuilding** — footprint + height/color from Overpass, projected into the diorama.
- **Strava session** — server-side tokens keyed by an httpOnly session cookie; never in client JS.
- **Exporter** — frame loop + encoded video/audio sink. Two implementations: WebCodecs MP4 and
  MediaRecorder WebM.

## Invariants

1. **Secrets stay server-side.** Strava client secret and refresh tokens live in server memory.
   The browser holds only an httpOnly session cookie.
2. **Activity data stays local.** Files are parsed in the browser. Strava streams cross the local
   server only when the user imports an activity; Overpass receives a padded route bbox, not files.
3. **Deterministic MP4 export.** Every MP4 frame is a pure function of frame index, duration, and
   activity; export advances by exactly `1/30 s`, never wall clock. The MediaRecorder WebM fallback
   is inherently real-time.
4. **9:16 first.** Preview and export share the same composer/camera math; resolution only scales it.
5. **One visual truth.** HUD and runner state come from the same `FrameSnapshot` used by the scene.
6. **Graceful degradation.** Tile failure → offline map (partial coverage labeled); OSM failure →
   no buildings, route still renders; Strava failure → reconnect/retry message; missing codecs →
   WebM; missing audio → video-only.
7. **User data is authoritative.** File/Strava metrics are used where present; inferred values are
   marked (`missingTimestamps`) and deterministic.

## Module ownership

| Module | Owns | Does not own |
| --- | --- | --- |
| `domain/parsers/*` | bytes or Strava streams → `RawActivity` | normalization, rendering |
| `domain/normalize.ts` | `RawActivity` → `Activity` | file formats, UI |
| `domain/race.ts` | comparing two activities | placement or visuals |
| `engine/geo.ts` | projection, route smoothing, sampling | tiles, Three.js |
| `engine/tiles.ts` | map style registry + stitched canvas | scene graph |
| `engine/osm.ts` | merged building geometry | fetching/caching |
| `engine/scene.ts` | 3D graph + camera choreography | HUD, encoding |
| `engine/hud.ts` | 2D overlay for a `FrameSnapshot` | 3D state |
| `engine/exporter.ts` | frame loop + encoders + mux | UI state |
| `api/strava.ts`, `api/osm.ts` | same-origin client calls | secrets, provider logic |
| `server/strava-*` | OAuth token exchange, refresh, sessions, activities/streams | rendering |
| `server/overpass-*` | bbox validation, Overpass query, cache, queue | Three.js |
| `ui/*` | user intent, panels, orchestration | engine internals |

## Extension seams

- New activity format: implement a parser returning `RawActivity`, add it to the dispatcher.
- New map style: add a `MapStyle` entry (base/overlay/filter/attribution).
- New camera: add a `CameraPreset` and a branch in `CameraDirector.poseFor`.
- New exporter: consume `FrameComposer` and implement the same result shape.
- New OAuth provider: add a service/router pair; inject a mock `fetch` in tests.
- New OSM layer: extend `OsmBuilding` or add a parallel service + scene group.

## Known gaps

Reverse-geocoded street/location names, OSM road/area layers, the multi-camera editor, and cloud
waitlist/share/analytics. Strava tokens are intentionally not persisted; a server restart asks the
user to reconnect. See `docs/jejaklari-engine.md` for the engine notes and
`docs/adr/0002-local-api-bridge.md` for the server decision.
