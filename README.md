# H3 Battle Lab

An independent Three.js battlefield prototype for the generative-art work on Heroes of Might and Magic III. It displays actual 3D models and skeletal animation, with an orbiting camera, realtime shadows and a hex battlefield.

**Code is public. Imported models, textures, Blender scenes and complete mods are not included.** A fresh checkout runs with procedural stand-ins. The local art workflow loads Skeleton, Walking Dead, Wight, Wraith, Swordsman and Crusader models, plus the latest Archer export with a shooting clip. Marksman scene integration is still pending; its simulation uses a stand-in until valid art is configured. Castle art remains draft material; adding it to this viewer does not establish appearance acceptance.

## Run

Node.js 22.18+ and a browser with WebGL 2 are required.

```sh
npm ci
npm run dev -- --port 5174
```

Open the localhost URL. Drag to orbit, scroll to zoom, and right-drag to pan. Select a unit from the menu, or click a friendly unit. With a configured native backend, configure both armies, click **开始对战**, then command the active stack. Movement is limited by creature speed; clicking an enemy approaches and resolves melee, retaliation and applicable extra attacks. Unblocked shooters with ammunition fire from their current position; **射手强制近战** overrides this. **等待** delays a stack, **防御** ends its turn with a defense bonus. Reset returns to army configuration. The close-up view and animation buttons inspect the original 3D asset.

The local scene can reuse the existing HD battlefield plates. The public fallback uses procedural terrain, trees, rocks and grass.

## Army editor

Use **配置双方阵容** to choose a creature and team, then **添加上场**. Each team supports up to seven stacks. Set **每队数量** (1–99,999) before adding/replacing, or use **应用数量到选中队伍** to refill the selected stack at the configured count. Floor labels show surviving counts; the footer shows the last creature’s remaining HP. **替换选中** replaces the currently selected unit at the same cell and on the same team; **移除选中单位** removes it. The top menu selects any unit on either team. Reset restores the configured composition and deployment with full health. Configuration lasts for the current page session. Editing is locked during battle; reset restores the configured armies and reopens editing.

Available local manifest entries populate the grouped creature catalogue. Entries without local artwork are explicitly marked as geometric stand-ins. Models load on demand and share downloaded assets, while each placed unit has its own skeleton and animation mixer. Failed replacements preserve the previous unit. Castle drafts remain marked in the selector.

## Custom creatures

The **自定义兵种** panel validates a versioned authoring format. See the [format guide](docs/custom-creatures.md), [JSON Schema](schemas/creature-pack.schema.json) and [example](examples/custom-creatures.json). Native conversion/import is pending: validated custom creatures cannot yet join battles. Original creature IDs are protected. No TypeScript mechanism interpreter remains.

## Local models

The sidebar accepts a self-contained `.glb` file. For automatic loading, place a manifest in ignored `public/local-assets/manifest.json`:

```json
{
  "units": {
    "skeleton": {"label": "骷髅兵", "url": "/local-assets/skeleton.glb", "height": 2.35, "faction": "墓园"},
    "zombie": {"label": "僵尸", "url": "/local-assets/zombie.glb", "height": 2.35, "faction": "墓园"}
  }
}
```

Supported clip names: `idle`, `walk`, `attack`, `hit`, `death`, with optional `shoot` for ranged units (falls back to attack when absent). Model forward is +Z after glTF import; Y is up. The viewer scales the initial visible height and places the feet on the ground. It does not change the original source file.

Existing Blender animation scenes can be exported with:

```sh
blender -b --python-exit-code 1 --python scripts/export-blender.py -- \
  --out public/local-assets \
  --source skeleton=/absolute/path/to/skeleton-scenes \
  --source zombie=/absolute/path/to/zombie-scenes
```

For mixed source directories, `--config /private/export.json` accepts `{"units":{"creature-id":{"label":"Name","faction":"Castle","draft":true,"scenes":{"idle":"/private/holding.blend","walk":"/private/moving.blend","attack":"/private/attack.blend","hit":"/private/hit.blend","death":"/private/death.blend"}}}}`. Configuration files containing source paths stay private. Exporting merges units into the existing local manifest and preserves backgrounds.

Each source folder contains `holding.blend`, `moving.blend`, `attack_front.blend`, `hitted.blend`, and `death.blend`. The exporter bakes scene animations, matches animation targets by full hierarchy path, and packs clips into one GLB per creature; explicit `scenes` mappings may include `shoot` or other extra clips, and directory mode detects `shoot_front.blend` so geometry and textures are not downloaded five times. This assumes clips share a compatible rig hierarchy. Rig-local bone names may repeat; the packer maps full hierarchy paths. `geometryClip` can select a clip containing all weapon meshes (e.g. `attack`), and optional meshes missing from a clip receive an explicit hidden scale track. A target absent from the geometry scene fails validation; incompatible scene roots still need a separate normalization step. Materials need inspection after export; Blender-specific shader nodes do not all translate to glTF.

`public/local-assets/`, `.local/`, build output and art formats are ignored. **A local production build includes whatever is in `public/`; do not distribute that build with private artwork.** The public CI checkout contains only code and therefore builds the procedural scene.

## Boundaries

TypeScript now retains GUI, Three.js rendering and ordered event playback only. The old TypeScript battle controller has been removed. An owned native wrapper executes combat through VCMI's actual server processor. The browser reads native legal actions, paths, footprints, turn queue, counts, health and ammunition; movement, strike, retaliation and death playback uses recorded engine updates. VCMI-Gym is not a dependency.

Without a configured native backend, the public checkout renders stand-ins and lets you edit armies/inspect models, but disables combat. There is no alternate rule fallback. The native transport currently runs with the Vite **development server**; static production hosting and `vite preview` do not provide an engine process.

See [native setup, protocol and reproduction](docs/vcmi-adapter.md). Once the owned core and private profile are prepared:

```sh
python3 scripts/native/build-battle-probe.py --backend \
  --vcmi-source "$VCMI_SOURCE" --vcmi-build "$VCMI_BUILD" \
  --core .local/owned-core --out .local/battle-backend \
  --dependency-include "$BOOST_INCLUDE" --dependency-lib "$BOOST_LIB_DIR"
BATTLE_LAB_BACKEND="$PWD/.local/battle-backend/battle-backend" \
BATTLE_LAB_PROFILE="$PWD/.local/base-profile" npm run dev -- --port 5174
```

Both armies support all 28 original Castle/Necropolis creatures, including upgrades, at up to seven stacks each. Native deployment handles double-wide footprints. Verified actions include movement, waiting, defense, shooting, melee, retaliation, extra strikes and victory/reset. Each page has its own native process and writable profile; game resources are shared from the prepared private data directory.

The active `base-reference` profile permits only `core` and `vcmi`, excluding installed rule mods and user settings. **Original H3 base behavior remains the target, not a certified result.** Known differences such as regeneration timing still need original-game checks and engine-side handling. Heroes/skills/spell commands, configurable terrain/obstacles, custom pack translation, siege, full creature-event coverage, remaining model integration and WASM are pending. The present native interface uses a fixed sand battlefield without obstacles or fighting heroes.

| Module | Responsibility |
| --- | --- |
| `scripts/native/battle-backend.cpp` | Native battle creation, action validation and real VCMI execution |
| `scripts/engine-bridge.mjs` | Local process/session transport |
| `src/engine.ts` | Protocol types and HTTP client |
| `src/presentation.ts` | Hex ID/world conversion and creature art labels |
| `src/creatures.ts` | Custom authoring format validation only |
| `src/world.ts`, `src/units.ts` | Scene, camera, optional GLBs and animations |
| `src/main.ts` | Input, native-state display and event playback |


## Verification

```sh
npm test
python3 tests/exporter.test.py
python3 tests/native-profile.test.py
npm run build
npx playwright install chromium
npm run test:e2e
npm run check:public
```

The browser suite verifies missing-art/missing-engine rendering, army editing and capacity, custom format validation, and optional real GLB bone animation. With `BATTLE_LAB_BACKEND` and `BATTLE_LAB_PROFILE`, it also executes actual native shooting through the browser, checks that damage displays at impact, compares final UI state with the engine response, and tests defense/reset. Native pathfinding, occupancy, melee and victory tests run separately:

```sh
BATTLE_LAB_BACKEND="$PWD/.local/battle-backend/battle-backend" \
BATTLE_LAB_PROFILE="$PWD/.local/base-profile" python3 tests/native-backend.test.py
```

Native integration tests skip when the private engine/profile are absent. Public CI does not verify combat parity. Screenshots stay in ignored `.local/`. To use an installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Related work

- [Art pipeline tools](https://github.com/yzh119/h3-art-pipeline)
- [Castle modeling notes](https://yzh119.github.io/zh/posts/castle-halberdier-bootstrap/)
- [Skeleton motion study](https://yzh119.github.io/zh/posts/skeleton-motion/)
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) and [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)

Meshy supplies source geometry and suitable rigs; Astra authors the local repair, animation, export and rendering code. This repository's MIT license applies to its code, not to separately supplied art or game data.

### Existing HD battlefield plates

The optional local manifest also accepts `backgrounds: [{ "label": "Grass hills", "url": "/local-assets/grass.png" }]`. The first image becomes the default scene. Images retain their aspect ratio in a fitted viewport. A locked perspective camera, animated 3D units and a transparent shadow receiver composite over the image. Switching to a unit close-up or the free scene restores the procedural 3D environment. A background photograph/redraw does not provide geometry, parallax or image-derived occlusion; lighting controls affect the 3D objects, not the baked image. Background images stay private alongside models.

HD background mode supports mouse-wheel and +/− button zoom from 1× to 3×. The camera projection and image UV crop scale together about the viewport center, keeping feet, shadows and painted ground aligned. Overview resets the crop. This is magnification of existing detail, not additional image resolution.
