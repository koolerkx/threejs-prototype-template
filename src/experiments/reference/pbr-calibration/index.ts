import { Mesh, MeshPhysicalNodeMaterial, SphereGeometry } from 'three/webgpu';
import { float } from 'three/tsl';
import { defineExperiment } from '@/core/experiment';

const GRID = 5; // spheres per row / column
const SPACING = 0.55; // m
const RADIUS = 0.22; // m

// Reference board: metallic (columns) x roughness (rows) on the engine-default lit model.
// Rebuild the same board in the target engine to calibrate lighting and tone mapping before judging a look.
export default defineExperiment({
  title: 'PBR calibration board',
  description: 'Metallic (left to right) x roughness (bottom to top) on the default lit model. Compare against the same board in the target engine.',
  tags: ['reference', 'pbr', 'lighting'],
  port: {
    ue: { tier: 'native', notes: ['Default Lit Material Instance: BaseColor, Metallic, Roughness, Specular 0.5 (F0 0.04).'] },
    unity: { tier: 'native', notes: ['URP Lit, Metallic workflow. Unity Smoothness = 1 - Roughness.'] },
    godot: { tier: 'native', notes: ['StandardMaterial3D: albedo, metallic, roughness; metallic_specular 0.5.'] },
    dx12: { tier: 'native', notes: ['GGX + Smith + Schlick, F0 = lerp(0.04, baseColor, metallic).'] },
  },
  params: {
    baseColor: { type: 'color', value: '#b4b4b4', label: 'Base color' },
    specular: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Specular', hint: 'UE Specular; F0 = 0.08 * specular' },
  },
  camera: { position: [0, 1.5, 4.6], target: [0, 1.4, 0] },
  stage: { ground: true, sunElevationDeg: 40, sunAzimuthDeg: 30 },
  setup({ root, u }) {
    const geometry = new SphereGeometry(RADIUS, 64, 32);
    const offset = ((GRID - 1) * SPACING) / 2;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const material = new MeshPhysicalNodeMaterial();
        material.colorNode = u.baseColor;
        material.metalness = col / (GRID - 1);
        material.roughness = Math.max(row / (GRID - 1), 0.04);
        // UE: F0 = 0.08 * Specular. three.js: F0 = 0.04 (IOR 1.5) * specularIntensity. So specularIntensity = 2 * Specular.
        material.specularIntensityNode = u.specular.mul(float(2));
        const mesh = new Mesh(geometry, material);
        mesh.position.set(col * SPACING - offset, RADIUS + 0.2 + row * SPACING, 0);
        root.add(mesh);
      }
    }
  },
});
