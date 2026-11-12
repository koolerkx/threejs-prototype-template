import type { Material, Object3D, Texture } from 'three/webgpu';

/** Disposes geometries, materials and their textures below `root`, then detaches it. */
export function disposeTree(root: Object3D): void {
  const materials = new Set<Material>();
  root.traverse((obj) => {
    const mesh = obj as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
    else if (mat) materials.add(mat);
  });
  for (const mat of materials) {
    for (const value of Object.values(mat)) {
      if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
    }
    mat.dispose();
  }
  root.removeFromParent();
}
