import * as THREE from 'three';
import type { Activity } from '../domain/activity';
import type { RaceOutcome } from '../domain/race';
import type { Diorama } from './geo';
import { HudRenderer } from './hud';
import { StudioScene, type FrameSnapshot, type SceneOptions } from './scene';
import type { CameraPreset, RunnerLook, SkyMode } from './theme';
import { SKY_PALETTES } from './theme';
import type { FrameState } from './timeline';
import type { MapStyleId, StitchedMap } from './tiles';

export interface ComposerOptions {
  activity: Activity;
  rival: Activity | null;
  diorama: Diorama;
  map: StitchedMap;
  primaryLook: RunnerLook;
  rivalLook: RunnerLook;
  sky: SkyMode;
  preset: CameraPreset;
  mapStyle: MapStyleId;
  width: number;
  height: number;
}

export class FrameComposer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: StudioScene;
  readonly canvas: HTMLCanvasElement;
  readonly hudCanvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;

  private readonly hud: HudRenderer;
  private readonly hudContext: CanvasRenderingContext2D;

  constructor(options: ComposerOptions) {
    this.width = options.width;
    this.height = options.height;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(options.width, options.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor('#0f172a', 1);
    this.canvas = this.renderer.domElement;

    const sceneOptions: SceneOptions = {
      activity: options.activity,
      rival: options.rival,
      diorama: options.diorama,
      map: options.map,
      primaryLook: options.primaryLook,
      rivalLook: options.rivalLook,
      sky: options.sky,
      preset: options.preset,
    };
    this.scene = new StudioScene(sceneOptions);

    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.width = options.width;
    this.hudCanvas.height = options.height;
    const hudContext = this.hudCanvas.getContext('2d');
    if (!hudContext) throw new Error('Canvas 2D tidak tersedia untuk HUD');
    this.hudContext = hudContext;

    this.hud = new HudRenderer({
      activity: options.activity,
      rival: options.rival,
      primaryLook: options.primaryLook,
      rivalLook: options.rivalLook,
      diorama: options.diorama,
      route: this.scene.route,
      rivalRoute: this.scene.rivalRoute,
      outcome: this.scene.outcome,
      mapStyle: options.mapStyle,
      skyLabel: SKY_PALETTES[options.sky].label,
    });
  }

  draw(state: FrameState, deltaSec: number, playing = true): FrameSnapshot {
    const snapshot = this.scene.update({
      activityTimeSec: state.activityTimeSec,
      phase: state.phase,
      introProgress: state.introProgress,
      finishProgress: state.finishProgress,
      progress: state.progress,
      deltaSec,
      playing,
    });
    this.scene.render(this.renderer);
    this.hud.draw(
      this.hudContext,
      this.width,
      this.height,
      snapshot,
      state.introProgress,
      state.finishProgress,
    );
    return snapshot;
  }

  compose(context: CanvasRenderingContext2D): void {
    context.drawImage(this.canvas, 0, 0, this.width, this.height);
    context.drawImage(this.hudCanvas, 0, 0, this.width, this.height);
  }

  setPreset(preset: CameraPreset): void {
    this.scene.setPreset(preset);
  }

  updateRunnerLooks(primaryLook: RunnerLook, rivalLook: RunnerLook, outcome: RaceOutcome | null): void {
    this.scene.updateRunnerLooks(primaryLook, rivalLook, outcome);
    this.hud.setRunnerLooks(primaryLook, rivalLook, outcome);
  }

  dispose(): void {
    this.scene.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.hudCanvas.width = 0;
    this.hudCanvas.height = 0;
  }
}
