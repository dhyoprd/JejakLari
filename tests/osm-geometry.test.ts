import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildOsmBuildingsMesh } from '../src/engine/osm';
import type { Diorama } from '../src/engine/geo';
import type { OsmBuilding } from '../src/shared/osm';

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

const BUILDING: OsmBuilding = {
  id: 1,
  heightMeters: 24,
  colorHex: '#cbd5e1',
  polygon: [
    { lat: -6.2005, lng: 106.7995 },
    { lat: -6.2005, lng: 106.8005 },
    { lat: -6.1995, lng: 106.8005 },
    { lat: -6.1995, lng: 106.7995 },
  ],
};

describe('OSM building geometry', () => {
  it('builds one merged mesh with walls and a roof above ground', () => {
    const mesh = buildOsmBuildingsMesh([BUILDING], DIORAMA);
    expect(mesh).not.toBeNull();
    if (!mesh) return;
    const position = mesh.geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(24);
    expect(position.count % 3).toBe(0);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    expect(box).toBeTruthy();
    if (box) {
      expect(box.max.y).toBeGreaterThan(20);
      expect(box.min.y).toBeGreaterThanOrEqual(0);
      expect(box.max.x - box.min.x).toBeGreaterThan(50);
    }
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
    mesh.geometry.dispose();
    material.dispose();
  });

  it('returns null for an empty or degenerate set', () => {
    expect(buildOsmBuildingsMesh([], DIORAMA)).toBeNull();
    expect(
      buildOsmBuildingsMesh(
        [{ ...BUILDING, polygon: [BUILDING.polygon[0], BUILDING.polygon[0]] }],
        DIORAMA,
      ),
    ).toBeNull();
  });
});
