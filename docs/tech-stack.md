# Tech stack decision

Goal: fastest look-and-adjust loop for an AI coding agent (Claude Code first, opencode second), with results that transfer to UE5 / Unity. Reliability and long-term maintenance are explicitly secondary.

## Choice

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict), `tsc --noEmit` only | Typecheck is the cheapest feedback an agent gets: it catches wrong TSL node types and three.js API drift in under a second, before any browser run. |
| Renderer | `three/webgpu` (`WebGPURenderer`) + TSL | three.js development focuses on WebGPURenderer; it falls back to WebGL2 automatically. TSL is a node graph in code, so each expression maps to one engine material node. |
| Bundler | Vite | Instant dev server, HMR, `import.meta.glob` for the experiment registry. |
| UI | lil-gui, imported from `three/addons/libs/` | Zero extra dependency; panel generated from the param schema. |
| Logic tests | Vitest, pure logic only (`yarn test`) | Trajectory/state math is where bugs hide and what ports to C++/C#; visuals are judged from captures instead. |
| Agent vision | Playwright (`yarn shot`) | Headless capture + console errors + stats in one command; the agent reads the PNG. |
| Package manager | Yarn 4 via Corepack, `node-modules` linker | Same as the other prototypes. |

## Rejected

| Option | Reason |
| --- | --- |
| Plain JavaScript | No typecheck: TSL mistakes (vec3 vs float, wrong node names) surface only at shader compile time in the browser, which costs a full screenshot round trip. |
| React + React Three Fiber | Adds a reconciler, hooks lifecycle and JSX between the agent and the scene. WebGPU in R3F needs an async renderer factory; most R3F examples and drei helpers assume WebGL. Engines are imperative (actors, components, materials), so an imperative scene ports more directly. Worth it only for UI-heavy tools, which these prototypes are not. |
| WebGLRenderer + GLSL strings | Maintenance mode upstream; GLSL in strings has no type information; `onBeforeCompile` patches do not map to engine material graphs. |
| Full physics / game frameworks | Out of scope: experiments test graphics, not gameplay. |

## Prototype kinds it covers

The layout follows the earlier prototypes: material/shader sandboxes (prototype-shader, prototype-texture), gameplay visuals such as projectile curves (vibe-test-3d-web) and UI/camera-transition prototypes with an HTML layer over the 3D view (prototype-ui). Each is one experiment folder; the harness (stage, params, capture, port notes) is shared.

## Known limits

- Headless browsers without a GPU produce no readable WebGPU image. `yarn shot` detects a blank capture and retries on the WebGL2 backend; the report marks it as `webgpuFallback`. Use `--headed` or `--channel chrome` on a machine with a GPU to capture through WebGPU.
- TSL and WebGPURenderer still change between releases. `three` is pinned to an exact version; check `node_modules/three` before applying a skill's example.
