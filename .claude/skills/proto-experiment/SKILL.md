---
name: proto-experiment
description: Create or iterate a visual experiment in this three.js prototype repo - scaffold, write the TSL look, capture, adjust, record findings. Use when the user asks to try, test, prototype or tweak a shader, material, lighting, VFX or 3D look.
---

# Prototype experiment loop

One experiment = one folder `src/experiments/<id>/` with `index.ts` (the look) and `brief.md` (the question and findings).

## 1. Frame the question
- Restate the visual question in one sentence and the target engine (UE5 / Unity / other).
- Existing experiment that is close? Copy its folder instead of starting from `_template`.
- New: `yarn new <kebab-id> --title "Readable title"`, then fill `brief.md` → Question, Reference, Target, Acceptance.
- If the user supplied reference images, save them in `src/experiments/<id>/ref/` and note the source.

## 2. Build the smallest version that shows the effect
- `defineExperiment({ title, description, port, params, setup })` - see `src/core/experiment.ts`.
- Every tunable is a `params` entry; read it in TSL through `ctx.u.<name>` (uniform, live-updated) and in JS through `ctx.params.<name>`.
  Mark a param `rebuild: true` when it changes geometry or material type; `select` params always rebuild.
- Start from a lit node material (`MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial`) and override inputs:
  `colorNode`, `roughnessNode`, `metalnessNode`, `normalNode`, `emissiveNode`, `positionNode`, `opacityNode`.
- Use `ctx.time` for animation (deterministic captures), never the TSL `time` node or `performance.now()`.
- Put objects under `ctx.root`; the harness disposes them. Return `{ update, dispose }` only when needed.
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
