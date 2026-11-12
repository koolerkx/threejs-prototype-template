import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import type { ExperimentClock } from '../core/clock';

// Deterministic motion capture: pauses the clock, steps experiment time frame by frame, reads each rendered frame
// back and encodes a GIF and/or returns key frames. Used by Tools → Record GIF and `yarn shot --range`.

export interface FrameGrabber {
  /** Resolves with a copy of the next rendered frame, scaled to `width` (height keeps the aspect ratio). */
  grab(width: number): Promise<HTMLCanvasElement>;
}

export interface RecordOptions {
  /** Start time (s). Default: current time. */
  start?: number;
  /** Length (s). */
  duration: number;
  fps: number;
  /** Output width (px). */
  width: number;
  gif?: boolean;
  /** Also return this many evenly spaced frames as PNG data URLs (for contact sheets). */
  keyFrames?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface RecordResult {
  gif?: Blob;
  keyFrames: { time: number; dataUrl: string }[];
  frames: number;
}

const MAX_FRAMES = 600;

export async function record(clock: ExperimentClock, grabber: FrameGrabber, opts: RecordOptions): Promise<RecordResult> {
  const before = clock.state;
  const start = opts.start ?? before.time;
  const total = Math.min(Math.max(1, Math.round(opts.duration * opts.fps)), MAX_FRAMES);
  const keyCount = Math.min(opts.keyFrames ?? 0, total);
  const keyIndices = new Set(Array.from({ length: keyCount }, (_, i) => Math.round((i * (total - 1)) / Math.max(keyCount - 1, 1))));
  const encoder = opts.gif ? GIFEncoder() : null;
  const delay = Math.round(1000 / opts.fps);
  const keyFrames: RecordResult['keyFrames'] = [];

  try {
    for (let i = 0; i < total; i++) {
      const time = start + i / opts.fps;
      clock.set({ paused: true, time });
      const canvas = await grabber.grab(opts.width);
      if (encoder) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const palette = quantize(data, 256);
        encoder.writeFrame(applyPalette(data, palette), canvas.width, canvas.height, { palette, delay });
      }
      if (keyIndices.has(i)) keyFrames.push({ time, dataUrl: canvas.toDataURL('image/png') });
      opts.onProgress?.(i + 1, total);
    }
  } finally {
    clock.set(before);
  }

  let gif: Blob | undefined;
  if (encoder) {
    encoder.finish();
    gif = new Blob([encoder.bytes() as BlobPart], { type: 'image/gif' });
  }
  return { gif, keyFrames, frames: total };
}

export function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
