import { SRGBColorSpace, type Material, type Node, type PerspectiveCamera, type Scene, type ToneMapping } from 'three/webgpu';
import {
  ambientOcclusion, anisotropy, clearcoat, clearcoatRoughness, diffuseColor, emissive, float, floor, iridescence, metalness,
  mrt, normalWorld, output, packNormalToRGB, pass, renderOutput, roughness, screenUV, sheen, sheenRoughness, specularColor,
  perspectiveDepthToViewZ, sRGBTransferOETF, transmission, uv, vec2, vec3, vec4,
} from 'three/tsl';

// Buffer visualisation, like UE's View Mode → Buffer Visualization. Each channel is one material property written
// through MRT by a dedicated pass. Properties a material does not use read as their defaults (usually 0).

export const VIEW_MODES = [
  'lit', 'wireframe', 'sheet',
  'baseColor', 'normal', 'roughness', 'metallic', 'specular', 'ao', 'emissive', 'opacity',
  'clearcoat', 'clearcoatRoughness', 'fuzz', 'fuzzRoughness', 'anisotropy', 'thinFilm', 'transmission', 'sss', 'height',
  'uv', 'depth',
] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Custom channels: not three.js material properties; a material publishes them with `debugChannel()`. */
export type CustomChannel = 'sss' | 'height';

type Channel =
  | { kind: 'property'; node: () => Node; color?: boolean }
  | { kind: 'custom'; node: () => Node; color?: boolean }
  | { kind: 'depth'; color?: false };

const UV_CHECKER_CELLS = 8;
const gray = (n: Node<'float'>) => vec4(vec3(n), 1);

/** Channel per view mode; `lit` and `wireframe` render the shaded image instead. */
export const VIEW_CHANNELS: Partial<Record<ViewMode, Channel>> = {
  baseColor: { kind: 'property', node: () => vec4(diffuseColor.rgb, 1), color: true },
  normal: { kind: 'property', node: () => vec4(packNormalToRGB(normalWorld), 1) },
  roughness: { kind: 'property', node: () => gray(roughness) },
  metallic: { kind: 'property', node: () => gray(metalness) },
  // F0 x 12.5 = UE "Specular" scale: a dielectric F0 of 0.04 shows as 0.5 grey; metals saturate.
  specular: { kind: 'property', node: () => vec4(specularColor.mul(12.5).min(1), 1) },
  ao: { kind: 'property', node: () => gray(ambientOcclusion) },
  emissive: { kind: 'property', node: () => vec4(emissive, 1), color: true },
  opacity: { kind: 'property', node: () => gray(diffuseColor.a) },
  clearcoat: { kind: 'property', node: () => gray(clearcoat) },
  clearcoatRoughness: { kind: 'property', node: () => gray(clearcoatRoughness) },
  fuzz: { kind: 'property', node: () => vec4(sheen, 1), color: true },
  fuzzRoughness: { kind: 'property', node: () => gray(sheenRoughness) },
  anisotropy: { kind: 'property', node: () => gray(anisotropy) },
  thinFilm: { kind: 'property', node: () => gray(iridescence) },
  transmission: { kind: 'property', node: () => gray(transmission) },
  sss: { kind: 'custom', node: () => vec4(0, 0, 0, 1), color: true },
  height: { kind: 'custom', node: () => vec4(0, 0, 0, 1) },
  uv: {
    kind: 'property',
    node: () => {
      const t = uv();
      const cell = floor(t.mul(UV_CHECKER_CELLS));
      const checker = cell.x.add(cell.y).mod(2).mul(0.25).add(0.75);
      return vec4(t.x.mul(checker), t.y.mul(checker), float(0.2).mul(checker), 1);
    },
  },
  depth: { kind: 'depth' },
};

const CHANNELS_KEY = 'debugChannels';

/**
 * Publishes a custom debug channel of a material, shown by the matching view mode:
 *   debugChannel(material, 'height', heightNode)   // 0..1
 *   debugChannel(material, 'sss', sssColorNode)    // colour
 */
export function debugChannel(material: Material, channel: CustomChannel, node: Node): void {
  const map = (material.userData[CHANNELS_KEY] ??= {}) as Partial<Record<CustomChannel, Node>>;
  map[channel] = node;
}

/** The node a view mode should write for `material`, when the channel is custom and published. */
export function customChannelNode(material: Material, view: ViewMode): Node | null {
  const map = material.userData[CHANNELS_KEY] as Partial<Record<CustomChannel, Node>> | undefined;
  const node = map?.[view as CustomChannel];
  if (!node) return null;
  return view === 'height' ? gray(node as Node<'float'>) : vec4(node as Node<'vec3'>, 1);
}

/** Packed custom channels for the sheet view: rgb = sss, a = height. */
export function customSheetNode(material: Material): Node | null {
  const map = material.userData[CHANNELS_KEY] as Partial<Record<CustomChannel, Node>> | undefined;
  if (!map) return null;
  return vec4((map.sss as Node<'vec3'> | undefined) ?? vec3(0), (map.height as Node<'float'> | undefined) ?? float(0));
}

// --- Sheet view: every channel at once, in real time ---

export const SHEET_COLUMNS = 5;
export const SHEET_TILES = [
  'lit', 'baseColor', 'normal', 'roughness', 'metallic',
  'specular', 'ao', 'emissive', 'opacity', 'clearcoat',
  'clearcoatRoughness', 'fuzz', 'fuzzRoughness', 'anisotropy', 'thinFilm',
  'transmission', 'sss', 'height', 'uv', 'depth',
] as const;
export const SHEET_ROWS = Math.ceil(SHEET_TILES.length / SHEET_COLUMNS);

export interface Sheet {
  output: Node;
  dispose(): void;
}

/**
 * Renders the scene twice with MRT (at most 5 targets per pass, so WebGL2 works too) and tiles all channels in a
 * 5 x 4 grid. Lit is tone mapped; colour channels are sRGB encoded; data channels show raw values.
 */
export function createSheet(scene: Scene, camera: PerspectiveCamera, toneMapping: ToneMapping, depthRange: Node<'float'>): Sheet {
  const p1 = pass(scene, camera);
  p1.setMRT(mrt({
    output,
    a: vec4(diffuseColor.rgb, diffuseColor.a),
    b: vec4(packNormalToRGB(normalWorld), roughness),
    c: vec4(metalness, ambientOcclusion, clearcoat, clearcoatRoughness),
  }));
  const p2 = pass(scene, camera);
  p2.setMRT(mrt({
    output,
    d: vec4(specularColor, anisotropy),
    e: vec4(emissive, iridescence),
    f: vec4(sheen, sheenRoughness),
    g: vec4(0, 0, 0, 0), // custom: rgb = sss, a = height (materials override through mrtNode)
    h: vec4(transmission, uv(), 0),
  }));

  const cell = floor(screenUV.mul(vec2(SHEET_COLUMNS, SHEET_ROWS)));
  // Each tile shows the centre of the frame at the frame's aspect ratio (tile aspect / frame aspect = ROWS / COLUMNS).
  const tileUV = screenUV.mul(vec2(SHEET_COLUMNS, SHEET_ROWS)).fract();
  const local = vec2(tileUV.x.sub(0.5).mul(SHEET_ROWS / SHEET_COLUMNS).add(0.5), tileUV.y);
  const index = cell.y.mul(SHEET_COLUMNS).add(cell.x);
  const at = (p: ReturnType<typeof pass>, name: string) => p.getTextureNode(name).sample(local);
  const srgb = (c: Node) => vec4(sRGBTransferOETF(c as Node<'vec3'>) as Node<'vec3'>, 1);
  const g1 = (x: Node) => vec4(vec3(x as Node<'float'>), 1);
  const a = at(p1, 'a');
  const b = at(p1, 'b');
  const c = at(p1, 'c');
  const d = at(p2, 'd');
  const e = at(p2, 'e');
  const f = at(p2, 'f');
  const g = at(p2, 'g');
  const h = at(p2, 'h');
  const uvCell = floor(h.yz.mul(UV_CHECKER_CELLS));
  const checker = uvCell.x.add(uvCell.y).mod(2).mul(0.25).add(0.75);
  const rawDepth = p1.getTextureNode('depth').sample(local).r;
  // The composite runs with the full-screen quad's camera, so use the scene camera's planes explicitly.
  const viewZ = perspectiveDepthToViewZ(rawDepth, float(camera.near), float(camera.far));
  const depthSample = float(1).sub(viewZ.negate().div(depthRange).clamp(0, 1));

  const tiles: Record<(typeof SHEET_TILES)[number], Node> = {
    lit: vec4(renderOutput(at(p1, 'output'), toneMapping, SRGBColorSpace).rgb, 1),
    baseColor: srgb(a.rgb),
    normal: vec4(b.rgb, 1),
    roughness: g1(b.a),
    metallic: g1(c.r),
    specular: vec4(d.rgb.mul(12.5).min(1), 1),
    ao: g1(c.g),
    emissive: srgb(e.rgb),
    opacity: g1(a.a),
    clearcoat: g1(c.b),
    clearcoatRoughness: g1(c.a),
    fuzz: srgb(f.rgb),
    fuzzRoughness: g1(f.a),
    anisotropy: g1(d.a),
    thinFilm: g1(e.a),
    transmission: g1(h.r),
    sss: srgb(g.rgb),
    height: g1(g.a),
    uv: vec4(h.y.mul(checker), h.z.mul(checker), float(0.2).mul(checker), 1),
    depth: g1(depthSample),
  };
  let result: Node = vec4(0, 0, 0, 1);
  SHEET_TILES.forEach((name, i) => {
    result = index.equal(i).select(tiles[name] as Node<'vec4'>, result as Node<'vec4'>);
  });
  // Thin separators between tiles.
  const edge = tileUV.x.lessThan(0.004).or(tileUV.y.lessThan(0.006));
  const outputNode = edge.select(vec4(0.08, 0.08, 0.09, 1), result as Node<'vec4'>);
  return { output: outputNode, dispose: () => { p1.dispose(); p2.dispose(); } };
}
