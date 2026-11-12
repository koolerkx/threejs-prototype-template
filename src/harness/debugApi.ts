import type { WebGPURenderer } from 'three/webgpu';
import type { ClockState, ExperimentClock } from '../core/clock';
import type { AnyParamValues, ParamValue } from '../core/params';
import { EXPERIMENTS, findExperiment } from '../core/registry';
import type { ExperimentRunner } from '../core/runner';
import type { Stage } from '../core/stage';

// `window.__proto` is the agent interface: scripts/shot.mjs and browser tools drive the page through it.
// Keep it small, JSON-friendly and stable.

export interface ProtoStats {
  backend: 'webgpu' | 'webgl2';
  experiment: string | null;
  fps: number;
  frame: number;
  drawCalls: number;
  triangles: number;
  errors: number;
}

export interface ProtoApi {
  readonly version: 1;
  ready: boolean;
  errors: string[];
  list(): { id: string; title: string; tags: string[] }[];
  current(): { id: string; params: AnyParamValues; stage: AnyParamValues } | null;
  load(id: string, params?: AnyParamValues, stage?: AnyParamValues): Promise<boolean>;
  setParams(params: AnyParamValues): Promise<void>;
  setStage(stage: AnyParamValues): void;
  /** Reads, and optionally changes, the experiment clock: `time({ paused: true, time: 2.5 })`, `time({ speed: 0.25 })`. */
  time(patch?: Partial<ClockState>): ClockState;
  /** Resolves after `count` rendered frames (lets shaders compile and post settle). */
  frames(count?: number): Promise<void>;
  stats(): ProtoStats;
  /**
   * Renders one frame and returns it as a PNG data URL. `blank` is true when every sampled pixel is identical,
   * which usually means the backend produced no readable image (e.g. WebGPU on a GPU-less headless browser).
   */
  capture(): Promise<{ dataUrl: string; blank: boolean }>;
}

declare global {
  interface Window {
    __proto?: ProtoApi;
  }
}

export interface FrameSignal {
  frame: number;
  fps: number;
  waiters: { until: number; resolve: () => void }[];
}

export function installDebugApi(
  renderer: WebGPURenderer,
  runner: ExperimentRunner,
  stage: Stage,
  clock: ExperimentClock,
  signal: FrameSignal,
  onStageChanged: () => void = () => {},
): ProtoApi {
  const errors: string[] = [];
  const record = (msg: string) => {
    errors.push(msg);
    if (errors.length > 50) errors.shift();
  };
  addEventListener('error', (e) => record(`error: ${e.message}`));
  addEventListener('unhandledrejection', (e) => record(`unhandledrejection: ${String(e.reason)}`));
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    record(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' '));
    origError(...args);
  };

  const backendName = (): ProtoStats['backend'] =>
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

  const api: ProtoApi = {
    version: 1,
    ready: false,
    errors,
    list: () => EXPERIMENTS.map(({ id, def }) => ({ id, title: def.title, tags: def.tags ?? [] })),
    current: () => {
      const cur = runner.current;
      return cur ? { id: cur.entry.id, params: { ...cur.state.values }, stage: { ...stage.state.values } } : null;
    },
    load: async (id, params = {}, stageOverrides = {}) => {
      const entry = findExperiment(id);
      if (!entry) return false;
      await runner.load(entry, params, stageOverrides);
      return true;
    },
    setParams: async (params) => {
      for (const [k, v] of Object.entries(params)) runner.setParam(k, v as ParamValue);
      await runner.whenIdle();
    },
    setStage: (overrides) => {
      for (const [k, v] of Object.entries(overrides)) stage.state.set(k, v as ParamValue);
      stage.apply();
      onStageChanged();
    },
    time: (patch) => {
      if (patch) clock.set(patch);
      return clock.state;
    },
    frames: (count = 2) => new Promise((resolve) => signal.waiters.push({ until: signal.frame + count, resolve })),
    capture: async () => {
      stage.render(); // read back in the same task as the render
      const dataUrl = renderer.domElement.toDataURL('image/png');
      return { dataUrl, blank: await isBlank(dataUrl) };
    },
    stats: () => ({
      backend: backendName(),
      experiment: runner.current?.entry.id ?? null,
      fps: Math.round(signal.fps),
      frame: signal.frame,
      drawCalls: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
      errors: errors.length,
    }),
  };
  window.__proto = api;
  return api;
}

const SAMPLE_W = 64;
const SAMPLE_H = 36;

async function isBlank(dataUrl: string): Promise<boolean> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.canvas.width = SAMPLE_W;
  ctx.canvas.height = SAMPLE_H;
  ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
  const px = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  for (let i = 4; i < px.length; i += 4) {
    if (px[i] !== px[0] || px[i + 1] !== px[1] || px[i + 2] !== px[2] || px[i + 3] !== px[3]) return false;
  }
  return true;
}
