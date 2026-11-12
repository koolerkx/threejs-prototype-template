import {
  ACESFilmicToneMapping, AgXToneMapping, DirectionalLight, GridHelper, HemisphereLight, Mesh, NeutralToneMapping,
  NoToneMapping, PlaneGeometry, RenderPipeline, Scene, ShadowMaterial, Vector3,
  type PerspectiveCamera, type ToneMapping, type WebGPURenderer,
} from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { BACKDROPS, BackdropLibrary, backdropIntensity, type Backdrop, type BackdropOptions } from './backdrops';
import { createParamState, type ParamState, type ParamValues } from './params';
import { DEG2RAD } from './units';

// Engine-like default stage: one sun (directional light), a sky light (IBL), a backdrop, tone mapping and bloom.
// The defaults stay close to a fresh UE5 / Unity URP scene so a look transfers without relighting.
export const STAGE_SCHEMA = {
  backdrop: { type: 'select', value: 'none', options: BACKDROPS, label: 'Backdrop', hint: 'none | stage (cyclorama) | sky | space | outdoor (sky + ground)' },
  environment: { type: 'select', value: 'backdrop', options: ['backdrop', 'studio', 'hemisphere', 'none'], label: 'Sky light', hint: 'backdrop = IBL from the backdrop; studio = RoomEnvironment; hemisphere = flat sky/ground fill' },
  envIntensity: { type: 'number', value: 1, min: 0, max: 3, step: 0.01, label: 'Sky intensity' },
  sunIntensity: { type: 'number', value: 3, min: 0, max: 10, step: 0.01, label: 'Sun intensity' },
  sunColor: { type: 'color', value: '#ffffff', label: 'Sun color' },
  sunElevationDeg: { type: 'number', value: 45, min: -10, max: 90, step: 1, unit: 'deg', label: 'Sun elevation' },
  sunAzimuthDeg: { type: 'number', value: 35, min: -180, max: 180, step: 1, unit: 'deg', label: 'Sun azimuth' },
  shadows: { type: 'boolean', value: true, label: 'Shadows' },
  ground: { type: 'boolean', value: true, label: 'Shadow catcher', hint: 'Invisible plane at y = 0 that only shows shadows (backdrops without ground)' },
  grid: { type: 'boolean', value: true, label: 'Grid (1 m)' },
  background: { type: 'color', value: '#202328', label: 'Background', hint: 'Backdrop "none"' },
  stageColor: { type: 'color', value: '#aeb1b8', label: 'Stage color', hint: 'Backdrop "stage"' },
  backdropIntensity: { type: 'number', value: 1, min: 0, max: 3, step: 0.01, label: 'Backdrop intensity', hint: 'Visible sky / space brightness; the IBL uses Sky intensity' },
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
const SKY_ENV_DELAY_MS = 150; // debounce for re-baking the sky IBL while dragging the sun

export class Stage {
  readonly scene = new Scene();
  readonly state: ParamState<StageSchema>;
  readonly pipeline: RenderPipeline;

  private readonly sun = new DirectionalLight();
  private readonly hemi = new HemisphereLight(0xdfe8ff, 0x3a3530, 0);
  private readonly shadowCatcher: Mesh;
  private readonly grid = new GridHelper(20, 20, 0x5a5f68, 0x3a3e45);
  private readonly backdrops: BackdropLibrary;
  private readonly scenePass;
  private readonly bloomPass;
  private backdrop: Backdrop | null = null;
  private bloomOn: boolean | undefined;
  private envKey = '';
  private envTimer = 0;

  constructor(private readonly renderer: WebGPURenderer, camera: PerspectiveCamera) {
    this.state = createParamState(STAGE_SCHEMA);
    this.backdrops = new BackdropLibrary(renderer);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    Object.assign(this.sun.shadow.camera, { left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 0.1, far: 30 });
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.shadowCatcher = new Mesh(new PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new ShadowMaterial({ opacity: 0.35 }));
    this.shadowCatcher.receiveShadow = true;
    this.grid.position.y = 0.002; // above the shadow catcher and the stage pedestal
    this.scene.add(this.shadowCatcher, this.grid);

    this.scenePass = pass(this.scene, camera);
    const s = this.state.uniforms;
    this.bloomPass = bloom(this.scenePass.getTextureNode('output'), s.bloomStrength, s.bloomRadius, s.bloomThreshold);
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

    const elev = v.sunElevationDeg * DEG2RAD;
    const azim = v.sunAzimuthDeg * DEG2RAD;
    const sunDirection = new Vector3(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim));
    this.sun.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
    this.sun.intensity = v.sunIntensity;
    this.sun.color.set(v.sunColor);
    this.sun.castShadow = v.shadows;

    // Backdrop: swap the set and apply its background / fog.
    const next = this.backdrops.get(v.backdrop);
    if (next !== this.backdrop) {
      this.backdrop?.object.removeFromParent();
      this.scene.add(next.object);
      this.backdrop = next;
    }
    const opts: BackdropOptions = { background: v.background, stageColor: v.stageColor, sunDirection };
    next.apply(this.scene, opts);
    this.updateEnvironment(next, opts);

    backdropIntensity.value = v.backdropIntensity;
    this.hemi.intensity = v.environment === 'hemisphere' ? v.envIntensity : 0;
    this.scene.environmentIntensity = v.envIntensity;
    this.shadowCatcher.visible = v.ground && v.shadows && !next.hasGround;
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

  private updateEnvironment(backdrop: Backdrop, opts: BackdropOptions): void {
    const mode = this.state.values.environment;
    if (mode === 'none' || mode === 'hemisphere') {
      this.scene.environment = null;
      this.envKey = mode;
      return;
    }
    if (mode === 'studio') {
      this.scene.environment = this.backdrops.studioEnvironment;
      this.envKey = mode;
      return;
    }
    // 'backdrop': sky-based backdrops re-bake when the sun moves (debounced while dragging).
    const sunKey = backdrop.usesSun ? opts.sunDirection.toArray().map((n) => n.toFixed(3)).join(',') : '';
    const key = `${this.state.values.backdrop}|${sunKey}`;
    if (key === this.envKey) return;
    const first = !this.envKey.startsWith(`${this.state.values.backdrop}|`);
    this.envKey = key;
    clearTimeout(this.envTimer);
    const bake = () => {
      this.scene.environment = backdrop.environment(opts);
    };
    if (first) bake();
    else this.envTimer = window.setTimeout(bake, SKY_ENV_DELAY_MS);
  }
}
