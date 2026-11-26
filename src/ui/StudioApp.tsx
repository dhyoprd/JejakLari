import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { ActivityParseError, type Activity } from '../domain/activity';
import { compareRace } from '../domain/race';
import { formatClock } from '../domain/format';
import { normalizeActivity } from '../domain/normalize';
import { parseActivityBytes, parseActivityFile } from '../domain/parsers';
import { parseStravaStreams } from '../domain/parsers/strava';
import {
  SilentAudioTrack,
  SynthAudioTrack,
  UploadedAudioTrack,
  decodeAudioFile,
  type AudioTrackProvider,
} from '../engine/audio';
import { FrameComposer } from '../engine/composer';
import { exportVideo, type ExportProgress, type VideoQuality } from '../engine/exporter';
import { buildDiorama, type Diorama } from '../engine/geo';
import type { FrameSnapshot } from '../engine/scene';
import {
  ACCESSORIES,
  CAMERA_PRESETS,
  DEFAULT_PRIMARY_LOOK,
  DEFAULT_RIVAL_LOOK,
  HAIR_STYLES,
  JERSEY_COLORS,
  SHOE_COLORS,
  SKIN_COLORS,
  SKY_PALETTES,
  type CameraPreset,
  type RunnerLook,
  type SkyMode,
} from '../engine/theme';
import {
  MAP_STYLES,
  createFallbackMap,
  stitchMap,
  type MapStyleId,
  type StitchedMap,
} from '../engine/tiles';
import { frameStateAt } from '../engine/timeline';
import { fetchOsmBuildings } from '../api/osm';
import {
  disconnectStrava,
  fetchStravaActivities,
  fetchStravaStatus,
  fetchStravaStreams,
} from '../api/strava';
import type { OsmBuilding } from '../shared/osm';
import type { StravaActivitySummary, StravaStatus } from '../shared/strava';
import { ChipGroup, Field, Section, Swatches } from './controls';
import { StravaSection } from './StravaSection';

type Target = 'primary' | 'rival';
type Tab = 'runner' | 'race' | 'map' | 'export';
type MapStatus = 'idle' | 'loading' | 'ready' | 'fallback';
type MusicMode = 'default' | 'upload' | 'none';
type OsmStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'stale' | 'error';

interface ExportResultView {
  url: string;
  fileName: string;
  sizeMb: string;
  width: number;
  height: number;
  mode: string;
  hasAudio: boolean;
}

const STAGE_WIDTH = 720;
const STAGE_HEIGHT = 1280;

function errorMessage(error: unknown): string {
  if (error instanceof ActivityParseError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function safeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'jejaklari';
}

export function StudioApp() {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [rival, setRival] = useState<Activity | null>(null);
  const [diorama, setDiorama] = useState<Diorama | null>(null);
  const [map, setMap] = useState<StitchedMap | null>(null);
  const [mapStatus, setMapStatus] = useState<MapStatus>('idle');
  const [mapStyle, setMapStyle] = useState<MapStyleId>('satellite');
  const [sky, setSky] = useState<SkyMode>('morning');
  const [preset, setPreset] = useState<CameraPreset>('follow_runner');
  const [duration, setDuration] = useState(30);
  const [quality, setQuality] = useState<VideoQuality>('hd');
  const [primaryLook, setPrimaryLook] = useState<RunnerLook>(DEFAULT_PRIMARY_LOOK);
  const [rivalLook, setRivalLook] = useState<RunnerLook>(DEFAULT_RIVAL_LOOK);
  const [tab, setTab] = useState<Tab>('runner');
  const [status, setStatus] = useState<string>('Menyiapkan studio...');
  const [error, setError] = useState<string | null>(null);

  const [composer, setComposer] = useState<FrameComposer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [live, setLive] = useState<FrameSnapshot | null>(null);

  const [osmBuildings, setOsmBuildings] = useState<OsmBuilding[] | null>(null);
  const [osmStatus, setOsmStatus] = useState<OsmStatus>('idle');
  const [osmError, setOsmError] = useState<string | null>(null);
  const [showBuildings, setShowBuildings] = useState(true);
  const [osmReload, setOsmReload] = useState(0);

  const [stravaStatus, setStravaStatus] = useState<StravaStatus | null>(null);
  const [stravaActivities, setStravaActivities] = useState<StravaActivitySummary[]>([]);
  const [stravaLoading, setStravaLoading] = useState(false);
  const [stravaError, setStravaError] = useState<string | null>(null);
  const [stravaImportingId, setStravaImportingId] = useState<string | null>(null);

  const [musicMode, setMusicMode] = useState<MusicMode>('default');
  const [uploadedTrack, setUploadedTrack] = useState<UploadedAudioTrack | null>(null);
  const [musicName, setMusicName] = useState('');
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResultView | null>(null);
  const [transportNonce, setTransportNonce] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const presetRef = useRef<CameraPreset>(preset);
  const abortRef = useRef<AbortController | null>(null);
  const primaryInputRef = useRef<HTMLInputElement>(null);
  const globalPrimaryInputRef = useRef<HTMLInputElement>(null);
  const rivalInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const bootstrapped = useRef(false);
  const loadGeneration = useRef(0);
  const activityRef = useRef<Activity | null>(null);
  const rivalRef = useRef<Activity | null>(null);
  const previewAudioContextRef = useRef<AudioContext | null>(null);
  const osmForceRef = useRef(false);
  const osmBuildingsRef = useRef<OsmBuilding[] | null>(null);
  const composerRef = useRef<FrameComposer | null>(null);

  const audioTrack = useMemo<AudioTrackProvider>(() => {
    if (musicMode === 'none') return new SilentAudioTrack();
    if (musicMode === 'upload') return uploadedTrack ?? new SilentAudioTrack();
    return new SynthAudioTrack();
  }, [musicMode, uploadedTrack]);

  const raceOutcome = useMemo(
    () =>
      activity && rival
        ? compareRace(activity, rival, primaryLook.name, rivalLook.name)
        : null,
    [activity, rival, primaryLook.name, rivalLook.name],
  );

  const primaryVisualKey = [
    primaryLook.gender,
    primaryLook.hair,
    primaryLook.accessory,
    primaryLook.jerseyColor,
    primaryLook.shortsColor,
    primaryLook.shoeColor,
    primaryLook.skinColor,
  ].join('|');
  const rivalVisualKey = [
    rivalLook.gender,
    rivalLook.hair,
    rivalLook.accessory,
    rivalLook.jerseyColor,
    rivalLook.shortsColor,
    rivalLook.shoeColor,
    rivalLook.skinColor,
  ].join('|');

  const applyActivity = useCallback((next: Activity, target: Target) => {
    const nextPrimary = target === 'primary' ? next : activityRef.current;
    const nextRival = target === 'rival' ? next : rivalRef.current;
    if (target === 'primary') {
      activityRef.current = next;
      setActivity(next);
      timeRef.current = 0;
      setVideoTime(0);
      setPlaying(false);
      playingRef.current = false;
      setResult((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return null;
      });
    } else {
      rivalRef.current = next;
      setRival(next);
    }
    const points = nextPrimary
      ? nextRival
        ? [...nextPrimary.timeline, ...nextRival.timeline]
        : nextPrimary.timeline
      : [];
    setDiorama(points.length > 0 ? buildDiorama(points) : null);
    setMap(null);
    setMapStatus('loading');
    osmBuildingsRef.current = null;
    setOsmBuildings(null);
    setOsmStatus('loading');
    setOsmError(null);
  }, []);

  const clearRival = useCallback(() => {
    loadGeneration.current += 1;
    rivalRef.current = null;
    setRival(null);
    const primary = activityRef.current;
    setDiorama(primary ? buildDiorama(primary.timeline) : null);
    setMap(null);
    setMapStatus('loading');
    osmBuildingsRef.current = null;
    setOsmBuildings(null);
    setOsmStatus('loading');
    setOsmError(null);
  }, []);

  const loadSample = useCallback(
    async (target: Target, fileName = 'sample-5k.gpx') => {
      const generation = ++loadGeneration.current;
      setError(null);
      setStatus(`Memuat ${fileName}...`);
      try {
        const response = await fetch(`/samples/${fileName}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const raw = await parseActivityBytes(bytes, fileName);
        const next = normalizeActivity(raw, { activityName: raw.name });
        if (generation !== loadGeneration.current) return;
        applyActivity(next, target);
        setStatus(`${next.activityName} • ${next.totalDistanceKm.toFixed(2)} km`);
      } catch (loadError) {
        if (generation !== loadGeneration.current) return;
        setError(errorMessage(loadError));
        setStatus('Gagal memuat contoh');
      }
    },
    [applyActivity],
  );

  const loadFile = useCallback(
    async (file: File, target: Target) => {
      const generation = ++loadGeneration.current;
      setError(null);
      setStatus(`Membaca ${file.name}...`);
      try {
        const raw = await parseActivityFile(file);
        const next = normalizeActivity(raw, { activityName: raw.name || file.name });
        if (generation !== loadGeneration.current) return;
        applyActivity(next, target);
        setStatus(`${next.activityName} • ${next.totalDistanceKm.toFixed(2)} km`);
      } catch (loadError) {
        if (generation !== loadGeneration.current) return;
        setError(errorMessage(loadError));
        setStatus('File gagal dibaca');
      }
    },
    [applyActivity],
  );

  const refreshStravaStatus = useCallback(async () => {
    try {
      const next = await fetchStravaStatus();
      setStravaStatus(next);
      setStravaError(null);
    } catch (statusError) {
      setStravaStatus({ configured: false, connected: false });
      setStravaError(errorMessage(statusError));
    }
  }, []);

  const loadStravaActivities = useCallback(async () => {
    setStravaLoading(true);
    setStravaError(null);
    try {
      const response = await fetchStravaActivities(1, 30);
      setStravaActivities(response.activities);
    } catch (activityError) {
      setStravaError(errorMessage(activityError));
    } finally {
      setStravaLoading(false);
    }
  }, []);

  const handleStravaImport = useCallback(
    async (summary: StravaActivitySummary) => {
      const generation = ++loadGeneration.current;
      setStravaImportingId(summary.id);
      setStravaError(null);
      setError(null);
      setStatus(`Mengambil ${summary.name} dari Strava...`);
      try {
        const payload = await fetchStravaStreams(summary.id);
        const raw = parseStravaStreams(payload);
        const next = normalizeActivity(raw, { activityName: raw.name });
        if (generation !== loadGeneration.current) return;
        applyActivity(next, 'primary');
        setStatus(
          `${next.activityName} • ${next.totalDistanceKm.toFixed(2)} km • ${next.avgPaceFormatted}/km • Strava`,
        );
      } catch (importError) {
        if (generation !== loadGeneration.current) return;
        setStravaError(errorMessage(importError));
        setStatus('Gagal mengambil aktivitas Strava');
      } finally {
        setStravaImportingId(null);
      }
    },
    [applyActivity],
  );

  const handleStravaDisconnect = useCallback(async () => {
    setStravaLoading(true);
    setStravaError(null);
    try {
      await disconnectStrava();
      setStravaActivities([]);
      await refreshStravaStatus();
    } catch (disconnectError) {
      setStravaError(errorMessage(disconnectError));
    } finally {
      setStravaLoading(false);
    }
  }, [refreshStravaStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stravaResult = params.get('strava');
    if (stravaResult === 'connected') {
      setStatus('Strava terhubung');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stravaResult === 'error') {
      const reason = params.get('reason') ?? 'oauth_failed';
      setStravaError(`Otorisasi Strava gagal (${reason}).`);
      window.history.replaceState({}, '', window.location.pathname);
    }
    void refreshStravaStatus();
  }, [refreshStravaStatus]);

  useEffect(() => {
    if (!stravaStatus?.connected) {
      setStravaActivities([]);
      return;
    }
    void loadStravaActivities();
  }, [stravaStatus?.connected, loadStravaActivities]);

  useEffect(() => {
    osmBuildingsRef.current = osmBuildings;
  }, [osmBuildings]);

  useEffect(() => {
    if (!diorama || !showBuildings) {
      osmBuildingsRef.current = null;
      setOsmBuildings(null);
      setOsmStatus('idle');
      setOsmError(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setOsmStatus('loading');
    setOsmError(null);
    const force = osmForceRef.current;
    osmForceRef.current = false;
    void (async () => {
      try {
        const result = await fetchOsmBuildings(diorama, controller.signal, force);
        if (cancelled) return;
        osmBuildingsRef.current = result.buildings;
        setOsmBuildings(result.buildings);
        setOsmStatus(result.stale ? 'stale' : result.buildings.length > 0 ? 'ready' : 'empty');
        setOsmError(null);
      } catch (osmFetchError) {
        if (cancelled) return;
        if (osmFetchError instanceof DOMException && osmFetchError.name === 'AbortError') return;
        const hasCached = Boolean(osmBuildingsRef.current?.length);
        if (!hasCached) setOsmBuildings(null);
        setOsmStatus(hasCached ? 'stale' : 'error');
        setOsmError(
          hasCached
            ? 'Gagal memperbarui OSM; memakai data bangunan terakhir.'
            : errorMessage(osmFetchError),
        );
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [diorama, showBuildings, osmReload]);

  useEffect(() => {
    composer?.setOsmBuildings(showBuildings ? osmBuildings : null);
  }, [composer, osmBuildings, showBuildings]);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void loadSample('primary');
  }, [loadSample]);


  useEffect(() => {
    if (!diorama) return;
    const controller = new AbortController();
    let cancelled = false;
    setMap(null);
    setMapStatus('loading');
    void (async () => {
      try {
        const stitched = await stitchMap(diorama, mapStyle, controller.signal);
        if (cancelled) return;
        if (stitched && !stitched.fallback) {
          setMap(stitched);
          setMapStatus('ready');
        } else {
          setMap(createFallbackMap(diorama, mapStyle));
          setMapStatus('fallback');
        }
      } catch {
        if (cancelled) return;
        setMap(createFallbackMap(diorama, mapStyle));
        setMapStatus('fallback');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [diorama, mapStyle]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    presetRef.current = preset;
    composer?.setPreset(preset);
  }, [composer, preset]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!activity || !diorama || !map || !stage) return;
    let next: FrameComposer;
    try {
      next = new FrameComposer({
        activity,
        rival,
        diorama,
        map,
        primaryLook,
        rivalLook,
        sky,
        preset: presetRef.current,
        mapStyle,
        osmBuildings: showBuildings ? osmBuildings : null,
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
      });
    } catch (composerError) {
      setError(`Gagal membuat renderer 3D: ${errorMessage(composerError)}`);
      return;
    }

    next.displayCanvas.className = 'stage-gl';
    // Render one complete frame before swapping DOM nodes. Disposing the old
    // renderer first would blank its canvas and flash black during style/look
    // changes; the old composer is disposed only after the new frame is live.
    try {
      next.draw(
        frameStateAt(timeRef.current, duration, activity.totalDurationSec),
        1 / 30,
        playingRef.current,
      );
      next.present();
    } catch (renderError) {
      next.dispose();
      setError(`Gagal merender frame awal: ${errorMessage(renderError)}`);
      return;
    }
    const previous = composerRef.current;
    composerRef.current = next;
    stage.replaceChildren(next.displayCanvas);
    previous?.dispose();
    setComposer(next);
    setStatus((current) =>
      current.startsWith('Menyiapkan') || current.startsWith('Memuat') ? 'Studio siap' : current,
    );

    return () => {
      setComposer((current) => (current === next ? null : current));
    };
  }, [activity, rival, diorama, map, primaryVisualKey, rivalVisualKey, sky, mapStyle]);

  useEffect(() => {
    return () => {
      composerRef.current?.dispose();
      composerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!composer) return;
    composer.updateRunnerLooks(primaryLook, rivalLook, raceOutcome);
  }, [composer, primaryLook, rivalLook, raceOutcome]);

  useEffect(() => {
    if (!composer || !activity) return;
    let frameHandle = 0;
    let last = performance.now();
    let lastUi = 0;

    const tick = (now: number) => {
      const delta = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;
      if (playingRef.current) {
        timeRef.current = Math.min(duration, timeRef.current + delta);
        if (timeRef.current >= duration) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
      const state = frameStateAt(timeRef.current, duration, activity.totalDurationSec);
      const snapshot = composer.draw(state, delta, playingRef.current);
      composer.present();
      if (now - lastUi > 120) {
        lastUi = now;
        setVideoTime(timeRef.current);
        setLive(snapshot);
      }
      frameHandle = requestAnimationFrame(tick);
    };
    frameHandle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameHandle);
  }, [composer, activity, duration]);

  useEffect(() => {
    if (timeRef.current > duration) {
      timeRef.current = duration;
      setVideoTime(duration);
    }
  }, [duration]);

  useEffect(() => {
    const url = result?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [result]);

  useEffect(() => {
    if (!playing || muted || volume <= 0.001 || audioTrack.silent) return;
    let cancelled = false;
    let source: AudioBufferSourceNode | null = null;
    const context = previewAudioContextRef.current ?? new AudioContext();
    previewAudioContextRef.current = context;
    void (async () => {
      try {
        const buffer = await audioTrack.getBuffer(duration);
        if (cancelled || !buffer) return;
        const gain = context.createGain();
        gain.gain.value = Math.min(1, volume) * 0.8;
        source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gain).connect(context.destination);
        await context.resume();
        if (!cancelled) source.start(0, timeRef.current % Math.max(0.2, buffer.duration));
      } catch {
        // Preview audio is best-effort; export still has a verified audio track.
      }
    })();
    return () => {
      cancelled = true;
      try {
        source?.stop();
      } catch {
        // Already stopped.
      }
    };
  }, [playing, muted, volume, audioTrack, duration, transportNonce]);

  useEffect(() => {
    return () => {
      previewAudioContextRef.current?.close().catch(() => {});
      previewAudioContextRef.current = null;
    };
  }, []);

  const togglePlay = () => {
    if (timeRef.current >= duration - 0.05) timeRef.current = 0;
    if (!playing && !muted && volume > 0.001 && !audioTrack.silent) {
      previewAudioContextRef.current ??= new AudioContext();
      void previewAudioContextRef.current.resume().catch(() => {});
    }
    setPlaying((current) => !current);
    setTransportNonce((value) => value + 1);
  };

  const seek = (value: number) => {
    timeRef.current = Math.max(0, Math.min(duration, value));
    setVideoTime(timeRef.current);
    setTransportNonce((nonce) => nonce + 1);
  };

  const handleExport = async () => {
    if (!activity || !diorama || !map || exporting) return;
    playingRef.current = false;
    setPlaying(false);
    setExporting(true);
    setExportError(null);
    setProgress(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const output = await exportVideo({
        activity,
        rival,
        diorama,
        map,
        primaryLook,
        rivalLook,
        sky,
        preset,
        mapStyle,
        osmBuildings: showBuildings ? osmBuildings : null,
        durationSec: duration,
        quality,
        audio: audioTrack,
        volume,
        muted,
        onProgress: setProgress,
        signal: controller.signal,
      });
      const fileName = `jejaklari-${safeFileName(activity.activityName)}-${quality}.${output.ext}`;
      const url = URL.createObjectURL(output.blob);
      setResult((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return {
          url,
          fileName,
          sizeMb: (output.blob.size / (1024 * 1024)).toFixed(1),
          width: output.width,
          height: output.height,
          mode: output.mode,
          hasAudio: output.hasAudio,
        };
      });
      downloadBlob(output.blob, fileName);
    } catch (exportFailure) {
      if (exportFailure instanceof DOMException && exportFailure.name === 'AbortError') {
        setExportError('Ekspor dibatalkan.');
      } else {
        setExportError(errorMessage(exportFailure));
      }
    } finally {
      setExporting(false);
      abortRef.current = null;
    }
  };

  const downloadFrame = () => {
    if (!composer || !activity) return;
    const canvas = document.createElement('canvas');
    canvas.width = composer.width;
    canvas.height = composer.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const state = frameStateAt(timeRef.current, duration, activity.totalDurationSec);
    composer.draw(state, 1 / 30, playingRef.current);
    composer.compose(context);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `jejaklari-frame-${Math.round(timeRef.current)}s.png`);
    }, 'image/png');
  };

  const handlePrimaryInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file, 'primary');
    event.target.value = '';
  };

  const handleRivalInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file, 'rival');
    event.target.value = '';
  };

  const handleMusicInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      setError('File audio terlalu besar. Batas maksimal 30 MB.');
      return;
    }
    setError(null);
    setStatus(`Menyiapkan musik ${file.name}...`);
    try {
      const buffer = await decodeAudioFile(file);
      const track = new UploadedAudioTrack(buffer, file.name);
      setUploadedTrack(track);
      setMusicName(file.name);
      setMusicMode('upload');
      setStatus(`Musik siap: ${file.name}`);
    } catch (musicError) {
      setError(`Gagal membaca audio: ${errorMessage(musicError)}`);
    }
  };

  const dropHandler = (target: Target) => (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file, target);
  };

  const point = live?.point;
  const progressLabel = progress
    ? `${progress.message} (${progress.percent}%)`
    : exporting
      ? 'Menyiapkan ekspor...'
      : '';

  const osmStatusText =
    osmStatus === 'loading'
      ? 'Mengambil bangunan dari Overpass...'
      : osmStatus === 'ready'
        ? `${osmBuildings?.length ?? 0} bangunan 3D aktif`
        : osmStatus === 'stale'
          ? `${osmBuildings?.length ?? 0} bangunan (data OSM terakhir)`
          : osmStatus === 'empty'
            ? 'Tidak ada bangunan OSM di area ini'
            : osmStatus === 'error'
              ? 'Overpass tidak tersedia'
              : showBuildings
                ? 'Menunggu area rute...'
                : 'Bangunan 3D nonaktif';
  const osmDotClass =
    osmStatus === 'ready'
      ? 'ready'
      : osmStatus === 'loading'
        ? 'loading'
        : osmStatus === 'error'
          ? 'error'
          : '';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo-mark" aria-hidden>
            <svg viewBox="0 0 48 48" role="img">
              <defs>
                <linearGradient id="brand-gradient" x1="4" y1="4" x2="44" y2="44">
                  <stop offset="0" stopColor="#059669" />
                  <stop offset="1" stopColor="#0ea5e9" />
                </linearGradient>
              </defs>
              <rect x="2" y="2" width="44" height="44" rx="14" fill="url(#brand-gradient)" />
              <path
                d="M12 34 L21 22 L27 27 L36 13"
                fill="none"
                stroke="#fff"
                strokeWidth="3.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="brand-name">
              JejakLari <span>LOCAL</span>
            </div>
            <div className="brand-sub">Engine port • FIT/GPX/TCX → 9:16 3D video</div>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`status-chip status-${mapStatus} ${map?.degraded ? 'status-degraded' : ''}`}>
            {mapStatus === 'loading'
              ? 'Menyiapkan peta...'
              : mapStatus === 'fallback'
                ? 'Peta offline'
                : mapStatus === 'ready'
                  ? map?.degraded
                    ? 'Peta sebagian'
                    : MAP_STYLES[mapStyle].label
                  : 'Studio'}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => void loadSample('primary')}>
            Contoh 5K
          </button>
          <button type="button" className="btn btn-primary" data-testid="upload-route" onClick={() => globalPrimaryInputRef.current?.click()}>
            Upload rute
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="preview-column">
          <div className="stage-shell">
            <div className="stage" ref={stageRef} aria-label="Preview video 9:16" />
            {mapStatus === 'loading' ? (
              <div className="stage-overlay">
                <span className="spinner" />
                <p>Menyusun tile peta...</p>
                <small>Satelit, jalan, topo, atau malam</small>
              </div>
            ) : null}
            {!activity && mapStatus !== 'loading' ? (
              <div className="stage-overlay">
                <p>Pilih file aktivitas lari</p>
                <small>.FIT, .GPX, .TCX, .ZIP</small>
              </div>
            ) : null}
            <div className="stage-badge">PREVIEW 9:16</div>
          </div>

          <div className="transport">
            <button type="button" className="btn btn-play" onClick={togglePlay} aria-label="Putar atau jeda">
              {playing ? '❚❚' : '▶'}
            </button>
            <div className="scrub">
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={Math.min(videoTime, duration)}
                onChange={(event) => seek(Number(event.target.value))}
                aria-label="Posisi video"
              />
              <div className="scrub-meta">
                <span>{formatClock(videoTime)}</span>
                <span>{duration}s video</span>
              </div>
            </div>
          </div>

          <div className="quick-cameras">
            {CAMERA_PRESETS.map((camera) => (
              <button
                type="button"
                key={camera.id}
                className={`cam-chip ${preset === camera.id ? 'active' : ''}`}
                onClick={() => setPreset(camera.id)}
              >
                {camera.label}
              </button>
            ))}
          </div>

          <div className="live-strip">
            <div>
              <span>PACE</span>
              <strong className="text-amber">{point?.paceFormatted ?? '--'}</strong>
            </div>
            <div>
              <span>HEART</span>
              <strong className="text-rose">{point?.heartRate ?? '--'} bpm</strong>
            </div>
            <div>
              <span>CADENCE</span>
              <strong className="text-purple">{point?.cadence ?? '--'} spm</strong>
            </div>
            <div>
              <span>DISTANCE</span>
              <strong className="text-green">{(point?.distanceKm ?? 0).toFixed(2)} km</strong>
            </div>
          </div>

          {status ? <p className="status-line">{status}</p> : null}
          {error ? <p className="error-line">{error}</p> : null}
        </section>

        <aside className="panel">
          <div className="panel-tabs" role="tablist" aria-label="Studio controls">
            {(
              [
                ['runner', 'Pelari'],
                ['race', 'Tanding'],
                ['map', 'Peta'],
                ['export', 'Export'],
              ] as Array<[Tab, string]>
            ).map(([id, label]) => (
              <button
                type="button"
                role="tab"
                key={id}
                aria-selected={tab === id}
                className={`panel-tab ${tab === id ? 'active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="panel-body">
            {tab === 'runner' ? (
              <>
                <Section title="File aktivitas" hint="GPS + detak jantung">
                  <label
                    className="upload-tile"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={dropHandler('primary')}
                  >
                    <input
                      ref={primaryInputRef}
                      data-testid="primary-file"
                      type="file"
                      accept=".fit,.gpx,.tcx,.zip,.gz,application/zip"
                      onChange={handlePrimaryInput}
                    />
                    <strong>Pilih file .FIT / .GPX / .TCX / .ZIP</strong>
                    <span>Data diproses di browser — tidak diunggah ke server.</span>
                  </label>
                  <div className="row gap">
                    <button type="button" className="btn btn-ghost" onClick={() => void loadSample('primary')}>
                      Contoh 5K
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void loadSample('primary', 'sample-run.fit')}
                    >
                      Contoh FIT asli
                    </button>
                  </div>
                  {activity ? (
                    <div className="activity-card">
                      <strong>{activity.activityName}</strong>
                      <span>
                        {activity.totalDistanceKm.toFixed(2)} km • {formatClock(activity.totalDurationSec)} •{' '}
                        {activity.avgPaceFormatted}/km
                      </span>
                      <small>
                        {activity.missingTimestamps ? 'Durasi diestimasi (tanpa timestamp)' : 'Timestamp GPS terbaca'} •{' '}
                        {activity.timeline.length} sampel
                      </small>
                    </div>
                  ) : null}
                </Section>

                <StravaSection
                  status={stravaStatus}
                  activities={stravaActivities}
                  loading={stravaLoading}
                  error={stravaError}
                  importingId={stravaImportingId}
                  onConnect={() => window.location.assign('/api/strava/auth')}
                  onDisconnect={() => void handleStravaDisconnect()}
                  onRefresh={() => void loadStravaActivities()}
                  onImport={(summary) => void handleStravaImport(summary)}
                />

                <Section title="Identitas pelari">
                  <Field label="Nama pelari">
                    <input
                      type="text"
                      maxLength={18}
                      value={primaryLook.name}
                      onChange={(event) =>
                        setPrimaryLook((look) => ({ ...look, name: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Nomor BIB">
                    <input
                      type="text"
                      maxLength={8}
                      value={primaryLook.bib}
                      onChange={(event) => setPrimaryLook((look) => ({ ...look, bib: event.target.value }))}
                    />
                  </Field>
                </Section>

                <Section title="Karakter" hint="Model 3D prosedural">
                  <ChipGroup
                    value={primaryLook.gender}
                    options={[
                      { id: 'male', label: 'Laki-laki' },
                      { id: 'female', label: 'Perempuan' },
                    ]}
                    onChange={(gender) => setPrimaryLook((look) => ({ ...look, gender }))}
                    columns={2}
                  />
                  <div className="sub-label">Rambut</div>
                  <ChipGroup
                    value={primaryLook.hair}
                    options={HAIR_STYLES}
                    onChange={(hair) => setPrimaryLook((look) => ({ ...look, hair }))}
                    columns={3}
                  />
                  <div className="sub-label">Aksesori</div>
                  <ChipGroup
                    value={primaryLook.accessory}
                    options={ACCESSORIES}
                    onChange={(accessory) => setPrimaryLook((look) => ({ ...look, accessory }))}
                    columns={2}
                  />
                </Section>

                <Section title="Warna outfit">
                  <Swatches
                    label="Jersey"
                    value={primaryLook.jerseyColor}
                    colors={JERSEY_COLORS}
                    onChange={(jerseyColor) => setPrimaryLook((look) => ({ ...look, jerseyColor }))}
                  />
                  <Swatches
                    label="Sepatu"
                    value={primaryLook.shoeColor}
                    colors={SHOE_COLORS}
                    onChange={(shoeColor) => setPrimaryLook((look) => ({ ...look, shoeColor }))}
                  />
                  <Swatches
                    label="Kulit"
                    value={primaryLook.skinColor}
                    colors={SKIN_COLORS}
                    onChange={(skinColor) => setPrimaryLook((look) => ({ ...look, skinColor }))}
                  />
                </Section>
              </>
            ) : null}

            {tab === 'race' ? (
              <>
                <Section title="Mode tanding 1 vs 1" hint="Dua aktivitas, satu kamera">
                  <label
                    className="upload-tile"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={dropHandler('rival')}
                  >
                    <input
                      ref={rivalInputRef}
                      data-testid="rival-file"
                      type="file"
                      accept=".fit,.gpx,.tcx,.zip,.gz,application/zip"
                      onChange={handleRivalInput}
                    />
                    <strong>Upload file lawan (.FIT / .GPX / .ZIP)</strong>
                    <span>Dibandingkan pada waktu tempuh yang sama.</span>
                  </label>
                  <div className="row gap">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void loadSample('rival', 'rival-5k.gpx')}
                    >
                      Ghost rival 5K
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={clearRival}
                      disabled={!rival}
                    >
                      Hapus lawan
                    </button>
                  </div>
                  {rival ? (
                    <div className="activity-card">
                      <strong>{rival.activityName}</strong>
                      <span>
                        {rival.totalDistanceKm.toFixed(2)} km • {formatClock(rival.totalDurationSec)} •{' '}
                        {rival.avgPaceFormatted}/km
                      </span>
                    </div>
                  ) : null}
                  {raceOutcome ? (
                    <div className={`outcome outcome-${raceOutcome.winner}`}>
                      <span>{raceOutcome.winner === 'tie' ? 'HASIL SERI' : `${raceOutcome.winnerName} menang`}</span>
                      <strong>{raceOutcome.marginLabel}</strong>
                    </div>
                  ) : null}
                </Section>

                <Section title="Karakter lawan">
                  <Field label="Nama lawan">
                    <input
                      type="text"
                      maxLength={18}
                      value={rivalLook.name}
                      onChange={(event) => setRivalLook((look) => ({ ...look, name: event.target.value }))}
                    />
                  </Field>
                  <Field label="Nomor BIB lawan">
                    <input
                      type="text"
                      maxLength={8}
                      value={rivalLook.bib}
                      onChange={(event) => setRivalLook((look) => ({ ...look, bib: event.target.value }))}
                    />
                  </Field>
                  <ChipGroup
                    value={rivalLook.gender}
                    options={[
                      { id: 'male', label: 'Laki-laki' },
                      { id: 'female', label: 'Perempuan' },
                    ]}
                    onChange={(gender) => setRivalLook((look) => ({ ...look, gender }))}
                    columns={2}
                  />
                  <div className="sub-label">Rambut</div>
                  <ChipGroup
                    value={rivalLook.hair}
                    options={HAIR_STYLES}
                    onChange={(hair) => setRivalLook((look) => ({ ...look, hair }))}
                    columns={3}
                  />
                  <Swatches
                    label="Jersey lawan"
                    value={rivalLook.jerseyColor}
                    colors={JERSEY_COLORS}
                    onChange={(jerseyColor) => setRivalLook((look) => ({ ...look, jerseyColor }))}
                  />
                </Section>
              </>
            ) : null}

            {tab === 'map' ? (
              <>
                <Section title="Bangunan 3D" hint="Overpass / OSM">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={showBuildings}
                      onChange={(event) => setShowBuildings(event.target.checked)}
                    />
                    Tampilkan bangunan 3D
                  </label>
                  <div className="osm-status">
                    <span className={`status-dot ${osmDotClass}`} />
                    <span>{osmStatusText}</span>
                  </div>
                  {osmError ? <p className="error-line">{osmError}</p> : null}
                  <div className="row gap">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        osmForceRef.current = true;
                        setOsmReload((value) => value + 1);
                      }}
                      disabled={!showBuildings || osmStatus === 'loading'}
                    >
                      Muat ulang OSM
                    </button>
                    {osmBuildings && osmBuildings.length > 0 ? (
                      <span className="micro-copy">tinggi {Math.round(Math.max(...osmBuildings.map((b) => b.heightMeters)))} m</span>
                    ) : null}
                  </div>
                  <p className="micro-copy">
                    Overpass di-cache server 1 jam; satu query per area rute. Bangunan mengikuti
                    footprint dan tag tinggi OSM, lalu diekstrusi di atas peta.
                  </p>
                </Section>

                <Section title="Gaya peta" hint="Tile nyata dari Esri/OSM">
                  <ChipGroup
                    value={mapStyle}
                    options={Object.values(MAP_STYLES).map((style) => ({
                      id: style.id,
                      label: style.label,
                      hint: style.hint,
                    }))}
                    onChange={(style) => setMapStyle(style)}
                    columns={2}
                  />
                  <p className="micro-copy">
                    Zoom dipilih otomatis dari luas rute. {mapStatus === 'fallback' ? 'Tile gagal dimuat — memakai peta offline.' : 'Atribusi peta tercetak di video.'}
                  </p>
                </Section>

                <Section title="Suasana langit">
                  <ChipGroup
                    value={sky}
                    options={Object.values(SKY_PALETTES).map((palette) => ({
                      id: palette.id,
                      label: palette.label,
                    }))}
                    onChange={(next) => setSky(next)}
                    columns={4}
                  />
                </Section>

                <Section title="Kamera sinematik">
                  <ChipGroup
                    value={preset}
                    options={CAMERA_PRESETS}
                    onChange={(next) => setPreset(next)}
                    columns={3}
                  />
                  <p className="micro-copy">Follow memakai kamera aerial; Front/Side/Chase untuk hero shot.</p>
                </Section>

                <Section title="Durasi video" hint={`${duration} detik`}>
                  <input
                    className="range"
                    type="range"
                    min={12}
                    max={60}
                    step={1}
                    value={duration}
                    onChange={(event) => setDuration(Number(event.target.value))}
                  />
                  <div className="row gap">
                    {[15, 30, 45, 60].map((value) => (
                      <button
                        type="button"
                        key={value}
                        className={`btn btn-ghost ${duration === value ? 'is-active' : ''}`}
                        onClick={() => setDuration(value)}
                      >
                        {value}s
                      </button>
                    ))}
                  </div>
                  <p className="micro-copy">
                    Struktur: intro 3.5s • lari • finisher 4s. Render 30 fps.
                  </p>
                </Section>
              </>
            ) : null}

            {tab === 'export' ? (
              <>
                <Section title="Kualitas" hint="H.264 9:16">
                  <ChipGroup
                    value={quality}
                    options={[
                      { id: 'hd', label: 'HD 720 × 1280', hint: '6.5 Mbps' },
                      { id: 'fhd', label: 'Full HD 1080 × 1920', hint: '10.5 Mbps' },
                    ]}
                    onChange={(next) => setQuality(next as VideoQuality)}
                    columns={2}
                  />
                  <p className="micro-copy">
                    Output MP4 (WebCodecs + mp4-muxer). Fallback WebM lewat MediaRecorder jika codec tidak tersedia.
                  </p>
                </Section>

                <Section title="Musik latar">
                  <ChipGroup
                    value={musicMode}
                    options={[
                      { id: 'default', label: 'Beat bawaan' },
                      { id: 'upload', label: 'File saya' },
                      { id: 'none', label: 'Tanpa musik' },
                    ]}
                    onChange={(mode) => setMusicMode(mode as MusicMode)}
                    columns={3}
                  />
                  <div className="row gap">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => musicInputRef.current?.click()}
                    >
                      Upload audio
                    </button>
                    <input
                      ref={musicInputRef}
                      data-testid="music-file"
                      type="file"
                      accept="audio/*"
                      hidden
                      onChange={(event) => void handleMusicInput(event)}
                    />
                    <span className="micro-copy">{musicName || (musicMode === 'default' ? 'Synth beat 96 BPM' : '—')}</span>
                  </div>
                  <div className="slider-row">
                    <span>Volume</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(event) => setVolume(Number(event.target.value))}
                    />
                    <strong>{Math.round(volume * 100)}%</strong>
                  </div>
                  <label className="checkbox">
                    <input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} />
                    Bisukan musik di video
                  </label>
                  <p className="micro-copy">
                    Audio di-encode AAC 48 kHz (fallback Opus). Musik loop dan memudar di akhir.
                  </p>
                </Section>

                <Section title="Render video" hint={`${duration}s • 30 fps`}>
                  <div className="row gap">
                    <button
                      type="button"
                      className="btn btn-primary btn-wide" data-testid="export-video"
                      onClick={() => void handleExport()}
                      disabled={!activity || !map || exporting}
                    >
                      {exporting ? 'Merender...' : `Export ${duration}s 9:16`}
                    </button>
                    {exporting ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => abortRef.current?.abort()}
                      >
                        Batal
                      </button>
                    ) : null}
                  </div>
                  {exporting || progress ? (
                    <div className="progress-block">
                      <div className="progress-bar">
                        <span style={{ width: `${progress?.percent ?? 0}%` }} />
                      </div>
                      <span className="micro-copy">{progressLabel}</span>
                    </div>
                  ) : null}
                  {exportError ? <p className="error-line">{exportError}</p> : null}
                  {result ? (
                    <div className="result-card">
                      <div>
                        <strong>{result.fileName}</strong>
                        <span>
                          {result.width}×{result.height} • {result.sizeMb} MB • {result.mode}
                          {result.hasAudio ? ' • audio' : ' • tanpa audio'}
                        </span>
                      </div>
                      <div className="row gap">
                        <a className="btn btn-primary" data-testid="download-video" href={result.url} download={result.fileName}>
                          Unduh video
                        </a>
                      </div>
                    </div>
                  ) : null}
                  <button type="button" className="btn btn-ghost" onClick={downloadFrame} disabled={!composer}>
                    Unduh frame PNG
                  </button>
                </Section>

                <Section title="Catatan port">
                  <p className="micro-copy">
                    Mesin lokal ini meniru pipeline JejakLari Studio: tile Esri/OSM → tekstur three.js,
                    bangunan Overpass, karakter chibi prosedural, HUD kanvas, Strava OAuth lokal, dan
                    ekspor WebCodecs. Reverse-geocoding dan layer jalan/area OSM belum disertakan.
                  </p>
                </Section>
              </>
            ) : null}
          </div>
        </aside>
      </main>

      <footer className="footer">
        <span>JejakLari Local • port edukasi mesin video 9:16</span>
        <span>Peta © Esri, OpenStreetMap, CARTO • Data aktivitas tetap di perangkat.</span>
      </footer>

      <input
        ref={globalPrimaryInputRef}
        type="file"
        accept=".fit,.gpx,.tcx,.zip,.gz,application/zip"
        hidden
        onChange={handlePrimaryInput}
      />

    </div>
  );
}
