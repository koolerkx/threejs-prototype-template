# Skills

Claude Code and opencode both load `.claude/skills/<name>/SKILL.md`. This is the only copy; do not add symlinks
(they break on Windows checkouts). Project rules in `AGENTS.md` override any skill.

## Template-owned

| Skill | Purpose |
| --- | --- |
| `proto-experiment` | Scaffold → TSL look → capture → findings loop |
| `look-check` | `yarn shot` usage and what to check in captures |
| `engine-port` | Port tiers, notes and port guides for UE5 / Unity / Godot / DX12 |

## Plugin: ponytail

[ponytail](https://github.com/DietrichGebert/ponytail) (MIT) keeps solutions minimal: YAGNI, no unrequested
abstractions, `shortcut:` comments for deliberate shortcuts. It is referenced, not vendored:

- Claude Code: `.claude/settings.json` registers the `DietrichGebert/ponytail` GitHub marketplace and enables
  `ponytail@ponytail`. Claude Code asks to trust it the first time the folder is opened.
- opencode (v1 config): `opencode.json` → `"plugin": ["@dietrichgebert/ponytail@5.3.3"]` (npm).

Commands: `/ponytail [lite|full|ultra|off]`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`.

## Vendored third-party

Copied unmodified at the commits below. Their three.js skills target r183-r186; this repo pins `three`, so verify an
API in `node_modules/three` before trusting an example. Licence files sit inside each skill folder (`webgpu-threejs-tsl`: MIT per its upstream README, see its `NOTICE.md`).

| Skill | Source | Licence | Commit |
| --- | --- | --- | --- |
| `webgpu-threejs-tsl` | dgreenheck/webgpu-claude-skill | MIT | `af2319b` |
| `threejs-fundamentals` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `threejs-materials` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `threejs-shaders` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `threejs-lighting` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `threejs-textures` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `threejs-postprocessing` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `threejs-performance` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `threejs-geometry` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `threejs-loaders` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `threejs-animation` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `threejs-asset-pipeline` | CloudAI-X/threejs-skills | MIT | `0e18186` |
| `shader-programming` | gamedev-skills/awesome-gamedev-agent-skills | Apache-2.0 | `25eec57` |
| `procedural-gen` | gamedev-skills/awesome-gamedev-agent-skills | Apache-2.0 | `25eec57` |
| `godot-shaders` | gamedev-skills/awesome-gamedev-agent-skills | Apache-2.0 | `25eec57` |
| `unreal-niagara` | gamedev-skills/awesome-gamedev-agent-skills | Apache-2.0 | `25eec57` |
| `diagnosing-bugs` | mattpocock/skills | MIT | `4ae2317` |

To update one: clone the source repo, copy the skill folder over the existing one, and update the commit here.
To add one: prefer skills that cover WebGPU/TSL or engine porting; skip WebGL-only, React, or gameplay skills.
