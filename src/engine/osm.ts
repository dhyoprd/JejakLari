import * as THREE from 'three';
import type { OsmBuilding } from '../shared/osm';
import { projectPoint, type Diorama } from './geo';

const BASE_Y = 0.24;

interface Polygon2D {
  points: THREE.Vector2[];
}

function polygonFor(building: OsmBuilding, diorama: Diorama): Polygon2D | null {
  const points: THREE.Vector2[] = [];
  for (const point of building.polygon) {
    const projected = projectPoint(point.lat, point.lng, diorama);
    const previous = points[points.length - 1];
    if (previous && Math.abs(previous.x - projected.x) < 1e-5 && Math.abs(previous.y - projected.z) < 1e-5) {
      continue;
    }
    points.push(new THREE.Vector2(projected.x, projected.z));
  }
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.x - last.x) < 1e-5 && Math.abs(first.y - last.y) < 1e-5) points.pop();
  }
  if (points.length < 3) return null;

  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  if (Math.abs(area) < 1e-4) return null;
  if (area < 0) points.reverse();
  return { points };
}

/**
 * One merged, non-indexed mesh for every building: walls + triangulated roofs,
 * per-face normals and colors. Keeps OSM data at a single draw call.
 */
export function buildOsmBuildingsMesh(
  buildings: OsmBuilding[],
  diorama: Diorama,
): THREE.Mesh | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  const addTriangle = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    normal: THREE.Vector3,
    color: THREE.Color,
  ) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const facing = new THREE.Vector3().crossVectors(ab, ac);
    const third = facing.dot(normal) < 0 ? b : c;
    const second = facing.dot(normal) < 0 ? c : b;
    for (const point of [a, second, third]) {
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      colors.push(color.r, color.g, color.b);
    }
  };

  let built = 0;
  for (const building of buildings) {
    const polygon = polygonFor(building, diorama);
    if (!polygon) continue;
    const baseColor = new THREE.Color(
      /^#[0-9a-f]{6}$/i.test(building.colorHex) ? building.colorHex : '#cbd5e1',
    );
    const wallColor = baseColor.clone().lerp(new THREE.Color('#ffffff'), 0.12);
    const roofColor = baseColor.clone().lerp(new THREE.Color('#ffffff'), 0.38);
    const top = BASE_Y + Math.max(3, building.heightMeters);
    const roofNormal = new THREE.Vector3(0, 1, 0);

    let faces: number[][] = [];
    try {
      faces = THREE.ShapeUtils.triangulateShape(polygon.points, []);
    } catch {
      faces = [];
    }
    if (faces.length === 0) continue;

    for (let index = 0; index < polygon.points.length; index++) {
      const current = polygon.points[index];
      const next = polygon.points[(index + 1) % polygon.points.length];
      const dx = next.x - current.x;
      const dz = next.y - current.y;
      const length = Math.hypot(dx, dz);
      if (length < 1e-5) continue;
      const normal = new THREE.Vector3(dz / length, 0, -dx / length);
      const bottomA = new THREE.Vector3(current.x, BASE_Y, current.y);
      const bottomB = new THREE.Vector3(next.x, BASE_Y, next.y);
      const topA = new THREE.Vector3(current.x, top, current.y);
      const topB = new THREE.Vector3(next.x, top, next.y);
      addTriangle(bottomA, bottomB, topB, normal, wallColor);
      addTriangle(bottomA, topB, topA, normal, wallColor);
    }

    for (const face of faces) {
      if (face.length < 3) continue;
      const a = polygon.points[face[0]];
      const b = polygon.points[face[1]];
      const c = polygon.points[face[2]];
      addTriangle(
        new THREE.Vector3(a.x, top, a.y),
        new THREE.Vector3(b.x, top, b.y),
        new THREE.Vector3(c.x, top, c.y),
        roofNormal,
        roofColor,
      );
    }
    built += 1;
  }

  if (built === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'osm-buildings';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}
