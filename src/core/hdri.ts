import { EquirectangularReflectionMapping, type DataTexture } from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

// Every .hdr / .exr in src/assets/hdri/ is an HDRI choice (name = file name without extension and `_1k` suffix).
const files = import.meta.glob<string>('../assets/hdri/*.{hdr,exr}', { query: '?url', import: 'default', eager: true });

const URLS: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.split('/').at(-1)!.replace(/\.(hdr|exr)$/i, '').replace(/_\d+k$/i, ''), url]),
);

export const HDRI_NAMES: string[] = Object.keys(URLS).sort();
export const DEFAULT_HDRI = HDRI_NAMES.find((n) => n.includes('studio')) ?? HDRI_NAMES[0] ?? '';

const cache = new Map<string, Promise<DataTexture>>();

/** Loads (once) an equirectangular HDRI by name. */
export function loadHdri(name: string): Promise<DataTexture> {
  let pending = cache.get(name);
  if (!pending) {
    const url = URLS[name];
    if (!url) return Promise.reject(new Error(`Unknown HDRI "${name}". Known: ${HDRI_NAMES.join(', ')}`));
    const loader = /\.exr($|\?)/i.test(url) ? new EXRLoader() : new HDRLoader();
    pending = loader.loadAsync(url).then((texture) => {
      texture.mapping = EquirectangularReflectionMapping;
      return texture;
    });
    cache.set(name, pending);
  }
  return pending;
}
