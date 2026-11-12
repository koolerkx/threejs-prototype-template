import { Mesh, MeshStandardNodeMaterial, SphereGeometry, type Line2NodeMaterial } from 'three/webgpu';
import { defineExperiment } from '@/core/experiment';
import { bezier3, ballistic, linear, polylineLength, sample, solveBallistic, type Vec3 } from '@/lib/curves';
import { createLine, setLinePoints } from '@/lib/lines';

const SAMPLES = 96;
const LANE_SPACING = 1.6; // m between the three lanes
const MARKER_RADIUS = 0.09; // m

type Lane = { name: string; color: string; path: (t: number) => Vec3 };

// Gameplay/logic example: trajectory shapes drawn as scrolling dashed lines with a projectile on each.
// The math lives in src/lib/curves.ts (engine-neutral); this file only draws it.
export default defineExperiment({
  title: 'Projectile curves',
  description: 'Straight shot, mortar arc and Bezier "magic bullet" from launcher to target, with scrolling dashes and a moving projectile.',
  tags: ['example', 'gameplay', 'curves', 'lines'],
  port: {
    ue: { tier: 'extra', notes: ['Math: port src/lib/curves.ts to C++ (FVector).', 'Draw: Spline Component + Niagara ribbon; scroll the ribbon UV for dashes.'] },
    unity: { tier: 'extra', notes: ['Math: C# port of curves.ts.', 'Draw: LineRenderer (Texture Mode Tile) with a scrolling material offset.'] },
    godot: { tier: 'extra', notes: ['Path3D / Curve3D for Bezier; ImmediateMesh ribbon for the dashed line.'] },
    dx12: { tier: 'extra', notes: ['Camera-facing quad strip; dash = fract(distance / (dash + gap)) in the pixel shader.'] },
  },
  params: {
    distance: { type: 'number', value: 8, min: 2, max: 20, step: 0.1, unit: 'm', label: 'Target distance' },
    targetHeight: { type: 'number', value: 0, min: -2, max: 4, step: 0.05, unit: 'm', label: 'Target height' },
    apexHeight: { type: 'number', value: 3, min: 0.2, max: 10, step: 0.05, unit: 'm', label: 'Mortar apex' },
    gravity: { type: 'number', value: 9.81, min: 1, max: 30, step: 0.01, unit: 'm/s²', label: 'Gravity' },
    bend: { type: 'number', value: 3, min: -6, max: 6, step: 0.05, unit: 'm', label: 'Bezier bend' },
    lift: { type: 'number', value: 2, min: 0, max: 6, step: 0.05, unit: 'm', label: 'Bezier lift' },
    flightTime: { type: 'number', value: 1.6, min: 0.3, max: 5, step: 0.05, unit: 's', label: 'Flight time (line, bezier)' },
    lineWidth: { type: 'number', value: 4, min: 1, max: 12, step: 0.5, unit: 'px', label: 'Line width' },
    dashSize: { type: 'number', value: 0.35, min: 0.05, max: 2, step: 0.01, unit: 'm', label: 'Dash' },
    gapSize: { type: 'number', value: 0.2, min: 0.05, max: 2, step: 0.01, unit: 'm', label: 'Gap' },
    scrollSpeed: { type: 'number', value: 2, min: -10, max: 10, step: 0.1, unit: 'm/s', label: 'Dash scroll' },
  },
  camera: { position: [-2.5, 4, 7.5], target: [4, 1.2, 0] },
  stage: { backdrop: 'outdoor', sunElevationDeg: 55 },
  setup({ root, params, overlay }) {
    const lanes = (): Lane[] => {
      const p = params;
      const z = (i: number) => (i - 1) * LANE_SPACING;
      const from = (i: number): Vec3 => [0, 0.5, z(i)];
      const to = (i: number): Vec3 => [p.distance, p.targetHeight + 0.5, z(i)];
      const shot = solveBallistic(from(1), to(1), p.apexHeight, p.gravity);
      return [
        { name: 'Straight', color: '#7fd8ff', path: (t) => linear(from(0), to(0), t) },
        { name: `Mortar (${shot.duration.toFixed(2)} s)`, color: '#ffb347', path: (t) => ballistic(from(1), shot.velocity, p.gravity, t * shot.duration) },
        {
          name: 'Bezier',
          color: '#ff5fa2',
          path: (t) => {
            const a = from(2);
            const b = to(2);
            return bezier3(a, [a[0] + p.distance * 0.3, a[1] + p.lift, a[2] + p.bend], [b[0] - p.distance * 0.3, b[1] + p.lift, b[2] - p.bend], b, t);
          },
        },
      ];
    };

    const markerGeometry = new SphereGeometry(MARKER_RADIUS, 24, 12);
    const built = lanes().map((lane) => {
      const points = sample(lane.path, SAMPLES);
      const line = createLine(points, { color: lane.color, width: params.lineWidth, dashed: true, dashSize: params.dashSize, gapSize: params.gapSize });
      const marker = new Mesh(markerGeometry, new MeshStandardNodeMaterial({ color: lane.color, emissive: lane.color, emissiveIntensity: 0.6 }));
      root.add(line, marker);
      return { line, marker, length: polylineLength(points) };
    });

    const legend = document.createElement('div');
    legend.style.cssText = 'position:absolute;top:12px;left:12px;padding:6px 10px;background:rgba(20,22,26,.75);border-radius:4px;font:12px ui-monospace,monospace;line-height:1.6';
    overlay.append(legend);

    const rebuild = () => {
      const current = lanes();
      current.forEach((lane, i) => {
        const points = sample(lane.path, SAMPLES);
        setLinePoints(built[i].line, points);
        built[i].length = polylineLength(points);
        const m = built[i].line.material as Line2NodeMaterial;
        m.linewidth = params.lineWidth;
        m.dashSize = params.dashSize;
        m.gapSize = params.gapSize;
      });
      legend.innerHTML = current
        .map((l, i) => `<div><span style="color:${l.color}">■</span> ${l.name} · ${built[i].length.toFixed(1)} m</div>`)
        .join('');
    };
    rebuild();

    return {
      onParam: rebuild,
      update({ time }) {
        const current = lanes();
        built.forEach((b, i) => {
          (b.line.material as Line2NodeMaterial).dashOffset = -time * params.scrollSpeed;
          const t = (time / params.flightTime) % 1;
          b.marker.position.set(...current[i].path(t));
        });
      },
    };
  },
});
