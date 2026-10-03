# Battle lab

- Independent Three.js battlefield prototype. Adventure map is a later phase.
- Public repository contains code only. All imported/generated art and complete game resources stay in ignored `public/local-assets/` or outside this repo.
- Never commit GLB, textures, Blender scenes, asset manifests with private filesystem paths, or screenshots containing private art. Blog demonstrations are a separate authorized workflow.
- Keep all combat calculations in compiled VCMI. TypeScript owns GUI, rendering and event playback only. Do not claim complete original H3 parity without verification.
- Combat targets original H3 base rules only, as explicitly requested by the user. Do not inherit enabled local VCMI rule mods or custom balance settings. VCMI source may serve as a reference, but is not itself the rules specification. Describe implemented subsets and remaining gaps accurately.
- Asset loading must fail gracefully to procedural code-generated stand-ins. Keep the public checkout runnable without proprietary assets.
- Test pathfinding/occupancy and actual browser rendering, including missing-art mode. Preserve original models and VCMI source.
- No subagents unless the user asks.
