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
