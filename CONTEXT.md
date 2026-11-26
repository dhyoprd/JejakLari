# Context — JejakLari Local Studio

A local reconstruction of the JejakLari Studio rendering engine: activity file → 3D 9:16 running
video. Single browser context; no server, no accounts, no telemetry.

## Ubiquitous language

- **Activity** — normalized run: header metrics + `timeline` of `ActivityPoint`s.
- **RawActivity** — format-specific output before normalization (lat/lng/time/ele/hr/cad).
- **Diorama** — local metric frame around the route: center, bbox, X/Z spans.
- **Route** — projected and smoothed points in diorama meters with elapsed time and distance.
- **Timeline** — deterministic video clock: intro, run, finish, and the activity time at each frame.
- **FrameComposer** — owns one scene + HUD + WebGL renderer; draws one time position.
- **Runner** — procedural chibi model; visual config is `RunnerLook`.
- **Duel** — second activity sampled at the same elapsed time, plus result by time or pace.
- **Exporter** — frame loop + encoded video/audio sink. Two implementations: WebCodecs MP4 and
  MediaRecorder WebM.

## Invariants

1. **Local-only.** No activity bytes leave the browser. Network is used only for map tiles.
2. **Deterministic MP4 export.** Every MP4 frame is a pure function of frame index, duration, and
   activity; export advances by exactly `1/30 s` and never by wall clock. The MediaRecorder WebM
   fallback is inherently real-time.
3. **9:16 first.** Preview and export share the same composer/camera math; resolution only scales it.
4. **One visual truth.** HUD and runner state come from the same `FrameSnapshot` used by the scene.
5. **Graceful degradation.** Total tile failure produces an offline map, partial coverage is marked
   "Peta sebagian", missing codecs fall back to MediaRecorder, and missing audio encodes video-only.
6. **User data is authoritative.** File metrics are used where present; inferred values are marked
   (`missingTimestamps`) and deterministic.

## Module ownership

| Module | Owns | Does not own |
| --- | --- | --- |
| `domain/parsers/*` | bytes → `RawActivity` | normalization, rendering |
| `domain/normalize.ts` | `RawActivity` → `Activity` | file formats, UI |
| `domain/race.ts` | comparing two activities | placement or visuals |
| `engine/geo.ts` | projection, route smoothing, sampling | tiles, Three.js |
| `engine/tiles.ts` | map style registry + stitched canvas | scene graph |
| `engine/scene.ts` | 3D graph + camera choreography | HUD, encoding |
| `engine/hud.ts` | 2D overlay for a `FrameSnapshot` | 3D state |
| `engine/exporter.ts` | frame loop + encoders + mux | UI state |
| `ui/*` | user intent + file handling | engine internals |

## Extension seams

- New activity format: implement a parser that returns `RawActivity`, add it to the dispatcher.
- New map style: add a `MapStyle` entry (base/overlay/filter/attribution).
- New camera: add a `CameraPreset` and a branch in `CameraDirector.poseFor`.
- New exporter: consume `FrameComposer` and implement the same result shape.

## Known gaps

Strava integration, Overpass 3D buildings/roads, reverse geocoding, multi-camera edits, cloud
waitlist/share. See `docs/jejaklari-engine.md` for the observed original behavior and
`docs/adr/0001-local-port-architecture.md` for deliberate differences.
