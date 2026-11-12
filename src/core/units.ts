// World conventions shared by every experiment. See docs/engine-port.md for the engine conversions.
//   Length: 1 unit = 1 metre (UE: x100 cm). Up axis: +Y. Handedness: right-handed, camera looks down -Z.
//   Time: seconds. Angles: radians in code, degrees in parameters (suffix `Deg`).

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** UE uses centimetres. */
export const UE_UNITS_PER_METRE = 100;
