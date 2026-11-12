# Engine port reference

Prototypes here exist to answer a visual question fast, then rebuild the answer in a game engine.
UE5 and Unity are the primary targets; Godot 4 and a plain DirectX 12 / HLSL renderer are references.
These are goals, not hard rules: an experiment may use something an engine lacks, as long as its port notes say so.

## 1. Tiers

Every experiment declares a tier per engine in `port` (shown as badges in the page).

| Tier | Meaning | UE5 | Unity | Godot 4 | DX12 |
| --- | --- | --- | --- | --- | --- |
| `native` | built-in material, parameters only | Material Instance on Default Lit | URP/HDRP Lit | StandardMaterial3D | standard PBR pass |
| `graph` | one node-graph material, no code | Material Graph | Shader Graph | VisualShader | (code by definition) |
| `code` | shader code inside the material | Custom node / `.ush` include | Custom Function (HLSL) | shader language | HLSL |
| `extra` | more than one material | extra mesh, Niagara, post process, Blueprint | extra mesh, VFX Graph, Renderer Feature, script | extra node, GPUParticles3D, CompositorEffect | extra pass |

## 2. World conventions

| | three.js (this repo) | UE5 | Unity | Godot 4 |
| --- | --- | --- | --- | --- |
| Length | 1 unit = 1 m | 1 unit = 1 cm | 1 m | 1 m |
| Up | +Y | +Z | +Y | +Y |
| Handedness | right | left | left | right |
| Forward (convention) | -Z | +X | +Z | -Z |
| Position from three.js | - | `(-z, x, y) * 100` | `(x, y, -z)` | same |

The UE and Unity rows assume the object faces -Z in three.js. An axis flip mirrors geometry, so importers also flip triangle winding; use glTF/FBX export rather than copying vertex data by hand.

Angles are degrees in parameters (`…Deg`) and radians in code. Time is seconds; use `ctx.time`, not the TSL `time` node.

## 3. Lighting and tone mapping

- Do not transfer raw light intensities between engines; the units differ (UE5 sun in lux, Unity URP in arbitrary units). Calibrate instead: rebuild `pbr-calibration` in the engine, match exposure until the boards agree, then judge looks.
- Tone mapping: `ACES` ≈ UE5 filmic tone mapper and Unity ACES; `Neutral` = Khronos PBR Neutral (Unity URP Neutral); `AgX` is available in Godot 4.4+ and Blender. Disable auto exposure in the engine while comparing.
- Sky light: `studio` uses three.js `RoomEnvironment` (an IBL box). In the engine, use a Sky Light / Reflection Probe with a similar neutral cubemap.
- Colors in parameters are sRGB hex. Enter the same hex in the engine color picker (UE, Unity and Godot pickers all show sRGB hex) and the linear value matches.

## 4. Material model

| three.js | UE5 | Unity | Godot 4 |
| --- | --- | --- | --- |
| `MeshStandardNodeMaterial` | Default Lit | URP Lit (Metallic) | StandardMaterial3D |
| `roughness` | Roughness | Smoothness = 1 - roughness | roughness |
| `specularIntensity * 0.5` (Physical) | Specular (F0 = 0.08 × Specular) | (fixed 0.04 in Metallic workflow) | `metallic_specular` |
| `emissive` / `emissiveNode` | Emissive Color | Emission | emission |
| Physical `clearcoat` | Clear Coat model / Substrate | URP Complex Lit, HDRP Lit coat | `clearcoat` |
| Physical `sheen` | Cloth / Substrate Fuzz | HDRP Fabric | none (approximate with rim) |
| Physical `iridescence` | Substrate Thin Film | HDRP Lit iridescence | none |
| Physical `transmission` | Thin Translucent / Substrate | HDRP transmission | screen-space refraction |
| `MeshBasicNodeMaterial` | Unlit | URP Unlit | `unshaded` |
| `MeshToonNodeMaterial` | no built-in: emissive trick or custom shading model | Shader Graph custom lighting | `diffuse_toon` |

Prefer overriding inputs of a lit node material (`colorNode`, `roughnessNode`, `metalnessNode`, `normalNode`, `emissiveNode`, `positionNode`, `opacityNode`). Replacing the whole output (`fragmentNode`, `outputNode`) or writing a custom lighting model moves the look to `code` or `extra` in every engine.

## 5. TSL node map

| TSL | UE5 Material Graph | Unity Shader Graph | Godot 4 | HLSL |
| --- | --- | --- | --- | --- |
| `positionLocal` | Local Position | Position (Object) | `VERTEX` (vertex stage) | `input.positionOS` |
| `positionWorld` | Absolute World Position | Position (World) | `(MODEL_MATRIX * vec4(VERTEX, 1)).xyz` | `mul(World, pos)` |
| `normalWorld` | Vertex / Pixel Normal WS | Normal Vector (World) | `NORMAL` is view space in fragment | `normalWS` |
| `normalView` | Transform (World → View) of normal | Normal Vector (View) | `NORMAL` (fragment) | `mul(View, normalWS)` |
| `positionViewDirection` | Camera Vector | View Direction | `VIEW` | `normalize(cameraPos - posWS)` |
| `uv()` | TexCoord[0] | UV0 | `UV` | `uv0` |
| `ctx.time` | Time | Time | `TIME` | constant buffer time |
| `ctx.u.<param>` (uniform) | Scalar / Vector Parameter | exposed Property | `uniform` / Parameter node | constant buffer field |
| `texture(map, uv)` | Texture Sample (Texture Parameter) | Sample Texture 2D | `texture()` | `Texture2D.Sample` |
| `mix` | Lerp | Lerp | `mix` | `lerp` |
| `smoothstep` | SmoothStep | Smoothstep | `smoothstep` | `smoothstep` |
| `sin(x)` | **Sine with Period = 2π** (default period is 1) | Sine | `sin` | `sin` |
| `fract` / `floor` | Frac / Floor | Fraction / Floor | `fract` / `floor` | `frac` / `floor` |
| `fresnel()` (`src/lib/nodes.ts`) | Fresnel (BaseReflectFraction 0) | Fresnel Effect | Fresnel node | `pow(1 - saturate(dot(N, V)), p)` |
| `mx_noise_float` and other noise | Noise node (different algorithm) | Gradient / Simple Noise (different) | NoiseTexture2D/3D | port the function |
| `positionNode` | **World Position Offset**: world-space *offset*, cm | Vertex Position: object-space *absolute* | `VERTEX` (object space) | vertex shader |
| `emissiveNode` | Emissive Color | Emission | `EMISSION` | output |
| `opacityNode` + `alphaTest` | Opacity Mask (Masked) | Alpha Clip Threshold | `ALPHA_SCISSOR_THRESHOLD` | `clip()` |
| `Fn(...)` | Material Function | Sub Graph | Expression node / function | function |
| compute (`Fn().compute()`) | Niagara GPU sim / compute shader | VFX Graph / Compute Shader | GPUParticles3D / RenderingDevice | compute shader |
| render pipeline post nodes (`bloom`, …) | Post Process Volume / Material | Volume overrides / Renderer Feature | Environment / CompositorEffect | post pass |

Noise is the usual mismatch: engine noise nodes are different functions. When the exact pattern matters, port the TSL function to HLSL (UE Custom node / Unity Custom Function) or bake it to a tiling texture.

## 6. Porting checklist

1. Rebuild `pbr-calibration` in the engine and match exposure.
2. In the page, use *Tools → Copy params JSON*; the JSON is the source of truth for parameter values.
3. Create one material parameter per experiment parameter, same name in PascalCase, same default and range.
4. Rebuild the node chain with the table above; keep the TSL structure (one TSL expression ≈ one engine node).
5. Capture the same camera in both (`yarn shot --exp <id> --t <s>` here) and compare side by side.
6. Record differences and decisions in the experiment's `brief.md` → *Findings*.
