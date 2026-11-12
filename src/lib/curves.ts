// Engine-neutral trajectory math. Plain number tuples, no three.js types, so the same functions port
// line-for-line to C++ (UE FVector / DX12 XMFLOAT3), C# (Unity Vector3) or GDScript.
// Units: metres, seconds, m/s, m/s^2. +Y up.

export type Vec3 = readonly [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** Straight shot. t in [0, 1]. */
export function linear(from: Vec3, to: Vec3, t: number): Vec3 {
  return lerp(from, to, t);
}

export interface Ballistic {
  /** Launch velocity (m/s). */
  velocity: Vec3;
  /** Flight time to the target (s). */
  duration: number;
}

/**
 * Launch velocity that passes through `to` with its apex `apexHeight` metres above the higher end point
 * (mortar arc). Gravity is a positive magnitude along -Y.
 */
export function solveBallistic(from: Vec3, to: Vec3, apexHeight: number, gravity: number): Ballistic {
  if (gravity <= 0) throw new Error('gravity must be positive');
  const apexY = Math.max(from[1], to[1]) + Math.max(apexHeight, 0.001);
  const up = Math.sqrt(2 * gravity * (apexY - from[1])); // vertical speed to reach the apex
  const tUp = up / gravity;
  const tDown = Math.sqrt((2 * (apexY - to[1])) / gravity);
  const duration = tUp + tDown;
  return { velocity: [(to[0] - from[0]) / duration, up, (to[2] - from[2]) / duration], duration };
}

/** Position on a ballistic path at time `time` (s). */
export function ballistic(from: Vec3, velocity: Vec3, gravity: number, time: number): Vec3 {
  return [from[0] + velocity[0] * time, from[1] + velocity[1] * time - 0.5 * gravity * time * time, from[2] + velocity[2] * time];
}

/** Quadratic Bezier. t in [0, 1]. */
export function bezier2(p0: Vec3, p1: Vec3, p2: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return add(add(scale(p0, u * u), scale(p1, 2 * u * t)), scale(p2, t * t));
}

/** Cubic Bezier. t in [0, 1]. */
export function bezier3(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return add(add(scale(p0, u * u * u), scale(p1, 3 * u * u * t)), add(scale(p2, 3 * u * t * t), scale(p3, t * t * t)));
}

/** Samples `fn` at `count` evenly spaced parameters in [0, 1] (count >= 2). */
export function sample(fn: (t: number) => Vec3, count: number): Vec3[] {
  const n = Math.max(2, Math.floor(count));
  return Array.from({ length: n }, (_, i) => fn(i / (n - 1)));
}

/** Total length of a polyline. */
export function polylineLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += length(sub(points[i], points[i - 1]));
  return total;
}
