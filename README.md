# three.js prototype template

A template for testing 3D graphics, gameplay visuals and UI quickly with AI coding agents (Claude Code first, opencode compatible), then rebuilding the result in a game engine (UE5 / Unity first; Godot 4 and plain DX12 as references).

Stack: TypeScript + Vite + `three/webgpu` (WebGPURenderer with automatic WebGL2 fallback) + TSL node materials + lil-gui. Why: [docs/tech-stack.md](docs/tech-stack.md).

## Start

Requires Node.js 22.12+ and Corepack.

```bash
corepack enable
yarn install
yarn setup          # once per machine: Playwright Chromium for `yarn shot` (or use --channel chrome)
yarn dev            # http://127.0.0.1:5173/  (opens reference/pbr-calibration)
```

New prototype from this template: copy the folder (or use it as a GitLab/GitHub template), delete the examples you do not need, and edit the first line of `AGENTS.md`.

## Features

### Page
| Feature | Where | Notes |
| --- | --- | --- |
| Scene browser | left | Folder tree of `src/experiments/`. Filter with `/`, ↑/↓ to switch, ←/→ to collapse/expand. Dots show the UE5 / Unity port tier. |
| Time transport | top | Restart, step back/forward one frame, play/pause, time field (type to seek), speed 0.1×-4×. Drives shaders (`ctx.time`) and JS animation alike. |
| Params panel | right | Generated from each experiment's param schema; units shown; changes mirrored to the URL. |
| Backdrops | right, top | `none`, `stage` (cyclorama + floor disc), `sky` (physical sky), `space` (stars + nebula), `outdoor` (sky + ground + fog). Each also provides the sky-light IBL. |
| Stage | right, Stage folder | Sun (intensity, color, elevation, azimuth), sky light (backdrop / studio / hemisphere / none), shadows, shadow catcher, 1 m grid, tone mapping (ACES / AgX / Neutral), exposure, bloom. |
| Tools | right, Tools folder | Reset params, copy params JSON (with a `world` units/axes block for engines), save PNG. |
| Info card | bottom left | Description, port tier badges per engine (hover for notes), backend / fps / draw calls / triangles. |
| Keys | | Space play/pause, `,` `.` frame step, `[` `]` speed, Home restart, H hide UI, `/` filter scenes. |

### Authoring
| Feature | API |
| --- | --- |
| Experiment registry | `export default defineExperiment({...})` in `src/experiments/<folder>/<name>/index.ts`; id = folder path. `_`-prefixed paths are skipped. |
| Params → TSL uniforms | `params: { rim: { type: 'number', value: 1, min: 0, max: 5, unit: 'm' } }` → `ctx.u.rim` (uniform), `ctx.params.rim` (value). Types: number, color, boolean, select; `rebuild: true` re-runs setup. |
| Deterministic time | `ctx.time` (TSL uniform), `update({ time, delta, frame })`; URL `?t=` starts paused at t. |
| Basic shapes | `primitiveMesh('torus', material, { onGround: true })`, `shapeParam('sphere')`. 14 engine-style 1 m shapes: cube, sphere, icosphere, cylinder, cone, pyramid, capsule, torus, torusKnot, wedge, plane, quad, rect, disc. Engine names in `PRIMITIVE_INFO`. |
| HTML overlay | `ctx.overlay` - layer over the viewport for prototype UI, labels, legends; cleared on unload. |
| Shared libs | `@/lib/nodes` (TSL helpers, e.g. `fresnel`), `@/lib/curves` (engine-neutral trajectory math, tested), `@/lib/lines` (thick / dashed lines), `@/lib/assets` (`loadGltf`). |
| Per-experiment stage | `stage: { backdrop: 'space', bloom: true }`, `camera: { position, target, fovDeg }`. |
| Port notes | `port: { ue: { tier: 'graph', notes: [...] }, unity: {...} }`, tiers `native` / `graph` / `code` / `extra`. |
| Scaffold | `yarn new <folder>/<name> --title "..."` copies `_template/` (index.ts + brief.md). |

### Agent harness
| Feature | Command / API |
| --- | --- |
| Capture | `yarn shot --exp <id>` → `.shots/<id>.png` + `report.json` (backend, draw calls, params, console errors). Blank WebGPU captures fall back to WebGL2 automatically. |
| Compare | `--variants '[{"rim":1},{"rim":3},{"$stage":{"backdrop":"sky"}}]'` → one PNG each + `.shots/sheet.png`. |
| UI capture | `--page` includes the HTML overlay. |
| Smoke | `yarn shot --all`, `yarn check` (typecheck + all captures). |
| Page API | `window.__proto`: `list`, `load`, `setParams`, `setStage`, `time({ paused, time, speed })`, `frames(n)`, `stats`, `capture`. |
| Logic tests | `yarn test` (Vitest, `src/**/*.test.ts`, pure logic only). |
| Rules / skills | `AGENTS.md` (single source; `CLAUDE.md` imports it), `.claude/skills/` (read by Claude Code and opencode), ponytail plugin. See [docs/skills.md](docs/skills.md). |

### Examples
- `reference/pbr-calibration` - metallic × roughness board to match engine lighting (default page).
- `reference/primitives` - every basic shape at its default size, labelled with engine counterparts.
- `materials/stylized-rim` - TSL Fresnel rim, noise bands, vertex wobble, spin; on the space backdrop with bloom.
- `gameplay/projectile-curves` - straight / mortar / Bezier trajectories as scrolling dashed lines.

## Commands

| Command | Purpose |
| --- | --- |
| `yarn dev` | Dev server with HMR |
| `yarn typecheck` | TypeScript check (the required gate) |
| `yarn test` | Vitest for pure logic |
| `yarn shot …` | Browser capture, see above. Options: `--params`, `--stage`, `--variants`, `--t <s>`, `--size 1280x720`, `--page`, `--headed`, `--channel chrome`, `--webgl`, `--url <running server>` |
| `yarn check` | `typecheck` + `shot --all` |
| `yarn new <folder>/<name>` | Scaffold an experiment |
| `yarn build` / `yarn preview` | Static build in `dist/` |

## URL

`?exp=<id>&params=<json>&stage=<json>&t=<s>&shot=1&webgl=1` - experiment, param overrides, stage overrides, start paused at t, capture mode (UI hidden), force WebGL2. Param changes are mirrored to the address bar, so the URL reproduces a view.

## Writing an experiment

```ts
// imports as in src/experiments/materials/stylized-rim/index.ts
export default defineExperiment({
  title: 'Energy shield',
  description: 'Fresnel rim on a sphere.',
  port: { ue: { tier: 'graph', notes: ['Fresnel node -> Emissive'] }, unity: { tier: 'graph' } },
  params: {
    shape: shapeParam('sphere'),
    rimColor: { type: 'color', value: '#7fd8ff' },
    rimPower: { type: 'number', value: 3, min: 0.5, max: 8 },
  },
  stage: { backdrop: 'space', bloom: true },
  setup({ root, params, u, time }) {
    const material = new MeshStandardNodeMaterial();
    material.emissiveNode = u.rimColor.mul(fresnel(u.rimPower)).mul(sin(time).mul(0.5).add(1));
    root.add(primitiveMesh(params.shape, material, { onGround: true }));
  },
});
```

## Files

- `index.html` - Vite's entry point: the page shell (scene browser, viewport, overlay, info card) that loads `src/main.ts`. Vite serves it in dev and bundles from it in `yarn build`.
- `src/core/` harness, `src/ui/` page UI, `src/lib/` shared code, `src/harness/debugApi.ts` page API, `scripts/` capture and scaffold.
- `public/assets/` - meshes and textures; record each source in its README.
- `docs/engine-port.md` - port tiers, axes/units, lighting, material model, TSL → UE / Unity / Godot / HLSL node map.
- `opencode.json` / `.claude/settings.json` - ponytail plugin for opencode / Claude Code.

## Deploy

`.gitlab-ci.yml` publishes `dist/` to GitLab Pages when `prod` is pushed. `main` is the working branch.
