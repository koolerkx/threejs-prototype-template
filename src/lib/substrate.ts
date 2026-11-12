import { Color, MeshSSSNodeMaterial, type Node } from 'three/webgpu';
import { color as colorNode, float, max, mix, vec2, vec3 } from 'three/tsl';
import type { PortNotes } from '@/core/experiment';
import { debugChannel } from '@/core/views';

// Substrate-style material authoring (UE5 Substrate), for experiments that will be rebuilt with Substrate.
//
//   const tree = verticalLayer(
//     slab({ diffuseAlbedo: '#7a1020', f0: 0.04, roughness: 0.35 }),       // coat on top
//     slab(metalnessToSlab({ baseColor: '#c0c0c8', metallic: 1, roughness: 0.3 })),
//   );
//   const { material, approximations, port } = createSubstrateMaterial(tree);
//
// Operators follow Substrate's names: Slab BSDF, Horizontal Mixing, Vertical Layer, Coverage Weight.
// three.js renders one physical BSDF per pixel, so the tree is flattened to one MeshSSSNodeMaterial
// (MeshPhysicalNodeMaterial + thickness-based translucency):
//   - horizontalMix blends parameters (UE Substrate's cheaper "parameter blending" mode), not two BSDF results
//   - verticalLayer supports one coat: the top slab becomes the clear-coat lobe (F0 0.04, its roughness); the top
//     albedo tints the base like absorption through the coat
//   - haziness (second roughness) uses the clear-coat lobe when no coat is present
//   - SSS is thickness-based translucency, not Substrate's MFP diffusion
// `approximations` lists what was approximated for the given tree; `port` carries engine notes for the experiment.

type NodeInput = Node | number | string | Color;

export interface SlabInputs {
  /** Diffuse albedo (sRGB colour). Substrate Slab "Diffuse Albedo". */
  diffuseAlbedo?: NodeInput;
  /** Specular reflectance at normal incidence (colour or scalar). Dielectrics ~0.04. */
  f0?: NodeInput;
  /** Reflectance at grazing angles (0..1 scalar). Default 1. */
  f90?: NodeInput;
  roughness?: NodeInput;
  /** -1..1. Requires tangents (UV-mapped geometry). */
  anisotropy?: NodeInput;
  normal?: Node;
  emissive?: NodeInput;
  /** Haziness: second specular lobe. */
  secondRoughness?: NodeInput;
  secondRoughnessWeight?: NodeInput;
  /** Fuzz (cloth / velvet / dust). */
  fuzzAmount?: NodeInput;
  fuzzColor?: NodeInput;
  fuzzRoughness?: NodeInput;
  /** Thin film (soap, oil, anodised metal). Thickness in nanometres; 0 = off. */
  thinFilmThickness?: NodeInput;
  thinFilmIor?: NodeInput;
  /** Subsurface: scattering colour (approximates Substrate SSS MFP colour) and strength 0..1. */
  sssColor?: NodeInput;
  sssStrength?: NodeInput;
  /** Transmission 0..1 (glass-like) with thickness (m) and IOR. */
  transmission?: NodeInput;
  thickness?: NodeInput;
  ior?: NodeInput;
  /** Height 0..1, for the height view mode and for displacement / parallax done by the experiment. */
  height?: NodeInput;
}

export type SubstrateTree =
  | { op: 'slab'; inputs: SlabInputs }
  | { op: 'horizontalMix'; background: SubstrateTree; foreground: SubstrateTree; mix: NodeInput }
  | { op: 'verticalLayer'; top: SubstrateTree; base: SubstrateTree; coverage: NodeInput }
  | { op: 'coverage'; tree: SubstrateTree; weight: NodeInput };

export const slab = (inputs: SlabInputs): SubstrateTree => ({ op: 'slab', inputs });
/** Substrate Horizontal Mixing: `mix` 0 = background, 1 = foreground. */
export const horizontalMix = (background: SubstrateTree, foreground: SubstrateTree, mixValue: NodeInput): SubstrateTree => ({
  op: 'horizontalMix', background, foreground, mix: mixValue,
});
/** Substrate Vertical Layer: `top` over `base`. `coverage` 0..1 scales the top layer. */
export const verticalLayer = (top: SubstrateTree, base: SubstrateTree, coverage: NodeInput = 1): SubstrateTree => ({
  op: 'verticalLayer', top, base, coverage,
});
/** Substrate Coverage Weight: opacity of the whole tree. */
export const coverageWeight = (tree: SubstrateTree, weight: NodeInput): SubstrateTree => ({ op: 'coverage', tree, weight });

/** UE "Substrate Metalness-To-DiffuseAlbedo-F0": converts the classic metallic workflow to slab inputs. */
export function metalnessToSlab(i: { baseColor: NodeInput; metallic: NodeInput; specular?: NodeInput; roughness?: NodeInput }): SlabInputs {
  const base = toVec3(i.baseColor);
  const metal = toFloat(i.metallic);
  const spec = toFloat(i.specular ?? 0.5);
  return {
    diffuseAlbedo: base.mul(float(1).sub(metal)),
    f0: mix(vec3(spec.mul(0.08)), base, metal),
    roughness: i.roughness ?? 0.5,
  };
}

// --- Flattening ---

/** One physical BSDF: every field a node. */
interface Flat {
  albedo: Node<'vec3'>;
  f0: Node<'vec3'>;
  f90: Node<'float'>;
  roughness: Node<'float'>;
  anisotropy: Node<'float'>;
  emissive: Node<'vec3'>;
  haze: Node<'float'>;
  hazeRoughness: Node<'float'>;
  fuzz: Node<'vec3'>;
  fuzzRoughness: Node<'float'>;
  filmThickness: Node<'float'>;
  filmIor: Node<'float'>;
  sss: Node<'vec3'>;
  transmission: Node<'float'>;
  thickness: Node<'float'>;
  ior: Node<'float'>;
  height: Node<'float'>;
  coat: Node<'float'>;
  coatRoughness: Node<'float'>;
  opacity: Node<'float'>;
  normal: Node | null;
}

function toFloat(v: NodeInput): Node<'float'> {
  if (typeof v === 'number') return float(v);
  if (typeof v === 'string' || v instanceof Color) return float(new Color(v).r);
  return v as Node<'float'>;
}

function toVec3(v: NodeInput): Node<'vec3'> {
  if (typeof v === 'number') return vec3(v, v, v);
  if (typeof v === 'string' || v instanceof Color) return colorNode(new Color(v)) as unknown as Node<'vec3'>;
  const n = v as Node & { nodeType?: string | null };
  return (n.nodeType === 'float' ? vec3(n as Node<'float'>) : n) as Node<'vec3'>;
}

interface Context {
  approximations: Set<string>;
  features: Set<string>;
  coats: number;
}

function flattenSlab(i: SlabInputs, ctx: Context): Flat {
  const used = (k: keyof SlabInputs, feature: string) => i[k] !== undefined && ctx.features.add(feature);
  used('anisotropy', 'anisotropy');
  used('fuzzAmount', 'fuzz');
  used('thinFilmThickness', 'thin film');
  used('sssColor', 'subsurface');
  used('transmission', 'transmission');
  used('secondRoughnessWeight', 'haziness');
  if (i.f90 !== undefined) ctx.features.add('F90');
  if (i.sssColor !== undefined) ctx.approximations.add('Subsurface: thickness-based translucency, not Substrate MFP diffusion.');
  return {
    albedo: toVec3(i.diffuseAlbedo ?? 0.18),
    f0: toVec3(i.f0 ?? 0.04),
    f90: toFloat(i.f90 ?? 1),
    roughness: toFloat(i.roughness ?? 0.5),
    anisotropy: toFloat(i.anisotropy ?? 0),
    emissive: toVec3(i.emissive ?? 0),
    haze: toFloat(i.secondRoughnessWeight ?? 0),
    hazeRoughness: toFloat(i.secondRoughness ?? 0.5),
    fuzz: toVec3(i.fuzzColor ?? 1).mul(toFloat(i.fuzzAmount ?? 0)),
    fuzzRoughness: toFloat(i.fuzzRoughness ?? 0.5),
    filmThickness: toFloat(i.thinFilmThickness ?? 0),
    filmIor: toFloat(i.thinFilmIor ?? 1.3),
    sss: toVec3(i.sssColor ?? 0).mul(toFloat(i.sssStrength ?? (i.sssColor !== undefined ? 1 : 0))),
    transmission: toFloat(i.transmission ?? 0),
    thickness: toFloat(i.thickness ?? 0.01),
    ior: toFloat(i.ior ?? 1.5),
    height: toFloat(i.height ?? 0),
    coat: float(0),
    coatRoughness: float(0),
    opacity: float(1),
    normal: i.normal ?? null,
  };
}

function lerpFlat(a: Flat, b: Flat, t: Node<'float'>): Flat {
  const out = {} as Flat;
  for (const key of Object.keys(a) as (keyof Flat)[]) {
    if (key === 'normal') continue;
    (out as unknown as Record<string, Node>)[key] = mix(a[key] as Node<'float'>, b[key] as Node<'float'>, t);
  }
  out.normal = b.normal ?? a.normal;
  return out;
}

function flatten(tree: SubstrateTree, ctx: Context, depth = 0): Flat {
  switch (tree.op) {
    case 'slab':
      return flattenSlab(tree.inputs, ctx);
    case 'horizontalMix': {
      ctx.features.add('horizontal mixing');
      ctx.approximations.add('Horizontal mixing blends parameters (Substrate "parameter blending"), not two evaluated BSDFs.');
      return lerpFlat(flatten(tree.background, ctx, depth + 1), flatten(tree.foreground, ctx, depth + 1), toFloat(tree.mix));
    }
    case 'verticalLayer': {
      ctx.features.add('vertical layering');
      const top = flatten(tree.top, ctx, depth + 1);
      const base = flatten(tree.base, ctx, depth + 1);
      const cov = toFloat(tree.coverage);
      if (++ctx.coats > 1 || tree.top.op !== 'slab') {
        ctx.approximations.add('Only one coat layer: nested vertical layers are merged into a single clear-coat lobe.');
      }
      ctx.approximations.add('Vertical layer: top slab = clear coat (F0 0.04, top roughness); top albedo tints the base as absorption; top F0 colour is ignored.');
      return {
        ...base,
        // Absorption through the coat: white top albedo = clear coat; coloured = tinted lacquer.
        albedo: base.albedo.mul(mix(vec3(1), top.albedo, cov)),
        f0: base.f0.mul(mix(vec3(1), top.albedo, cov)),
        coat: max(base.coat, cov),
        coatRoughness: mix(base.coatRoughness, top.roughness, cov),
        fuzz: mix(base.fuzz, top.fuzz, cov),
        fuzzRoughness: mix(base.fuzzRoughness, top.fuzzRoughness, cov),
        filmThickness: mix(base.filmThickness, top.filmThickness, cov),
        emissive: base.emissive.add(top.emissive.mul(cov)),
        height: max(base.height, top.height),
      };
    }
    case 'coverage': {
      ctx.features.add('coverage');
      const inner = flatten(tree.tree, ctx, depth + 1);
      return { ...inner, opacity: inner.opacity.mul(toFloat(tree.weight)) };
    }
  }
}

export interface SubstrateResult {
  material: MeshSSSNodeMaterial;
  features: string[];
  approximations: string[];
  port: PortNotes;
}

export function createSubstrateMaterial(tree: SubstrateTree, opts: { transparent?: boolean } = {}): SubstrateResult {
  const ctx: Context = { approximations: new Set(), features: new Set(), coats: 0 };
  const f = flatten(tree, ctx);
  const m = new MeshSSSNodeMaterial();

  // Base slab. three.js dielectric F0 = 0.04 * specularColor * specularIntensity, F90 = specularIntensity (IOR 1.5).
  m.colorNode = f.albedo;
  m.metalnessNode = float(0);
  m.roughnessNode = f.roughness;
  m.specularIntensityNode = f.f90;
  m.specularColorNode = f.f0.div(max(f.f90.mul(0.04), 1e-4));
  m.iorNode = float(1.5);
  m.emissiveNode = f.emissive;
  if (f.normal) m.normalNode = f.normal;
  if (ctx.features.has('anisotropy')) m.anisotropyNode = vec2(f.anisotropy, 0);

  // Coat, or haziness on the coat lobe when there is no coat.
  if (ctx.features.has('vertical layering')) {
    m.clearcoatNode = f.coat;
    m.clearcoatRoughnessNode = f.coatRoughness;
    if (ctx.features.has('haziness')) ctx.approximations.add('Haziness ignored: the clear-coat lobe is used by the vertical layer.');
  } else if (ctx.features.has('haziness')) {
    m.clearcoatNode = f.haze;
    m.clearcoatRoughnessNode = f.hazeRoughness;
    ctx.approximations.add('Haziness: second lobe rendered with the clear-coat lobe (F0 0.04), not the slab F0.');
  }

  if (ctx.features.has('fuzz')) {
    m.sheenNode = f.fuzz;
    m.sheenRoughnessNode = f.fuzzRoughness;
  }
  if (ctx.features.has('thin film')) {
    m.iridescenceNode = f.filmThickness.greaterThan(1).select(float(1), float(0));
    m.iridescenceThicknessNode = f.filmThickness;
    m.iridescenceIORNode = f.filmIor;
  }
  if (ctx.features.has('transmission')) {
    m.transmissionNode = f.transmission;
    m.thicknessNode = f.thickness;
    m.iorNode = f.ior;
  }
  if (ctx.features.has('subsurface')) {
    m.thicknessColorNode = f.sss;
    m.thicknessPowerNode = float(4);
    m.thicknessScaleNode = float(4);
    m.thicknessDistortionNode = float(0.2);
  }
  if (ctx.features.has('coverage') || opts.transparent) {
    m.opacityNode = f.opacity;
    m.transparent = true;
  }

  debugChannel(m, 'sss', f.sss);
  debugChannel(m, 'height', f.height);

  const features = [...ctx.features];
  const approximations = [...ctx.approximations];
  return { material: m, features, approximations, port: portNotes(ctx) };
}

function portNotes(ctx: Context): PortNotes {
  const has = (f: string) => ctx.features.has(f);
  const ueNodes = ['Substrate Slab BSDF'];
  if (has('horizontal mixing')) ueNodes.push('Substrate Horizontal Mixing');
  if (has('vertical layering')) ueNodes.push('Substrate Vertical Layer');
  if (has('coverage')) ueNodes.push('Substrate Coverage Weight');
  const hdrpOnly = has('haziness') || has('thin film') || has('subsurface') || has('vertical layering');
  return {
    ue: {
      tier: 'graph',
      notes: [`${ueNodes.join(', ')}. Substrate must be enabled (default from UE 5.7).`, 'Here the tree is flattened; in UE each operator is evaluated for real, so expect richer layering.'],
    },
    unity: {
      tier: hdrpOnly ? 'graph' : 'native',
      notes: [hdrpOnly ? 'HDRP StackLit Shader Graph (coat, dual specular / haze, iridescence, SSS, anisotropy). URP: custom HLSL.' : 'URP / HDRP Lit.'],
    },
    godot: {
      tier: has('thin film') || has('haziness') || has('horizontal mixing') ? 'code' : 'native',
      notes: ['StandardMaterial3D has clearcoat, rim (approx. fuzz), subsurface, anisotropy; thin film and haze need shader code.'],
    },
    dx12: { tier: 'code', notes: ['Implement the flattened BSDF (GGX + coat + Charlie sheen + thin film) in HLSL, or a real layered model.'] },
  };
}
