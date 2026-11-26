import * as THREE from 'three';
import { disposeObjectTree } from './dispose';
import { CameraDirector } from './camera';
import type { Activity, ActivityPoint } from '../domain/activity';
import { compareRace, type RaceOutcome } from '../domain/race';
import { buildRoute, interpolateActivity, sampleRoute, type Diorama, type RoutePoint } from './geo';
import { RunnerModel } from './runner';
import type { CameraPreset, RunnerLook, SkyMode } from './theme';
import { buildOsmBuildingsMesh } from './osm';
import type { OsmBuilding } from '../shared/osm';
import { SKY_PALETTES } from './theme';
import type { StitchedMap } from './tiles';

export interface SceneOptions {
  activity: Activity;
  rival: Activity | null;
  diorama: Diorama;
  map: StitchedMap;
  primaryLook: RunnerLook;
  rivalLook: RunnerLook;
  sky: SkyMode;
  preset: CameraPreset;
  osmBuildings?: OsmBuilding[] | null;
}

export interface FrameSnapshot {
  point: ActivityPoint;
  rivalPoint: ActivityPoint | null;
  phase: 'intro' | 'run' | 'finish';
  progress: number;
}

export interface SceneUpdate {
  activityTimeSec: number;
  phase: 'intro' | 'run' | 'finish';
  introProgress: number;
  finishProgress: number;
  progress: number;
  deltaSec: number;
  playing: boolean;
}

function routeRibbon(points: RoutePoint[], width: number, y: number): THREE.BufferGeometry {
  const count = points.length;
  const positions = new Float32Array(count * 6);
  const uvs = new Float32Array(count * 4);
  const indices: number[] = [];

  for (let i = 0; i < count; i++) {
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(count - 1, i + 1)];
    let dx = next.x - previous.x;
    let dz = next.z - previous.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-5) {
      dx = i > 0 ? points[i].x - points[i - 1].x : 1;
      dz = i > 0 ? points[i].z - points[i - 1].z : 0;
    }
    const normalLength = Math.max(1e-5, Math.hypot(dx, dz));
    const nx = -dz / normalLength;
    const nz = dx / normalLength;
    const half = width / 2;
    const offset = i * 6;
    positions[offset] = points[i].x - nx * half;
    positions[offset + 1] = y;
    positions[offset + 2] = points[i].z - nz * half;
    positions[offset + 3] = points[i].x + nx * half;
    positions[offset + 4] = y;
    positions[offset + 5] = points[i].z + nz * half;
    uvs[i * 4] = i / Math.max(1, count - 1);
    uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = i / Math.max(1, count - 1);
    uvs[i * 4 + 3] = 1;
    if (i < count - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function labelSprite(text: string, accent: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 144;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 128, 34);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 74);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(42, 11.8, 1);
  return sprite;
}

function marker(
  position: { x: number; z: number },
  accent: string,
  label: string,
  radius: number,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(position.x, 1.12, position.z);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  group.add(disc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.82, radius, 48),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.22, radius * 0.42, 46, 18, 1, true),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  beam.position.y = 23;
  group.add(beam);

  const sprite = labelSprite(label, accent);
  sprite.position.y = 30;
  sprite.scale.multiplyScalar(Math.max(0.6, radius / 14));
  group.add(sprite);

  return group;
}

export class StudioScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  outcome: RaceOutcome | null;

  private readonly options: SceneOptions;
  private readonly primary: RunnerModel;
  private readonly rival: RunnerModel | null;
  readonly route: RoutePoint[];
  readonly rivalRoute: RoutePoint[] | null;
  private readonly progressGeometry: THREE.BufferGeometry;
  private readonly glowGeometry: THREE.BufferGeometry;
  private readonly markerGroup: THREE.Group;
  private readonly runnerRing: THREE.Mesh;
  private readonly mapTexture: THREE.CanvasTexture;
  private readonly phase = new THREE.Group();
  private readonly cameraDirector: CameraDirector;
  private osmGroup: THREE.Group | null = null;
  private cameraPreset: CameraPreset;

  constructor(options: SceneOptions) {
    this.options = options;
    this.camera = new THREE.PerspectiveCamera(43, 9 / 16, 0.4, 40000);
    const palette = SKY_PALETTES[options.sky];

    this.scene.background = new THREE.Color(palette.background);
    const maxSpan = Math.max(options.diorama.spanMetersX, options.diorama.spanMetersZ);
    this.scene.fog = new THREE.Fog(new THREE.Color(palette.fog), maxSpan * 1.1, maxSpan * 5.2);

    const hemisphere = new THREE.HemisphereLight(palette.ambient, palette.ground, palette.ambientIntensity);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(palette.sun, palette.sunIntensity);
    sun.position.set(320, 620, 260);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(palette.rim, 0.8);
    rim.position.set(-260, 160, -320);
    this.scene.add(rim);

    this.mapTexture = new THREE.CanvasTexture(options.map.canvas);
    this.mapTexture.colorSpace = THREE.SRGBColorSpace;
    this.mapTexture.anisotropy = 8;
    this.mapTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.mapTexture.magFilter = THREE.LinearFilter;
    this.mapTexture.generateMipmaps = true;
    this.mapTexture.needsUpdate = true;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(options.map.widthMeters, options.map.heightMeters),
      new THREE.MeshBasicMaterial({ map: this.mapTexture }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(options.map.centerX, 0, options.map.centerZ);
    this.scene.add(ground);

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(options.map.widthMeters * 1.02, 16, options.map.heightMeters * 1.02),
      new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 1, metalness: 0 }),
    );
    slab.position.set(options.map.centerX, -8.1, options.map.centerZ);
    this.scene.add(slab);

    this.route = buildRoute(options.activity.timeline, options.diorama);
    const fullGeometry = routeRibbon(this.route, 5.6, 1.03);
    const dim = new THREE.Mesh(
      fullGeometry,
      new THREE.MeshBasicMaterial({
        color: '#e2e8f4',
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.scene.add(dim);

    this.progressGeometry = routeRibbon(this.route, 5.6, 1.08);
    this.glowGeometry = routeRibbon(this.route, 16, 1.06);
    const progress = new THREE.Mesh(
      this.progressGeometry,
      new THREE.MeshBasicMaterial({
        color: '#2dd4bf',
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const glow = new THREE.Mesh(
      this.glowGeometry,
      new THREE.MeshBasicMaterial({
        color: '#5eead4',
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(glow, progress);

    this.markerGroup = new THREE.Group();
    const start = this.route[0] ?? { x: 0, z: 0, elapsedSec: 0, distanceKm: 0 };
    const finish = this.route[this.route.length - 1] ?? start;
    this.markerGroup.add(marker(start, '#34d399', 'START', 12));
    this.markerGroup.add(marker(finish, '#f59e0b', 'FINISH', 14));
    this.addKilometerMarkers();
    this.scene.add(this.markerGroup);

    this.phase.add(
      new THREE.Mesh(
        new THREE.RingGeometry(2.2, 3.1, 40),
        new THREE.MeshBasicMaterial({
          color: '#99f6e4',
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ).rotateX(-Math.PI / 2),
    );
    this.runnerRing = this.phase.children[0] as THREE.Mesh;
    this.scene.add(this.phase);

    this.primary = new RunnerModel(options.primaryLook);
    this.scene.add(this.primary.group);

    this.rival = options.rival ? new RunnerModel(options.rivalLook) : null;
    if (this.rival) this.scene.add(this.rival.group);

    this.rivalRoute = options.rival ? buildRoute(options.rival.timeline, options.diorama) : null;
    this.cameraDirector = new CameraDirector(options.diorama);
    this.cameraPreset = options.preset;

    this.outcome = options.rival
      ? compareRace(options.activity, options.rival, options.primaryLook.name, options.rivalLook.name)
      : null;

    this.primary.setTransform(start.x, 1.15, start.z, 0);
    this.rival?.setTransform(start.x + 2, 1.15, start.z, 0);
    this.primary.setDisplayScale(6);
    this.rival?.setDisplayScale(6);
    this.setOsmBuildings(options.osmBuildings ?? null);
  }

  setOsmBuildings(buildings: OsmBuilding[] | null): void {
    if (this.osmGroup) {
      disposeObjectTree(this.osmGroup);
      this.scene.remove(this.osmGroup);
      this.osmGroup = null;
    }
    if (!buildings || buildings.length === 0) return;
    const mesh = buildOsmBuildingsMesh(buildings, this.options.diorama);
    if (!mesh) return;
    this.osmGroup = new THREE.Group();
    this.osmGroup.name = 'osm-buildings';
    this.osmGroup.add(mesh);
    this.scene.add(this.osmGroup);
  }

  private addKilometerMarkers(): void {
    const total = this.options.activity.totalDistanceKm;
    for (let km = 1; km < total; km++) {
      const point = this.route.find((entry) => entry.distanceKm >= km);
      if (!point) continue;
      const tick = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.5, 20),
        new THREE.MeshBasicMaterial({
          color: '#e0f2fe',
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      tick.rotation.x = -Math.PI / 2;
      tick.position.set(point.x, 1.06, point.z);
      this.markerGroup.add(tick);
    }
  }

  update(frame: SceneUpdate): FrameSnapshot {
    const activity = this.options.activity;
    const point = interpolateActivity(activity.timeline, frame.activityTimeSec);
    const transform = sampleRoute(this.route, frame.activityTimeSec);
    const runnerRunning = frame.phase === 'run';
    const finishPose = frame.phase === 'finish';

    this.primary.setTransform(transform.x, 1.15, transform.z, transform.rotationY);
    this.primary.update(frame.deltaSec, {
      speedMps: runnerRunning ? point.speed : 1.4,
      cadenceSpm: point.cadence,
      running: runnerRunning,
      finishPose,
      playing: frame.playing,
    });

    let rivalPoint: ActivityPoint | null = null;
    if (this.rival && this.options.rival && this.rivalRoute) {
      const rivalActivity = this.options.rival;
      const rivalTime = Math.min(frame.activityTimeSec, rivalActivity.totalDurationSec);
      rivalPoint = interpolateActivity(rivalActivity.timeline, rivalTime);
      const rivalTransform = sampleRoute(this.rivalRoute, rivalTime);
      const sideX = Math.cos(rivalTransform.rotationY);
      const sideZ = -Math.sin(rivalTransform.rotationY);
      const rivalFinished = finishPose || rivalTime >= rivalActivity.totalDurationSec - 0.05;
      const rotation = finishPose ? rivalTransform.rotationY + Math.PI : rivalTransform.rotationY;
      this.rival.setTransform(
        rivalTransform.x + sideX * 1.45,
        1.15,
        rivalTransform.z + sideZ * 1.45,
        rotation,
      );
      this.rival.update(frame.deltaSec, {
        speedMps: runnerRunning ? rivalPoint.speed : 1.4,
        cadenceSpm: rivalPoint.cadence,
        running: runnerRunning && !rivalFinished,
        finishPose,
        playing: frame.playing,
      });
    }

    this.updateRouteProgress(point.distanceKm / Math.max(0.1, activity.totalDistanceKm));
    this.phase.position.set(transform.x, 1.19, transform.z);
    this.runnerRing.rotation.z += frame.deltaSec * 0.8;

    this.cameraDirector.update(this.camera, frame.deltaSec, {
      runnerX: transform.x,
      runnerZ: transform.z,
      runnerRotation: transform.rotationY,
      rivalX: this.rival ? this.rival.group.position.x : undefined,
      rivalZ: this.rival ? this.rival.group.position.z : undefined,
      elapsedSec: frame.activityTimeSec,
      phase: frame.phase,
      introProgress: frame.introProgress,
      finishProgress: frame.finishProgress,
    }, this.cameraPreset);

    const cameraDistance = this.cameraDirector.currentDistance;
    const displayScale = finishPose
      ? 2.05
      : Math.max(2.2, Math.min(55, 1.2 + 0.044 * Math.max(4, cameraDistance)));
    this.primary.setDisplayScale(displayScale);
    this.rival?.setDisplayScale(displayScale);

    if (finishPose) {
      this.primary.faceCamera(this.camera.position);
      this.rival?.faceCamera(this.camera.position);
    }

    return {
      point,
      rivalPoint,
      phase: frame.phase,
      progress: Math.max(0, Math.min(1, frame.progress)),
    };
  }

  updateRunnerLooks(primaryLook: RunnerLook, rivalLook: RunnerLook, outcome: RaceOutcome | null): void {
    this.primary.updateBib(primaryLook);
    this.rival?.updateBib(rivalLook);
    this.outcome = outcome;
  }

  private updateRouteProgress(fraction: number): void {
    const segments = Math.max(0, this.route.length - 1);
    const completed = Math.max(0, Math.min(1, fraction));
    let index = 0;
    const target = completed * Math.max(0.1, this.options.activity.totalDistanceKm);
    while (index < this.route.length - 1 && this.route[index + 1].distanceKm <= target) index++;
    const visible = Math.min(segments, index + (completed > 0 ? 1 : 0));
    const count = Math.max(0, visible * 6);
    this.progressGeometry.setDrawRange(0, count);
    this.glowGeometry.setDrawRange(0, count);
  }

  setPreset(preset: CameraPreset): void {
    this.cameraPreset = preset;
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    disposeObjectTree(this.scene);
    this.scene.clear();
  }
}
