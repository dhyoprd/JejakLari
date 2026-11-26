# Verification log

Date: 2026-11-26. Host: Windows 10.0.26200 x64, Node.js 24.17.0, npm 11.13.0, ffmpeg/ffprobe
installed. Browser: omp-managed headless Chromium with WebGL2. Dev and production servers both run
on `127.0.0.1`.

## Unit, type, and build checks

```text
$ npx vitest run
Test Files  5 passed (5)
     Tests  30 passed (30)

$ npx tsc --noEmit
(no output, exit 0)

$ npm run build
dist/index.html                     0.76 kB │ gzip:   0.46 kB
dist/assets/index-*.css            14.16 kB │ gzip:   3.81 kB
dist/assets/index-*.js          1,274.48 kB │ gzip: 334.93 kB
✓ built in ~256 ms
```

Coverage:

- Synthetic GPX/TCX, real Garmin FIT, ZIP/gzip, deep-ZIP rejection, invalid GPS.
- Multi-lap TCX totals, missing timestamps, altitude profile, terminal point.
- Interpolation, Mercator projection, route smoothing/sampling, duel by time and pace.
- Strava stream object and array forms, HR/cadence/distance/time mapping, no-GPS rejection.
- Strava bridge against a mock Strava: auth URL/scope/state, token exchange, httpOnly session,
  run filtering, activity streams, single-flight refresh under concurrent requests, disconnect,
  wrong-state rejection, cross-origin POST rejection.
- Overpass parser (height/levels/color/no-building), cache hit, truncation, oversized bbox 400,
  HTTP endpoint caching/refresh (including explicit `refresh: true`) and validation, coalesced
  queries surviving a caller abort, and post-abort dedupe while the shared query completes.
- OSM merged building geometry: wall/roof triangles, height bounds, `DoubleSide`/vertex colors,
  degenerate input.
- Tight camera presets: Front/Side/Chase keep a runner moving at 220 video m/s within 24 m of the
  look target across 120 simulated frames; heading smoothing is separate from position tracking.

## End-to-end browser verification

Performed through the UI in headless Chromium, with real exports downloaded and probed.

### MP4

| Export | ffprobe result |
| --- | --- |
| 15 s 720p | H.264 Baseline, 720×1280, 450 frames @30 fps, 15.02 s; AAC 48 kHz stereo 128 kbps |
| 15 s 1080p | H.264 1080×1920, 450 frames, 15.02 s; AAC |
| 30 s duel 720p | H.264, 900 frames, 30.02 s; AAC; rival visible in frame analysis |
| 15 s with 1,200 OSM buildings | H.264 720×1280, 450 frames, AAC; export wall time ≈2.0 s |

Frame analysis (raw RGB) confirms varied quantized colors, camera/route motion between frames,
teal route/HUD pixels, the finisher overlay, and rival pixels in duel mode.

### WebM fallback

WebCodecs was disabled in the page, then a 12 s export run: VP9 720×1280 + Opus 48 kHz stereo,
5.5 MB, UI mode `mediarecorder-webm`. Duration metadata is absent until the file is seeked, which is
typical for Chromium MediaRecorder output.

### Music

A 2 s 440 Hz WAV uploaded through the real file chooser, exported 15 s. FFT of the MP4 audio peaked
at **440.0 Hz**, confirming the uploaded track (not the synth) was encoded.

### OSM buildings (live Overpass)

With a 5 km GBK route and the default `maps.mail.ru` endpoint:

- Server returned 1,200 normalized buildings (cap reached; `truncated` true).
- Panel reported `1200 bangunan 3D aktif`; the scene added the merged mesh.
- Toggling the building checkbox changed the WebGL frame hash (`1790335436` → `2850030125`),
  proving the mesh contributes to the rendered frame.
- Export with buildings enabled completed in ≈2.0 s; no console errors.
- Endpoint behavior was checked against alternates; `overpass.osm.ch`, `overpass.maprva.org`, and
  `overpass.osm.lat` are regional extracts that return no Jakarta data; `maps.mail.ru` returned 16
  elements for a small test bbox in 14 s. `overpass-api.de` was intermittently at capacity.

### Strava bridge and UI

- Mock Strava server + real Express app: `/status`, `/auth`, `/callback` (state cookie), run
  filtering, streams, refresh-token path, `/disconnect`, and wrong-state rejection all pass.
- UI interception test: status/list/streams responses supplied through the browser; the Strava panel
  rendered the athlete and one run, and clicking it replaced the sample with
  `Mock Morning Run • 4.20 km • 5'33"/km • Strava` (5 timeline samples, no console errors).
- Real Strava OAuth was **not** run because this workspace has no Strava client credentials. The
  documented setup uses the same endpoints and scopes exercised by the mock.

### Server/UI degradation

- Tiles aborted: `Peta offline`, two canvases remain, app usable; restoring routes returns `Satelit`.
- Header upload while the Export tab is active: file chooser + FIT parse works.
- Invalid GPX: `Koordinat GPS valid di dalam file aktivitas kurang dari 2 titik.`
- Paused preview: Follow → Front changed the center WebGL hash.
- Frame PNG: 720×1280, HUD text and colored tiles present.
- Composer swaps (look/style rebuilds) render the first frame before replacing the visible canvas
  and dispose the old renderer afterwards. A 20 ms sampling loop across a jersey swatch rebuild
  recorded 47 frames, 0 dark frames (minimum center sum 4,192).
- The intro is a stable card, not a full-frame dim: the regular HUD is hidden during intro, the card
  starts visible and only fades out. OCR of the resulting 488×869 stage frame found one title
  (`MORNING 5K TEMPO RUN`), not the previous HUD+intro duplicate; 25 samples around playback had
  0 dark frames.
- Preview now composites WebGL + HUD into one 2D canvas instead of stacking two canvases. Thirty
  40 ms samples had 0 dark frames; OCR of a mid-run stage capture found title, pace, distance, heart
  rate, cadence, and time. The WebM fallback captures the same composed canvas: a 5 s frame OCRs
  with the full HUD.
- Map depth stability: camera near/far are 1 and a diorama-derived far (12–30 km); the decorative
  base slab sits 25 m below the map (its old 10 cm gap was occluded by the ground after a bad
  polygon offset), route/markers/buildings use negative offsets, route core writes depth, markers
  sit above the ribbon, and the map texture uses 16× anisotropy + mipmaps. The central map region
  then contains 329 quantized colors (terrain) instead of the slab's single flat color; route/HUD
  remain visible and 25 samples contain 0 dark frames.
- Production server on port 5189: `dist/` served, `/api/strava/status` 200 JSON, client route
  returned `text/html`, no console errors.

## Security pass

Manual review (the configured automated security reviewer failed at the model gateway twice):

- OAuth: random state cookie checked against the callback, httpOnly/SameSite session cookie,
  client secret only in server env, refresh/revoke server-side, no token in JSON sent to the browser.
- State-changing POSTs with an `Origin` header must match the request host; local cookies use
  `Secure` only when `COOKIE_SECURE=1` (set it behind TLS). The server binds `127.0.0.1` by default.
- Strava routes require a session for activities/streams; IDs are validated; errors are bounded.
- Overpass: bbox validated (span/area), one query at a time, in-flight dedupe, one-hour cache,
  identifying User-Agent, building cap; a caller abort stops that caller's wait while the shared
  query completes and caches for the next request.
- ZIP/GZ: supported-entry filter before decompression, max depth 2, 120 entries, 32 MB/entry,
  64 MB total, 32 MB gzip output; 40 MB input cap.
- No `innerHTML`, `dangerouslySetInnerHTML`, `eval`; names render as React text or canvas text.
- Download filenames sanitized; blob URLs and MediaRecorder tracks/audio contexts cleaned up.

## Not verified by machine

- A real Strava account/OAuth consent/revocation (no credentials in this workspace).
- Audible quality of music (codec/track presence and tone frequency were verified).
- Human visual review of styling; composition was checked through pixels, dimensions, and DOM state.
- Safari/Firefox fallback beyond the MediaRecorder code path.
- The 60 s 1080p export and 60 s Overpass route; frame math is identical, but longest tested renders
  were 30 s at 720p and 15 s at 1080p.
