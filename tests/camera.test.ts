import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraDirector } from '../src/engine/camera';
import type { Diorama } from '../src/engine/geo';

const DIORAMA: Diorama = {
  centerLat: -6.2,
  centerLng: 106.8,
  minLat: -6.21,
  maxLat: -6.19,
  minLng: 106.79,
  maxLng: 106.81,
  spanMetersX: 1200,
  spanMetersZ: 1200,
};

const CAMERA = () => new THREE.PerspectiveCamera(43, 9 / 16, 1, 30000);

describe('tight camera presets', () => {
  it('starts the intro at a low aerial instead of the drone overview', () => {
    const director = new CameraDirector({
      ...DIORAMA,
      spanMetersX: 1878,
      spanMetersZ: 1285,
    });
    const camera = CAMERA();
    director.update(
      camera,
      1 / 30,
      {
        runnerX: -900,
        runnerZ: 0,
        runnerRotation: 0,
        elapsedSec: 0,
        phase: 'intro',
        introProgress: 0,
        finishProgress: 0,
      },
      'follow_runner',
    );
    expect(camera.position.y).toBeLessThan(800);
    expect(camera.position.y).toBeGreaterThan(100);
  });

  it('keeps the finisher above the recap card and inside the top edge', () => {
    const director = new CameraDirector(DIORAMA);
    const camera = CAMERA();
    director.update(
      camera,
      1 / 30,
      {
        runnerX: 0,
        runnerZ: 0,
        runnerRotation: 0,
        elapsedSec: 0,
        phase: 'finish',
        introProgress: 1,
        finishProgress: 0.5,
      },
      'follow_runner',
    );
    camera.updateMatrixWorld();
    const screenY = (y: number) =>
      (1 - new THREE.Vector3(0, y, 0).project(camera).y) / 2;
    const feet = screenY(1.23);
    const head = screenY(5.54);
    expect(feet).toBeLessThan(0.72);
    expect(head).toBeGreaterThan(0.05);
    expect(feet - head).toBeGreaterThan(0.4);
  });

  it.each(['front_hero', 'side_profile', 'chase'] as const)(
    '%s keeps a runner moving at video speed inside the shot',
    (preset) => {
      const director = new CameraDirector(DIORAMA);
      const camera = CAMERA();
      let x = 0;
      let z = 0;
      const speed = 220; // metres per video second at a 30 s compressed run
      for (let frame = 0; frame < 120; frame++) {
        x += speed / 30;
        director.update(
          camera,
          1 / 30,
          {
            runnerX: x,
            runnerZ: z,
            runnerRotation: 0,
            elapsedSec: frame / 30,
            phase: 'run',
            introProgress: 1,
            finishProgress: 0,
          },
          preset,
        );
      }
      const distance = camera.position.distanceTo(new THREE.Vector3(x, 3.2, z));
      expect(distance).toBeLessThan(24);
      expect(distance).toBeGreaterThan(10);
    },
  );
});
