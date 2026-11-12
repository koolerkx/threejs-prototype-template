import type { FrameInfo } from './experiment';

const MAX_DELTA = 0.1; // s, clamps long frames (tab switch, breakpoint)
export const STEP_SECONDS = 1 / 60;
export const SPEEDS = [0, 0.1, 0.25, 0.5, 1, 2, 4] as const;

export interface ClockState {
  time: number;
  paused: boolean;
  speed: number;
}

/**
 * Experiment time with transport controls. Everything animated reads this clock (ctx.time, FrameInfo), so
 * pause, speed, seek and frame step apply to shaders and JS animation alike. URL `?t=` starts paused at t.
 */
export class ExperimentClock {
  private time: number;
  private frame = 0;
  private last = performance.now();
  private pendingStep = 0;
  private readonly listeners = new Set<() => void>();
  paused: boolean;
  speed = 1;

  constructor(private readonly startTime = 0, startPaused = false) {
    this.time = startTime;
    this.paused = startPaused;
  }

  get state(): ClockState {
    return { time: this.time, paused: this.paused, speed: this.speed };
  }

  /** Called whenever paused / speed / time changes outside normal playback (UI sync). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Experiment (re)loaded: back to the start time, transport settings kept. */
  reset(): void {
    this.time = this.startTime;
    this.frame = 0;
    this.last = performance.now();
    this.emit();
  }

  set(patch: Partial<ClockState>): void {
    if (patch.time !== undefined && Number.isFinite(patch.time)) this.time = Math.max(0, patch.time);
    if (patch.paused !== undefined) this.paused = patch.paused;
    if (patch.speed !== undefined && Number.isFinite(patch.speed)) this.speed = Math.max(0, patch.speed);
    this.emit();
  }

  togglePause(): void {
    this.set({ paused: !this.paused });
  }

  /** Pauses and advances (or rewinds, negative) by whole frames of STEP_SECONDS on the next tick. */
  step(frames = 1): void {
    this.paused = true;
    this.pendingStep += frames;
    this.emit();
  }

  /** Moves to the previous / next entry of SPEEDS. */
  shiftSpeed(direction: 1 | -1): void {
    const i = SPEEDS.findIndex((s) => s >= this.speed - 1e-6);
    const next = SPEEDS[Math.min(Math.max((i < 0 ? SPEEDS.length - 1 : i) + direction, 1), SPEEDS.length - 1)];
    this.set({ speed: next });
  }

  tick(): FrameInfo {
    const now = performance.now();
    const raw = Math.min((now - this.last) / 1000, MAX_DELTA);
    this.last = now;
    let delta = 0;
    if (this.pendingStep !== 0) {
      delta = Math.max(this.pendingStep * STEP_SECONDS, -this.time);
      this.pendingStep = 0;
    } else if (!this.paused) {
      delta = raw * this.speed;
    }
    this.time += delta;
    return { time: this.time, delta, frame: this.frame++ };
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}
