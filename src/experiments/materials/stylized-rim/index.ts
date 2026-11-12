import { Mesh, MeshStandardNodeMaterial, SphereGeometry, TorusKnotGeometry, IcosahedronGeometry, type BufferGeometry } from 'three/webgpu';
import { mx_noise_float, normalLocal, positionLocal, sin, smoothstep, vec3 } from 'three/tsl';
import { defineExperiment } from '../../core/experiment';
import { fresnel } from '../../lib/nodes';

const SHAPES: Record<string, () => BufferGeometry> = {
  sphere: () => new SphereGeometry(0.6, 128, 64),
  torusKnot: () => new TorusKnotGeometry(0.42, 0.14, 256, 48),
  icosahedron: () => new IcosahedronGeometry(0.6, 6),
};

// Example of a TSL look built only from nodes that exist in every target engine's graph editor:
// Fresnel rim, noise-driven emissive bands and vertex wobble (UE World Position Offset).
export default defineExperiment({
  title: 'Stylized rim + emissive bands',
  description: 'PBR base with a Fresnel rim, scrolling noise bands in emissive and a vertex wobble. Bloom is on (Stage) because the look depends on it.',
  tags: ['example', 'tsl', 'emissive', 'vertex'],
  port: {
    ue: {
      tier: 'graph',
      notes: [
        'Rim: Fresnel node (Exponent = rimPower) -> Emissive.',
        'Bands: Noise node differs from mx_noise; match by eye or bake to a tiling texture.',
        'Wobble: World Position Offset, in cm (x100).',
      ],
    },
    unity: { tier: 'graph', notes: ['Shader Graph: Fresnel Effect, Gradient Noise, Position (Object) -> Vertex Position.'] },
    godot: { tier: 'code', notes: ['VisualShader has Fresnel but no 3D noise; use a NoiseTexture3D or shader-language noise.'] },
    dx12: { tier: 'code', notes: ['Port mx_noise_float (MaterialX Perlin) to HLSL as a shared include.'] },
  },
  params: {
    shape: { type: 'select', value: 'torusKnot', options: Object.keys(SHAPES), label: 'Shape' },
    baseColor: { type: 'color', value: '#5b4bd6', label: 'Base color' },
    roughness: { type: 'number', value: 0.45, min: 0, max: 1, step: 0.01, label: 'Roughness' },
    metallic: { type: 'number', value: 0, min: 0, max: 1, step: 0.01, label: 'Metallic' },
    rimColor: { type: 'color', value: '#7fd8ff', label: 'Rim color' },
    rimPower: { type: 'number', value: 3, min: 0.5, max: 8, step: 0.1, label: 'Rim power' },
    rimIntensity: { type: 'number', value: 1.5, min: 0, max: 10, step: 0.05, label: 'Rim intensity' },
    bandColor: { type: 'color', value: '#ff5fa2', label: 'Band color' },
    bandIntensity: { type: 'number', value: 2, min: 0, max: 20, step: 0.1, label: 'Band intensity' },
    bandScale: { type: 'number', value: 2.5, min: 0.1, max: 10, step: 0.1, unit: '1/m', label: 'Band scale' },
    bandSpeed: { type: 'number', value: 0.4, min: 0, max: 3, step: 0.01, unit: 'm/s', label: 'Band speed' },
    wobbleAmount: { type: 'number', value: 0.03, min: 0, max: 0.2, step: 0.001, unit: 'm', label: 'Wobble amount' },
    wobbleFrequency: { type: 'number', value: 6, min: 0, max: 20, step: 0.1, unit: 'rad/m', label: 'Wobble frequency' },
  },
  camera: { position: [0, 1.3, 3], target: [0, 0.9, 0] },
  stage: { bloom: true, bloomThreshold: 1 },
  setup({ root, params, u, time }) {
    const material = new MeshStandardNodeMaterial();
    material.colorNode = u.baseColor;
    material.roughnessNode = u.roughness;
    material.metalnessNode = u.metallic;

    const rim = fresnel(u.rimPower).mul(u.rimIntensity);

    // Noise bands scrolling along -Y in object space (UE Noise node / Unity Gradient Noise).
    const scroll = vec3(0, time.mul(u.bandSpeed), 0);
    const n = mx_noise_float(positionLocal.add(scroll).mul(u.bandScale));
    const bands = smoothstep(0.15, 0.35, n).mul(u.bandIntensity);

    material.emissiveNode = u.rimColor.mul(rim).add(u.bandColor.mul(bands));

    // Vertex wobble along the normal (UE World Position Offset).
    const wobble = sin(positionLocal.y.mul(u.wobbleFrequency).add(time.mul(3))).mul(u.wobbleAmount);
    material.positionNode = positionLocal.add(normalLocal.mul(wobble));

    const mesh = new Mesh(SHAPES[params.shape](), material);
    mesh.position.y = 0.9;
    root.add(mesh);

    return {
      update({ delta }) {
        mesh.rotation.y += delta * 0.3;
      },
    };
  },
});
