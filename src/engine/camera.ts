import * as THREE from 'three';
import type { Diorama } from './geo';
import type { CameraPreset } from './theme';

export type VideoPhase = 'intro' | 'run' | 'finish';

export interface CameraFrame {
  runnerX: number;
  runnerZ: number;
  runnerRotation: number;
  rivalX?: number;
  rivalZ?: number;
  elapsedSec: number;
  phase: VideoPhase;
  introProgress: number;
  finishProgress: number;
}

const smoothstep = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

export class CameraDirector {
  private readonly position = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private initialized = false;
  private finishPose = false;
  private distance = 100;
  private heading = 0;
  private headingReady = false;

  constructor(private readonly diorama: Diorama) {}

  get currentDistance(): number {
    return this.distance;
  }

  private overview(distanceFactor: number): { position: THREE.Vector3; target: THREE.Vector3 } {
    const span = Math.max(
      350,
      this.diorama.spanMetersX,
      this.diorama.spanMetersZ,
    );
    const distance = Math.max(
      450,
      Math.min(11000, Math.max((0.62 * span) / 0.25, (0.78 * span) / 0.445)),
    );
    const position = new THREE.Vector3(
      distanceFactor * distance * 0.07,
      0.91 * distance,
      0.41 * distance,
    );
    return { position, target: new THREE.Vector3(0, 0, 0) };
  }

  private poseFor(
    preset: CameraPreset,
    x: number,
    z: number,
    rotationY: number,
    twoRunners: boolean,
  ): { position: THREE.Vector3; target: THREE.Vector3 } {
    if (preset === 'drone') {
      return this.overview(0);
    }

    const sin = -Math.sin(rotationY);
    const cos = -Math.cos(rotationY);
    const sideX = Math.cos(rotationY);
    const sideZ = -Math.sin(rotationY);
    const target = new THREE.Vector3();
    const position = new THREE.Vector3();

    if (preset === 'front_hero') {
      position.set(x + 14 * sin + 3.5 * sideX, 4.8, z + 14 * cos + 3.5 * sideZ);
      target.set(x, 3.2, z);
      return { position, target };
    }
    if (preset === 'side_profile') {
      position.set(x + 16.5 * sideX, 5.2, z + 16.5 * sideZ);
      target.set(x, 3.2, z);
      return { position, target };
    }
    if (preset === 'chase') {
      position.set(x - 19 * sin, 9.5, z - 19 * cos);
      target.set(x + 6.5 * sin, 3.2, z + 6.5 * cos);
      return { position, target };
    }

    const ahead = twoRunners ? 22 : 32;
    const targetX = x + ahead * sin;
    const targetZ = z + ahead * cos;
    position.set(
      targetX - 195 * sin + 18 * sideX,
      420,
      targetZ - 195 * cos + 18 * sideZ,
    );
    target.set(targetX, 1.5, targetZ);
    return { position, target };
  }

  update(
    camera: THREE.PerspectiveCamera,
    dt: number,
    frame: CameraFrame,
    preset: CameraPreset,
  ): void {
    this.finishPose = frame.phase === 'finish';
    const rivalX = frame.rivalX;
    const rivalZ = frame.rivalZ;
    const twoRunners = rivalX !== undefined && rivalZ !== undefined;

    let x = frame.runnerX;
    let z = frame.runnerZ;
    if (rivalX !== undefined && rivalZ !== undefined) {
      const rivalDistance = Math.hypot(rivalX - x, rivalZ - z);
      if (rivalDistance > 1 && rivalDistance < 220) {
        const weight = 0.26 * (1 - rivalDistance / 220);
        x += (rivalX - x) * weight;
        z += (rivalZ - z) * weight;
      }
    }

    if (!this.headingReady) {
      this.heading = frame.runnerRotation;
      this.headingReady = true;
    } else {
      const delta = Math.atan2(
        Math.sin(frame.runnerRotation - this.heading),
        Math.cos(frame.runnerRotation - this.heading),
      );
      this.heading += delta * Math.min(1, Math.max(0, dt) * 10);
    }

    const follow = this.poseFor(preset, x, z, this.heading, twoRunners);
    let desiredPosition = follow.position;
    let desiredTarget = follow.target;

    if (this.finishPose) {
      desiredPosition = new THREE.Vector3(x, 4.25, z - 12.2);
      desiredTarget = new THREE.Vector3(x, 4.25, z);
    } else if (frame.phase === 'intro' && preset !== 'drone') {
      const orbit = this.overview(Math.sin(frame.introProgress * Math.PI));
      const blend = smoothstep((frame.introProgress - 0.42) / 0.58);
      desiredPosition = orbit.position.clone().lerp(follow.position, blend);
      desiredTarget = orbit.target.clone().lerp(follow.target, blend);
    }

    const tightShot =
      preset === 'front_hero' || preset === 'side_profile' || preset === 'chase';
    if (!this.initialized) {
      this.position.copy(desiredPosition);
      this.target.copy(desiredTarget);
      this.initialized = true;
    } else if (tightShot && frame.phase !== 'intro') {
      // The video clock compresses a whole run into seconds, so a tight shot
      // cannot exponential-lerp: at ~200 m/s the lag exceeds the 14-19 m
      // camera distance and the avatar leaves the frame. Track directly.
      this.position.copy(desiredPosition);
      this.target.copy(desiredTarget);
    } else {
      const rate = this.finishPose ? 8.5 : preset === 'drone' ? 5 : 8;
      const alpha = 1 - Math.exp(-rate * Math.max(0, dt));
      this.position.lerp(desiredPosition, alpha);
      this.target.lerp(desiredTarget, alpha);
    }

    camera.position.copy(this.position);
    camera.lookAt(this.target);
    this.distance = this.position.distanceTo(this.target);
  }
}
