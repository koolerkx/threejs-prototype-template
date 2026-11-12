---
name: look-check
description: Capture and visually judge experiments with `yarn shot` (screenshots, variant contact sheets, console errors, draw stats). Use after any visual change, when comparing parameter values, or when the user asks how something looks or why it renders wrong.
---

# Look check

## Capture
```bash
yarn shot --exp <id>                                   # .shots/<id>.png
yarn shot --exp <id> --params '{"rimPower":5}'         # one override
yarn shot --exp <id> --variants '[{"rimPower":1},{"rimPower":3},{"rimPower":6}]'   # .shots/sheet.png
yarn shot --exp <id> --variants '[{"$stage":{"backdrop":"sky"}},{"$stage":{"backdrop":"space"}}]'   # vary stage too
yarn shot --exp <id> --stage '{"bloom":false,"backdrop":"stage"}'
yarn shot --exp <id> --page                            # include the HTML overlay (UI prototypes)
yarn shot --exp <id> --t 2.5                           # paused at 2.5 s (default 1 s)
yarn shot --exp <id> --variants '[{},{}]' --t 0.5      # same params, different moments: run once per --t
yarn shot --all                                        # every experiment, smoke check
yarn shot --exp <id> --headed                          # real GPU window, WebGPU capture
```
Ids are folder paths (`materials/stylized-rim`); PNG names replace `/` with `.`.
The script starts its own Vite server (no HMR) unless `--url http://127.0.0.1:5173/` is given.
Then read the PNG (or `sheet.png`) with the file-reading tool. Always look; never infer a visual result from code or logs.

## report.json
`.shots/report.json` → per shot: `stats.backend` (`webgpu` / `webgl2`), `drawCalls`, `triangles`, `params`, `errors`, `warnings`, `blank`, `webgpuFallback`.
- Exit code 1 = console/page error or blank capture. Read `errors` first; a TSL type error names the node.
- `webgpuFallback: true` = WebGPU gave no image in this headless browser and the capture used WebGL2. Fine for judging most looks; use `--headed` when the difference matters.

## What to check in the image
- Exposure: highlights not clipped flat white, shadows not crushed (compare against `pbr-calibration` under the same stage).
- NaN / Inf: pure black or flickering pixels on emissive or normal-mapped areas (often `pow` of a negative or `normalize(0)`).
- Scale: the grid is 1 m; does the effect size match the brief?
- Context: judge on the backdrop the brief targets (`none`, `stage`, `sky`, `space`, `outdoor`); a look tuned on dark grey often fails on a bright sky.
- Bloom: emissive above `bloomThreshold` glows; if the look depends on bloom, say so in the port notes (engine post process).
- Silhouette and motion: vertex offsets should not tear; capture two `--t` values to see motion.

## Interactive
`yarn dev` → http://127.0.0.1:5173/?exp=<id>. `window.__proto` in the console: `list()`, `load(id, params)`, `setParams({...})`, `setStage({...})`, `time({ paused, time, speed })`, `frames(n)`, `stats()`, `capture()`.
Transport bar (top): restart, frame step, play/pause, seek field, speed. Keys: Space play/pause, `,` `.` frame step, `[` `]` speed, Home restart, H hides the UI.
