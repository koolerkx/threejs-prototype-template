import { MeshStandardNodeMaterial } from 'three/webgpu';
import { sin } from 'three/tsl';
import { defineExperiment } from '@/core/experiment';
import { primitiveMesh, shapeParam } from '@/lib/primitives';

// Scaffold copied by `yarn new <id>`. Replace the body; keep the shape:
//   params  -> one entry per engine material parameter (ctx.u.<name> is its TSL uniform)
//   port    -> how each target engine would build it (tier + short notes)
//   setup() -> add objects under ctx.root (HTML under ctx.overlay); the harness clears both on unload
//   shapes  -> primitiveMesh(name, material) from @/lib/primitives (engine-style 1 m basic shapes)
//   time    -> ctx.time (TSL) / update({ time }) follow the transport: pause, speed, seek, frame step
export default defineExperiment({
  title: '__TITLE__',
  description: 'What visual question does this answer? See brief.md.',
  tags: [],
  port: {
    ue: { tier: 'native', notes: [] },
    unity: { tier: 'native', notes: [] },
  },
  params: {
    shape: shapeParam('sphere'),
    baseColor: { type: 'color', value: '#d0a070', label: 'Base color' },
    roughness: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Roughness' },
    pulse: { type: 'number', value: 0, min: 0, max: 5, step: 0.01, label: 'Emissive pulse' },
  },
  setup({ root, params, u, time }) {
    const material = new MeshStandardNodeMaterial();
    material.colorNode = u.baseColor;
    material.roughnessNode = u.roughness;
    material.emissiveNode = u.baseColor.mul(sin(time.mul(3)).mul(0.5).add(0.5).mul(u.pulse));

    root.add(primitiveMesh(params.shape, material, { onGround: true, detail: 'high' }));
  },
});
