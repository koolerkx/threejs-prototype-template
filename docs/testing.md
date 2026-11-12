# Testing in a browser

Visual results are checked by looking at rendered images, not by assertions. There are three ways to get them, from
cheapest to most faithful. Logic (curves, state) is the exception: it has Vitest unit tests (`yarn test`).

| Mode | Command / tool | Renderer | Use for |
| --- | --- | --- | --- |
| Headless capture | `yarn shot …` (Playwright, bundled Chromium) | WebGPU, or WebGL2 when headless WebGPU gives no image | Every visual change; smoke checks (`yarn check`) |
| Headed capture | `yarn shot … --headed` or `--channel chrome` | WebGPU on the real GPU | WebGPU-specific results, GPU timings, before reporting a final look |
| Interactive | `yarn dev` + a browser the agent can drive | WebGPU on the real GPU | Exploring, UI prototypes, anything needing clicks |

## 1. Headless: `yarn shot`

`scripts/shot.mjs` starts its own Vite server (no HMR), opens Chromium through Playwright, drives the page through
`window.__proto`, and writes `.shots/` (PNG per capture, `sheet.png` for comparisons, `report.json`, GIFs).

```bash
yarn setup                                             # once per machine (Playwright Chromium)
yarn shot --exp materials/stylized-rim                 # one capture
yarn shot --all                                        # every experiment
yarn check                                             # typecheck + every experiment; non-zero exit on errors
yarn shot --exp <id> --variants '[{"a":1},{"$stage":{"view":"sheet"}}]'
yarn shot --exp <id> --range 0:2 --count 8 --gif       # motion
yarn shot --exp <id> --page                            # composited page incl. HTML overlay
```

- Exit code 1 = console/page error or blank capture; `report.json` has the messages.
- In a GPU-less environment (CI, containers) WebGPU renders nothing readable; the script retries on WebGL2 and marks
  `webgpuFallback: true`. Frame and GPU times there are software rendering and not representative.
- Read the PNG with the file-reading tool and judge it; never report a look from logs alone.

## 2. Headed: real GPU

```bash
yarn shot --exp <id> --headed                          # visible Playwright Chromium window
yarn shot --exp <id> --channel chrome                  # installed Chrome (no `yarn setup` needed)
```

Use this to confirm a WebGPU result, read `gpuMs` in `report.json`, or check performance budgets (`over budget:`
lines appear only for headed runs).

## 3. Interactive

Start the dev server (`yarn dev`, http://127.0.0.1:5173/) and drive the page:

- **Claude Code desktop preview**: `.claude/launch.json` defines the `dev` server; open it in the preview pane.
- **Claude in Chrome / built-in browser / Playwright MCP**: navigate to `http://127.0.0.1:5173/?exp=<id>` and use
  `window.__proto` from the page (JavaScript tool / evaluate):

```js
await __proto.load('materials/substrate-lab', { recipe: 'velvet' });
__proto.setStage({ view: 'sheet' });                   // all channels at once
__proto.time({ paused: true, time: 1.5 });
__proto.camera({ position: [2, 1.5, 3], target: [0, 0.8, 0] });
await __proto.frames(5);
__proto.stats();                                       // perf snapshot + overBudget
(await __proto.capture()).dataUrl;                     // PNG of the canvas
```

- URL parameters reproduce a state without clicks: `?exp=…&params=…&stage=…&t=…&cam=…&shot=1&webgl=1`
  (see README → URL).
- Keyboard: Space / `,` / `.` / `[` / `]` time, 1-9 bookmarks, V / B view modes and sheet, G gallery, P perf HUD,
  H hide UI.

## What to check

See the `look-check` skill: exposure, NaN/black pixels, scale against the 1 m grid, bloom dependence, motion
(`--range`), material channels (`view` / `sheet`), and the backdrop the brief targets.
