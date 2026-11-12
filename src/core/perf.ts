import { TimestampQuery, type WebGPURenderer } from 'three/webgpu';

// Frame profiling and budgets. Budgets are rough starting points for judging cost before a port, not engine
// guarantees: edit BUDGETS to match the project, or override per experiment with `budget` in defineExperiment.

export interface Budget {
  /** Frame time target (ms). */
  frameMs: number;
  drawCalls: number;
  triangles: number;
  /** GPU memory tracked by three.js (MB). */
  memoryMB: number;
}

export const BUDGETS = {
  'PC 60': { frameMs: 16.7, drawCalls: 3000, triangles: 5_000_000, memoryMB: 2048 },
  'PC 120': { frameMs: 8.3, drawCalls: 2000, triangles: 3_000_000, memoryMB: 2048 },
  'Console 30': { frameMs: 33.3, drawCalls: 3000, triangles: 6_000_000, memoryMB: 4096 },
  'Mobile 30': { frameMs: 33.3, drawCalls: 300, triangles: 500_000, memoryMB: 512 },
  'VR 90': { frameMs: 11.1, drawCalls: 500, triangles: 1_000_000, memoryMB: 1024 },
} as const satisfies Record<string, Budget>;
export type BudgetName = keyof typeof BUDGETS;
export const BUDGET_NAMES = Object.keys(BUDGETS) as BudgetName[];

export interface PerfSnapshot {
  backend: 'webgpu' | 'webgl2';
  fps: number;
  /** Interval between frames (ms), averaged. */
  frameMs: number;
  /** JS time spent per frame in update + render submission (ms), averaged. */
  cpuMs: number;
  /** GPU time of the render passes (ms), when the backend supports timestamp queries; else null. */
  gpuMs: number | null;
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
  programs: number;
  memoryMB: number;
}

const HISTORY = 180; // frames kept for the graph
const AVERAGE_FRAMES = 30;
const GPU_QUERY_EVERY = 10; // frames between timestamp resolves

export class PerfMonitor {
  /** Frame intervals (ms), oldest first. */
  readonly history: number[] = [];
  private readonly cpu: number[] = [];
  private lastFrame = 0;
  private frameStart = 0;
  private gpuMs: number | null = null;
  private frames = 0;
  private resolving = false;

  constructor(private readonly renderer: WebGPURenderer) {}

  get backend(): PerfSnapshot['backend'] {
    return (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  }

  beginFrame(): void {
    const now = performance.now();
    if (this.lastFrame) {
      this.history.push(now - this.lastFrame);
      if (this.history.length > HISTORY) this.history.shift();
    }
    this.lastFrame = now;
    this.frameStart = now;
  }

  endFrame(): void {
    this.cpu.push(performance.now() - this.frameStart);
    if (this.cpu.length > AVERAGE_FRAMES) this.cpu.shift();
    if (++this.frames % GPU_QUERY_EVERY === 0 && !this.resolving) {
      this.resolving = true;
      this.renderer
        .resolveTimestampsAsync(TimestampQuery.RENDER)
        .then((ms) => {
          if (typeof ms === 'number' && ms > 0) this.gpuMs = ms;
        })
        .catch(() => {
          this.gpuMs = null;
        })
        .finally(() => {
          this.resolving = false;
        });
    }
  }

  snapshot(): PerfSnapshot {
    const recent = this.history.slice(-AVERAGE_FRAMES);
    const frameMs = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const cpuMs = this.cpu.length ? this.cpu.reduce((a, b) => a + b, 0) / this.cpu.length : 0;
    const { render, memory } = this.renderer.info;
    return {
      backend: this.backend,
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      cpuMs,
      gpuMs: this.gpuMs,
      drawCalls: render.drawCalls,
      triangles: render.triangles,
      lines: render.lines,
      points: render.points,
      geometries: memory.geometries,
      textures: memory.textures,
      programs: memory.programs,
      memoryMB: memory.total / (1024 * 1024),
    };
  }
}

/** Budget items over their limit, as short labels. */
export function overBudget(s: PerfSnapshot, b: Budget): string[] {
  const over: string[] = [];
  if (s.frameMs > b.frameMs * 1.05) over.push('frame');
  if (s.gpuMs !== null && s.gpuMs > b.frameMs) over.push('gpu');
  if (s.drawCalls > b.drawCalls) over.push('draws');
  if (s.triangles > b.triangles) over.push('tris');
  if (s.memoryMB > b.memoryMB) over.push('memory');
  return over;
}
