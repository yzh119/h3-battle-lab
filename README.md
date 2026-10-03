# H3 Battle Lab

An independent Three.js battlefield prototype for the generative-art work on Heroes of Might and Magic III. It displays actual 3D models and skeletal animation, with an orbiting camera, realtime shadows and a hex battlefield.

**Code is public. Imported models, textures, Blender scenes and complete mods are not included.** A fresh checkout runs with procedural stand-ins. The local art workflow loads Skeleton, Walking Dead, Wight, Wraith, Swordsman and Crusader models, plus the latest Archer export with a shooting clip. Marksman scene integration is still pending; its simulation uses a stand-in until valid art is configured. Castle art remains draft material; adding it to this viewer does not establish appearance acceptance.

## Run

Node.js 22.18+ and a browser with WebGL 2 are required.

```sh
npm ci
npm run dev -- --port 5174
```

Open the localhost URL. Drag to orbit, scroll to zoom, and right-drag to pan. Select a unit from the menu, or click a friendly unit. Configure both armies, click **开始对战**, then command the active stack. Movement is limited by creature speed; clicking an enemy approaches and resolves melee, retaliation and applicable extra attacks. Unblocked shooters with ammunition fire from their current position; **射手强制近战** overrides this. **等待** delays a stack, **防御** ends its turn with a defense bonus. Reset returns to army configuration. The close-up view and animation buttons inspect the original 3D asset.

The local scene can reuse the existing HD battlefield plates. The public fallback uses procedural terrain, trees, rocks and grass.

## Army editor

Use **配置双方阵容** to choose a creature and team, then **添加上场**. Each team supports up to seven stacks. Set **每队数量** (1–99,999) before adding/replacing, or use **应用数量到选中队伍** to refill the selected stack at the configured count. Floor labels show surviving counts; the footer shows the last creature’s remaining HP. **替换选中** replaces the currently selected unit at the same cell and on the same team; **移除选中单位** removes it. The top menu selects any unit on either team. Reset restores the configured composition and deployment with full health. Configuration lasts for the current page session. Editing is locked during battle; reset restores the configured armies and reopens editing.

Available local manifest entries populate the grouped creature catalogue. Entries without local artwork are explicitly marked as geometric stand-ins. Models load on demand and share downloaded assets, while each placed unit has its own skeleton and animation mixer. Failed replacements preserve the previous unit. Castle drafts remain marked in the selector.

## Custom creatures

Import a versioned creature JSON from the **自定义兵种** panel, or automatically load ignored `public/local-assets/creatures.json`. Built-in and custom creatures share stats and declarative mechanisms. See the [format guide](docs/custom-creatures.md), [JSON Schema](schemas/creature-pack.schema.json) and [working example](examples/custom-creatures.json). Custom IDs cannot override original creatures. Unsupported mechanisms fail validation. Artwork is optional and associated by creature ID.

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

**Migration direction:** TypeScript will retain GUI, 3D rendering and event playback only. Compiled VCMI will own all combat mechanics and legal actions. An owned native wrapper comes first, followed by the same interface in WASM; VCMI-Gym is optional reference material. The separate native smoke test now loads an isolated core/essential-data profile and executes actual server combat with ordered state updates. See the [adapter plan, results and reproduction commands](docs/vcmi-adapter.md). The current TypeScript simulation below remains a temporary demonstration until that backend is connected; new mechanism development belongs in the engine.

| Module | Responsibility |
| --- | --- |
| `src/battle.ts` | Hex topology, occupancy, turn controller, movement, melee and ranged exchanges |
| `src/creatures.ts` | Creature definitions, versioned packs, mechanism validation and registration |
| `src/world.ts` | Terrain, camera, light, shadows, grid and instanced vegetation |
| `src/units.ts` | GLB loading, independent model instances and animation blending |
| `src/main.ts` | Input, movement playback, attack sequencing and inspection UI |
| `scripts/export-blender.py` | Private Blender-to-glTF export and clip packing |

Combat is being implemented incrementally against **original H3 base rules**, excluding local rule mods. Original H3 behavior takes precedence if the local VCMI implementation differs; VCMI is an implementation reference, not the rules specification. The current catalogue implements twelve creatures’ base stats, stack counts, attack/defense-adjusted melee damage ranges, integer damage sampling and wounded-creature/casualty accounting. The log records each single blow. Creature stats are transcribed from the [original manual](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/297000/manuals/BONUS_Heroes_of_Might_and_Magic_III_HDEdition_OldManual1999_EN.pdf), printed pages 85–86 and 101–102. The local `zombie` art identifier represents **Walking Dead / CZOMBI** (15 HP, speed 3), not upgraded Zombie.

Damage uses the unmodified VCMI reference settings (+5% attack, capped at +300%; −2.5% defense, capped at −70%) and averages up to ten inclusive damage rolls as in `BattleInfo::getActualDamage`. Reference revision: `9012c9fbdcd5640115010728240a3107f990d780`, files `config/gameConfig.json`, `scripts/damage/damageCalculator.lua`, and `lib/battle/BattleInfo.cpp`. No mod bonuses or scripts are loaded. This is an independent TypeScript implementation, **not a live VCMI connection or complete H3 combat**.

The current battle controller adds speed-limited walking/flying, descending-speed normal turns, ascending-speed waited turns, alternating equal-speed teams, one action per round, defense, per-round retaliation budgets, Crusader extra attacks, Wight/Wraith wounded-creature regeneration and victory detection. Generic mechanisms also support custom extra attacks, limited regeneration, retaliation counts and retaliation blocking. The original manual (printed pp. 41–44, 86, 101) is the rule reference. Regeneration runs at round start as stated on p. 101, rather than copying the local VCMI activation-time implementation. Queue and melee sequencing reference `lib/battle/CBattleInfoCallback.cpp` and `server/battles/BattleActionProcessor.cpp` at the revision above. Defense rounding and expiration at the next activation currently follow that reference and still warrant original-game parity checks.

Ranged combat adds finite ammunition, adjacent-enemy shooting lockout, a 50% penalty beyond ten hexes, the shooter melee penalty, Zealot melee exception, Marksman ranged double attacks and Lich death-cloud splash (including friendly fire, excluding adjacent undead). Stats and creature behavior reference original manual pp. 42, 85–86, 102; distance/ammunition details reference `CBattleInfoCallback.cpp`, `CUnitState.cpp` and `BattleActionProcessor.cpp` at the revision above. Each shot plays a procedural projectile; splash victims react together and displayed HP/casualties update at each impact.

Still pending: the rest of the Castle/Necropolis roster and latest model integration, double-hex occupancy, other creature abilities (including Wraith mana drain), heroes, skills, luck/morale, spells, siege/war machines and original-game parity verification. This remains a partial H3 combat implementation; custom mechanisms do not imply these missing systems are present.

Next priority: connect an isolated native VCMI battle backend and replace the TypeScript rule controller with engine state and ordered events. Continue reviewing animation transitions and material fidelity. Adventure-map rendering comes later.

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

The browser suite tests the no-art fallback, camera controls, speed-limited hex movement, round transitions, melee/retaliation, ranged projectiles, ammo, custom JSON import and battle, army selection, replacement, removal, reset and team capacity. When local assets exist, it also checks GLB loading, exported clip names and actual bone-transform changes. Local screenshots stay in `.local/`. To use an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Related work

- [Art pipeline tools](https://github.com/yzh119/h3-art-pipeline)
- [Castle modeling notes](https://yzh119.github.io/zh/posts/castle-halberdier-bootstrap/)
- [Skeleton motion study](https://yzh119.github.io/zh/posts/skeleton-motion/)
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) and [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)

Meshy supplies source geometry and suitable rigs; Astra authors the local repair, animation, export and rendering code. This repository's MIT license applies to its code, not to separately supplied art or game data.

### Existing HD battlefield plates

The optional local manifest also accepts `backgrounds: [{ "label": "Grass hills", "url": "/local-assets/grass.png" }]`. The first image becomes the default scene. Images retain their aspect ratio in a fitted viewport. A locked perspective camera, animated 3D units and a transparent shadow receiver composite over the image. Switching to a unit close-up or the free scene restores the procedural 3D environment. A background photograph/redraw does not provide geometry, parallax or image-derived occlusion; lighting controls affect the 3D objects, not the baked image. Background images stay private alongside models.

HD background mode supports mouse-wheel and +/− button zoom from 1× to 3×. The camera projection and image UV crop scale together about the viewport center, keeping feet, shadows and painted ground aligned. Overview resets the crop. This is magnification of existing detail, not additional image resolution.
