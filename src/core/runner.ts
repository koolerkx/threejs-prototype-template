import { Group, type PerspectiveCamera, type UniformNode, type WebGPURenderer } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ExperimentContext, ExperimentInstance, FrameInfo } from './experiment';
import { createParamState, defaultValues, type AnyParamValues, type ParamSchema, type ParamState, type ParamValue } from './params';
import type { RegisteredExperiment } from './registry';
import type { Stage } from './stage';
import { disposeTree } from './dispose';

export interface LoadedExperiment {
  entry: RegisteredExperiment;
  state: ParamState<ParamSchema>;
}

/** Owns the active experiment: load, parameter changes, per-frame update, unload. */
export class ExperimentRunner {
  readonly time: UniformNode<'float'> = uniform(0);
  current: LoadedExperiment | null = null;

  private instance: ExperimentInstance | void = undefined;
  private root: Group | null = null;
  private loading: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly camera: PerspectiveCamera,
    private readonly controls: OrbitControls,
    private readonly stage: Stage,
  ) {}

  /** Called after every load or rebuild (UI refresh). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(entry: RegisteredExperiment, overrides: AnyParamValues = {}, stageOverrides: AnyParamValues = {}, resetView = true): Promise<void> {
    this.loading = this.loading.then(() => this.doLoad(entry, overrides, stageOverrides, resetView)).catch((err) => {
      console.error(`[runner] failed to load "${entry.id}"`, err);
    });
    return this.loading;
  }

  /** Waits for any pending load or rebuild. */
  whenIdle(): Promise<void> {
    return this.loading;
  }

  setParam(key: string, value: ParamValue): void {
    const cur = this.current;
    if (!cur) return;
    const spec = cur.entry.def.params[key];
    if (!spec || !cur.state.set(key, value)) {
      console.warn(`[runner] rejected param ${key}=${String(value)}`);
      return;
    }
    if (spec.rebuild || spec.type === 'select') {
      // Pass the live values object: further set() calls in the same tick land before the queued rebuild runs.
      void this.load(cur.entry, cur.state.values, {}, false);
    } else {
      this.instance?.onParam?.(key, cur.state.values[key]);
    }
  }

  /** Parameters that differ from the defaults (for URLs and preset export). */
  changedParams(): AnyParamValues {
    const cur = this.current;
    if (!cur) return {};
    const defaults = defaultValues(cur.entry.def.params);
    return Object.fromEntries(Object.entries(cur.state.values).filter(([k, v]) => defaults[k] !== v));
  }

  update(frame: FrameInfo): void {
    this.time.value = frame.time;
    this.instance?.update?.(frame);
  }

  private async doLoad(entry: RegisteredExperiment, overrides: AnyParamValues, stageOverrides: AnyParamValues, resetView: boolean): Promise<void> {
    this.unload();
    const { def } = entry;

    if (resetView) {
      this.stage.state.reset();
      for (const [k, v] of Object.entries({ ...def.stage, ...stageOverrides })) this.stage.state.set(k, v as ParamValue);
      this.stage.apply();
      const cam = def.camera ?? { position: [2.5, 1.6, 3.2] as const, target: [0, 0.6, 0] as const };
      this.camera.position.set(...cam.position);
      this.camera.fov = cam.fovDeg ?? 45;
      this.camera.updateProjectionMatrix();
      this.controls.target.set(...cam.target);
      this.controls.update();
    }

    const state = createParamState(def.params, overrides);
    const root = new Group();
    root.name = `experiment:${entry.id}`;
    this.stage.scene.add(root);
    this.root = root;
    this.current = { entry, state };

    const ctx: ExperimentContext<ParamSchema> = {
      renderer: this.renderer,
      camera: this.camera,
      root,
      params: state.values,
      u: state.uniforms,
      time: this.time,
    };
    this.instance = await def.setup(ctx);
    root.traverse((obj) => {
      if ((obj as { isMesh?: boolean }).isMesh && obj.userData.shadow !== false) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    this.listeners.forEach((l) => l());
  }

  private unload(): void {
    try {
      this.instance?.dispose?.();
    } catch (err) {
      console.error('[runner] dispose failed', err);
    }
    this.instance = undefined;
    if (this.root) disposeTree(this.root);
    this.root = null;
    this.current = null;
  }
}
