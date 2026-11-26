# Verification log

Date: 2026-11-26. Host: Windows 10.0.26200 x64, Node.js 24.17.0, npm 11.13.0, ffmpeg/ffprobe
installed. Browser: omp-managed headless Chromium with WebGL2; app served by Vite on
`http://127.0.0.1:5187/`.

## Unit and type checks

```text
$ npx vitest run
Test Files  1 passed (1)
     Tests  13 passed (13)

$ npx tsc --noEmit
(no output, exit 0)

$ npm run build
dist/index.html                     0.76 kB │ gzip:   0.46 kB
dist/assets/index-*.css            11.97 kB │ gzip:   3.37 kB
dist/assets/index-*.js          1,252.98 kB │ gzip: 327.75 kB
✓ built in ~218 ms
```

The tests cover:

- Synthetic GPX and TCX 5 km runs with HR/cadence.
- A real 5.38 km Garmin FIT file (`tests/fixtures/sample-run.fit`).
- ZIP extraction of a GPX activity, gzip extraction, and deep-ZIP rejection.
- Multi-lap TCX totals summed across laps (not collapsed to lap 1).
- Invalid GPS rejection.
- Missing-timestamp inference, timeline terminal point, and altitude profile.
- Interpolation, Web Mercator projection, route smoothing/sampling.
- Duel result by duration and by pace.

## End-to-end browser verification

Performed through the UI (file chooser, export button, result link) in headless Chromium.

### 15 s / 720×1280 MP4

```text
format: mov,mp4 duration 15.018667 s, size 7,698,020 B
video: h264, 720×1280, 30/1 fps, 450 frames, 15.000 s, ~3.97 Mbps, Baseline
audio: aac, 48 kHz, 2 ch, 128 kbps, 15.018667 s
```

Frame analysis at 5 s/8 s: 193–218 quantized colors, 74% of sampled pixels changed between the
two frames (camera/route motion), teal route/HUD pixels present, dark HUD bands present.

### 15 s / 1080×1920 MP4

```text
format: duration 15.018667 s, size 9,953,137 B, ~5.30 Mbps
video: h264, 1080×1920, 450 frames, 15.000 s, ~5.18 Mbps, Baseline
audio: aac, 48 kHz, 2 ch, 128 kbps
```

### 30 s duel / 720×1280 MP4

Exported after loading the ghost rival. UI result: `RIVAL MENANG UNGGUL 00:30`.

```text
format: duration 30.016 s, size 15,668,025 B
video: h264, 720×1280, 900 frames, 30.000 s, ~4.05 Mbps
audio: aac, 48 kHz, 2 ch, 128 kbps
```

Rival presence: orange pixel share rose from 0% in the single-run export to 0.05–0.09% in the duel
run frames; the amber duel-pill border occupied 0.67–1.63% of the top band. The finisher overlay
dominates frames after 26 s (dark share 29%+).

### MediaRecorder fallback

WebCodecs was disabled in the page (`window.VideoEncoder = undefined`), then a 12 s export run:

```text
format: WebM, size 5,508,873 B
video: vp9, 720×1280
audio: opus, 48 kHz, 2 ch
```

The UI reported `mediarecorder-webm` and offered the download. WebM duration metadata is absent
until the file is seeked; this is typical for Chromium MediaRecorder output.

### UI and degradation paths

- Header “Upload rute” opened the file chooser **while the Export tab was active** and parsed a
  real FIT file: `sample-run.fit 5.38 km • 28:00 • 5'12"/km`, 1,681 samples.
- Invalid GPX produced: `Koordinat GPS valid di dalam file aktivitas kurang dari 2 titik.`
- Tile hosts were aborted with CDP routes; status became `Peta offline`, two canvases remained,
  and the app stayed usable. Restoring routes returned `Satelit`.
- Paused preview: play 8.2 s → pause; camera preset Follow → Front changed the center WebGL hash
  (`1427407116` → `1037547699`), confirming live camera switching.
- Frame PNG: downloaded `jejaklari-frame-8s.png`, 720×1280, 403,552 B; HUD text and colored tiles
  present in the pixel analysis.
- Uploaded music: loaded a 2 s 440 Hz WAV via the real file chooser, exported 15 s. FFT of the MP4
  audio peaked at 440.0 Hz, confirming the uploaded track (not the synth) was encoded.

## Security pass

Manual review (the configured automated security reviewer failed at the model gateway twice):

- ZIP entries are filtered before decompression: supported extensions only, max depth 2, max 120
  entries, max 32 MB per entry, max 64 MB total, 40 MB input cap.
- Gzip uses an incremental `Gunzip` with a 32 MB output cap instead of an unbounded
  `gunzipSync`.
- No `innerHTML`, `dangerouslySetInnerHTML`, `eval`, or string-to-HTML sink. Activity and runner
  names render through React text nodes or canvas `fillText`.
- Download filenames are sanitized; blob URLs are revoked on replacement/unmount; MediaRecorder
  tracks and preview/export audio contexts are closed; preview audio reuses one context.
- Third-party tiles are loaded as CORS images (no script execution); tile providers see the tile
  coordinates, which is documented in the README.
- No secrets, telemetry, or activity upload endpoint exists.

## Not verified by machine

- Audible quality of the synthesized music (codec/track presence and duration were verified).
- Human visual review of styling; composition was checked through pixels, dimensions, and DOM state.
- Safari/Firefox fallback behavior beyond the MediaRecorder code path.
- Very long activities (60 s at 1080p) — frame math is the same, but the longest tested export was
  30 s at 720p and 15 s at 1080p.
