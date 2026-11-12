import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry,
  IcosahedronGeometry, Mesh, PlaneGeometry, Shape, SphereGeometry, TorusGeometry, TorusKnotGeometry, Vector2, type Material,
} from 'three/webgpu';

// Engine-style basic shapes. Default size: 1 m extent, pivot at the centre, like UE BasicShapes (100 cm) and
// Unity primitives, so a look built on `cube` here matches a Cube dropped into the engine.
// 2D shapes are single-sided like their engine counterparts: plane / disc face +Y, quad / rect face +Z.
//
//   const mesh = primitiveMesh('torus', material, { onGround: true });   // mesh sitting on y = 0
//   params: { shape: shapeParam('sphere') }  ->  primitiveMesh(params.shape, material)

export const PRIMITIVES = [
  'cube', 'sphere', 'icosphere', 'cylinder', 'cone', 'pyramid', 'capsule', 'torus', 'torusKnot', 'wedge',
  'plane', 'quad', 'rect', 'disc',
] as const;
export type PrimitiveName = (typeof PRIMITIVES)[number];

/** Engine counterparts, for port notes and the reference scene. */
export const PRIMITIVE_INFO: Record<PrimitiveName, { size: string; ue: string; unity: string; godot: string }> = {
  cube: { size: '1 × 1 × 1 m', ue: 'Cube', unity: 'Cube', godot: 'BoxMesh' },
  sphere: { size: 'Ø 1 m (UV)', ue: 'Sphere', unity: 'Sphere', godot: 'SphereMesh' },
  icosphere: { size: 'Ø 1 m (even tris)', ue: 'Modeling: Sphere (Box)', unity: 'ProBuilder Icosphere', godot: 'SphereMesh' },
  cylinder: { size: 'Ø 1 m, h 1 m', ue: 'Cylinder', unity: 'Cylinder (h 2 m: scale Y 0.5)', godot: 'CylinderMesh (h 2: scale)' },
  cone: { size: 'Ø 1 m, h 1 m', ue: 'Cone', unity: 'ProBuilder Cone', godot: 'CylinderMesh top_radius 0' },
  pyramid: { size: '1 × 1 base, h 1 m', ue: 'Modeling: Cone, 4 sides', unity: 'ProBuilder Cone, 4 sides', godot: 'CylinderMesh 4 segments' },
  capsule: { size: 'Ø 1 m, h 2 m', ue: 'Modeling: Capsule', unity: 'Capsule', godot: 'CapsuleMesh' },
  torus: { size: 'Ø 1 m, tube Ø 0.25 m', ue: 'Modeling: Torus', unity: 'ProBuilder Torus', godot: 'TorusMesh' },
  torusKnot: { size: '~1 m', ue: 'imported mesh', unity: 'imported mesh', godot: 'imported mesh' },
  wedge: { size: '1 × 1 × 1 m prism', ue: 'Modeling: Stairs/Wedge', unity: 'ProBuilder Prism', godot: 'PrismMesh' },
  plane: { size: '1 × 1 m, faces +Y', ue: 'Plane', unity: 'Plane (10 m: scale 0.1)', godot: 'PlaneMesh (2 m: scale 0.5)' },
  quad: { size: '1 × 1 m, faces +Z', ue: 'Plane rotated', unity: 'Quad', godot: 'QuadMesh' },
  rect: { size: 'w × h, faces +Z', ue: 'Plane scaled', unity: 'Quad scaled', godot: 'QuadMesh size' },
  disc: { size: 'Ø 1 m, faces +Y', ue: 'Modeling: Disc', unity: 'ProBuilder Disc', godot: 'imported mesh' },
};

export interface PrimitiveOptions {
  /** Uniform scale of the 1 m default (m). */
  size?: number;
  /** Tessellation: 'low' for faceted looks, 'high' for smooth shading tests. Default 'medium'. */
  detail?: 'low' | 'medium' | 'high';
  /** rect only, in metres. */
  width?: number;
  height?: number;
}

const SEGMENTS = { low: 0.25, medium: 1, high: 2 } as const;

/** Creates the geometry of a basic shape, centred on its bounding box. */
export function createPrimitive(name: PrimitiveName, opts: PrimitiveOptions = {}): BufferGeometry {
  const k = SEGMENTS[opts.detail ?? 'medium'];
  const seg = (n: number) => Math.max(3, Math.round(n * k));
  let g: BufferGeometry;
  switch (name) {
    case 'cube':
      g = new BoxGeometry(1, 1, 1);
      break;
    case 'sphere':
      g = new SphereGeometry(0.5, seg(64), seg(32));
      break;
    case 'icosphere':
      g = new IcosahedronGeometry(0.5, Math.max(1, Math.round(4 * k)));
      break;
    case 'cylinder':
      g = new CylinderGeometry(0.5, 0.5, 1, seg(64));
      break;
    case 'cone':
      g = new ConeGeometry(0.5, 1, seg(64));
      break;
    case 'pyramid':
      g = new ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4); // square 1 x 1 base
      break;
    case 'capsule':
      g = new CapsuleGeometry(0.5, 1, seg(16), seg(32));
      break;
    case 'torus':
      g = new TorusGeometry(0.375, 0.125, seg(32), seg(96)).rotateX(-Math.PI / 2); // lying flat, like UE/Godot
      break;
    case 'torusKnot':
      g = new TorusKnotGeometry(0.3, 0.1, seg(192), seg(32));
      break;
    case 'wedge': {
      const shape = new Shape([new Vector2(-0.5, -0.5), new Vector2(0.5, -0.5), new Vector2(0, 0.5)]);
      g = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
      break;
    }
    case 'plane':
      g = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      break;
    case 'quad':
      g = new PlaneGeometry(1, 1);
      break;
    case 'rect':
      g = new PlaneGeometry(opts.width ?? 1.6, opts.height ?? 0.9);
      break;
    case 'disc':
      g = new CircleGeometry(0.5, seg(64)).rotateX(-Math.PI / 2);
      break;
  }
  g.computeBoundingBox();
  const box = g.boundingBox!;
  g.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
  if (opts.size !== undefined && opts.size !== 1) g.scale(opts.size, opts.size, opts.size);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Mesh of a basic shape. `onGround` lifts it so its lowest point sits on y = 0. */
export function primitiveMesh(
  name: PrimitiveName,
  material: Material,
  opts: PrimitiveOptions & { onGround?: boolean } = {},
): Mesh {
  const geometry = createPrimitive(name, opts);
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  if (opts.onGround) mesh.position.y = -geometry.boundingBox!.min.y;
  return mesh;
}

/** A `select` param over all primitives: `params: { shape: shapeParam('sphere') }`. Changing it rebuilds. */
export function shapeParam(value: PrimitiveName = 'sphere', label = 'Shape') {
  return { type: 'select', value, options: PRIMITIVES, label } as const;
}
