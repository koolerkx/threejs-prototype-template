# Project Instructions

Throwaway three.js prototype template for testing 3D graphics, gameplay visuals and UI quickly with AI agents, then rebuilding the result in a game engine (UE5 / Unity first; Godot 4 or plain DX12 as references). Optimise for a fast look-and-adjust loop, not stability or regression coverage.

## Language
- Write explanations and progress reports to the user in Traditional Chinese (zh-HK).
- Write code, identifiers, comments, commit messages and repo docs in English.

## Stack
- TypeScript (strict) + Vite + `three/webgpu` (WebGPURenderer, auto WebGL2 fallback) + TSL node materials + lil-gui from `three/addons/libs/`. Yarn 4 via Corepack. Rationale: [docs/tech-stack.md](docs/tech-stack.md).
- Runtime dependencies: `three`, and `gifenc` for GIF export. Ask before adding any dependency.
- `three` is pinned; skills may target a newer release. When an API is in doubt, check `node_modules/three` (`src/nodes/TSL.js`, `examples/jsm/`).
- Import project code through the `@/` alias (`@/core/experiment`, `@/lib/curves`) so experiment folders can move.

## Layout
- `src/experiments/<folder>/<name>/index.ts` - one experiment per folder, auto-registered; the id is the folder path (`materials/stylized-rim`) and folders form the scene browser tree. `brief.md` beside it holds the question and findings. Paths with a `_` segment are skipped (`_template/` is the scaffold).
- `src/core/` - harness: param schema → TSL uniforms, stage (sun, sky light, backdrops, tone mapping, bloom), runner, clock, URL state.
- `src/lib/` - shared code with an engine twin: `primitives.ts` (engine-style basic shapes), `nodes.ts` (TSL helpers), `curves.ts` (engine-neutral trajectory math), `lines.ts` (thick/dashed lines), `assets.ts` (glTF loading).
- `src/ui/` - scene browser + presets (left), time transport + camera bookmarks (top), perf HUD (top left), lil-gui panel (right), info card.
- `src/core/` also holds `perf.ts` (budgets), `store.ts` (IndexedDB presets/thumbnails), `hdri.ts`, `session.ts` (state across reloads). `src/assets/hdri/` holds the HDRIs. `src/harness/debugApi.ts` - `window.__proto`.
- `public/assets/` - asset files; record each source in its README.
- `scripts/` - `shot.mjs` (capture), `new-experiment.mjs` (scaffold).

## Commands
- `yarn dev` - http://127.0.0.1:5173/?exp=<id>
- `yarn typecheck` - required after every code change.
- `yarn shot --exp <id>` - renders in a browser, writes `.shots/<id>.png` and `.shots/report.json`; `--variants '[{...}]'` (params, plus `"$stage": {...}`) writes `.shots/sheet.png`; `--range a:b` writes a motion filmstrip (`--gif` adds a GIF); `--cam n` / `--camera` set the view; `--page` includes the HTML overlay. Details: `look-check` skill.
- `yarn test` - Vitest, pure logic only (`src/**/*.test.ts`).
- `yarn check` - typecheck + capture every experiment (run before committing harness changes).
- `yarn new <folder>/<name> --title "..."` - scaffold an experiment.
- First run on a machine: `yarn install`, then `yarn setup` (Playwright Chromium) or pass `--channel chrome` to `yarn shot`.

## Experiment Rules
- Every tunable is a `params` entry, read through `ctx.u.<name>` in TSL and `ctx.params.<name>` in JS. One param = one engine parameter; give units for physical values; degrees in params, radians in code.
- Animate with `ctx.time` / `FrameInfo.time`, never the TSL `time` node or wall-clock time: the transport (pause, speed, seek, frame step) and captures depend on it. Prefer functions of `time` over accumulating `delta`, so seeking and stepping back stay correct.
- Use `primitiveMesh()` / `shapeParam()` from `@/lib/primitives` for basic shapes, so sizes match engine primitives.
- Materials: start from a lit node material and override its inputs; replacing the whole output or the lighting model pushes the port to `code`/`extra` - only do it when the experiment is about that.
- Gameplay and logic: keep the math in plain functions with number tuples (like `src/lib/curves.ts`) so it ports line-for-line to C++/C#; draw it separately. Give branchy or numeric logic a small `*.test.ts`.
- UI prototypes: build HTML in `ctx.overlay`; capture with `yarn shot --page`.
- Create objects under `ctx.root` and DOM under `ctx.overlay` (both cleared on unload). Release anything else in `dispose()`.
- Pick a backdrop in the experiment's `stage` (`none`, `stage`, `sky`, `space`, `outdoor`, `hdri`) when the look is judged in context.
- Give experiments that need several angles `bookmarks`, and tight-budget ones (VFX, mobile) a `budget` override; check `stats().overBudget` / the shot report.
- To hand chosen looks back, write `presets.json` next to the experiment (the page's Export format).
- Keep each experiment self-contained. Change `src/core`, `src/ui` or `scripts` only for a reason that helps every experiment; run `yarn check` afterwards.
- Fill `port` (tier + short notes per engine) before calling an experiment done. Mapping tables: [docs/engine-port.md](docs/engine-port.md). Targets are a purpose, not a hard rule.
- World: 1 unit = 1 m, +Y up, ground at y = 0.

## Verification
- `yarn typecheck` must pass; `yarn test` too when logic with tests changed.
- For any visual change, capture with `yarn shot` and look at the PNG before reporting. Never describe a visual result you did not look at. For motion, look at the `--range` filmstrip; for material channels, use buffer views (`--stage '{"view":"normal"}'`).
- No visual regression suites, evidence ledgers, PASS/FAIL reports or review subagents unless the user asks.
- Do not change requested visual behaviour to make a check pass; ask instead.

## Git
- Commit freely at natural checkpoints: one experiment or one harness change per commit, conventional subject (`feat(<id>):`, `fix:`, `chore:`, `docs:`). Stage only that change's files.
- Never commit `.shots/`, `dist/` or local agent state.

## Skills and Plugins
- `.claude/skills/` is read by Claude Code and opencode. Start with `proto-experiment`; `look-check` for captures; `engine-port` for port notes; `webgpu-threejs-tsl` for TSL syntax. Index and sources: [docs/skills.md](docs/skills.md).
- The ponytail plugin is enabled (Claude Code: `.claude/settings.json`; opencode: `opencode.json`). Its minimalism applies; its "leave a small test" rule applies to logic only, not to visuals.
- Project rules override skill and plugin advice; installing anything they suggest needs approval.

## Maintaining This File
- Keep only rules that change how the next agent works. Replace a rule when it stops matching the code; do not append contradicting revisions.
- Feature notes, tuning values and history belong in the experiment's `brief.md`, not here.
