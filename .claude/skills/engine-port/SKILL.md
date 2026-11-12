---
name: engine-port
description: Rate and document how a three.js/TSL experiment would be rebuilt in UE5, Unity, Godot 4 or a plain DX12/HLSL renderer - port tiers, node mapping, parameter export, porting steps. Use when filling an experiment's `port` notes, or when the user asks how to move a look into a game engine.
---

# Engine port

Reference tables: `docs/engine-port.md` (tiers, axes and units, lighting, material model, TSL → engine node map). Read the sections you need; do not copy them into experiments.

## Fill `port` in an experiment
For each engine the user cares about (UE5 and Unity by default; Godot and DX12 when relevant):
1. Pick the tier by the most demanding feature used:
   - only built-in material inputs → `native`
   - node chain with nodes that exist in the engine's graph editor → `graph`
   - any node with no engine equivalent (TSL noise variants, custom loops, custom lighting) → `code`
   - extra meshes, particles, post process, render passes, scripts → `extra`
2. Write 1-3 short notes, each naming the engine node or feature and the gotcha. Examples:
   - "Wobble: World Position Offset is a world-space offset in cm (x100)."
   - "UE Sine node period defaults to 1; set Period to 2π."
   - "Noise differs from mx_noise_float; bake or port the function."
3. If the look relies on Stage settings (bloom, tone mapping, sky light), note the engine-side equivalent.

## Write a port guide (when asked)
Create `src/experiments/<id>/PORT.md`:
- Parameters: table of name (PascalCase), type, default, range, unit - from the experiment's `params`.
- Node chain per target engine, in evaluation order, using the node names from the reference map.
- Stage: tone mapping, sky light, sun direction (elevation/azimuth in degrees), bloom.
- Differences to expect and how to judge them (calibration board first).
For DX12/HLSL, write the HLSL function for any `code`-tier node (e.g. the noise) in a fenced block.

## Rules
- Targets are a purpose, not a hard rule: an `extra` look is allowed if the user wants it; just make the cost visible.
- Do not change the look to make a tier lower unless the user asks.
