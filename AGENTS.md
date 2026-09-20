# Battle lab

- Independent Three.js battlefield prototype. Adventure map is a later phase.
- Public repository contains code only. All imported/generated art and complete game resources stay in ignored `public/local-assets/` or outside this repo.
- Never commit GLB, textures, Blender scenes, asset manifests with private filesystem paths, or screenshots containing private art. Blog demonstrations are a separate authorized workflow.
- Keep simulation (`battle.ts`) independent of Three.js. Do not imply that prototype combat implements H3/VCMI rules.
- Asset loading must fail gracefully to procedural code-generated stand-ins. Keep the public checkout runnable without proprietary assets.
- Test pathfinding/occupancy and actual browser rendering, including missing-art mode. Preserve original models and VCMI source.
- No subagents unless the user asks.
