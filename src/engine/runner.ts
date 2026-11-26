import * as THREE from 'three';
import { disposeObjectTree } from './dispose';
import type { RunnerLook } from './theme';

export interface RunnerAnimation {
  speedMps: number;
  cadenceSpm: number;
  running: boolean;
  finishPose: boolean;
  playing: boolean;
}

interface LegPivots {
  hip: THREE.Group;
  knee: THREE.Group;
}

interface ArmPivots {
  shoulder: THREE.Group;
  elbow: THREE.Group;
}

const SKIN_FALLBACK = '#d9a273';

function mesh(
  geometry: THREE.BufferGeometry,
  color: string,
  options: { roughness?: number; emissive?: string; emissiveIntensity?: number } = {},
): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.62,
    metalness: 0.04,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  return new THREE.Mesh(geometry, material);
}

function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(2,6,23,0.55)');
    gradient.addColorStop(0.55, 'rgba(2,6,23,0.28)');
    gradient.addColorStop(1, 'rgba(2,6,23,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function bibTexture(look: RunnerLook): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(2, 6, 23, 0.86)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 164, 34);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.stroke();
    ctx.fillStyle = look.jerseyColor;
    ctx.beginPath();
    ctx.roundRect(24, 24, 464, 52, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 26px system-ui, sans-serif';
    ctx.fillText('JEJAKLARI RUNNER', 256, 51);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 58px system-ui, sans-serif';
    ctx.fillText(look.name.trim().toUpperCase().slice(0, 14) || 'RUNNER', 256, 112);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '800 28px system-ui, sans-serif';
    ctx.fillText(`BIB #${look.bib || '0000'}`, 256, 152);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class RunnerModel {
  readonly group = new THREE.Group();

  private readonly shadow: THREE.Mesh;
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly bib: THREE.Sprite;
  private bibTexture: THREE.CanvasTexture;
  private readonly legs: [LegPivots, LegPivots];
  private readonly arms: [ArmPivots, ArmPivots];
  private phase = 0;
  private idle = 0;
  private displayScale = 1;

  constructor(look: RunnerLook) {
    const skin = look.skinColor || SKIN_FALLBACK;
    const female = look.gender === 'female';
    const hairColor = look.hair === 'hijab' ? look.jerseyColor : '#1f2937';
    const jersey = look.jerseyColor;
    const shorts = look.shortsColor;
    const shoe = look.shoeColor;

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.6),
      new THREE.MeshBasicMaterial({
        map: shadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.group.add(this.shadow);

    this.group.add(this.body);

    const hips = mesh(new THREE.SphereGeometry(0.2, 18, 14), shorts, { roughness: 0.8 });
    hips.scale.set(female ? 1.12 : 1.05, female ? 0.72 : 0.7, female ? 0.9 : 0.85);
    hips.position.y = 0.76;
    this.body.add(hips);

    const torso = mesh(new THREE.CapsuleGeometry(0.18, 0.3, 8, 18), jersey, {
      roughness: 0.56,
    });
    torso.position.y = 1.0;
    torso.scale.set(female ? 0.98 : 1.05, 1, female ? 0.78 : 0.82);
    this.body.add(torso);

    const collar = mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 18), '#e2e8f0', {
      roughness: 0.7,
    });
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.19;
    this.body.add(collar);

    this.head.position.y = 1.37;
    this.body.add(this.head);
    const skull = mesh(new THREE.SphereGeometry(0.225, 26, 20), skin, { roughness: 0.7 });
    skull.scale.set(1, 1.02, 0.96);
    this.head.add(skull);

    const eyeGeometry = new THREE.SphereGeometry(0.026, 12, 10);
    for (const side of [-1, 1]) {
      const eye = mesh(eyeGeometry, '#0f172a', { roughness: 0.25 });
      eye.position.set(side * 0.078, 0.03, 0.207);
      this.head.add(eye);
    }
    const mouth = mesh(new THREE.CapsuleGeometry(0.012, 0.035, 4, 8), '#92400e', {
      roughness: 0.8,
    });
    mouth.rotation.z = Math.PI / 2;
    mouth.position.set(0, -0.07, 0.212);
    this.head.add(mouth);

    this.addHair(look, hairColor);
    this.addAccessory(look, jersey);

    const legHip = new THREE.Group();
    legHip.position.set(0, 0.76, 0);
    this.body.add(legHip);
    this.legs = [
      this.buildLeg(legHip, female ? -0.085 : -0.095, shorts, skin, shoe),
      this.buildLeg(legHip, female ? 0.085 : 0.095, shorts, skin, shoe),
    ];

    const shoulder = new THREE.Group();
    shoulder.position.y = 1.12;
    this.body.add(shoulder);
    this.arms = [
      this.buildArm(shoulder, female ? -0.21 : -0.235, jersey, skin),
      this.buildArm(shoulder, female ? 0.21 : 0.235, jersey, skin),
    ];

    this.bibTexture = bibTexture(look);
    this.bib = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.bibTexture, transparent: true, depthWrite: false }),
    );
    this.bib.scale.set(1.05, 0.37, 1);
    this.bib.position.y = 2.18;
    this.group.add(this.bib);
  }

  private buildLeg(
    parent: THREE.Group,
    x: number,
    shorts: string,
    skin: string,
    shoe: string,
  ): LegPivots {
    const hip = new THREE.Group();
    hip.position.set(x, 0, 0);
    parent.add(hip);

    const thigh = mesh(new THREE.CapsuleGeometry(0.077, 0.2, 8, 14), shorts, {
      roughness: 0.8,
    });
    thigh.position.y = -0.15;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.33;
    hip.add(knee);

    const calf = mesh(new THREE.CapsuleGeometry(0.062, 0.18, 8, 14), skin, {
      roughness: 0.72,
    });
    calf.position.y = -0.15;
    knee.add(calf);

    const sock = mesh(new THREE.CylinderGeometry(0.066, 0.058, 0.09, 14), '#f8fafc', {
      roughness: 0.85,
    });
    sock.position.y = -0.27;
    knee.add(sock);

    const foot = mesh(new THREE.BoxGeometry(0.115, 0.075, 0.23), shoe, { roughness: 0.5 });
    foot.position.set(0, -0.325, 0.04);
    knee.add(foot);

    return { hip, knee };
  }

  private buildArm(
    parent: THREE.Group,
    x: number,
    jersey: string,
    skin: string,
  ): ArmPivots {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, 0, 0);
    parent.add(shoulder);

    const sleeve = mesh(new THREE.CapsuleGeometry(0.062, 0.12, 8, 12), jersey, {
      roughness: 0.6,
    });
    sleeve.position.y = -0.08;
    shoulder.add(sleeve);

    const elbow = new THREE.Group();
    elbow.position.y = -0.2;
    shoulder.add(elbow);

    const forearm = mesh(new THREE.CapsuleGeometry(0.052, 0.14, 8, 12), skin, {
      roughness: 0.72,
    });
    forearm.position.y = -0.1;
    elbow.add(forearm);

    const hand = mesh(new THREE.SphereGeometry(0.058, 12, 10), skin, { roughness: 0.68 });
    hand.position.y = -0.2;
    elbow.add(hand);

    return { shoulder, elbow };
  }

  private addHair(look: RunnerLook, hairColor: string): void {
    const cap = mesh(new THREE.SphereGeometry(0.235, 24, 18), hairColor, { roughness: 0.82 });
    cap.scale.set(1.02, 0.85, 1.02);
    cap.position.y = 0.055;
    this.head.add(cap);

    const style = look.hair;
    if (style === 'undercut' || style === 'sidefade') {
      const front = mesh(new THREE.BoxGeometry(0.33, 0.1, 0.11), hairColor, { roughness: 0.82 });
      front.position.set(0, 0.135, 0.19);
      front.rotation.x = -0.24;
      this.head.add(front);
      for (const side of [-1, 1]) {
        const fade = mesh(
          new THREE.BoxGeometry(0.05, style === 'sidefade' ? 0.13 : 0.16, 0.24),
          hairColor,
          { roughness: 0.82 },
        );
        fade.position.set(side * 0.205, style === 'sidefade' ? -0.045 : -0.02, -0.05);
        fade.rotation.z = side * 0.06;
        this.head.add(fade);
      }
    }
    if (style === 'spiky') {
      for (let i = 0; i < 5; i++) {
        const spike = mesh(new THREE.ConeGeometry(0.06, 0.16, 8), hairColor, {
          roughness: 0.78,
        });
        const angle = (i / 5) * Math.PI * 2;
        spike.position.set(Math.cos(angle) * 0.12, 0.19, Math.sin(angle) * 0.1 - 0.01);
        spike.rotation.z = Math.cos(angle) * 0.35;
        spike.rotation.x = Math.sin(angle) * 0.3;
        this.head.add(spike);
      }
    }
    if (style === 'bob' || style === 'twintails') {
      const bob = mesh(new THREE.CapsuleGeometry(0.2, 0.02, 8, 18), hairColor, {
        roughness: 0.82,
      });
      bob.scale.set(1, 1.05, 0.9);
      bob.position.set(0, -0.06, -0.06);
      this.head.add(bob);
      const fringe = mesh(new THREE.BoxGeometry(0.36, 0.09, 0.09), hairColor, {
        roughness: 0.82,
      });
      fringe.position.set(0, 0.13, 0.2);
      this.head.add(fringe);
      if (style === 'twintails') {
        for (const side of [-1, 1]) {
          const tail = mesh(new THREE.CapsuleGeometry(0.06, 0.32, 8, 12), hairColor, {
            roughness: 0.82,
          });
          tail.position.set(side * 0.25, -0.18, -0.05);
          tail.rotation.z = side * 0.24;
          this.head.add(tail);
        }
      }
    }
    if (style === 'hijab') {
      const hijab = mesh(new THREE.SphereGeometry(0.25, 24, 18), hairColor, {
        roughness: 0.9,
      });
      hijab.scale.set(1.03, 1.06, 0.92);
      hijab.position.set(0, 0.01, -0.07);
      this.head.add(hijab);
      const drape = mesh(new THREE.CapsuleGeometry(0.16, 0.16, 8, 16), hairColor, {
        roughness: 0.9,
      });
      drape.scale.set(1.1, 1, 0.7);
      drape.position.set(0, -0.28, -0.02);
      this.head.add(drape);
    }
  }

  private addAccessory(look: RunnerLook, accent: string): void {
    const accessory = look.accessory;
    if (accessory === 'cap') {
      const top = mesh(new THREE.CylinderGeometry(0.235, 0.245, 0.09, 24), accent, {
        roughness: 0.55,
      });
      top.position.y = 0.24;
      top.scale.z = 0.92;
      this.head.add(top);
      const brim = mesh(new THREE.BoxGeometry(0.34, 0.035, 0.2), accent, { roughness: 0.5 });
      brim.position.set(0, 0.2, 0.21);
      brim.rotation.x = -0.12;
      this.head.add(brim);
    }
    if (accessory === 'headband') {
      const band = mesh(new THREE.TorusGeometry(0.228, 0.032, 10, 26), accent, {
        roughness: 0.5,
      });
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.1;
      this.head.add(band);
    }
    if (accessory === 'visor') {
      const brim = mesh(new THREE.BoxGeometry(0.38, 0.03, 0.2), '#ffffff', {
        roughness: 0.35,
      });
      brim.position.set(0, 0.16, 0.21);
      brim.rotation.x = -0.1;
      this.head.add(brim);
      const band = mesh(new THREE.TorusGeometry(0.228, 0.022, 8, 24), accent, {
        roughness: 0.5,
      });
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.12;
      this.head.add(band);
    }
    if (accessory === 'trail') {
      const vest = mesh(new THREE.BoxGeometry(0.3, 0.24, 0.2), '#111827', {
        roughness: 0.9,
      });
      vest.position.set(0, 1.02, -0.02);
      vest.scale.z = 0.9;
      this.body.add(vest);
      for (const side of [-1, 1]) {
        const strap = mesh(new THREE.BoxGeometry(0.055, 0.3, 0.05), accent, {
          roughness: 0.6,
        });
        strap.position.set(side * 0.12, 1.05, 0.15);
        this.body.add(strap);
      }
      const lamp = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), '#fef9c3', {
        emissive: '#fef08a',
        emissiveIntensity: 2.4,
        roughness: 0.3,
      });
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(0, 1.18, 0.2);
      this.body.add(lamp);
    }
    if (accessory === 'cat_ears' || accessory === 'bunny_ears') {
      for (const side of [-1, 1]) {
        const ear =
          accessory === 'cat_ears'
            ? mesh(new THREE.ConeGeometry(0.07, 0.17, 8), '#1f2937', { roughness: 0.85 })
            : mesh(new THREE.CapsuleGeometry(0.04, 0.24, 6, 10), '#1f2937', { roughness: 0.85 });
        ear.position.set(side * 0.13, accessory === 'cat_ears' ? 0.27 : 0.32, -0.02);
        ear.rotation.z = side * (accessory === 'cat_ears' ? 0.25 : 0.15);
        this.head.add(ear);
        if (accessory === 'cat_ears') {
          const inner = mesh(new THREE.ConeGeometry(0.04, 0.1, 8), '#f9a8d4', {
            roughness: 0.75,
          });
          inner.position.set(side * 0.13, 0.27, 0.01);
          inner.rotation.z = side * 0.25;
          this.head.add(inner);
        }
      }
    }
  }

  updateBib(look: RunnerLook): void {
    const nextTexture = bibTexture(look);
    const material = this.bib.material as THREE.SpriteMaterial;
    material.map = nextTexture;
    material.needsUpdate = true;
    const previous = this.bibTexture;
    this.bibTexture = nextTexture;
    previous.dispose();
  }

  update(dt: number, animation: RunnerAnimation): void {
    const stepsPerSecond = Math.max(0, animation.cadenceSpm) / 60;
    const phaseSpeed = stepsPerSecond * Math.PI;
    if (animation.playing) this.idle += dt;
    if (animation.playing && animation.running) this.phase += dt * phaseSpeed;

    const swing = Math.sin(this.phase);
    const amplitude = animation.finishPose ? 0.12 : 0.42 + Math.min(0.4, animation.speedMps * 0.075);
    const kneeLift = animation.finishPose ? 0.1 : 0.9;

    const [leftLeg, rightLeg] = this.legs;
    const [leftArm, rightArm] = this.arms;

    if (animation.finishPose) {
      for (const leg of this.legs) {
        leg.hip.rotation.x = 0;
        leg.knee.rotation.x = 0;
        leg.hip.rotation.z = leg === leftLeg ? 0.08 : -0.08;
      }
      for (const arm of this.arms) {
        arm.shoulder.rotation.x = -2.65;
        arm.shoulder.rotation.z = arm === leftArm ? -0.38 : 0.38;
        arm.elbow.rotation.x = -0.25;
      }
      this.body.position.y = 0.04 + Math.sin(this.idle * 4) * 0.02;
      this.body.rotation.x = -0.05;
    } else {
      leftLeg.hip.rotation.x = swing * amplitude;
      rightLeg.hip.rotation.x = -swing * amplitude;
      leftLeg.knee.rotation.x = -Math.max(0, -swing) * kneeLift - 0.08;
      rightLeg.knee.rotation.x = -Math.max(0, swing) * kneeLift - 0.08;
      leftLeg.hip.rotation.z = 0;
      rightLeg.hip.rotation.z = 0;

      leftArm.shoulder.rotation.x = -swing * amplitude * 0.85;
      rightArm.shoulder.rotation.x = swing * amplitude * 0.85;
      leftArm.shoulder.rotation.z = -0.08;
      rightArm.shoulder.rotation.z = 0.08;
      leftArm.elbow.rotation.x = -0.65 - Math.max(0, swing) * 0.35;
      rightArm.elbow.rotation.x = -0.65 - Math.max(0, -swing) * 0.35;

      this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.035;
      this.body.rotation.x = 0.06 + Math.min(0.12, animation.speedMps * 0.012);
      this.head.rotation.x = -0.04;
    }

    this.group.scale.setScalar(this.displayScale);
    this.bib.visible = !animation.finishPose;
  }

  setTransform(x: number, y: number, z: number, rotationY: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = rotationY;
  }

  setDisplayScale(scale: number): void {
    this.displayScale = Math.max(1, scale);
  }

  faceCamera(cameraPosition: THREE.Vector3): void {
    const dx = cameraPosition.x - this.group.position.x;
    const dz = cameraPosition.z - this.group.position.z;
    this.group.rotation.y = Math.atan2(dx, dz);
  }

  dispose(): void {
    disposeObjectTree(this.group);
  }
}
