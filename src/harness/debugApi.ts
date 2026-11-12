import type { ClockState, ExperimentClock } from '../core/clock';
import { overBudget, type Budget, type PerfMonitor, type PerfSnapshot } from '../core/perf';
import type { AnyParamValues, ParamValue } from '../core/params';
import { EXPERIMENTS, findExperiment } from '../core/registry';
import type { ExperimentRunner } from '../core/runner';
import type { Stage } from '../core/stage';
import type { CameraView } from '../core/store';
import { record, type FrameGrabber } from './recorder';

// `window.__proto` is the agent interface: scripts/shot.mjs and browser tools drive the page through it.
// Keep it small, JSON-friendly and stable.

export interface ProtoStats extends PerfSnapshot {
  experiment: string | null;
  frame: number;
  errors: number;
  /** Budget items over their limit for the selected target (perf HUD). */
  overBudget: string[];
}

export interface ProtoRecordOptions {
  start?: number;
  duration: number;
  fps: number;
  width?: number;
  /** Return the GIF as a base64 string. */
  gif?: boolean;
  /** Return this many evenly spaced frames as PNG data URLs. */
  keyFrames?: number;
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
  /** Reads, and optionally sets, the camera. */
  camera(view?: Partial<CameraView>): CameraView;
  /** Jumps to camera bookmark 1-9; false when the slot is empty. */
  bookmark(slot: number): boolean;
  /** Resolves after `count` rendered frames (lets shaders compile and post settle). */
  frames(count?: number): Promise<void>;
  stats(): ProtoStats;
  /**
   * Renders one frame and returns it as a PNG data URL. `blank` is true when every sampled pixel is identical,
   * which usually means the backend produced no readable image (e.g. WebGPU on a GPU-less headless browser).
   */
  capture(): Promise<{ dataUrl: string; blank: boolean }>;
  /** Steps time deterministically and records frames: GIF (base64) and/or key frames (PNG data URLs). */
  record(opts: ProtoRecordOptions): Promise<{ gifBase64?: string; keyFrames: { time: number; dataUrl: string }[]; frames: number }>;
}

declare global {
  interface Window {
    __proto?: ProtoApi;
  }
}

export interface FrameSignal {
  frame: number;
  waiters: { until: number; resolve: () => void }[];
}

export interface AppContext {
  canvas: HTMLCanvasElement;
  runner: ExperimentRunner;
  stage: Stage;
  clock: ExperimentClock;
  perf: PerfMonitor;
  budget(): Budget;
  signal: FrameSignal;
  grabber: FrameGrabber;
  getView(): CameraView;
  setView(view: CameraView): void;
  bookmark(slot: number): boolean;
  /** Keeps the GUI in sync after API-driven stage changes. */
  onStageChanged(): void;
}

const DEFAULT_RECORD_WIDTH = 480;

export function installDebugApi(app: AppContext): ProtoApi {
  const { runner, stage, clock, perf, signal } = app;
  const errors: string[] = [];
  const recordError = (msg: string) => {
    errors.push(msg);
    if (errors.length > 50) errors.shift();
  };
  addEventListener('error', (e) => recordError(`error: ${e.message}`));
  addEventListener('unhandledrejection', (e) => recordError(`unhandledrejection: ${String(e.reason)}`));
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    recordError(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' '));
    origError(...args);
  };

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
      app.onStageChanged();
    },
    time: (patch) => {
      if (patch) clock.set(patch);
      return clock.state;
    },
    camera: (view) => {
      if (view) app.setView({ ...app.getView(), ...view });
      return app.getView();
    },
    bookmark: (slot) => app.bookmark(slot),
    frames: (count = 2) => new Promise((resolve) => signal.waiters.push({ until: signal.frame + count, resolve })),
    stats: () => {
      const snap = perf.snapshot();
      return {
        ...snap,
        experiment: runner.current?.entry.id ?? null,
        frame: signal.frame,
        errors: errors.length,
        overBudget: overBudget(snap, app.budget()),
      };
    },
    capture: async () => {
      stage.render(); // read back in the same task as the render
      const dataUrl = app.canvas.toDataURL('image/png');
      return { dataUrl, blank: await isBlank(dataUrl) };
    },
    record: async (opts) => {
      const result = await record(clock, app.grabber, { ...opts, width: opts.width ?? DEFAULT_RECORD_WIDTH });
      let gifBase64: string | undefined;
      if (result.gif) {
        const bytes = new Uint8Array(await result.gif.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        gifBase64 = btoa(bin);
      }
      return { gifBase64, keyFrames: result.keyFrames, frames: result.frames };
    },
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
