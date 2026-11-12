import { describe, expect, it } from 'vitest';
import { ballistic, bezier3, sample, solveBallistic, type Vec3 } from './curves';

const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));

describe('solveBallistic', () => {
  it('hits the target and reaches the requested apex', () => {
    const from: Vec3 = [0, 0, 0];
    const to: Vec3 = [10, 2, -4];
    const g = 9.81;
    const { velocity, duration } = solveBallistic(from, to, 3, g);
    close(ballistic(from, velocity, g, duration), to);
    const apexTime = velocity[1] / g;
    expect(ballistic(from, velocity, g, apexTime)[1]).toBeCloseTo(5, 5);
  });

  it('rejects non-positive gravity', () => {
    expect(() => solveBallistic([0, 0, 0], [1, 0, 0], 1, 0)).toThrow();
  });
});

describe('bezier3 / sample', () => {
  it('starts and ends on the end points', () => {
    const pts = sample((t) => bezier3([0, 0, 0], [1, 2, 0], [3, 2, 0], [4, 0, 0], t), 5);
    close(pts[0], [0, 0, 0]);
    close(pts[4], [4, 0, 0]);
    expect(pts).toHaveLength(5);
  });
});
