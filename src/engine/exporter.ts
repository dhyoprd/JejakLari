import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { AudioTrackProvider } from './audio';
import { resampleForVideo } from './audio';
import { FrameComposer, type ComposerOptions } from './composer';
import { VIDEO_FPS, frameCountForDuration, frameStateAt, frameStateForIndex } from './timeline';

export type VideoQuality = 'hd' | 'fhd';

export interface ExportRequest extends Omit<ComposerOptions, 'width' | 'height'> {
  durationSec: number;
  quality: VideoQuality;
  audio: AudioTrackProvider | null;
  volume: number;
  muted: boolean;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface ExportProgress {
  stage: 'audio' | 'video' | 'finalize';
  frame: number;
  totalFrames: number;
  percent: number;
  message: string;
}

export interface ExportResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  mime: string;
  width: number;
  height: number;
  durationSec: number;
  frames: number;
  hasAudio: boolean;
  mode: 'webcodecs-mp4' | 'mediarecorder-webm';
}

interface PreparedAudio {
  muxerCodec: 'aac' | 'opus';
  sampleRate: number;
  channels: number;
  chunks: EncodedAudioChunk[];
  metadata: Array<EncodedAudioChunkMetadata | undefined>;
}

const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_CHUNK_FRAMES = 1024;

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Ekspor dibatalkan.', 'AbortError');
  }
}

function isWebCodecsAvailable(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof VideoEncoder.isConfigSupported === 'function'
  );
}

async function supportedVideoConfig(
  width: number,
  height: number,
  bitrate: number,
): Promise<VideoEncoderConfig | null> {
  const codecs =
    width >= 1080
      ? ['avc1.42002a', 'avc1.420028', 'avc1.4d002a', 'avc1.4d0028', 'avc1.64002a', 'avc1.640028']
      : ['avc1.420028', 'avc1.42001f', 'avc1.42E01E', 'avc1.4d0020', 'avc1.640028'];

  for (const acceleration of ['prefer-hardware', 'no-preference'] as const) {
    for (const codec of codecs) {
      const base: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: VIDEO_FPS,
        hardwareAcceleration: acceleration,
        latencyMode: 'realtime',
      };
      for (const candidate of [{ ...base, avc: { format: 'avc' as const } }, base]) {
        try {
          const support = await VideoEncoder.isConfigSupported(candidate);
          if (support.supported && support.config) return support.config;
        } catch {
          // Some Chromium builds reject the `avc` extension option; retry without it.
        }
      }
    }
  }
  return null;
}

async function prepareAudio(
  provider: AudioTrackProvider | null,
  durationSec: number,
  volume: number,
  muted: boolean,
): Promise<PreparedAudio | null> {
  if (!provider || provider.silent || muted || volume <= 0.001) return null;
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;

  let buffer: AudioBuffer | null = null;
  try {
    buffer = await provider.getBuffer(durationSec);
  } catch {
    return null;
  }
  if (!buffer) return null;

  let resampled: AudioBuffer;
  try {
    resampled = await resampleForVideo(buffer, durationSec, volume, AUDIO_SAMPLE_RATE);
  } catch {
    return null;
  }

  const candidates: Array<{
    muxerCodec: 'aac' | 'opus';
    config: AudioEncoderConfig;
  }> = [
    {
      muxerCodec: 'aac',
      config: {
        codec: 'mp4a.40.2',
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfChannels: 2,
        bitrate: 128_000,
      },
    },
    {
      muxerCodec: 'opus',
      config: {
        codec: 'opus',
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfChannels: 2,
        bitrate: 128_000,
      },
    },
  ];

  for (const candidate of candidates) {
    try {
      const support = await AudioEncoder.isConfigSupported(candidate.config);
      if (!support.supported) continue;

      const chunks: EncodedAudioChunk[] = [];
      const metadata: Array<EncodedAudioChunkMetadata | undefined> = [];
      let encoderError: Error | null = null;
      const encoder = new AudioEncoder({
        output: (chunk, meta) => {
          chunks.push(chunk);
          metadata.push(meta);
        },
        error: (error) => {
          encoderError = error;
        },
      });
      encoder.configure(candidate.config);

      const left = resampled.getChannelData(0);
      const right = resampled.numberOfChannels > 1 ? resampled.getChannelData(1) : left;
      const totalFrames = resampled.length;

      for (let offset = 0; offset < totalFrames; offset += AUDIO_CHUNK_FRAMES) {
        if (encoderError) break;
        const frameCount = Math.min(AUDIO_CHUNK_FRAMES, totalFrames - offset);
        const data = new Float32Array(frameCount * 2);
        for (let i = 0; i < frameCount; i++) {
          data[i] = left[offset + i] ?? 0;
          data[frameCount + i] = right[offset + i] ?? 0;
        }
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: AUDIO_SAMPLE_RATE,
          numberOfFrames: frameCount,
          numberOfChannels: 2,
          timestamp: Math.round((offset / AUDIO_SAMPLE_RATE) * 1e6),
          data,
        });
        try {
          encoder.encode(audioData);
        } finally {
          audioData.close();
        }
      }
      await encoder.flush();
      encoder.close();
      if (encoderError) throw encoderError;

      return {
        muxerCodec: candidate.muxerCodec,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: 2,
        chunks,
        metadata,
      };
    } catch {
      // Try the next supported codec.
    }
  }
  return null;
}

async function waitForQueue(
  encoder: VideoEncoder,
  maxSize: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = performance.now() + 8000;
  while (encoder.encodeQueueSize > maxSize && encoder.state === 'configured') {
    abortIfRequested(signal);
    if (performance.now() > deadline) throw new Error('Encoder video tidak merespons.');
    const { promise, resolve } = Promise.withResolvers<void>();
    const timeout = setTimeout(resolve, 60);
    const previous = encoder.ondequeue;
    encoder.ondequeue = (event) => {
      previous?.call(encoder, event);
      clearTimeout(timeout);
      resolve();
    };
    await promise;
    encoder.ondequeue = previous;
  }
}

async function exportMp4(request: ExportRequest): Promise<ExportResult> {
  const width = request.quality === 'fhd' ? 1080 : 720;
  const height = request.quality === 'fhd' ? 1920 : 1280;
  const bitrate = request.quality === 'fhd' ? 10_500_000 : 6_500_000;
  const totalFrames = frameCountForDuration(request.durationSec);

  request.onProgress?.({
    stage: 'audio',
    frame: 0,
    totalFrames,
    percent: 0,
    message: 'Menyiapkan audio...',
  });
  const audio = await prepareAudio(request.audio, request.durationSec, request.volume, request.muted);
  abortIfRequested(request.signal);

  const videoConfig = await supportedVideoConfig(width, height, bitrate);
  if (!videoConfig) throw new Error('Codec H.264 tidak didukung browser ini.');

  const composer = new FrameComposer({ ...request, width, height });
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = width;
  frameCanvas.height = height;
  const frameContext = frameCanvas.getContext('2d');
  if (!frameContext) {
    composer.dispose();
    throw new Error('Canvas 2D tidak tersedia.');
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: VIDEO_FPS },
    audio: audio
      ? {
          codec: audio.muxerCodec,
          numberOfChannels: audio.channels,
          sampleRate: audio.sampleRate,
        }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  if (audio) {
    for (let i = 0; i < audio.chunks.length; i++) {
      muxer.addAudioChunk(audio.chunks[i], audio.metadata[i]);
    }
  }

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    },
  });
  encoder.configure(videoConfig);

  const frameDuration = Math.round(1e6 / VIDEO_FPS);
  try {
    for (let index = 0; index < totalFrames; index++) {
      abortIfRequested(request.signal);
      if (encoderError) throw encoderError;
      const state = frameStateForIndex(index, request.durationSec, request.activity.totalDurationSec);
      composer.draw(state, 1 / VIDEO_FPS);
      composer.compose(frameContext);

      const videoFrame = new VideoFrame(frameCanvas, {
        timestamp: Math.round((index * 1e6) / VIDEO_FPS),
        duration: frameDuration,
      });
      try {
        encoder.encode(videoFrame, { keyFrame: index % (VIDEO_FPS * 2) === 0 });
      } finally {
        videoFrame.close();
      }
      await waitForQueue(encoder, 6, request.signal);

      if (index % 5 === 0 || index === totalFrames - 1) {
        request.onProgress?.({
          stage: 'video',
          frame: index + 1,
          totalFrames,
          percent: Math.round(((index + 1) / totalFrames) * 96),
          message: `Merender frame ${index + 1}/${totalFrames}`,
        });
      }
    }

    request.onProgress?.({
      stage: 'finalize',
      frame: totalFrames,
      totalFrames,
      percent: 98,
      message: 'Menutup file MP4...',
    });
    await encoder.flush();
    encoder.close();
    if (encoderError) throw encoderError;
    muxer.finalize();

    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    request.onProgress?.({
      stage: 'finalize',
      frame: totalFrames,
      totalFrames,
      percent: 100,
      message: 'Selesai',
    });
    return {
      blob,
      ext: 'mp4',
      mime: 'video/mp4',
      width,
      height,
      durationSec: request.durationSec,
      frames: totalFrames,
      hasAudio: Boolean(audio),
      mode: 'webcodecs-mp4',
    };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    composer.dispose();
  }
}

function supportedRecorderMime(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? '';
}

async function exportWebm(request: ExportRequest): Promise<ExportResult> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Browser ini tidak mendukung rekaman video otomatis.');
  }
  const width = request.quality === 'fhd' ? 1080 : 720;
  const height = request.quality === 'fhd' ? 1920 : 1280;
  const totalFrames = frameCountForDuration(request.durationSec);
  const composer = new FrameComposer({ ...request, width, height });

  const stream = composer.displayCanvas.captureStream(VIDEO_FPS);
  let audioContext: AudioContext | null = null;

  if (request.audio && !request.audio.silent && !request.muted && request.volume > 0.001) {
    try {
      const buffer = await request.audio.getBuffer(request.durationSec);
      if (buffer) {
        audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = audioContext.createGain();
        const level = Math.max(0.0001, Math.min(1, request.volume) * 0.9);
        const now = audioContext.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(level, now + 0.8);
        const fadeStart = now + Math.max(0.8, request.durationSec - 1.4);
        gain.gain.setValueAtTime(level, fadeStart);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + request.durationSec);
        source.connect(gain).connect(destination);
        source.start(now);
        for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
        await audioContext.resume();
      }
    } catch {
      audioContext = null;
    }
  }

  const mime = supportedRecorderMime();
  const recorder = new MediaRecorder(stream, {
    mimeType: mime || undefined,
    videoBitsPerSecond: request.quality === 'fhd' ? 10_500_000 : 6_500_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const stopped = Promise.withResolvers<void>();
  recorder.onstop = () => stopped.resolve();
  recorder.start(250);

  const startedAt = performance.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (request.signal?.aborted) {
          reject(new DOMException('Ekspor dibatalkan.', 'AbortError'));
          return;
        }
        const elapsed = (performance.now() - startedAt) / 1000;
        if (elapsed >= request.durationSec) {
          resolve();
          return;
        }
        const state = frameStateAt(elapsed, request.durationSec, request.activity.totalDurationSec);
        composer.draw(state, 1 / VIDEO_FPS);
        composer.present();
        request.onProgress?.({
          stage: 'video',
          frame: Math.floor(elapsed * VIDEO_FPS),
          totalFrames,
          percent: Math.round((elapsed / request.durationSec) * 95),
          message: `Merekam ${elapsed.toFixed(1)}s / ${request.durationSec}s`,
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    recorder.stop();
    await stopped.promise;
    stream.getTracks().forEach((track) => track.stop());
    if (audioContext) await audioContext.close().catch(() => {});
    composer.dispose();
  }

  const blob = new Blob(chunks, { type: mime || 'video/webm' });
  request.onProgress?.({
    stage: 'finalize',
    frame: totalFrames,
    totalFrames,
    percent: 100,
    message: 'Selesai',
  });
  const isMp4 = mime.includes('mp4');
  return {
    blob,
    ext: isMp4 ? 'mp4' : 'webm',
    mime: mime || 'video/webm',
    width,
    height,
    durationSec: request.durationSec,
    frames: totalFrames,
    hasAudio: Boolean(audioContext),
    mode: 'mediarecorder-webm',
  };
}

export async function exportVideo(request: ExportRequest): Promise<ExportResult> {
  if (isWebCodecsAvailable()) {
    try {
      return await exportMp4(request);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      console.warn('WebCodecs export failed, falling back to MediaRecorder:', error);
    }
  }
  return exportWebm(request);
}
