export interface AudioTrackProvider {
  readonly id: string;
  readonly label: string;
  readonly silent: boolean;
  getBuffer(durationSec: number): Promise<AudioBuffer | null>;
}

const TARGET_SAMPLE_RATE = 48_000;

export class UploadedAudioTrack implements AudioTrackProvider {
  readonly id: string;
  readonly label: string;
  readonly silent = false;

  constructor(
    private readonly buffer: AudioBuffer,
    label: string,
  ) {
    this.id = 'uploaded';
    this.label = label;
  }

  async getBuffer(): Promise<AudioBuffer> {
    return this.buffer;
  }
}

export class SynthAudioTrack implements AudioTrackProvider {
  readonly id = 'synth-default';
  readonly label = 'JejakLari Beat (bawaan)';
  readonly silent = false;

  private cache: { duration: number; buffer: AudioBuffer } | null = null;

  async getBuffer(durationSec: number): Promise<AudioBuffer> {
    if (this.cache && Math.abs(this.cache.duration - durationSec) < 0.1) {
      return this.cache.buffer;
    }
    const buffer = await renderSynthBeat(Math.max(8, durationSec));
    this.cache = { duration: durationSec, buffer };
    return buffer;
  }
}

export class SilentAudioTrack implements AudioTrackProvider {
  readonly id = 'silent';
  readonly label = 'Tanpa musik';
  readonly silent = true;

  async getBuffer(): Promise<null> {
    return null;
  }
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  try {
    const arrayBuffer = await file.arrayBuffer();
    return await context.decodeAudioData(arrayBuffer);
  } finally {
    await context.close().catch(() => {});
  }
}

async function renderSynthBeat(durationSec: number): Promise<AudioBuffer> {
  const sampleRate = TARGET_SAMPLE_RATE;
  const frames = Math.max(1, Math.ceil(durationSec * sampleRate));
  const context = new OfflineAudioContext(2, frames, sampleRate);

  const master = context.createGain();
  master.gain.value = 0.0001;
  master.gain.setValueAtTime(0.0001, 0);
  master.gain.exponentialRampToValueAtTime(0.28, 1.2);
  const fadeOutStart = Math.max(1.5, durationSec - 1.8);
  master.gain.setValueAtTime(0.28, fadeOutStart);
  master.gain.exponentialRampToValueAtTime(0.0001, durationSec);

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.ratio.value = 3.2;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.22;
  master.connect(compressor).connect(context.destination);

  const padBus = context.createGain();
  padBus.gain.value = 0.34;
  const padFilter = context.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 1500;
  padBus.connect(padFilter).connect(master);

  const bassBus = context.createGain();
  bassBus.gain.value = 0.3;
  bassBus.connect(master);

  const chords = [
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [130.81, 164.81, 196],
    [196, 246.94, 293.66],
  ];
  const beat = 60 / 96;
  const chordDuration = beat * 8;

  for (let start = 0, index = 0; start < durationSec; start += chordDuration, index++) {
    const chord = chords[index % chords.length];
    for (const frequency of chord) {
      for (const detune of [-4, 4]) {
        const oscillator = context.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency;
        oscillator.detune.value = detune;
        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(0.055, start + 0.7);
        envelope.gain.setValueAtTime(0.055, Math.max(start + 0.8, start + chordDuration - 0.9));
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + chordDuration + 0.2);
        oscillator.connect(envelope).connect(padBus);
        oscillator.start(start);
        oscillator.stop(start + chordDuration + 0.25);
      }
    }

    const root = chord[0] / 2;
    for (let step = 0; step < 8; step++) {
      const time = start + step * beat;
      if (time >= durationSec) break;
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = step % 4 === 3 ? root * 1.5 : root;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(0.12, time + 0.02);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + beat * 0.9);
      oscillator.connect(envelope).connect(bassBus);
      oscillator.start(time);
      oscillator.stop(time + beat);
    }

    const arp = [chord[2], chord[1], chord[0] * 2, chord[1] * 2];
    for (let step = 0; step < 8; step++) {
      const time = start + step * (beat / 2);
      if (time >= durationSec) break;
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = arp[step % arp.length];
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(0.02, time + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + beat * 0.42);
      oscillator.connect(envelope).connect(master);
      oscillator.start(time);
      oscillator.stop(time + beat * 0.45);
    }
  }

  const noiseBuffer = context.createBuffer(1, Math.ceil(sampleRate * 0.2), sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseData.length) ** 2;
  }

  for (let time = 0; time < durationSec; time += beat) {
    const kick = context.createOscillator();
    kick.type = 'sine';
    kick.frequency.setValueAtTime(120, time);
    kick.frequency.exponentialRampToValueAtTime(44, time + 0.18);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.26, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
    kick.connect(gain).connect(master);
    kick.start(time);
    kick.stop(time + 0.3);

    const hatTime = time + beat / 2;
    if (hatTime < durationSec) {
      const hat = context.createBufferSource();
      hat.buffer = noiseBuffer;
      const hatFilter = context.createBiquadFilter();
      hatFilter.type = 'highpass';
      hatFilter.frequency.value = 6200;
      const hatGain = context.createGain();
      hatGain.gain.value = 0.08;
      hat.connect(hatFilter).connect(hatGain).connect(master);
      hat.start(hatTime);
    }
  }

  return context.startRendering();
}

export async function resampleForVideo(
  buffer: AudioBuffer,
  durationSec: number,
  volume: number,
  sampleRate = TARGET_SAMPLE_RATE,
): Promise<AudioBuffer> {
  const frames = Math.max(1, Math.ceil(durationSec * sampleRate));
  const context = new OfflineAudioContext(2, frames, sampleRate);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = context.createGain();
  const level = Math.max(0, Math.min(1, volume)) * 0.9;
  gain.gain.setValueAtTime(0.0001, 0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), Math.min(0.7, durationSec * 0.2));
  const fadeStart = Math.max(0.8, durationSec - 1.4);
  gain.gain.setValueAtTime(Math.max(0.0001, level), fadeStart);
  gain.gain.exponentialRampToValueAtTime(0.0001, durationSec);
  source.connect(gain).connect(context.destination);
  source.start(0);
  return context.startRendering();
}
