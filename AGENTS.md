# Project Instructions

Throwaway three.js prototype template for testing 3D graphics fast with AI agents, then rebuilding the result in a game engine (UE5 / Unity first; Godot 4 or plain DX12 as references). Optimise for a fast look-and-adjust loop, not stability or regression coverage.

## Language
- Write explanations and progress reports to the user in Traditional Chinese (zh-HK).
- Write code, identifiers, comments, commit messages and repo docs in English.

## Stack
- TypeScript (strict) + Vite + `three/webgpu` (WebGPURenderer, auto WebGL2 fallback) + TSL node materials + lil-gui from `three/addons/libs/`. Yarn 4 via Corepack. Rationale: [docs/tech-stack.md](docs/tech-stack.md).
- `three` is the only runtime dependency. Ask before adding any dependency.
- `three` is pinned; skills may target a newer release. When an API is in doubt, check `node_modules/three` (`src/nodes/TSL.js`, `examples/jsm/`).

## Layout
- `src/experiments/<id>/index.ts` - one experiment per folder, auto-registered, `export default defineExperiment({...})`. `brief.md` beside it holds the question and findings. `_template/` is the scaffold (`yarn new <id>`).
- `src/core/` - harness: param schema → TSL uniforms, stage (sun, sky light, tone mapping, bloom), runner, clock, URL state.
- `src/lib/nodes.ts` - shared TSL helpers that have a 1:1 engine node.
- `src/harness/debugApi.ts` - `window.__proto`, the page API used by `yarn shot` and browser tools.
- `scripts/` - `shot.mjs` (capture), `new-experiment.mjs` (scaffold).

## Commands
- `yarn dev` - http://127.0.0.1:5173/?exp=<id>
- `yarn typecheck` - required after every code change.
- `yarn shot --exp <id>` - renders in a browser, writes `.shots/<id>.png` and `.shots/report.json`; `--variants '[{...}]'` writes `.shots/sheet.png`. Details: `look-check` skill.
- `yarn check` - typecheck + capture every experiment (run before committing harness changes).
- `yarn new <id> --title "..."` - scaffold an experiment.
- First run on a machine: `yarn install`, then `yarn setup` (Playwright Chromium) or pass `--channel chrome` to `yarn shot`.

## Experiment Rules
- Every tunable is a `params` entry, read through `ctx.u.<name>` in TSL and `ctx.params.<name>` in JS. One param = one engine material parameter; give units for physical values; degrees in params, radians in code.
- Animate with `ctx.time` / `FrameInfo`, never the TSL `time` node or wall-clock time, so captures are reproducible.
- Start from a lit node material and override its inputs; replacing the whole output or the lighting model pushes the port to `code`/`extra` - only do it when the experiment is about that.
- Create objects under `ctx.root` (auto-disposed). Release anything else in `dispose()`.
- Keep each experiment self-contained. Change `src/core`, `src/ui` or `scripts` only for a reason that helps every experiment; run `yarn check` afterwards.
- Fill `port` (tier + short notes per engine) before calling an experiment done. Mapping tables: [docs/engine-port.md](docs/engine-port.md). Targets are a purpose, not a hard rule.
- World: 1 unit = 1 m, +Y up, ground at y = 0.

## Verification
- `yarn typecheck` must pass.
- For any visual change, capture with `yarn shot` and look at the PNG before reporting. Never describe a visual result you did not look at.
- No test suites, evidence ledgers, PASS/FAIL reports or review subagents unless the user asks.
- Do not change requested visual behaviour to make a check pass; ask instead.

## Git
- Commit freely at natural checkpoints: one experiment or one harness change per commit, conventional subject (`feat(<id>):`, `fix:`, `chore:`, `docs:`). Stage only that change's files.
- Never commit `.shots/`, `dist/` or local agent state.

## Skills
- `.claude/skills/` is read by Claude Code and opencode. Start with `proto-experiment`; `look-check` for captures; `engine-port` for port notes; `webgpu-threejs-tsl` for TSL syntax. Index and sources: [docs/skills.md](docs/skills.md).
- Project rules override skill advice; installing anything a skill suggests needs approval.

## Maintaining This File
- Keep only rules that change how the next agent works. Replace a rule when it stops matching the code; do not append contradicting revisions.
- Feature notes, tuning values and history belong in the experiment's `brief.md`, not here.
