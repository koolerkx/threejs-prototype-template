import type { Node } from 'three/webgpu';
import { dot, float, normalView, positionViewDirection, pow, saturate } from 'three/tsl';

// Small TSL helpers with a 1:1 node in the target engines. Add a helper here only when two experiments need it,
// and name its engine equivalent in the comment so the port stays mechanical.

type FloatInput = Node<'float'> | number;

/**
 * Fresnel term: 0 facing the camera, 1 at grazing angles.
 * UE: Fresnel (Exponent, BaseReflectFraction 0). Unity: Fresnel Effect (Power). Godot: Fresnel node.
 * HLSL: pow(1 - saturate(dot(N, V)), power).
 */
export function fresnel(power: FloatInput): Node<'float'> {
  return pow(float(1).sub(saturate(dot(normalView, positionViewDirection))), power);
}
