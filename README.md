# three.js prototype template

A template for testing 3D graphics, gameplay visuals (trajectories, curves) and UI quickly with AI coding agents (Claude Code first, opencode compatible) and then rebuilding the result in a game engine (UE5 / Unity, with Godot 4 and plain DX12 as references).

Stack: TypeScript + Vite + `three/webgpu` (WebGPURenderer with WebGL2 fallback) + TSL node materials + lil-gui. Why: [docs/tech-stack.md](docs/tech-stack.md).

## Start

Requires Node.js 22.12+ and Corepack.

```bash
corepack enable
yarn install
yarn setup          # once per machine: Playwright Chromium for `yarn shot` (or use --channel chrome)
yarn dev            # http://127.0.0.1:5173/
```

To start a new prototype from this template: copy the folder (or use it as a GitLab/GitHub template), delete the example experiments you do not need, and edit the first line of `AGENTS.md`.

## Commands

| Command | Purpose |
| --- | --- |
| `yarn dev` | Dev server with HMR |
| `yarn typecheck` | TypeScript check (the required gate) |
| `yarn shot --exp <id>` | Render in a browser → `.shots/<id>.png` + `report.json` |
| `yarn shot --exp <id> --variants '[{"a":1},{"$stage":{"backdrop":"sky"}}]'` | One capture per variant + `.shots/sheet.png` |
| `yarn shot --exp <id> --page` | Composited page incl. the experiment's HTML overlay |
| `yarn test` | Vitest for pure logic (`src/**/*.test.ts`) |
| `yarn shot --all` | Capture every experiment (smoke check) |
| `yarn check` | `typecheck` + `shot --all` |
| `yarn new <folder>/<name> --title "..."` | Scaffold `src/experiments/<folder>/<name>/` |
| `yarn build` / `yarn preview` | Static build in `dist/` |

`yarn shot` options: `--params`, `--stage` (JSON), `--t <s>` frozen time, `--size 1280x720`, `--headed`, `--channel chrome`, `--webgl`, `--page`, `--url <running server>`. Experiment ids are folder paths, e.g. `materials/stylized-rim`.

## Using it with an agent

Ask for a look in plain words, e.g. *"Try an energy-shield material on a sphere: hex pattern, Fresnel rim, hit ripple. Target UE5."*
The agent follows `AGENTS.md` and the `proto-experiment` skill: scaffold → TSL → `yarn shot` → look at the PNG → adjust → fill port notes and `brief.md`.

Skills (in `.claude/skills/`, read by Claude Code and opencode): see [docs/skills.md](docs/skills.md).

## Page

- Left: scene browser, the folder tree of `src/experiments/`. Filter with `/`, move with ↑/↓, collapse/expand with ←/→. Dots show the UE5 / Unity port tier.
- Right: Backdrop switch, Params (from the experiment's schema), Tools (reset, copy params JSON, save PNG), Stage (sun, sky light, tone mapping, bloom).
- Backdrops: `none` (solid color), `stage` (minimalist cyclorama + pedestal), `sky` (physical sky), `space` (stars + nebula), `outdoor` (sky + ground + fog). Each also provides the sky-light IBL.
- `?exp=<id>` selects an experiment; parameter changes are mirrored to `&params=` so the URL reproduces the view.
- `&stage=<json>` overrides lighting/post, `&t=<s>` freezes time, `&shot=1` hides the UI, `&webgl=1` forces WebGL2.
- Bottom-left card: description, port tier badges per engine (hover for notes), backend / fps / draw calls.
- Keys: Space pauses time, H hides the UI. Console: `window.__proto` (`list`, `load`, `setParams`, `setStage`, `stats`, `capture`).

## Writing an experiment

```ts
// imports as in src/experiments/stylized-rim/index.ts
export default defineExperiment({
  title: 'Energy shield',
  description: 'Hex pattern + Fresnel rim on a sphere.',
  port: { ue: { tier: 'graph', notes: ['Fresnel node -> Emissive'] }, unity: { tier: 'graph' } },
  params: {
    rimColor: { type: 'color', value: '#7fd8ff' },
    rimPower: { type: 'number', value: 3, min: 0.5, max: 8 },
  },
  setup({ root, u, time }) {
    const material = new MeshStandardNodeMaterial();
    material.emissiveNode = u.rimColor.mul(fresnel(u.rimPower));
    root.add(new Mesh(new SphereGeometry(0.5, 64, 32), material));
  },
});
```

`ctx.overlay` is an HTML layer over the viewport for prototype UI, labels and legends.

Examples:
- `reference/pbr-calibration` - metallic × roughness board to match engine lighting.
- `materials/stylized-rim` - TSL Fresnel rim, noise bands, vertex wobble.
- `gameplay/projectile-curves` - straight / mortar / Bezier trajectories as scrolling dashed lines; math in `src/lib/curves.ts` (tested, engine-neutral).

## Porting

[docs/engine-port.md](docs/engine-port.md): port tiers, axis/unit conversion, lighting and tone mapping, material model and the TSL → UE / Unity / Godot / HLSL node map.

## Files

- `index.html` - Vite's entry point: the page shell (scene browser, viewport, overlay, info card) that loads `src/main.ts`. Vite serves it in dev and bundles from it in `yarn build`.
- `public/assets/` - meshes and textures; record each source in its README. Load GLB with `loadGltf()` from `src/lib/assets.ts`.
- `opencode.json` / `.claude/settings.json` - enable the ponytail plugin for opencode / Claude Code.

## Deploy

`.gitlab-ci.yml` publishes `dist/` to GitLab Pages when `prod` is pushed. `main` is the working branch.
