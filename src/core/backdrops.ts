import {
  BackSide, BufferGeometry, CircleGeometry, Color, CylinderGeometry, Float32BufferAttribute, Fog, Group, Mesh,
  MeshBasicNodeMaterial, MeshStandardNodeMaterial, PMREMGenerator, Scene, SphereGeometry, Vector3,
  type Node, type Texture, type WebGPURenderer,
} from 'three/webgpu';
import {
  abs, dot, float, floor, fract, max, mix, mx_noise_float, normalize, positionWorld, positionLocal, pow, smoothstep, sin, uniform,
  vec3, vec4,
} from 'three/tsl';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

// Backdrops are what surrounds an experiment: background, sky light (IBL) and optional set geometry.
// Each maps to a typical engine setup so a look can be judged in context:
//   none    - solid color + neutral studio IBL (UE/Unity empty level with a sky light cubemap)
//   stage   - minimalist product stage: seamless cyclorama and a pedestal, studio IBL
//   sky     - physical sky (Preetham, like UE SkyAtmosphere / Unity procedural skybox), IBL from the sky
//   space   - starfield and faint nebula dome, dark IBL from the dome
//   outdoor - physical sky + ground plane and horizon fog
export const BACKDROPS = ['none', 'stage', 'sky', 'space', 'outdoor'] as const;
export type BackdropName = (typeof BACKDROPS)[number];

export interface BackdropOptions {
  background: string;
  stageColor: string;
  sunDirection: Vector3;
}

export interface Backdrop {
  readonly object: Group;
  /** Hide the shadow catcher plane when the backdrop has its own shadow-receiving ground. */
  readonly hasGround: boolean;
  readonly usesSun: boolean;
  /** Re-renders the IBL; called when the sun direction changes for sky-based backdrops. */
  environment(opts: BackdropOptions): Texture | null;
  apply(scene: Scene, opts: BackdropOptions): void;
  dispose(): void;
}

const SKY_RADIUS = 400; // m, inside the camera far plane
const ENV_SIGMA = 0.04;
// The Preetham sky outputs very high HDR values (sun intensity 1000). Scale it so the default sun (3) and
// exposure (1) give a balanced image, as a UE SkyAtmosphere does with a physical sun and fixed exposure.
const SKY_SCALE = 0.12;

/** Brightness of the visible backdrop (sky, space dome). The baked IBL ignores it; use `envIntensity` for that. */
export const backdropIntensity = uniform(1);

function disposeGroup(group: Group): void {
  group.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose();
    (m.material as { dispose?: () => void } | undefined)?.dispose?.();
  });
}

/** Seamless studio backdrop: floor -> quarter-circle cove -> back wall, swept along X. */
function createCycloramaGeometry(): BufferGeometry {
  const halfWidth = 20;
  const coveRadius = 4;
  const floorFront = 12;
  const floorBack = -6;
  const wallTop = 14;
  const profile: [number, number][] = [[floorFront, 0], [floorBack, 0]];
  const arcSteps = 24;
  for (let i = 1; i <= arcSteps; i++) {
    const a = (i / arcSteps) * (Math.PI / 2);
    profile.push([floorBack - Math.sin(a) * coveRadius, coveRadius - Math.cos(a) * coveRadius]);
  }
  profile.push([floorBack - coveRadius, wallTop]);

  const positions: number[] = [];
  const indices: number[] = [];
  profile.forEach(([z, y]) => positions.push(-halfWidth, y, z, halfWidth, y, z));
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Procedural starfield + nebula on the view direction. Unlit; values above 1 feed bloom. */
function createSpaceMaterial(intensity: Node<'float'> | number): MeshBasicNodeMaterial {
  const dir = normalize(positionLocal);
  // Stars: one candidate per cell of a 3D grid on the direction, kept when its hash is above a threshold.
  const cell = floor(dir.mul(220));
  const h = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
  const local = fract(dir.mul(220)).sub(0.5);
  const twinkleSize = float(0.08).add(h.mul(0.12));
  const star = smoothstep(twinkleSize, 0, local.length()).mul(smoothstep(0.985, 1, h)).mul(h.mul(6));
  // Nebula: two noise octaves tinted between violet and teal, faded toward the poles.
  const n1 = mx_noise_float(dir.mul(2.2)).mul(0.5).add(0.5);
  const n2 = mx_noise_float(dir.mul(5.5).add(7.3)).mul(0.5).add(0.5);
  const cloud = pow(max(n1.mul(n2).mul(1.6).sub(0.25), 0), 1.6).mul(float(1).sub(abs(dir.y).mul(0.6)));
  const nebula = mix(vec3(0.09, 0.03, 0.2), vec3(0.02, 0.18, 0.24), n2).mul(cloud).mul(1.4);
  const base = vec3(0.004, 0.005, 0.012);

  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  material.colorNode = base.add(nebula).add(vec3(star)).mul(intensity);
  return material;
}

/** Large ground disc with noise-varied grass and dirt; receives shadows. */
function createOutdoorGround(): Mesh {
  const material = new MeshStandardNodeMaterial();
  const p = positionWorld.xz;
  const large = mx_noise_float(p.mul(0.08)).mul(0.5).add(0.5);
  const small = mx_noise_float(p.mul(1.7)).mul(0.5).add(0.5);
  const grass = mix(vec3(0.16, 0.24, 0.07), vec3(0.24, 0.31, 0.1), small);
  const dirt = vec3(0.27, 0.21, 0.14);
  material.colorNode = mix(grass, dirt, smoothstep(0.62, 0.72, large));
  material.roughnessNode = float(0.95);
  const ground = new Mesh(new CircleGeometry(SKY_RADIUS * 0.9, 96).rotateX(-Math.PI / 2), material);
  ground.receiveShadow = true;
  return ground;
}

function createSky(scale: Node<'float'> | number): SkyMesh {
  const sky = new SkyMesh();
  const k = typeof scale === 'number' ? float(scale) : scale;
  sky.material.colorNode = (sky.material.colorNode as Node<'vec4'>).mul(vec4(k, k, k, 1));
  sky.scale.setScalar(SKY_RADIUS);
  sky.turbidity.value = 4;
  sky.rayleigh.value = 1.5;
  sky.mieCoefficient.value = 0.005;
  sky.mieDirectionalG.value = 0.8;
  sky.cloudSpeed.value = 0; // SkyMesh animates clouds with the global TSL time; keep captures deterministic
  sky.material.fog = false;
  return sky;
}

export class BackdropLibrary {
  private readonly pmrem: PMREMGenerator;
  private readonly roomEnv: Texture;
  private skyEnv: Texture | null = null;
  private readonly cache = new Map<BackdropName, Backdrop>();

  constructor(private readonly renderer: WebGPURenderer) {
    this.pmrem = new PMREMGenerator(renderer);
    this.roomEnv = this.pmrem.fromScene(new RoomEnvironment(), ENV_SIGMA).texture;
  }

  get studioEnvironment(): Texture {
    return this.roomEnv;
  }

  get(name: BackdropName): Backdrop {
    let b = this.cache.get(name);
    if (!b) {
      b = this.create(name);
      this.cache.set(name, b);
    }
    return b;
  }

  private create(name: BackdropName): Backdrop {
    const object = new Group();
    object.name = `backdrop:${name}`;
    const room = this.roomEnv;

    switch (name) {
      case 'none':
        return {
          object, hasGround: false, usesSun: false,
          environment: () => room,
          apply: (scene, o) => { scene.background = new Color(o.background); scene.fog = null; },
          dispose: () => {},
        };

      case 'stage': {
        const material = new MeshStandardNodeMaterial({ roughness: 0.85 });
        const cyc = new Mesh(createCycloramaGeometry(), material);
        cyc.position.y = -0.08;
        cyc.receiveShadow = true;
        const pedestal = new Mesh(new CylinderGeometry(1.2, 1.25, 0.08, 96), new MeshStandardNodeMaterial({ roughness: 0.6 }));
        pedestal.position.y = -0.04; // top surface at y = 0
        pedestal.receiveShadow = true;
        pedestal.castShadow = true;
        object.add(cyc, pedestal);
        return {
          object, hasGround: true, usesSun: false,
          environment: () => room,
          apply: (scene, o) => {
            material.color.set(o.stageColor);
            (pedestal.material as MeshStandardNodeMaterial).color.set(o.stageColor).multiplyScalar(0.92);
            scene.background = new Color(o.stageColor);
            scene.fog = null;
          },
          dispose: () => disposeGroup(object),
        };
      }

      case 'sky':
      case 'outdoor': {
        const sky = createSky(backdropIntensity.mul(SKY_SCALE));
        object.add(sky);
        const outdoor = name === 'outdoor';
        if (outdoor) object.add(createOutdoorGround());
        const fog = new Fog(0xb9c9d6, 40, SKY_RADIUS * 0.8);
        return {
          object, hasGround: outdoor, usesSun: true,
          environment: (o) => this.renderSkyEnvironment(o.sunDirection),
          apply: (scene, o) => {
            sky.sunPosition.value.copy(o.sunDirection);
            scene.background = null;
            scene.fog = outdoor ? fog : null;
          },
          dispose: () => disposeGroup(object),
        };
      }

      case 'space': {
        const dome = new Mesh(new SphereGeometry(SKY_RADIUS, 64, 32), createSpaceMaterial(backdropIntensity));
        dome.userData.shadow = false;
        object.add(dome);
        let env: Texture | null = null;
        return {
          object, hasGround: false, usesSun: false,
          environment: () => {
            if (!env) {
              const envScene = new Scene();
              const envDome = new Mesh(new SphereGeometry(10, 64, 32), createSpaceMaterial(1));
              envScene.add(envDome);
              env = this.pmrem.fromScene(envScene, ENV_SIGMA, 0.1, 50).texture;
              envDome.geometry.dispose();
              envDome.material.dispose();
            }
            return env;
          },
          apply: (scene) => { scene.background = null; scene.fog = null; },
          dispose: () => { disposeGroup(object); env?.dispose(); },
        };
      }
    }
  }

  private renderSkyEnvironment(sunDirection: Vector3): Texture {
    const envScene = new Scene();
    const sky = createSky(SKY_SCALE);
    sky.scale.setScalar(10);
    sky.sunPosition.value.copy(sunDirection);
    envScene.add(sky);
    const previous = this.skyEnv;
    this.skyEnv = this.pmrem.fromScene(envScene, ENV_SIGMA, 0.1, 50).texture;
    previous?.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    return this.skyEnv;
  }
}
