import type { Group } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Put asset files in public/assets/ and record their source in public/assets/README.md (generated or downloaded).
// glTF/GLB is the exchange format for every target engine (UE Interchange, Unity glTFast, Godot native).

const loader = new GLTFLoader();

/** Loads a GLB/glTF from `public/` (e.g. 'assets/ship.glb') and returns its scene root. */
export async function loadGltf(path: string): Promise<Group> {
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${path}`);
  return gltf.scene;
}
