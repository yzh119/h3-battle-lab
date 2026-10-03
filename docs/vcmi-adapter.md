# VCMI as the authoritative battle engine

The agreed direction is to keep TypeScript for GUI, Three.js rendering and event playback. All combat mechanics—including pathfinding, occupancy, initiative, damage, retaliation, ammunition, creature abilities, heroes and spells—must be computed by compiled VCMI. No second combat implementation should remain in TypeScript after migration. VCMI-Gym is a reference, not a required dependency.

The viewer currently still runs its independent TypeScript simulation. It is a temporary demonstration, not a connected VCMI backend or complete original H3 combat. A separate native smoke test now initializes the actual library and executes server combat. Existing frontend mechanisms stay available during migration; further mechanism development belongs in the native engine. Procedural artwork fallback will remain; silently falling back to different combat rules will not.

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

The prototype only exposes a fixed ranged scenario. It has no frontend transport, general custom-army requests, hero-spell event normalization or WASM build yet. Captured unknown native messages are retained as diagnostic updates; this is not the final event protocol. The game-handler boundary follows VCMI's server battle test fixture rather than implementing combat in the wrapper.

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

Actions must cover move, melee, shoot, wait, defend and eventually hero spells. Events must capture movement paths, each strike and retaliation, damage/casualties, deaths, spell effects and round/turn changes. They must carry enough before/after state for the renderer to play intermediate animation without calculating outcomes or prematurely displaying final health. Illegal or stale actions must not mutate state. Seeded input histories should reproduce results.

The GUI sends player intentions and displays the engine's legal options. It must not calculate movement eligibility, damage previews, attack counts, splash victims or turn queues. Event timing and projectile trajectories are presentation decisions; their outcomes come from the engine.

## Custom creatures and mechanisms

Keep one versioned authoring format for creature stats, declarative mechanisms and artwork IDs. Translate that format into VCMI creature/bonus/script configuration in an owned custom rules profile. Importing the current version-1 JSON into the viewer does not yet install a creature in VCMI.

The backend must advertise supported mechanisms and reject unsupported fields explicitly. Compose existing VCMI mechanisms through data; implement new behavior in engine code or engine scripts, extending the translator and schema together. Do not implement the same mechanism in TypeScript. Original and custom profiles must remain distinguishable, and custom packs must not silently override base creatures. Art remains optional and separate from rules.

## Implementation order

1. Replace the local relink bootstrap with a dedicated pinned source build. Keep the verified owned resource/profile boundary and explicit base-data allowlist; original sources, art and user profiles stay untouched.
2. Generalize the verified real server smoke test into custom-army battle creation and versioned requests. `BattleInfo::setupBattle` constructs state, but action processing also needs the initialized game-handler context used by the probe.
3. Capture ordered updates and replay them through Three.js. Verify seeded movement, melee/retaliation and shooting against original H3 behavior. Known reference differences such as regeneration timing belong in the engine profile.
4. Replace the frontend controller and remove TypeScript combat calculations. Keep only coordinate conversion, input/state validation, presentation state and event playback. Move rule tests to the engine boundary; retain browser tests for rendering and interaction.
5. Compile the same wrapper with Emscripten. Filesystem initialization, platform paths, threads/condition variables, dynamic libraries and scripting dependencies need explicit browser support. No WASM build has been demonstrated yet.

VCMI-Gym's Python/pybind11 environment and threaded connector are native references, not a browser backend. Its action subset also does not establish hero-spell support or ordered animation events for this viewer.

## References

- [VCMI battle setup](https://github.com/vcmi/vcmi/blob/9012c9fbdcd5640115010728240a3107f990d780/lib/battle/BattleInfo.cpp)
- [VCMI hex geometry](https://github.com/vcmi/vcmi/blob/9012c9fbdcd5640115010728240a3107f990d780/lib/battle/BattleHex.h)
- [VCMI action processing](https://github.com/vcmi/vcmi/blob/9012c9fbdcd5640115010728240a3107f990d780/server/battles/BattleActionProcessor.cpp)
- [VCMI-Gym v15 environment](https://github.com/smanolloff/vcmi-gym/blob/main/vcmi_gym/envs/v15/vcmi_env.py)
- [VCMI-Gym threaded connector](https://github.com/smanolloff/vcmi-gym/blob/main/vcmi_gym/connectors/v15/threadconnector.h)

VCMI's GPL license applies to VCMI and derived integrations; the viewer's MIT license does not relicense those components. Complete game resources and art remain outside the public checkout.
