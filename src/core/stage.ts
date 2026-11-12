import {
  ACESFilmicToneMapping, AgXToneMapping, Color, DirectionalLight, GridHelper, Group, HemisphereLight, Mesh,
  NeutralToneMapping, NoToneMapping, PlaneGeometry, PMREMGenerator, RenderPipeline, Scene, ShadowMaterial,
  type PerspectiveCamera, type Texture, type ToneMapping, type WebGPURenderer,
} from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createParamState, type ParamState, type ParamValues } from './params';
import { DEG2RAD } from './units';

// Engine-like default stage: one sun (directional light) plus sky light (IBL), tone mapping, optional bloom.
// The defaults stay close to a fresh UE5 / Unity URP scene so a look transfers without relighting.
export const STAGE_SCHEMA = {
  environment: { type: 'select', value: 'studio', options: ['studio', 'hemisphere', 'none'], label: 'Sky light', hint: 'studio = RoomEnvironment IBL; hemisphere = flat sky/ground fill' },
  envIntensity: { type: 'number', value: 1, min: 0, max: 3, step: 0.01, label: 'Sky intensity' },
  sunIntensity: { type: 'number', value: 3, min: 0, max: 10, step: 0.01, label: 'Sun intensity' },
  sunColor: { type: 'color', value: '#ffffff', label: 'Sun color' },
  sunElevationDeg: { type: 'number', value: 45, min: -10, max: 90, step: 1, unit: 'deg', label: 'Sun elevation' },
  sunAzimuthDeg: { type: 'number', value: 35, min: -180, max: 180, step: 1, unit: 'deg', label: 'Sun azimuth' },
  shadows: { type: 'boolean', value: true, label: 'Shadows' },
  ground: { type: 'boolean', value: true, label: 'Shadow catcher' },
  grid: { type: 'boolean', value: true, label: 'Grid (1 m)' },
  background: { type: 'color', value: '#202328', label: 'Background' },
  toneMapping: { type: 'select', value: 'ACES', options: ['ACES', 'AgX', 'Neutral', 'None'], label: 'Tone mapping', hint: 'ACES ~ UE5 filmic / Unity ACES; Neutral = Khronos PBR Neutral' },
  exposure: { type: 'number', value: 1, min: 0, max: 4, step: 0.01, label: 'Exposure' },
  bloom: { type: 'boolean', value: false, label: 'Bloom' },
  bloomStrength: { type: 'number', value: 0.6, min: 0, max: 3, step: 0.01, label: 'Bloom strength' },
  bloomRadius: { type: 'number', value: 0.4, min: 0, max: 1, step: 0.01, label: 'Bloom radius' },
  bloomThreshold: { type: 'number', value: 0.9, min: 0, max: 2, step: 0.01, label: 'Bloom threshold' },
} as const;

export type StageSchema = typeof STAGE_SCHEMA;
export type StageSettings = ParamValues<StageSchema>;

const TONE_MAPPINGS: Record<StageSettings['toneMapping'], ToneMapping> = {
  ACES: ACESFilmicToneMapping,
  AgX: AgXToneMapping,
  Neutral: NeutralToneMapping,
  None: NoToneMapping,
};

const SUN_DISTANCE = 10; // m
const SHADOW_EXTENT = 4; // m, half size of the shadow camera

export class Stage {
  readonly scene = new Scene();
  readonly state: ParamState<StageSchema>;
  readonly pipeline: RenderPipeline;

  private readonly sun = new DirectionalLight();
  private readonly hemi = new HemisphereLight(0xdfe8ff, 0x3a3530, 0);
  private readonly helpers = new Group();
  private readonly ground: Mesh;
  private readonly grid = new GridHelper(20, 20, 0x5a5f68, 0x3a3e45);
  private readonly roomEnv: Texture;
  private readonly scenePass;
  private readonly bloomPass;
  private bloomOn: boolean | undefined;

  constructor(private readonly renderer: WebGPURenderer, camera: PerspectiveCamera) {
    this.state = createParamState(STAGE_SCHEMA);

    const pmrem = new PMREMGenerator(renderer);
    this.roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    Object.assign(this.sun.shadow.camera, { left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 0.1, far: 30 });
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.ground = new Mesh(new PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new ShadowMaterial({ opacity: 0.35 }));
    this.ground.receiveShadow = true;
    this.grid.position.y = 0.001; // avoid z-fighting with the shadow catcher
    this.helpers.add(this.ground, this.grid);
    this.scene.add(this.helpers);

    this.scenePass = pass(this.scene, camera);
    const color = this.scenePass.getTextureNode('output');
    const s = this.state.uniforms;
    this.bloomPass = bloom(color, s.bloomStrength, s.bloomRadius, s.bloomThreshold);
    this.pipeline = new RenderPipeline(renderer);
    this.apply();
  }

  /** Applies all settings; cheap enough to call on every change. */
  apply(): void {
    const v = this.state.values;
    const r = this.renderer;

    r.toneMapping = TONE_MAPPINGS[v.toneMapping];
    r.toneMappingExposure = v.exposure;
    r.shadowMap.enabled = true;
    this.scene.background = new Color(v.background);

    const useEnv = v.environment === 'studio';
    this.scene.environment = useEnv ? this.roomEnv : null;
    this.scene.environmentIntensity = v.envIntensity;
    this.hemi.intensity = v.environment === 'hemisphere' ? v.envIntensity : 0;

    const elev = v.sunElevationDeg * DEG2RAD;
    const azim = v.sunAzimuthDeg * DEG2RAD;
    this.sun.position.set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim)).multiplyScalar(SUN_DISTANCE);
    this.sun.intensity = v.sunIntensity;
    this.sun.color.set(v.sunColor);
    this.sun.castShadow = v.shadows;

    this.ground.visible = v.ground && v.shadows;
    this.grid.visible = v.grid;

    if (this.bloomOn !== v.bloom) {
      this.bloomOn = v.bloom;
      const color = this.scenePass.getTextureNode('output');
      this.pipeline.outputNode = v.bloom ? color.add(this.bloomPass) : color;
      this.pipeline.needsUpdate = true;
    }
  }

  render(): void {
    this.pipeline.render();
  }
}
