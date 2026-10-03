# VCMI as the authoritative battle engine

The agreed direction is to keep TypeScript for GUI, Three.js rendering and event playback. All combat mechanics—including pathfinding, occupancy, initiative, damage, retaliation, ammunition, creature abilities, heroes and spells—must be computed by compiled VCMI. No second combat implementation should remain in TypeScript after migration. VCMI-Gym is a reference, not a required dependency.

The browser is connected to an owned native JSON-lines backend through the local Vite server. The TypeScript battle simulation has been removed. Without an engine/profile, army editing and model inspection remain available while combat is disabled. No alternate combat-rule fallback is used.

Start with an owned native wrapper so resource initialization, custom armies and complete battle events can be validated independently of browser compilation. A later WASM build should implement the same protocol. Original H3 base behavior remains the target: reference differences must be handled in the engine's isolated rules profile, not compensated for by frontend damage or turn logic.

## Evidence so far

At VCMI revision `9012c9fbdcd5640115010728240a3107f990d780`, a resource-free C++ probe compiled against local core headers and linked `libvcmi`. All 187 availability flags, 165 playable neighbor sets and 34,969 pairwise distances matched the corrected TypeScript topology. The probe does **not** initialize resources or execute a battle.

It exposed the previous offset-row mismatch: `cellAt` now uses `col - ceil(row / 2)`. Columns 0 and 16 are reserved for heroes and unavailable to creature stacks. Native IDs are `row * 17 + col`; the adapter should expose these IDs while the renderer may convert to axial/world coordinates.

To reproduce with an existing compatible VCMI build on macOS, supply your own paths:

```sh
mkdir -p .local
c++ -std=c++20 \
  -I "$VCMI_SOURCE" -I "$VCMI_SOURCE/include" -I "$VCMI_SOURCE/lib" \
  -I "$BOOST_INCLUDE" scripts/native/hex-probe.cpp \
  -L "$VCMI_LIB_DIR" -lvcmi -Wl,-rpath,"$VCMI_LIB_DIR" \
  -o .local/native-hex-probe
.local/native-hex-probe > .local/native-hex-reference.json
node --experimental-strip-types scripts/check-vcmi-hex.ts .local/native-hex-reference.json
```

Header and library compatibility must be checked against the chosen pinned build. VCMI and game resources are not bundled in this repository or required by public CI.

### Isolated library and real server battle

The owned core derivative replaces platform profile discovery with `BATTLE_LAB_PROFILE`. It refuses startup without a prepared profile; it never falls back to the user's VCMI directories. The preparation tool copies engine config/scripts, the engine's essential `vcmi` mod and an explicit original-LOD allowlist into a **new** private directory. It excludes the user's Mods, settings and additional data archives. Native initialization checks that the active modules are exactly `core` and `vcmi`. `base-reference` describes this unmodified VCMI configuration; it does not certify complete original-game parity.

Verified locally:

- Library initialization returns all 28 original Castle/Necropolis creature definitions, including upgraded creatures.
- A memory-only SoD fixture initializes two real heroes/armies and game state. The upstream fixture writer is reused from private copies without its test-framework umbrella include; its original files remain unchanged.
- A seeded battle executes through `BattleProcessor::makePlayerBattleAction`. Twenty Marksmen shoot twenty Walking Dead twice, consuming two arrows. The captured attacks deal 55 and 54 damage; the target ends at 191 HP / 13 creatures and becomes active.
- Each captured native message has authoritative before/after state. Independent runs with seed 1337 produce identical output; the verifier checks ammo, casualty accounting, message continuity and turn advancement.

The generic backend now accepts both armies (up to seven stacks each) from all 28 original Castle/Necropolis definitions. Actual engine integration tests cover default and explicit deployment, double-wide occupancy, legal movement, waiting, defense, ranged double attacks, melee/retaliation/extra strikes, rejected stale/illegal requests, atomic failed creation, victory cleanup and a fresh battle. Browser tests connect through the real HTTP transport with artwork intentionally missing, check damage playback at impact, compare the displayed final state with the native response and exercise defense/reset. Optional local GLB tests also verify animated bone transforms.

Optional custom heroes, secondary skills, native hero/creature spell commands and versioned custom-creature mod imports are now connected. Combat equipment and native war machines are connected; siege, initial Tactics positioning and WASM remain pending. Terrain and initial obstacles are configurable through the native interface; sand without initial obstacles remains the default. The battlefield and the army containers’ map tiles use the same selected terrain; spell-created obstacles are engine-managed. A fixture check verifies that all 28 creatures retain their base speed rather than inheriting grass-native bonuses from the upstream test map. Unknown native messages remain generic authoritative updates; some creature abilities will need richer visual events and dedicated tests. This evidence does not establish full original H3 parity.

For an existing compatible macOS Ninja build, bootstrap an owned derivative without rebuilding or modifying the upstream tree:

```sh
python3 scripts/native/prepare-profile.py \
  --vcmi-source "$VCMI_SOURCE" --game-data "$H3_DATA_DIR" \
  --out .local/base-profile
python3 scripts/native/build-local-core.py \
  --vcmi-build "$VCMI_BUILD" --out .local/owned-core
python3 scripts/native/build-battle-probe.py \
  --vcmi-source "$VCMI_SOURCE" --vcmi-build "$VCMI_BUILD" \
  --core .local/owned-core --out .local/battle-probe \
  --dependency-include "$BOOST_INCLUDE" --dependency-lib "$BOOST_LIB_DIR"
BATTLE_LAB_PROFILE="$PWD/.local/base-profile" \
  .local/battle-probe/battle-probe > .local/battle-first.json
BATTLE_LAB_PROFILE="$PWD/.local/base-profile" \
  .local/battle-probe/battle-probe > .local/battle-repeat.json
python3 scripts/check-vcmi-battle.py .local/battle-first.json \
  --repeat .local/battle-repeat.json
```

The relink bootstrap reads the upstream Ninja commands/objects and drops all upstream post-link resource mutations. Compile outputs, copied fixture sources and the resulting dylib live only in the chosen new output directory. It is a development shortcut tied to the compatible existing build, not a portable release build. A dedicated pinned source build remains necessary for native releases and WASM. Runtime profiles contain private game resources and must stay ignored or outside this public repository.

## Proposed engine boundary

Use a versioned request/response protocol shared by native transport and a WASM worker:

| Operation | Input / output |
| --- | --- |
| Capabilities | Backend revision, protocol version, rules profile, supported creature mechanisms, actions and events |
| Create battle | Explicit seed, terrain, obstacles, two armies with creature IDs/counts/deployment, optional heroes; returns battle ID and authoritative initial state |
| Query state | Round, active stack, queue, health/counts, ammo, effects, footprints, legal actions and reachable destinations |
| Act | Battle ID, expected state revision, active stack and action; returns ordered events plus authoritative final state |
| Dispose | Releases one battle and its owned resources |

Actions must cover move, melee, shoot, wait, defend and hero spells. Events must capture movement paths, each strike and retaliation, damage/casualties, deaths, spell effects and round/turn changes. They must carry enough before/after state for the renderer to play intermediate animation without calculating outcomes or prematurely displaying final health. Illegal or stale actions must not mutate state. Seeded input histories should reproduce results.

The GUI sends player intentions and displays the engine's legal options. It must not calculate movement eligibility, damage previews, attack counts, splash victims or turn queues. Event timing and projectile trajectories are presentation decisions; their outcomes come from the engine.

## Custom creatures and mechanisms

Keep one versioned authoring format for creature stats, declarative mechanisms and artwork IDs. Translate that format into VCMI creature/bonus/script configuration in an owned custom rules profile. Importing version-1 JSON into the viewer now prepares a standard `battle-lab-custom` mod in an isolated candidate profile. All definitions load during native initialization; failed candidates preserve the original session. See [the format guide](custom-creatures.md).

The backend must advertise supported mechanisms and reject unsupported fields explicitly. Compose existing VCMI mechanisms through data; implement new behavior in engine code or engine scripts, extending the translator and schema together. Do not implement the same mechanism in TypeScript. Original and custom profiles must remain distinguishable, and custom packs must not silently override base creatures. Art remains optional and separate from rules.

## Current JSON-lines interface

Build the general service with `build-battle-probe.py --backend`, using the same source/build/core/dependency arguments above. Set `BATTLE_LAB_BACKEND` to the resulting executable and `BATTLE_LAB_PROFILE` to the prepared profile when starting `npm run dev`. This backend is currently available only through the development server, not static hosting or `vite preview`.

Each line is one JSON request `{ "version": 1, "requestId": "unique-id", "op": "catalogue" }`. Responses echo the version and ID, with `ok` and `result` or `error`.

| Operation | Fields and response |
| --- | --- |
| `catalogue` | Original creature IDs/data, `backend`, `rulesProfile`, `customPacks: true`, `customMechanisms`, `heroSpells: true`, `creatureSpells: true`, native spells/skills, `tenWeekTownArmies` |
| `create` | `seed` (0–2³¹−1), `armies` (two arrays of 1–7 `{creature,count,slot?,hex?}`), optional `heroes`; native initial state/events |
| `spellTargets` | `revision`, active `stack`, `spell`, optional `caster` (`hero` by default, or `creature`); native legal ordered target combinations |
| `state` | Current authoritative state |
| `act` | `revision`, active `stack`, `action`: `wait`, `defend`, `move` (+`hex`), `shoot` (+`target`), `melee` (+`target`,`from`), `spell` or `creatureSpell` (+`spell`,`targets`), `ai` |
| `dispose` | Releases the battle; the process can create another |

Original IDs are 0–13 and 56–69. Custom profiles return additional numeric IDs and stable `battle-lab-custom:<author-id>` keys; use the current catalogue rather than persisting numeric custom IDs. Counts are 1–99,999. Optional `slot` is 0–6; absent slots default to input array index. Duplicate slot IDs are rejected. Sparse slots and out-of-order input are accepted, with native slot IDs preserved. Deployment hexes are optional; the engine supplies default formation and double-wide adjustments. State contains native units/footprints, counts/health/ammo, remaining creature casts and fixed active spells, round, winner, queue and legal actions with native paths. Actions return ordered messages containing before/after state, followed by final state with the next revision. The wrapper validates actions against native legal options before mutating state. Failed creation preserves the prior battle.

`tenWeekTownArmies` is authoritative GUI preset data: `{weeks:10, profile:"complete-town-no-grail", armies:[...]}`. Each tier has `slot`, `base`, `upgraded`, `weekly`, and `count`. An isolated native town fixture calls VCMI `getGrowthInfo` with ordinary buildings present, excluding the Grail and external bonuses. The frontend copies the returned counts and IDs without calculating growth. This metadata fixture does not modify the active battle.

The local HTTP envelope is `{session?,request}` at `/api/engine`, with `{session,response}` returned. A first `catalogue` without a session creates a process. Each browser session owns a private writable profile; its data directory points at the prepared resources. HTTP operation `importPack` takes a version-1 `pack` while no battle is active. It appends definitions to the session pack, runs the Python data converter in a new private profile, initializes a candidate native process and returns its catalogue with a new session ID. This operation belongs to the process-owning HTTP wrapper, not the raw JSON-lines binary. Candidate failure retains the previous process. Concurrent requests are rejected during the switch. Reconnection reapplies the GUI's imported pack to a fresh process. Native mod checks allow exactly `core`, `vcmi` and the generated custom mod in this explicitly marked profile; base profiles continue to allow only `core` and `vcmi`. No combat code runs in the HTTP bridge or converter. Do not expose this development process launcher as a public service.

## Remaining implementation

1. Replace the local relink bootstrap with a pinned dedicated source build; upstream files remain untouched.
2. Add siege, initial Tactics positioning and richer effect events; verify remaining creature abilities and original H3 differences in the engine.
3. Extend the standard custom mod translator with further verified mechanisms, native faction selection and engine scripts. Advertise only verified engine capabilities.
4. Review the integrated 28 private models and remaining material/animation fidelity; loading does not establish appearance acceptance.
5. Compile the same wrapper with Emscripten. Platform paths, filesystems, threading, dynamic libraries and scripting need browser support. No WASM build has been demonstrated.

VCMI-Gym's Python/pybind11 environment and threaded connector are native references, not a browser backend. Its action subset also does not establish hero-spell support or ordered animation events for this viewer.

## References

- [VCMI battle setup](https://github.com/vcmi/vcmi/blob/9012c9fbdcd5640115010728240a3107f990d780/lib/battle/BattleInfo.cpp)
- [VCMI hex geometry](https://github.com/vcmi/vcmi/blob/9012c9fbdcd5640115010728240a3107f990d780/lib/battle/BattleHex.h)
- [VCMI action processing](https://github.com/vcmi/vcmi/blob/9012c9fbdcd5640115010728240a3107f990d780/server/battles/BattleActionProcessor.cpp)
- [VCMI-Gym v15 environment](https://github.com/smanolloff/vcmi-gym/blob/main/vcmi_gym/envs/v15/vcmi_env.py)
- [VCMI-Gym threaded connector](https://github.com/smanolloff/vcmi-gym/blob/main/vcmi_gym/connectors/v15/threadconnector.h)

VCMI's GPL license applies to VCMI and derived integrations; the viewer's MIT license does not relicense those components. Complete game resources and art remain outside the public checkout.


## Native scene configuration

`catalogue.scenarios` supplies eight original land terrains, allowed ordinary/special battlefield keys, a default configuration and `layoutCount`. Both `create` and `deployment` accept optional `scenario: { terrain, battlefield, obstacles, layout }`. Terrain IDs are original 0–7; battlefield keys must belong to that terrain or the original special-ground set. Ship fields are excluded. Omitted settings retain the neutral sand fixture, no initial obstacles and layout 148.

`layout` is a 0–1295 index into the private 36×36 map. The selected tile controls VCMI's obstacle-placement seed. The combat RNG still uses the separate `seed` argument. VCMI's `BattleInfo::setupBattle` generates the layout; its blocked hexes, double-wide footprints and legal paths are returned to the browser. `state.scenario` describes the applied configuration. Deployment previews preserve an existing battle and reproduce the initial obstacles/units of creation with the same inputs. Invalid scenes and blocked explicit deployments are rejected without replacing that battle.

The wrapper updates the fixture's map terrain as well as battle terrain before native setup. Actual integration tests check Castle grass and Necropolis dirt bonuses, unchanged base attributes on other selected land terrain, walking paths avoiding native obstacles, double-wide occupancy, deterministic preview/create, Magic Plains granting expert mass Haste without learned Air Magic, and Cursed Ground rejecting Implosion while allowing Magic Arrow. These tests establish that the interface uses compiled-engine behavior; they do not certify all terrain rules against original H3. Browser tests cover hover attributes, reset, both cameras, missing art and obstacle visibility over an image background. Ground colors and per-hex obstacle rocks are procedural presentation; they do not implement combat or reproduce the original obstacle artwork.


## Named heroes and native progression

`catalogue.namedHeroes` returns the 32 original Castle/Necropolis hero definitions (core IDs 0–15 and 64–79), classes, specialties/descriptions and `maxLevel`. A hero configuration may specify `type` and optional `level` (default 1). The fixture writer sets that original hero type and the native `reqExp(level)` threshold; VCMI initializes its defaults and performs automatic primary/secondary skill choices. The level limit is the largest native threshold representable in the fixture's 32-bit H3M experience field. Identical inputs and seeds reproduce the rolls in preview/create; automatic choices do not replicate a player's choices from a campaign.

Optional `attack`, `defense`, `power`, `knowledge`, `skills`, `spells` and `mana` override the initialized native values. Omitting an override preserves its default; explicit empty skill/spell arrays clear them. Named heroes retain the engine's specialty bonuses. Legacy configurations without `type` still require the four attributes and skill/spell lists and remove specialties. Battle state now returns hero identity, level, experience and secondary skills alongside mana/attributes/spells; anonymous custom heroes have a null type.

Real native tests initialize all 32 heroes, reproduce automatic level-20 progression and the maximum permitted level, compare troop-specialist bonuses against otherwise equal anonymous heroes, and check actual ranged and spell damage from Orrin's Archery and Sandro's Sorcery specialties. Invalid identities, levels and overrides preserve the current battle. Both sides may select the same hero type, with each instance initialized independently. This does not verify every specialty against original H3: noncombat specialties, after-battle adventure outcomes and full spell-specialty/artifact parity remain unverified or unconnected.

## Native equipment and war machines

`catalogue.equipment` lists original core artifacts and their numeric permitted HERO slots. A hero may provide `artifacts: [{slot, artifact, spell?}]`. Omitted slots preserve native starting equipment; `artifact: -1` removes the item. Grail/catapult slots are not editable. Spell scrolls require an original combat spell ID; other items reject a spell field. Duplicate slots, incompatible items and occupied combination slots reject candidate creation without replacing the current battle.

Equipment uses native artifact instances, `canBePutAt` and `putArtifact`; combination parts reserve their native slots. It is applied before mana capacity is computed. Hero snapshots include base primary attributes separately from current totals and the actual worn/locked inventory. Named hero initialization retains VCMI starting war machines before replacing the regular army with the requested stacks.

Machine stacks have native negative army slots and authoritative footprints, including border hexes permitted for machines. The GUI centres their models on those footprints without adding editable army slots. Native shooting eligibility is queried independently from melee eligibility; ballista can shoot despite being unable to make an ordinary melee attack. `state.legal.heals` advertises wounded, living friendly targets approved by native `canBeHealed`; `act` with `action: "heal"` and `target` executes `BattleAction::makeHeal`. Native before/after positive HP changes produce presentation-only `heal` events. The renderer does not compute healing amounts.

AI tent actions call compiled upstream `CBattleAI::useHealingTent`. The owned executable links existing `AI/BattleAI/CMakeFiles/BattleAI.dir/BattleAI.cpp.o` and `TacticsHandler.cpp.o` from the compatible Ninja build, alongside the original server objects. The build helper fails explicitly if these objects are missing. No upstream source edits are required. The catalogue includes 139 original equipment definitions; only the documented tested subset has been exercised here, and adventure-only outcomes are absent.

Each final/deployment state unit now includes `movement`, the native `battleGetOccupiableHexes(unit, true)` result for living stacks on either side, including both cells of wide bodies. This is inspection data; `legal.moves` continues to authorize only the active stack’s anchor destinations and paths. Ended battles return empty inspection ranges. No reachability or speed calculation runs in TypeScript.
