# H3 Battle Lab

An independent Three.js battlefield prototype for the generative-art work on Heroes of Might and Magic III. It displays actual 3D models and skeletal animation, with an orbiting camera, realtime shadows and a hex battlefield.

**Code is public. Imported models, textures, Blender scenes and complete mods are not included.** A fresh checkout runs with procedural stand-ins. The local art workflow adds existing skeleton and zombie models without changing the public repository.

## Run

Node.js 22.18+ and a browser with WebGL 2 are required.

```sh
npm ci
npm run dev -- --port 5174
```

Open the localhost URL. Drag to orbit, scroll to zoom, and right-drag to pan. Select a unit from the menu, or click a friendly unit. Click the ground to move up to eight hexes; click an opposing unit to approach and perform a basic melee attack. The close-up view and animation buttons inspect the original 3D asset.

The battlefield currently uses code-generated terrain, trees, rocks and grass. These are scene scaffolding; environment artwork is a later step.

## Local models

The sidebar accepts a self-contained `.glb` file. For automatic loading, place a manifest in ignored `public/local-assets/manifest.json`:

```json
{
  "units": {
    "skeleton": {"label": "骷髅兵", "url": "/local-assets/skeleton.glb", "height": 2.35},
    "zombie": {"label": "僵尸", "url": "/local-assets/zombie.glb", "height": 2.35}
  }
}
```

Supported clip names: `idle`, `walk`, `attack`, `hit`, `death`. Model forward is +Z after glTF import; Y is up. The viewer scales the initial visible height and places the feet on the ground. It does not change the original source file.

Existing Blender animation scenes can be exported with:

```sh
blender -b --python-exit-code 1 --python scripts/export-blender.py -- \
  --out public/local-assets \
  --source skeleton=/absolute/path/to/skeleton-scenes \
  --source zombie=/absolute/path/to/zombie-scenes
```

Each source folder contains `holding.blend`, `moving.blend`, `attack_front.blend`, `hitted.blend`, and `death.blend`. The exporter bakes scene animations, matches animation targets by unique node name, and packs all five clips into one GLB per creature so geometry and textures are not downloaded five times. This assumes all five scenes share the same geometry, rig and stable node names. Materials need inspection after export; Blender-specific shader nodes do not all translate to glTF.

`public/local-assets/`, `.local/`, build output and art formats are ignored. **A local production build includes whatever is in `public/`; do not distribute that build with private artwork.** The public CI checkout contains only code and therefore builds the procedural scene.

## Boundaries

| Module | Responsibility |
| --- | --- |
| `src/battle.ts` | Hex topology, shortest paths, occupancy and minimal demo combat |
| `src/world.ts` | Terrain, camera, light, shadows, grid and instanced vegetation |
| `src/units.ts` | GLB loading, independent model instances and animation blending |
| `src/main.ts` | Input, movement playback, attack sequencing and inspection UI |
| `scripts/export-blender.py` | Private Blender-to-glTF export and clip packing |

The demo uses free selection, eight-step movement and fixed 25-point melee damage. **It does not implement H3 combat rules and is not connected to VCMI.** Connecting a real battle-state/event source is a separate next step. The rendering layer is independent so that this can be added without moving game logic into the scene.

Next priorities: review animation transitions and material fidelity in realtime; replace environment scaffolding; add richer battle events and ranged units. Adventure-map rendering comes later.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run check:public
```

The browser suite tests the no-art fallback, camera controls, hex movement and melee damage. When local assets exist, it also checks GLB loading, exported clip names and actual bone-transform changes. Local screenshots stay in `.local/`. To use an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Related work

- [Art pipeline tools](https://github.com/yzh119/h3-art-pipeline)
- [Castle modeling notes](https://yzh119.github.io/zh/posts/castle-halberdier-bootstrap/)
- [Skeleton motion study](https://yzh119.github.io/zh/posts/skeleton-motion/)
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) and [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)

Meshy supplies source geometry and suitable rigs; Astra authors the local repair, animation, export and rendering code. This repository's MIT license applies to its code, not to separately supplied art or game data.

### Existing HD battlefield plates

The optional local manifest also accepts `backgrounds: [{ "label": "Grass hills", "url": "/local-assets/grass.png" }]`. The first image becomes the default scene. Images retain their aspect ratio in a fitted viewport. A locked perspective camera, animated 3D units and a transparent shadow receiver composite over the image. Switching to a unit close-up or the free scene restores the procedural 3D environment. A background photograph/redraw does not provide geometry, parallax or image-derived occlusion; lighting controls affect the 3D objects, not the baked image. Background images stay private alongside models.
