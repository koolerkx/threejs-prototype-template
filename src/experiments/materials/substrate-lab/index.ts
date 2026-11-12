import { mx_noise_float, positionLocal, smoothstep } from 'three/tsl';
import { defineExperiment } from '@/core/experiment';
import { primitiveMesh, shapeParam } from '@/lib/primitives';
import {
  coverageWeight, createSubstrateMaterial, horizontalMix, metalnessToSlab, slab, verticalLayer, type SubstrateTree,
} from '@/lib/substrate';

// Substrate-style recipes built from @/lib/substrate. Pick a recipe, tune it, and check channels with the view
// modes (clearcoat, fuzz, thinFilm, sss, height, specular...). The info card lists what was approximated.
const RECIPES = ['plastic', 'carPaint', 'velvet', 'soapBubble', 'skin', 'rustOverMetal', 'lacquer', 'hazyMetal', 'frostedGlass'] as const;

export default defineExperiment({
  title: 'Substrate lab',
  description: 'UE5 Substrate-style recipes (Slab, Horizontal Mixing, Vertical Layer, Coverage) flattened to one physical BSDF.',
  tags: ['example', 'substrate', 'materials', 'layering'],
  port: {
    ue: { tier: 'graph', notes: ['Substrate Slab BSDF + Horizontal Mixing / Vertical Layer, see the recipe notes in the console and brief.'] },
    unity: { tier: 'graph', notes: ['HDRP StackLit for coat / haze / iridescence / SSS; URP needs custom HLSL.'] },
    godot: { tier: 'code', notes: ['StandardMaterial3D covers coat, rim, SSS; thin film and haze need shader code.'] },
    dx12: { tier: 'code', notes: ['Flattened BSDF in HLSL.'] },
  },
  params: {
    recipe: { type: 'select', value: 'carPaint', options: RECIPES, label: 'Recipe' },
    shape: shapeParam('sphere'),
    color: { type: 'color', value: '#9e1b32', label: 'Color' },
    roughness: { type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, label: 'Roughness' },
    coatRoughness: { type: 'number', value: 0.05, min: 0, max: 1, step: 0.01, label: 'Coat roughness' },
    coat: { type: 'number', value: 1, min: 0, max: 1, step: 0.01, label: 'Coat / layer coverage' },
    fuzz: { type: 'number', value: 1, min: 0, max: 1, step: 0.01, label: 'Fuzz amount' },
    filmNm: { type: 'number', value: 420, min: 0, max: 1200, step: 1, unit: 'nm', label: 'Thin film' },
    sss: { type: 'number', value: 0.8, min: 0, max: 1, step: 0.01, label: 'SSS strength' },
    mix: { type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Mix (rust amount)' },
    haze: { type: 'number', value: 0.6, min: 0, max: 1, step: 0.01, label: 'Haze weight' },
  },
  camera: { position: [0, 1.4, 3.2], target: [0, 0.75, 0] },
  stage: { backdrop: 'hdri', hdri: 'studio_small_09', sunIntensity: 1.5 },
  bookmarks: [
    { position: [0, 1.4, 3.2], target: [0, 0.75, 0] },
    { position: [1.2, 0.9, 1.3], target: [0, 0.75, 0] },
  ],
  setup({ root, params, u, overlay }) {
    const p = params;
    let tree: SubstrateTree;
    switch (p.recipe) {
      case 'plastic':
        tree = slab({ diffuseAlbedo: u.color, f0: 0.04, roughness: u.roughness });
        break;
      case 'carPaint': // metallic flake base under a clear lacquer
        tree = verticalLayer(
          slab({ diffuseAlbedo: 1, roughness: u.coatRoughness }),
          slab(metalnessToSlab({ baseColor: u.color, metallic: 0.7, roughness: u.roughness })),
          u.coat,
        );
        break;
      case 'velvet':
        tree = slab({ diffuseAlbedo: u.color.mul(0.5), f0: 0.02, roughness: 0.8, fuzzAmount: u.fuzz, fuzzColor: u.color, fuzzRoughness: 0.35 });
        break;
      case 'soapBubble':
        tree = coverageWeight(slab({ diffuseAlbedo: 0, f0: 0.04, roughness: 0.02, thinFilmThickness: u.filmNm, thinFilmIor: 1.33 }), 0.35);
        break;
      case 'skin':
        tree = slab({ diffuseAlbedo: u.color, f0: 0.028, roughness: u.roughness, sssColor: '#d4523c', sssStrength: u.sss });
        break;
      case 'rustOverMetal': { // horizontal mix driven by a noise mask, also published as height
        const n = mx_noise_float(positionLocal.mul(4)).mul(0.5).add(0.5);
        const mask = smoothstep(u.mix.oneMinus().sub(0.1), u.mix.oneMinus().add(0.1), n);
        tree = horizontalMix(
          slab({ ...metalnessToSlab({ baseColor: '#b8b8c0', metallic: 1, roughness: 0.25 }), height: 0 }),
          slab({ diffuseAlbedo: '#6b2f17', f0: 0.04, roughness: 0.9, height: n }),
          mask,
        );
        break;
      }
      case 'lacquer': // tinted coat over a light diffuse base
        tree = verticalLayer(
          slab({ diffuseAlbedo: u.color, roughness: u.coatRoughness }),
          slab({ diffuseAlbedo: '#e8d7b0', f0: 0.04, roughness: u.roughness }),
          u.coat,
        );
        break;
      case 'hazyMetal':
        tree = slab({ ...metalnessToSlab({ baseColor: u.color, metallic: 1, roughness: u.roughness }), secondRoughness: 0.6, secondRoughnessWeight: u.haze });
        break;
      case 'frostedGlass':
        tree = slab({ diffuseAlbedo: 1, f0: 0.04, roughness: u.roughness, transmission: 1, thickness: 0.3, ior: 1.5 });
        break;
    }

    const { material, approximations, features } = createSubstrateMaterial(tree);
    const mesh = primitiveMesh(p.shape, material, { onGround: true, detail: 'high' });
    mesh.position.y += 0.25;
    root.add(mesh);

    // What the flattened material approximates, so the gap to UE Substrate stays visible.
    const note = document.createElement('div');
    note.style.cssText = 'position:absolute;left:12px;bottom:130px;max-width:420px;padding:8px 10px;background:rgba(20,22,26,.82);border:1px solid #33363c;border-radius:6px;font:11px/1.45 ui-sans-serif,system-ui,sans-serif;color:#a7adb6';
    const list = approximations.map((a) => `<li>${a}</li>`).join('');
    note.innerHTML = `<b style="color:#d6d9de">${p.recipe}</b> · ${features.join(', ') || 'slab'}${list ? `<ul style="margin:6px 0 0;padding-left:16px">${list}</ul>` : ''}`;
    overlay.append(note);
  },
});
