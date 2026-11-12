import { Line2NodeMaterial } from 'three/webgpu';
import { Line2 } from 'three/addons/lines/webgpu/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { Vec3 } from './curves';

// Screen-space thick lines (optionally dashed) for trajectories, guides and debug draw.
// UE: Spline + Niagara ribbon or spline mesh. Unity: LineRenderer (Texture Mode Tile, scroll the material offset).
// Godot: ImmediateMesh / custom ribbon. DX12: camera-facing quad strip in the vertex shader.

export interface LineStyle {
  color: string;
  /** Pixels, or metres when `worldUnits` is true. */
  width: number;
  worldUnits?: boolean;
  dashed?: boolean;
  /** Dash and gap length in world units (m). */
  dashSize?: number;
  gapSize?: number;
}

export function createLine(points: readonly Vec3[], style: LineStyle): Line2 {
  const geometry = new LineGeometry();
  geometry.setPositions(points.flat());
  const material = new Line2NodeMaterial({
    color: style.color,
    linewidth: style.width,
    worldUnits: style.worldUnits ?? false,
    dashed: style.dashed ?? false,
    dashSize: style.dashSize ?? 0.4,
    gapSize: style.gapSize ?? 0.2,
  });
  const line = new Line2(geometry, material);
  line.computeLineDistances(); // required for dashes
  line.userData.shadow = false;
  return line;
}

/** Replaces the points of a line created by createLine(). */
export function setLinePoints(line: Line2, points: readonly Vec3[]): void {
  line.geometry.setPositions(points.flat());
  line.computeLineDistances();
}
