# H3 Battle Lab

An independent Three.js battlefield prototype for the generative-art work on Heroes of Might and Magic III. It displays actual 3D models and skeletal animation, with an orbiting camera, realtime shadows and a hex battlefield.

**Code is public. Imported models, textures, Blender scenes and complete mods are not included.** A fresh checkout runs with procedural stand-ins. The private local manifest can load all 28 Castle and Necropolis creature models with baked animation. Actions that change rigs or geometry retain separate scene variants in the GLB; assets remain excluded from the public repository. Castle art remains draft material; adding it to this viewer does not establish appearance acceptance.

## Run

Node.js 22.18+ and a browser with WebGL 2 are required.

```sh
npm ci
npm run dev -- --port 5174
```

Open the localhost URL. Drag to orbit, scroll to zoom, and right-drag to pan. Select a unit from the menu, or click a friendly unit. With a configured native backend, configure both armies, click **开始对战**, then command the active stack. Movement is limited by creature speed; clicking an enemy approaches and resolves melee, retaliation and applicable extra attacks. Unblocked shooters with ammunition fire from their current position; **射手强制近战** overrides this. **等待** delays a stack, **防御** ends its turn with a defense bonus. Hover a model or occupied army slot to inspect engine attributes. Before battle the card uses native creature definitions; during battle it uses current stack attack, defense, damage, speed, HP and ammunition. **蓝方 VCMI AI** and **红方 VCMI AI** independently enable automatic turns, while **VCMI AI 行动一次** requests one action. The native bridge calls VCMI’s compiled `BattleEvaluator::selectStackAction` with two simulation turns and executes its result through the same server action processor. With a configured hero, the same compiled evaluator can choose a hero spell before the stack acts. Retreat and surrender decisions remain pending. Reset returns to army configuration. The close-up view and animation buttons inspect the original 3D asset.

Local models load in the background. Army edits, production presets and reset take effect immediately with procedural models; loading or failed artwork does not block combat configuration. Exact duplicate binary payloads and texture sources are shared when exporting alternate skeleton scenes.

The local scene can reuse the existing HD battlefield plates. The public fallback uses procedural terrain, trees, rocks and grass.

## Heroes and combat magic

**英雄与魔法** configures an optional custom hero for each side: attack, defense, spell power, knowledge, up to eight distinct original secondary skills at basic/advanced/expert level, and explicitly learned spells. Heroes have no specialty or combat artifacts. Mana capacity, army bonuses, skill effects and spell school mastery come from VCMI. Hero settings survive battle reset and are locked during combat.

Open **战斗魔法** during battle to choose a learned spell and an engine-approved target, then click **施放魔法**. Single targets can also be selected on the canvas; spells with two destinations, such as Teleport, use the ordered target list. The engine supplies the catalogue of 60 original combat spells, current availability, mana cost and all legal target combinations. It enforces immunity, school effects, mana, target validity and one hero cast per round. A hero spell normally leaves the same stack active. Earthquake remains unavailable in the current non-siege fixture; complete verification of every spell is pending.

Native checks cover Magic Arrow damage/cost/cooldown, expert mass Haste, Teleport, Clone, elemental summoning, Resurrection/Animate Dead and AI spell selection. New summons and clones are synchronized as additional battlefield units; unsupported summon art uses procedural models. Hypnotized units retain their original army side while their engine controller determines input and AI ownership. Browser checks cover actual spellbook casting, damage, mana and summoned-unit rendering.

## Active creature abilities

The **战斗魔法与兵种能力** panel has separate **英雄魔法** and **兵种能力** modes. For the original Castle/Necropolis roster, Archangel Resurrection is the active creature spell. The native snapshot supplies the ability, current availability and remaining casts; native target queries include eligible dead stacks. Select a legal target on the canvas or in the target list and confirm the cast. The native `MONSTER_SPELL` action consumes the creature's turn and cast, rather than using a hero's mana or per-round spell allowance.

Native and browser tests verify one Archangel restoring ten dead Pikemen, consuming its single cast, restoring the rendered stack and rejecting enemy/undead targets, noncasters and repeat use. This verifies that scenario; full creature/spell parity and richer casting animation remain pending.

## Army editor

The hex grid is visible by default. Configuration previews request native deployment using the same armies and seed as battle creation, so initial hexes match the engine. The persistent army bars show seven numbered slots for each side. Click an occupied or empty slot, choose a creature/count under **配置双方阵容**, and click **配置选中格子**. Empty slots remain empty when other stacks are removed; explicit slot IDs are preserved by native battle creation and reset. **添加上场** remains a shortcut for the first available slot. Each team supports up to seven stacks. Set **每队数量** (1–99,999) before adding/replacing, or use **应用数量到选中队伍** to refill the selected stack at the configured count. Floor labels show surviving counts; the footer shows the last creature’s remaining HP. **替换选中** replaces the currently selected unit at the same cell and on the same team; **移除选中单位** removes it. The top menu selects any unit on either team. Reset restores the configured composition and deployment with full health. Configuration lasts for the current page session. Editing is locked during battle; reset restores the configured armies and reopens editing.

**十周城镇产出** fills all seven slots on both sides from complete Castle/Necropolis town production. The native engine uses `CGTownInstance::getGrowthInfo` with ordinary buildings, castle and faction growth buildings present, excluding the Grail, external dwellings, heroes/artifacts and random-week effects. Ten-week counts by tier are Castle `280,180,170,80,60,40,20` and Necropolis `300,160,140,80,60,40,20`. **使用升级兵种** chooses upgraded creatures (enabled initially); clear it for basic creatures. The preset requires a connected engine, is disabled during battle, and survives battle reset. Quantities remain editable afterward.

Available local manifest entries populate the grouped creature catalogue. Entries without local artwork are explicitly marked as geometric stand-ins. Models load on demand and share downloaded assets, while each placed unit has its own skeleton and animation mixer. Failed replacements preserve the previous unit. Castle drafts remain marked in the selector.

## Custom creatures

The **自定义兵种** panel imports a versioned authoring format through an isolated standard VCMI mod. See the [format guide](docs/custom-creatures.md), [JSON Schema](schemas/creature-pack.schema.json) and [example](examples/custom-creatures.json). With a configured native engine and Python 3, imported creatures appear in the selector and can join battles. The converter validates the whole pack, prepares a candidate profile and switches sessions only after successful native initialization. Reset/reconnect preserve imported definitions; a page reload starts from the base profile. Original creature IDs are protected. No TypeScript mechanism interpreter remains.

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

The **战斗场景** controls change native terrain, battlefield and initial obstacles before combat. Deployment preview and battle creation use the same configuration. Native terrain bonuses appear in the preview hover attributes; obstacle rocks show the engine's blocked hexes in both camera modes and with image backgrounds. The layout number selects a tile in the private 36×36 fixture (0–1295), which VCMI uses to seed obstacle placement; it is separate from the combat seed. **换一个布局** advances that number. These rocks are occupancy markers, not faithful obstacle models. Display backgrounds remain independent of the combat terrain. Naval/ship and siege fields are excluded.

Engine integration lives in this repository under `scripts/native/`. Upstream VCMI sources remain unchanged: the local bootstrap substitutes the repository-owned profile-directory implementation in a new output directory, and fixture helper changes are applied to private copies. Future rule adaptations should use VCMI mods/plugins where supported; unavoidable source changes must be tracked here as reviewable patches with reproducible build steps rather than an untracked dirty fork.

The active `base-reference` profile permits only `core` and `vcmi`, excluding installed rule mods and user settings. **Original H3 base behavior remains the target, not a certified result.** Known differences such as regeneration timing still need original-game checks and engine-side handling. Named hero types/specialties/artifacts, new custom mechanisms/factions, siege, full spell/creature verification, richer event animation and WASM are pending. The native interface supports the eight original land terrains, their ordinary battlefields, special ground, optional native initial obstacles and custom fighting heroes. Sand without initial obstacles remains the default. Spell-created obstacles are also engine-managed.

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

The optional local manifest also accepts `backgrounds: [{ "label": "Grass hills", "url": "/local-assets/grass.png" }]`. The first image becomes the default scene. Images retain their aspect ratio in a fitted viewport. A locked perspective camera, animated 3D units and a transparent shadow receiver composite over the image. A unit close-up restores the procedural 3D environment inside the same canvas rectangle. **全局** restores the selected background; selecting the free scene clears it. Canvas bounds remain identical between overview and close-up, including after window resizing. A background photograph/redraw does not provide geometry, parallax or image-derived occlusion; lighting controls affect the 3D objects, not the baked image. Background images stay private alongside models.

HD background mode supports mouse-wheel and +/− button zoom from 1× to 3×. The camera projection and image UV crop scale together about the viewport center, keeping feet, shadows and painted ground aligned. Overview resets the crop. This is magnification of existing detail, not additional image resolution.
