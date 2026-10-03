# VCMI as the authoritative battle engine

The agreed direction is to keep TypeScript for GUI, Three.js rendering and event playback. All combat mechanics—including pathfinding, occupancy, initiative, damage, retaliation, ammunition, creature abilities, heroes and spells—must be computed by compiled VCMI. No second combat implementation should remain in TypeScript after migration. VCMI-Gym is a reference, not a required dependency.

The viewer currently still runs its independent TypeScript simulation. It is a temporary demonstration, not a connected VCMI backend or complete original H3 combat. Existing mechanisms stay available during migration; further mechanism development belongs in the native engine. Procedural artwork fallback will remain; silently falling back to different combat rules will not.

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

1. Use a separate pinned checkout/build and an owned resource/profile root. Original sources, art and user profiles stay untouched. Load only an explicit base-data allowlist, never the user's enabled rule mods.
2. Establish a custom-army battle through the actual server processor. `BattleInfo::setupBattle` constructs state, but action processing also needs game-handler state. A geometry probe is not a standalone battle engine.
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
