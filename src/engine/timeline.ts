export type VideoPhase = 'intro' | 'run' | 'finish';

export interface FrameState {
  videoTimeSec: number;
  videoDurationSec: number;
  phase: VideoPhase;
  activityTimeSec: number;
  progress: number;
  introProgress: number;
  finishProgress: number;
}

export const VIDEO_FPS = 30;

export function phaseWindows(videoDurationSec: number): {
  introSec: number;
  finishSec: number;
  runSec: number;
  finishStartSec: number;
} {
  const duration = Math.max(8, videoDurationSec);
  const introSec = Math.min(3.5, duration * 0.25);
  const finishSec = Math.min(4, duration * 0.25);
  return {
    introSec,
    finishSec,
    runSec: Math.max(0.1, duration - introSec - finishSec),
    finishStartSec: duration - finishSec,
  };
}

export function frameStateAt(
  videoTimeSec: number,
  videoDurationSec: number,
  activityDurationSec: number,
): FrameState {
  const duration = Math.max(8, videoDurationSec);
  const time = Math.max(0, Math.min(duration, videoTimeSec));
  const windows = phaseWindows(duration);
  const activityDuration = Math.max(1, activityDurationSec);

  if (time < windows.introSec) {
    return {
      videoTimeSec: time,
      videoDurationSec: duration,
      phase: 'intro',
      activityTimeSec: 0,
      progress: 0,
      introProgress: Math.min(1, time / windows.introSec),
      finishProgress: 0,
    };
  }
  if (time >= windows.finishStartSec) {
    return {
      videoTimeSec: time,
      videoDurationSec: duration,
      phase: 'finish',
      activityTimeSec: activityDuration,
      progress: 1,
      introProgress: 1,
      finishProgress: Math.min(1, (time - windows.finishStartSec) / windows.finishSec),
    };
  }

  const runProgress = Math.min(1, (time - windows.introSec) / windows.runSec);
  const activityTimeSec = runProgress * activityDuration;
  return {
    videoTimeSec: time,
    videoDurationSec: duration,
    phase: 'run',
    activityTimeSec,
    progress: activityTimeSec / activityDuration,
    introProgress: 1,
    finishProgress: 0,
  };
}

export function frameCountForDuration(videoDurationSec: number): number {
  return Math.max(30, Math.round(videoDurationSec * VIDEO_FPS));
}

export function frameStateForIndex(
  index: number,
  videoDurationSec: number,
  activityDurationSec: number,
): FrameState {
  return frameStateAt(index / VIDEO_FPS, videoDurationSec, activityDurationSec);
}
