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
yarn shot --exp <id> --range 0:2 --count 8             # motion filmstrip in sheet.png (deterministic steps)
yarn shot --exp <id> --range 0:2 --gif --fps 12        # also .shots/<id>.gif for the user
yarn shot --exp <id> --cam 2                           # camera bookmark 2 (or --camera '{"position":[..],"target":[..]}')
yarn shot --exp <id> --variants '[{"$stage":{"view":"normal"}},{"$stage":{"view":"roughness"}},{"$stage":{"view":"uv"}}]'  # buffer views
yarn shot --exp <id> --stage '{"view":"sheet"}'        # all 20 channels in one image (order: lit, baseColor, normal, roughness, metallic / specular, ao, emissive, opacity, clearcoat / clearcoatRoughness, fuzz, fuzzRoughness, anisotropy, thinFilm / transmission, sss, height, uv, depth)
yarn shot --exp <id> --t 2.5                           # paused at 2.5 s (default 1 s)
yarn shot --exp <id> --variants '[{},{}]' --t 0.5      # same params, different moments: run once per --t
yarn shot --all                                        # every experiment, smoke check
yarn shot --exp <id> --headed                          # real GPU window, WebGPU capture
```
Ids are folder paths (`materials/stylized-rim`); PNG names replace `/` with `.`.
The script starts its own Vite server (no HMR) unless `--url http://127.0.0.1:5173/` is given.
Then read the PNG (or `sheet.png`) with the file-reading tool. Always look; never infer a visual result from code or logs.

Full guide (headless, headed, interactive): `docs/testing.md`.

## report.json
`.shots/report.json` → per shot: `stats` (`backend`, `drawCalls`, `triangles`, `cpuMs`, `gpuMs`, `memoryMB`, `overBudget`), `params`, `errors`, `warnings`, `blank`, `webgpuFallback`, `frameTimes` (motion).
- Frame times in headless runs are not representative (software rendering); judge cost by draw calls, triangles and memory, and by `--headed` runs on a real GPU.
- Exit code 1 = console/page error or blank capture. Read `errors` first; a TSL type error names the node.
- `webgpuFallback: true` = WebGPU gave no image in this headless browser and the capture used WebGL2. Fine for judging most looks; use `--headed` when the difference matters.

## What to check in the image
- Exposure: highlights not clipped flat white, shadows not crushed (compare against `pbr-calibration` under the same stage).
- NaN / Inf: pure black or flickering pixels on emissive or normal-mapped areas (often `pow` of a negative or `normalize(0)`).
- Scale: the grid is 1 m; does the effect size match the brief?
- Context: judge on the backdrop the brief targets (`none`, `stage`, `sky`, `space`, `outdoor`); a look tuned on dark grey often fails on a bright sky.
- Bloom: emissive above `bloomThreshold` glows; if the look depends on bloom, say so in the port notes (engine post process).
- Silhouette and motion: vertex offsets should not tear; use `--range` to see motion over time.
- Channels: when a look is off, check buffer views (base color, normal, roughness, metallic, emissive, uv, depth) before changing lighting.

## Interactive
`yarn dev` → http://127.0.0.1:5173/?exp=<id>. `window.__proto` in the console: `list()`, `load(id, params)`, `setParams({...})`, `setStage({...})`, `time({ paused, time, speed })`, `frames(n)`, `stats()`, `capture()`.
Transport bar (top): restart, frame step, play/pause, seek field, speed, camera bookmarks 1-9. Keys: Space play/pause, `,` `.` frame step, `[` `]` speed, Home restart, 1-9 jump / Ctrl or Alt+1-9 save bookmark, V view mode, P perf HUD, H hides the UI.
More API: `camera({ position, target, fovDeg })`, `bookmark(n)`, `record({ start, duration, fps, gif, keyFrames })`.
