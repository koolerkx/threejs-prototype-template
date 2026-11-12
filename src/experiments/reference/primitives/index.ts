import { DoubleSide, MeshStandardNodeMaterial, Vector3 } from 'three/webgpu';
import { defineExperiment } from '@/core/experiment';
import { PRIMITIVE_INFO, PRIMITIVES, primitiveMesh } from '@/lib/primitives';

const COLUMNS = 7;
const SPACING = 2; // m
const ROW_SPACING = 3; // m

// Reference board of every basic shape from src/lib/primitives.ts, labelled with its engine counterpart.
export default defineExperiment({
  title: 'Basic shapes',
  description: 'All primitives from @/lib/primitives at their default 1 m size, sitting on the ground. Hover a label for its size and UE / Unity / Godot counterpart.',
  tags: ['reference', 'primitives', 'shapes'],
  port: {
    ue: { tier: 'native', notes: ['BasicShapes are 100 cm; shapes marked "Modeling" come from Modeling Mode.'] },
    unity: { tier: 'native', notes: ['Cylinder and Capsule are 2 m tall; Plane is 10 m.'] },
    godot: { tier: 'native', notes: ['CylinderMesh / CapsuleMesh default to 2 m height; PlaneMesh is 2 m.'] },
  },
  params: {
    color: { type: 'color', value: '#c9a27a', label: 'Color' },
    roughness: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Roughness' },
    detail: { type: 'select', value: 'medium', options: ['low', 'medium', 'high'], label: 'Detail' },
    wireframe: { type: 'boolean', value: false, label: 'Wireframe', rebuild: true },
    labels: { type: 'boolean', value: true, label: 'Labels' },
  },
  camera: { position: [0, 8.5, 9], target: [0, 0, 0.6], fovDeg: 50 },
  stage: { backdrop: 'stage', grid: false },
  setup({ root, params, u, camera, renderer, overlay }) {
    const material = new MeshStandardNodeMaterial({ side: DoubleSide, wireframe: params.wireframe });
    material.colorNode = u.color;
    material.roughnessNode = u.roughness;

    const labels: { el: HTMLElement; anchor: Vector3 }[] = [];
    PRIMITIVES.forEach((name, i) => {
      const mesh = primitiveMesh(name, material, { onGround: true, detail: params.detail });
      const col = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      mesh.position.x = (col - (COLUMNS - 1) / 2) * SPACING;
      mesh.position.z = (row - 0.5) * ROW_SPACING;
      root.add(mesh);

      const info = PRIMITIVE_INFO[name];
      const el = document.createElement('div');
      el.className = 'shape-label';
      el.style.cssText = 'position:absolute;transform:translate(-50%,0);padding:2px 6px;background:rgba(20,22,26,.78);border-radius:3px;font:10px/1.3 ui-monospace,monospace;color:#d6d9de;white-space:nowrap;text-align:center';
      el.textContent = name;
      el.title = `${info.size}\nUE: ${info.ue}\nUnity: ${info.unity}\nGodot: ${info.godot}`;
      el.style.pointerEvents = 'auto';
      overlay.append(el);
      labels.push({ el, anchor: new Vector3(mesh.position.x, 0, mesh.position.z + 0.8) });
    });

    const projected = new Vector3();
    return {
      update() {
        const { width, height } = renderer.domElement.getBoundingClientRect();
        for (const { el, anchor } of labels) {
          el.hidden = !params.labels;
          projected.copy(anchor).project(camera);
          el.style.left = `${((projected.x + 1) / 2) * width}px`;
          el.style.top = `${((1 - projected.y) / 2) * height}px`;
        }
      },
    };
  },
});
