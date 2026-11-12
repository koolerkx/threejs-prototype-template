import {
  ACESFilmicToneMapping, AgXToneMapping, DirectionalLight, GridHelper, HemisphereLight, Mesh, NeutralToneMapping,
  NoToneMapping, PlaneGeometry, RenderPipeline, Scene, ShadowMaterial, Vector3,
  type Material, type Node, type PerspectiveCamera, type ToneMapping, type WebGPURenderer,
} from 'three/webgpu';
import {
  diffuseColor, packNormalToRGB, emissive, float, floor, metalness, mrt, normalView, output, pass, roughness, uv, vec3, vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { BACKDROPS, BackdropLibrary, backdropIntensity, type Backdrop, type BackdropOptions } from './backdrops';
import { DEFAULT_HDRI, HDRI_NAMES } from './hdri';
import { createParamState, type ParamState, type ParamValues } from './params';
import { DEG2RAD } from './units';

// Engine-like default stage: one sun (directional light), a sky light (IBL), a backdrop, tone mapping and bloom.
// The defaults stay close to a fresh UE5 / Unity URP scene so a look transfers without relighting.

/** Buffer visualisation modes, like UE's View Mode → Buffer Visualization. */
export const VIEW_MODES = ['lit', 'baseColor', 'normal', 'roughness', 'metallic', 'emissive', 'uv', 'depth', 'wireframe'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const STAGE_SCHEMA = {
  view: { type: 'select', value: 'lit', options: VIEW_MODES, label: 'View mode', hint: 'Buffer visualisation (UE: View Mode). Key V cycles, Shift+V back.' },
  backdrop: { type: 'select', value: 'none', options: BACKDROPS, label: 'Backdrop', hint: 'none | stage (cyclorama) | sky | space | outdoor (sky + ground) | hdri' },
  hdri: { type: 'select', value: DEFAULT_HDRI, options: HDRI_NAMES, label: 'HDRI', hint: 'Files in src/assets/hdri/ (backdrop "hdri")' },
  hdriRotationDeg: { type: 'number', value: 0, min: -180, max: 180, step: 1, unit: 'deg', label: 'HDRI rotation' },
  hdriBlur: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'HDRI blur' },
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
  depthRange: { type: 'number', value: 20, min: 1, max: 200, step: 1, unit: 'm', label: 'Depth view range', hint: 'Distance shown as white in the depth view' },
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
const SHADOW_EXTENT = 8; // m, half size of the shadow camera
const SKY_ENV_DELAY_MS = 150; // debounce for re-baking the sky IBL while dragging the sun
const UV_CHECKER_CELLS = 8;

/** Views that show colours keep the sRGB output transform (without tone mapping); data views show raw values. */
const COLOR_VIEWS = new Set<ViewMode>(['lit', 'wireframe', 'baseColor', 'emissive']);

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
  private outputKey = '';
  private envKey = '';
  private envTimer = 0;
  private readonly focus = new Vector3();
  private readonly sunDirection = new Vector3(0, 1, 0);
  private readonly wireframeRestore = new Map<Material, boolean>();

  constructor(private readonly renderer: WebGPURenderer, camera: PerspectiveCamera) {
    this.state = createParamState(STAGE_SCHEMA);
    this.backdrops = new BackdropLibrary(renderer, () => this.apply());

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    Object.assign(this.sun.shadow.camera, { left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 0.1, far: 30 });
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.shadowCatcher = new Mesh(new PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new ShadowMaterial({ opacity: 0.35 }));
    this.shadowCatcher.receiveShadow = true;
    this.grid.position.y = 0.002; // above the shadow catcher and the stage floor disc
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
    const view = v.view as ViewMode;

    // Tone mapping only for the shaded image; buffer views show unmapped values.
    r.toneMapping = view === 'lit' || view === 'wireframe' ? TONE_MAPPINGS[v.toneMapping] : NoToneMapping;
    r.toneMappingExposure = v.exposure;
    r.shadowMap.enabled = true;

    const elev = v.sunElevationDeg * DEG2RAD;
    const azim = v.sunAzimuthDeg * DEG2RAD;
    this.sunDirection.set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim));
    this.placeSun();
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
    const opts: BackdropOptions = {
      background: v.background, stageColor: v.stageColor, sunDirection: this.sunDirection.clone(), hdri: v.hdri, hdriBlur: v.hdriBlur,
    };
    this.scene.backgroundBlurriness = 0;
    next.apply(this.scene, opts);
    const rot = v.backdrop === 'hdri' ? v.hdriRotationDeg * DEG2RAD : 0;
    this.scene.backgroundRotation.set(0, rot, 0);
    this.scene.environmentRotation.set(0, rot, 0);
    this.updateEnvironment(next, opts);

    backdropIntensity.value = v.backdropIntensity;
    this.hemi.intensity = v.environment === 'hemisphere' ? v.envIntensity : 0;
    this.scene.environmentIntensity = v.envIntensity;
    this.shadowCatcher.visible = v.ground && v.shadows && !next.hasGround;
    this.grid.visible = v.grid;

    this.updateOutput(view, v.bloom);
    this.applyWireframe(view === 'wireframe');
  }

  /** Re-applies per-material view state (wireframe) after an experiment (re)loads. */
  refreshView(): void {
    this.wireframeRestore.clear();
    this.applyWireframe(this.state.values.view === 'wireframe');
  }

  render(): void {
    this.pipeline.render();
  }

  /** Centres the sun's shadow camera on the orbit target, so shadows stay valid wherever the view goes. */
  setFocus(target: Vector3): void {
    if (this.focus.distanceToSquared(target) < 1e-6) return;
    this.focus.copy(target);
    this.placeSun();
  }

  private placeSun(): void {
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.sunDirection).multiplyScalar(SUN_DISTANCE).add(this.focus);
  }

  /** Builds the pipeline output for the view mode; buffer views render material properties through MRT. */
  private updateOutput(view: ViewMode, bloomOn: boolean): void {
    const key = `${view}|${bloomOn}`;
    if (key === this.outputKey) return;
    this.outputKey = key;

    const usesMrt = !COLOR_VIEWS.has(view) || view === 'baseColor' || view === 'emissive';
    this.scenePass.setMRT(
      usesMrt
        ? mrt({ output, baseColor: diffuseColor, normal: vec4(packNormalToRGB(normalView), 1), rm: vec4(roughness, metalness, 0, 1), emissive: vec4(emissive, 1), uv: vec4(uv(), 0, 1) })
        : null,
    );

    const color = this.scenePass.getTextureNode('output');
    let node: Node;
    switch (view) {
      case 'baseColor':
        node = this.scenePass.getTextureNode('baseColor');
        break;
      case 'normal':
        node = this.scenePass.getTextureNode('normal');
        break;
      case 'roughness':
        node = vec4(vec3(this.scenePass.getTextureNode('rm').x), 1);
        break;
      case 'metallic':
        node = vec4(vec3(this.scenePass.getTextureNode('rm').y), 1);
        break;
      case 'emissive':
        node = this.scenePass.getTextureNode('emissive');
        break;
      case 'uv': {
        const t = this.scenePass.getTextureNode('uv');
        const cell = floor(t.xy.mul(UV_CHECKER_CELLS));
        const checker = cell.x.add(cell.y).mod(2).mul(0.25).add(0.75);
        node = vec4(t.x.mul(checker), t.y.mul(checker), float(0.2).mul(checker), 1);
        break;
      }
      case 'depth': {
        const d = this.scenePass.getViewZNode().negate().div(this.state.uniforms.depthRange).clamp(0, 1);
        node = vec4(vec3(float(1).sub(d)), 1);
        break;
      }
      default:
        node = bloomOn ? color.add(this.bloomPass) : color;
    }
    this.pipeline.outputNode = node;
    this.pipeline.outputColorTransform = COLOR_VIEWS.has(view);
    this.pipeline.needsUpdate = true;
  }

  private applyWireframe(on: boolean): void {
    this.scene.traverse((obj) => {
      const mat = (obj as Mesh).material as Material | Material[] | undefined;
      if (!mat || obj === this.shadowCatcher || this.backdrop?.object.getObjectById(obj.id)) return;
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        const w = m as Material & { wireframe?: boolean };
        if (w.wireframe === undefined) continue;
        if (on && !this.wireframeRestore.has(m)) {
          this.wireframeRestore.set(m, w.wireframe);
          w.wireframe = true;
        }
      }
    });
    if (!on) {
      for (const [m, prev] of this.wireframeRestore) (m as Material & { wireframe: boolean }).wireframe = prev;
      this.wireframeRestore.clear();
    }
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
    const prefix = `${this.state.values.backdrop}|${backdrop.envVersion?.(opts) ?? ''}|`;
    const key = `${prefix}${sunKey}`;
    if (key === this.envKey) return;
    const first = !this.envKey.startsWith(prefix);
    this.envKey = key;
    clearTimeout(this.envTimer);
    const bake = () => {
      this.scene.environment = backdrop.environment(opts);
    };
    if (first) bake();
    else this.envTimer = window.setTimeout(bake, SKY_ENV_DELAY_MS);
  }
}
