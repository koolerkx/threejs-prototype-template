import type { FrameInfo } from './experiment';

const MAX_DELTA = 0.1; // s, clamps long frames (tab switch, breakpoint)

/** Deterministic experiment clock. A frozen clock (URL `?t=`) makes captures reproducible. */
export class ExperimentClock {
  timeScale = 1;
  paused = false;
  private time = 0;
  private frame = 0;
  private last = performance.now();

  constructor(private frozenAt: number | null = null) {
    if (frozenAt !== null) this.time = frozenAt;
  }

  get frozen(): boolean {
    return this.frozenAt !== null;
  }

  reset(): void {
    this.time = this.frozenAt ?? 0;
    this.frame = 0;
    this.last = performance.now();
  }

  tick(): FrameInfo {
    const now = performance.now();
    const raw = Math.min((now - this.last) / 1000, MAX_DELTA);
    this.last = now;
    const delta = this.frozenAt !== null || this.paused ? 0 : raw * this.timeScale;
    this.time += delta;
    return { time: this.time, delta, frame: this.frame++ };
  }
}
