---
name: proto-experiment
description: Create or iterate a visual experiment in this three.js prototype repo - scaffold, write the TSL look, capture, adjust, record findings. Use when the user asks to try, test, prototype or tweak a shader, material, lighting, VFX or 3D look.
---

# Prototype experiment loop

One experiment = one folder `src/experiments/<folder>/<name>/` with `index.ts` (the look) and `brief.md` (the question and findings). The id is the folder path; folders group scenes in the browser (`materials/`, `vfx/`, `gameplay/`, `ui/`, `reference/`).

## 1. Frame the question
- Restate the visual question in one sentence and the target engine (UE5 / Unity / other).
- Existing experiment that is close? Copy its folder instead of starting from `_template`.
- New: `yarn new <folder>/<kebab-name> --title "Readable title"`, then fill `brief.md` → Question, Reference, Target, Acceptance.
- If the user supplied reference images, save them in `src/experiments/<id>/ref/` and note the source.

## 2. Build the smallest version that shows the effect
- `defineExperiment({ title, description, port, params, setup })` - see `src/core/experiment.ts`.
- Every tunable is a `params` entry; read it in TSL through `ctx.u.<name>` (uniform, live-updated) and in JS through `ctx.params.<name>`.
  Mark a param `rebuild: true` when it changes geometry or material type; `select` params always rebuild.
- Start from a lit node material (`MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial`) and override inputs:
  `colorNode`, `roughnessNode`, `metalnessNode`, `normalNode`, `emissiveNode`, `positionNode`, `opacityNode`.
- Use `ctx.time` / `update({ time })` for animation, never the TSL `time` node or `performance.now()`; the transport (pause, speed, seek, frame step) and captures depend on it. Write motion as a function of `time` rather than accumulating `delta`.
- Basic shapes: `primitiveMesh(name, material, { onGround: true })` and `shapeParam('sphere')` from `@/lib/primitives` (1 m engine-style sizes).
- Put objects under `ctx.root` and HTML under `ctx.overlay`; the harness clears both. Return `{ update, onParam, dispose }` only when needed.
- Import with the `@/` alias (`@/core/experiment`, `@/lib/nodes`).
- Choose the judging context with `stage: { backdrop: 'none' | 'stage' | 'sky' | 'space' | 'outdoor' }`.
- Gameplay/logic experiments: math in plain functions with number tuples (see `src/lib/curves.ts`) plus a small `*.test.ts` (`yarn test`); draw with `src/lib/lines.ts`.
- UI prototypes: HTML/CSS in `ctx.overlay`, capture with `yarn shot --page`.
- Assets: put files in `public/assets/`, record the source in its README, load GLB with `loadGltf()` from `@/lib/assets`.
- Shared helpers with an engine twin go in `src/lib/nodes.ts` (only once two experiments need them).
- For TSL syntax and node names, load the `webgpu-threejs-tsl` skill; verify against `node_modules/three` (pinned version) when unsure.

## 3. Look at it
- `yarn typecheck` - fix all errors first; it is the fastest signal.
- `yarn shot --exp <id>` → read `.shots/<id>.png`. Compare settings with `--variants '[{...},{...}]'` → read `.shots/sheet.png`.
- See the `look-check` skill for what to check and how to read `report.json`.
- Iterate: one change → shot → judge. Stop when the brief's Acceptance is met or the user decides.

## 4. Record
- Fill `port` tiers and short notes per engine (load the `engine-port` skill).
- Write `brief.md` → Findings: chosen params (from `current().params` in report.json), what failed, port caveats.
- Commit the experiment folder as one commit (`feat(<id>): ...`).

## Do not
- Add npm dependencies without asking.
- Write test suites, evidence ledgers or PASS/FAIL reports.
- Change the harness (`src/core`, `src/ui`, `scripts`) to make one experiment work; ask first, or keep the workaround inside the experiment.
