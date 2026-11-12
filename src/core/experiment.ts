import type { Group, PerspectiveCamera, UniformNode, WebGPURenderer } from 'three/webgpu';
import type { ParamSchema, ParamUniforms, ParamValues } from './params';
import type { StageSettings } from './stage';

/**
 * How much engine work a look needs. The target engines are a purpose, not a hard rule:
 * UE5 and Unity are primary, Godot 4 and a plain DirectX 12 / HLSL renderer are references.
 *
 *  native - built-in material, parameters only
 *           (UE Material Instance on Default Lit, Unity URP/HDRP Lit, Godot StandardMaterial3D, DX12 standard PBR pass)
 *  graph  - one node-graph material, no hand-written shader code
 *           (UE Material Graph, Unity Shader Graph, Godot VisualShader)
 *  code   - needs shader code inside the material
 *           (UE Custom node / .ush, Unity HLSL Custom Function, Godot shader language, DX12 HLSL)
 *  extra  - needs more than one material: extra meshes, particles, post process, render passes, scripts
 */
export type PortTier = 'native' | 'graph' | 'code' | 'extra';
export type EngineId = 'ue' | 'unity' | 'godot' | 'dx12';

export type PortNote = { tier: PortTier; notes?: string[] };
export type PortNotes = Partial<Record<EngineId, PortNote>>;

export type Vec3Tuple = readonly [number, number, number];

export interface FrameInfo {
  /** Seconds since the experiment started; frozen when the page has `?t=`. Use this, not wall-clock time. */
  time: number;
  /** Seconds since the previous frame; 0 when time is frozen. */
  delta: number;
  frame: number;
}

export interface ExperimentContext<S extends ParamSchema> {
  renderer: WebGPURenderer;
  camera: PerspectiveCamera;
  /** Everything the experiment creates goes under this group. The harness disposes it on unload. */
  root: Group;
  /** Live parameter values (read in update()/onParam()). */
  params: ParamValues<S>;
  /** One TSL uniform per number/color/boolean parameter, kept in sync by the harness. */
  u: ParamUniforms<S>;
  /** Deterministic time in seconds as a TSL uniform. Use instead of the TSL `time` node. */
  time: UniformNode<'float'>;
}

export interface ExperimentInstance {
  update?(frame: FrameInfo): void;
  /** Called after a non-rebuild parameter changed; uniforms are already updated. */
  onParam?(key: string, value: unknown): void;
  /** Release anything not under `root` (listeners, render targets, timers). */
  dispose?(): void;
}

export interface ExperimentDef<S extends ParamSchema = ParamSchema> {
  title: string;
  /** One or two sentences: the visual question this experiment answers. */
  description: string;
  tags?: string[];
  port: PortNotes;
  params: S;
  camera?: { position: Vec3Tuple; target: Vec3Tuple; fovDeg?: number };
  /** Stage overrides applied when the experiment loads (lighting, post, background). */
  stage?: Partial<StageSettings>;
  setup(ctx: ExperimentContext<S>): ExperimentInstance | void | Promise<ExperimentInstance | void>;
}

/** Identity helper that keeps parameter literal types for `ctx.params` and `ctx.u`. */
export function defineExperiment<const S extends ParamSchema>(def: ExperimentDef<S>): ExperimentDef<S> {
  return def;
}
