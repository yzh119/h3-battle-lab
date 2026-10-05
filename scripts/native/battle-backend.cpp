// SPDX-License-Identifier: GPL-2.0-or-later
// Local JSON-lines engine service; GUI and transports do not compute combat.
#include "battle-context.h"
#include "lib/json/JsonParser.h"
#include "lib/entities/hero/CHeroHandler.h"
#include "lib/entities/hero/CHeroClass.h"
#include "lib/entities/artifact/CArtHandler.h"
#include "AI/BattleAI/BattleAI.h"
#include "AI/BattleAI/TacticsHandler.h"
#include "lib/mapObjects/CGTownInstance.h"
#include "lib/battle/ReachabilityInfo.h"
#include "server/queries/BattleQueries.h"
#include "server/queries/QueriesProcessor.h"
#include "server/battles/BattleFlowProcessor.h"
#include "AI/BattleAI/BattleEvaluator.h"
#include "lib/callback/CBattleCallback.h"
#include "lib/battle/CPlayerBattleCallback.h"
#include "lib/spells/ISpellMechanics.h"
#include <cmath>
#include <filesystem>
#include <fstream>

class AIEnvironment final : public Environment
{
    const CGameState & gameState;
    std::shared_ptr<CBattleCallback> callback;
public:
    AIEnvironment(const CGameState & game, std::shared_ptr<CBattleCallback> cb) : gameState(game), callback(std::move(cb)) {}
    const Services * services() const override { return LIBRARY; }
    const BattleCb * battle(const BattleID & id) const override { return callback->getBattle(id).get(); }
    const GameCb * game() const override { return &gameState; }
};

// AI evaluates against engine callbacks; capture its choice instead of sending
// through a graphical VCMI client. Execution stays in BattleProcessor below.
class AICallback final : public CBattleCallback
{
public:
    std::optional<BattleAction> spellAction;
    std::optional<BattleAction> tacticsAction;
    explicit AICallback(PlayerColor player) : CBattleCallback(player, nullptr) {}
    void battleMakeSpellAction(const BattleID &, const BattleAction & action) override { spellAction = action; }
    void battleMakeTacticAction(const BattleID &, const BattleAction & action) override { tacticsAction = action; }
    void battleMakeUnitAction(const BattleID &, const BattleAction & action) override { tacticsAction = action; }
};

void fields(const JsonNode & value, std::initializer_list<std::string> allowed)
{
    if (!value.isStruct()) throw std::runtime_error("Expected object");
    for (const auto & [key, entry] : value.Struct())
        if (std::find(allowed.begin(), allowed.end(), key) == allowed.end()) throw std::runtime_error("Unsupported field: " + key);
}
int64_t integer(const JsonNode & value, int64_t low, int64_t high)
{
    if (value.getType() != JsonNode::JsonType::DATA_INTEGER || value.Integer() < low || value.Integer() > high)
        throw std::runtime_error("Expected integer in range " + std::to_string(low) + ".." + std::to_string(high));
    return value.Integer();
}
JsonNode customPack;
std::map<int, JsonNode> customDefinitions;
bool allowedCreature(int id) { return (id >= 0 && id <= 13) || (id >= 56 && id <= 69) || customDefinitions.contains(id); }
void loadCustomMetadata()
{
    const auto path = std::filesystem::path(std::getenv("BATTLE_LAB_PROFILE")) / ".battle-lab-custom";
    if (!std::filesystem::exists(path)) return;
    if (std::filesystem::file_size(path) > 1024 * 1024) throw std::runtime_error("Custom metadata exceeds 1 MB");
    std::ifstream stream(path); std::string data((std::istreambuf_iterator<char>(stream)), {});
    JsonParsingSettings settings; settings.mode = JsonParsingSettings::JsonFormatMode::JSON;
    JsonParser parser(data.data(), data.size(), settings); customPack = parser.parse("custom-pack");
    if (!parser.isValid() || !customPack["creatures"].isVector()) throw std::runtime_error("Invalid custom pack metadata");
}

JsonNode tenWeekTownArmies()
{
    // A real callback context, isolated from the current battle. Growth itself
    // comes from CGTownInstance::getGrowthInfo, including castle and horde buildings.
    TinyH3M::TinyH3MBuilder builder(EMapFormat::SOD);
    builder.size(36).name("BattleLabGrowth").playerActive(PlayerColor(0)).playerActive(PlayerColor(1))
        .hero({5, 5, 0}, HeroTypeID(0), PlayerColor(0)).heroGarrison({{CreatureID(0), 1}})
        .hero({7, 7, 0}, HeroTypeID(1), PlayerColor(1)).heroGarrison({{CreatureID(0), 1}});
    MemoryMap maps(builder.build());
    auto game = std::make_shared<CGameState>(); game->preInit(LIBRARY);
    StartInfo start; start.mapname = "BattleLabGrowth"; start.mode = EStartMode::NEW_GAME;
    for (int side = 0; side < 2; ++side) {
        auto & player = start.playerInfos[PlayerColor(side)]; player.color = PlayerColor(side); player.name = "Growth";
        player.connectedPlayerIDs.insert(static_cast<PlayerConnectionID>(side)); player.bonus = PlayerStartingBonus::GOLD;
    }
    GameRandomizer randomizer(*game); randomizer.setSeed(0);
    Load::ProgressAccumulator progress; game->init(&maps, &start, randomizer, progress, false);
    JsonNode result; result["weeks"].Integer() = 10;
    result["profile"].String() = "complete-town-no-grail";
    for (const int faction : {0, 4}) {
        CGTownInstance town(game.get()); town.ID = Obj::TOWN; town.subID = faction; town.tempOwner = PlayerColor::NEUTRAL;
        for (const auto & [id, building] : town.getTown()->buildings)
            if (id != BuildingID::GRAIL) town.addBuilding(id);
        town.creatures.resize(town.getTown()->creatures.size());
        JsonNode army;
        for (size_t level = 0; level < town.creatures.size(); ++level) {
            const auto & ids = town.getTown()->creatures[level];
            town.creatures[level].second = ids;
            const int weekly = town.getGrowthInfo(level).totalGrowth();
            JsonNode entry; entry["slot"].Integer() = level;
            entry["base"].Integer() = ids.front().getNum(); entry["upgraded"].Integer() = ids.back().getNum();
            entry["weekly"].Integer() = weekly; entry["count"].Integer() = weekly * 10;
            army.Vector().push_back(std::move(entry));
        }
        result["armies"].Vector().push_back(std::move(army));
    }
    return result;
}

std::vector<BattleField> allowedBattlefields(int terrain)
{
    auto fields = LIBRARY->terrainTypeHandler->getById(TerrainId(terrain))->battleFields;
    // Keep the existing neutral sand fixture as the default and expose its mesa variant.
    if (terrain == static_cast<int>(TerrainId::SAND)) {
        for (const auto & field : LIBRARY->battlefieldsHandler->objects)
            if (field && field->getJsonKey() == "core:sand_shore") fields.insert(fields.begin(), field->getId());
    }
    for (const auto & field : LIBRARY->battlefieldsHandler->objects)
        if (field && field->getModScope() == "core" && field->isSpecial && field->getJsonKey() != "core:ship") fields.push_back(field->getId());
    return fields;
}

JsonNode scenarioCatalogue()
{
    JsonNode result;
    result["default"]["terrain"].Integer() = static_cast<int>(TerrainId::SAND);
    result["default"]["battlefield"].String() = LIBRARY->battlefieldsHandler->getById(allowedBattlefields(static_cast<int>(TerrainId::SAND)).front())->getJsonKey();
    result["default"]["obstacles"].Bool() = false;
    result["default"]["layout"].Integer() = 148;
    result["layoutCount"].Integer() = 36 * 36;
    for (int id = 0; id < 8; ++id) {
        const auto * terrain = LIBRARY->terrainTypeHandler->getById(TerrainId(id));
        JsonNode entry; entry["id"].Integer() = id; entry["key"].String() = terrain->getJsonKey();
        entry["label"].String() = terrain->getNameTranslated();
        std::set<int> unique;
        for (const auto & fieldId : allowedBattlefields(id)) {
            if (!unique.insert(fieldId.getNum()).second) continue;
            const auto * field = LIBRARY->battlefieldsHandler->getById(fieldId);
            JsonNode data; data["key"].String() = field->getJsonKey(); data["label"].String() = field->getNameTranslated().empty() ? field->getJsonKey() : field->getNameTranslated();
            data["special"].Bool() = field->isSpecial; entry["battlefields"].Vector().push_back(std::move(data));
        }
        result["terrains"].Vector().push_back(std::move(entry));
    }
    return result;
}

bool allowedHero(int id)
{
    return ((id >= 0 && id < 16) || (id >= 64 && id < 80)) && HeroTypeID(id).toHeroType()->getModScope() == "core";
}

int maxPresetHeroLevel()
{
    int maximum = 1;
    for (unsigned level = 2; level <= LIBRARY->heroh->maxSupportedLevel(); ++level) {
        if (LIBRARY->heroh->reqExp(level) > UINT32_MAX) break;
        maximum = level;
    }
    return maximum;
}

JsonNode heroCatalogue()
{
    JsonNode result; result["maxLevel"].Integer() = maxPresetHeroLevel();
    for (int id = 0; id < 80; ++id) {
        if (!allowedHero(id)) continue;
        const auto * hero = HeroTypeID(id).toHeroType();
        JsonNode entry; entry["id"].Integer() = id; entry["key"].String() = hero->getJsonKey();
        entry["label"].String() = hero->getNameTranslated();
        entry["class"].String() = hero->heroClass->getNameTranslated();
        entry["faction"].String() = id < 16 ? "Castle" : "Necropolis";
        entry["specialty"].String() = hero->getSpecialtyNameTranslated();
        entry["description"].String() = hero->getSpecialtyDescriptionTranslated();
        result["heroes"].Vector().push_back(std::move(entry));
    }
    return result;
}

bool allowedArtifact(int id)
{
    if (id < 0 || id > 140 || id == 2 || id == 3) return false;
    const auto * artifact = ArtifactID(id).toArtifact();
    return artifact && artifact->getModScope() == "core" && artifact->getPossibleSlots().contains(ArtBearer::HERO);
}

JsonNode artifactCatalogue()
{
    JsonNode result;
    for (int slot = 0; slot <= 18; ++slot) {
        if (slot == 16) continue; // Catapults belong to the future siege fixture.
        JsonNode entry; entry["id"].Integer() = slot;
        result["slots"].Vector().push_back(std::move(entry));
    }
    for (int id = 0; id <= 140; ++id) {
        if (!allowedArtifact(id)) continue;
        const auto * art = ArtifactID(id).toArtifact();
        JsonNode entry; entry["id"].Integer() = id; entry["key"].String() = art->getJsonKey();
        entry["label"].String() = art->getNameTranslated(); entry["description"].String() = art->getDescriptionTranslated();
        entry["combined"].Bool() = art->isCombined(); entry["scroll"].Bool() = id == static_cast<int>(ArtifactID::SPELL_SCROLL);
        if (art->getWarMachine().hasValue()) entry["creature"].String() = art->getWarMachine().toCreature()->getJsonKey();
        for (const auto & slot : art->getPossibleSlots().at(ArtBearer::HERO)) if (slot.getNum() != 16) entry["slots"].Vector().emplace_back(slot.getNum());
        result["artifacts"].Vector().push_back(std::move(entry));
    }
    return result;
}

JsonNode catalogue()
{
    JsonNode result;
    result["backend"].String() = "vcmi-native";
    result["scenarios"] = scenarioCatalogue();
    result["namedHeroes"] = heroCatalogue();
    result["equipment"] = artifactCatalogue();
    result["rulesProfile"].String() = customDefinitions.empty() ? "base-reference" : "custom-reference";
    result["customPacks"].Bool() = true;
    for (const auto * mechanism : {"flying", "additionalAttacks", "regeneration", "retaliations", "blocksRetaliation", "attacksAllAdjacent", "shooter", "undead", "deathCloud"})
        result["customMechanisms"].Vector().emplace_back(mechanism);
    result["heroSpells"].Bool() = true;
    result["creatureSpells"].Bool() = true;
    for (const auto & spell : LIBRARY->spellh->objects)
    {
        if (spell->getId().getNum() >= 70 || !spell->isCombat() || spell->isCreatureAbility()) continue;
        JsonNode entry; entry["id"].Integer() = spell->getId().getNum(); entry["label"].String() = spell->getNameTranslated();
        entry["key"].String() = spell->getJsonKey(); entry["level"].Integer() = spell->getLevel();
        result["spells"].Vector().push_back(std::move(entry));
    }
    for (int id = 0; id < 28; ++id)
    {
        JsonNode skill; skill["id"].Integer() = id; skill["label"].String() = SecondarySkill(id).toSkill()->getNameTranslated();
        result["skills"].Vector().push_back(std::move(skill));
    }
    result["battleAI"].String() = "VCMI BattleEvaluator";
    result["tenWeekTownArmies"] = tenWeekTownArmies();
    for (int id = 0; id < static_cast<int>(LIBRARY->creh->objects.size()); ++id)
    {
        if (!allowedCreature(id)) continue;
        const auto * creature = CreatureID(id).toCreature();
        JsonNode entry;
        entry["id"].Integer() = id;
        entry["key"].String() = creature->getJsonKey();
        entry["label"].String() = creature->getNameSingularTranslated();
        if (customDefinitions.contains(id)) {
            const auto & definition = customDefinitions.at(id);
            entry["art"].String() = definition["id"].String();
            entry["faction"].String() = definition["faction"].String();
            entry["custom"].Bool() = true;
        }
        entry["health"].Integer() = creature->getBaseHitPoints();
        entry["speed"].Integer() = creature->getBaseSpeed();
        entry["attack"].Integer() = creature->getBaseAttack();
        entry["defense"].Integer() = creature->getBaseDefense();
        entry["minDamage"].Integer() = creature->getBaseDamageMin();
        entry["maxDamage"].Integer() = creature->getBaseDamageMax();
        entry["shots"].Integer() = creature->getBaseShots();
        entry["doubleWide"].Bool() = creature->isDoubleWide();
        result["creatures"].Vector().push_back(std::move(entry));
    }
    return result;
}

class BattleSession
{
public:
    RecordingServer server;
    std::shared_ptr<CGameState> game;
    std::unique_ptr<CGameHandler> handler;
    int64_t revision = 0;

    explicit BattleSession(const JsonNode & request)
    {
        fields(request, {"version", "requestId", "op", "seed", "armies", "heroes", "scenario"});
        const auto seed = integer(request["seed"], 0, 2147483647);
        const auto & scene = request["scenario"];
        int terrain = static_cast<int>(TerrainId::SAND), layoutId = 148;
        bool obstacles = false;
        if (!scene.isNull()) {
            fields(scene, {"terrain", "battlefield", "obstacles", "layout"});
            if (!scene["terrain"].isNull()) terrain = integer(scene["terrain"], 0, 7);
            if (!scene["layout"].isNull()) layoutId = integer(scene["layout"], 0, 36 * 36 - 1);
            if (!scene["obstacles"].isNull()) {
                if (!scene["obstacles"].isBool()) throw std::runtime_error("Obstacle setting must be boolean");
                obstacles = scene["obstacles"].Bool();
            }
        }
        const auto availableFields = allowedBattlefields(terrain);
        BattleField field = availableFields.front();
        if (!scene["battlefield"].isNull()) {
            if (!scene["battlefield"].isString()) throw std::runtime_error("Battlefield key required");
            const auto found = std::find_if(availableFields.begin(), availableFields.end(), [&](const auto & id) { return LIBRARY->battlefieldsHandler->getById(id)->getJsonKey() == scene["battlefield"].String(); });
            if (found == availableFields.end()) throw std::runtime_error("Battlefield does not support this terrain");
            field = *found;
        }
        const int3 battleTile{layoutId % 36, layoutId / 36, 0};
        server.initialObstacles = obstacles;
        JsonNode armies = request["armies"];
        if (!armies.isVector() || armies.Vector().size() != 2) throw std::runtime_error("Two armies required");
        for (auto & army : armies.Vector())
        {
            if (!army.isVector() || army.Vector().empty() || army.Vector().size() > 7) throw std::runtime_error("Each army requires 1..7 stacks");
            std::set<int> slots;
            int index = 0;
            for (auto & stack : army.Vector())
            {
                fields(stack, {"creature", "count", "hex", "slot"});
                const int slot = stack["slot"].isNull() ? index : integer(stack["slot"], 0, 6);
                if (!slots.insert(slot).second) throw std::runtime_error("Duplicate army slot");
                stack["slot"].Integer() = slot;
                ++index;
                const int id = integer(stack["creature"], 0, INT32_MAX);
                if (!allowedCreature(id)) throw std::runtime_error("Only original Castle/Necropolis creatures supported");
                integer(stack["count"], 1, 99999);
                if (!stack["hex"].isNull() && !BattleHex(integer(stack["hex"], 0, 186)).isAvailable())
                    throw std::runtime_error("Unavailable deployment hex");
            }
            std::sort(army.Vector().begin(), army.Vector().end(), [](const JsonNode & left, const JsonNode & right) { return left["slot"].Integer() < right["slot"].Integer(); });
        }
        const auto & heroes = request["heroes"];
        if (!heroes.isNull() && (!heroes.isVector() || heroes.Vector().size() != 2)) throw std::runtime_error("Two hero configurations required");
        if (!heroes.isNull()) for (const auto & hero : heroes.Vector())
        {
            if (hero.isNull()) continue;
            fields(hero, {"attack", "defense", "power", "knowledge", "mana", "skills", "spells", "type", "level", "artifacts"});
            const bool named = !hero["type"].isNull();
            if (named && !allowedHero(integer(hero["type"], 0, 79))) throw std::runtime_error("Original Castle/Necropolis heroes only");
            if (!hero["level"].isNull()) { if (!named) throw std::runtime_error("Hero level requires a named hero"); integer(hero["level"], 1, maxPresetHeroLevel()); }
            for (const auto * attribute : {"attack", "defense", "power", "knowledge"})
                if (!named || !hero[attribute].isNull()) integer(hero[attribute], 0, 99);
            if (!hero["artifacts"].isNull()) {
                if (!hero["artifacts"].isVector() || hero["artifacts"].Vector().size() > 18) throw std::runtime_error("At most eighteen equipped artifacts");
                std::set<int> slots;
                for (const auto & entry : hero["artifacts"].Vector()) {
                    fields(entry, {"slot", "artifact", "spell"});
                    const int slot = integer(entry["slot"], 0, 18), id = integer(entry["artifact"], -1, 140);
                    if (slot == 16 || !slots.insert(slot).second || (id != -1 && !allowedArtifact(id))) throw std::runtime_error("Unsupported artifact or duplicate slot");
                    if (id == -1) { if (!entry["spell"].isNull()) throw std::runtime_error("Removed equipment cannot carry a spell"); continue; }
                    const auto & possible = ArtifactID(id).toArtifact()->getPossibleSlots().at(ArtBearer::HERO);
                    if (std::find(possible.begin(), possible.end(), ArtifactPosition(slot)) == possible.end()) throw std::runtime_error("Artifact does not fit this slot");
                    if (id == static_cast<int>(ArtifactID::SPELL_SCROLL)) {
                        const auto * spell = SpellID(integer(entry["spell"], 0, 69)).toSpell();
                        if (!spell->isCombat() || spell->isCreatureAbility()) throw std::runtime_error("Original combat scroll required");
                    } else if (!entry["spell"].isNull()) throw std::runtime_error("Only a scroll may specify a spell");
                }
            }
            if (!hero["mana"].isNull()) integer(hero["mana"], 0, 99999);
            if ((!named || !hero["skills"].isNull()) && (!hero["skills"].isVector() || hero["skills"].Vector().size() > 8)) throw std::runtime_error("At most eight secondary skills");
            std::set<int> skills;
            for (const auto & skill : hero["skills"].isNull() ? std::vector<JsonNode>{} : hero["skills"].Vector())
            {
                fields(skill, {"id", "level"}); const int id = integer(skill["id"], 0, 27); integer(skill["level"], 1, 3);
                if (!skills.insert(id).second) throw std::runtime_error("Duplicate secondary skill");
            }
            if ((!named || !hero["spells"].isNull()) && (!hero["spells"].isVector() || hero["spells"].Vector().size() > 70)) throw std::runtime_error("Spell list required");
            std::set<int> spells;
            for (const auto & id : hero["spells"].isNull() ? std::vector<JsonNode>{} : hero["spells"].Vector())
            {
                const auto * spell = SpellID(integer(id, 0, 69)).toSpell();
                if (!spell->isCombat() || spell->isCreatureAbility() || !spells.insert(id.Integer()).second) throw std::runtime_error("Original combat spells only; no duplicates");
            }
        }
        TinyH3M::TinyH3MBuilder builder(EMapFormat::SOD);
        builder.size(36).name("BattleLab").playerActive(PlayerColor(0)).playerActive(PlayerColor(1));
        for (int side = 0; side < 2; ++side) {
            const auto & config = heroes.isNull() ? JsonNode{} : heroes.Vector().at(side);
            const int type = config["type"].isNull() ? side : config["type"].Integer();
            const int level = config["level"].isNull() ? 1 : config["level"].Integer();
            builder.hero(side ? int3{7, 7, 0} : int3{5, 5, 0}, HeroTypeID(type), PlayerColor(side))
                .heroExperience(LIBRARY->heroh->reqExp(level));
            if (config["type"].isNull()) builder.heroGarrison({{CreatureID(0), 1}});
            server.namedHeroes[side] = !config["type"].isNull();
        }
        MemoryMap maps(builder.build());
        game = std::make_shared<CGameState>(); game->preInit(LIBRARY);
        StartInfo start; start.mapname = "BattleLab"; start.mode = EStartMode::NEW_GAME;
        for (int i = 0; i < 2; ++i)
        {
            auto & player = start.playerInfos[PlayerColor(i)];
            player.color = PlayerColor(i); player.name = "Battle Lab";
            player.connectedPlayerIDs.insert(static_cast<PlayerConnectionID>(i));
            player.bonus = PlayerStartingBonus::GOLD;
        }
        GameRandomizer randomizer(*game); randomizer.setSeed(seed);
        Load::ProgressAccumulator progress; game->init(&maps, &start, randomizer, progress, false);
        // Army containers and battle tile share the selected terrain. No frontend
        // stat compensation: native terrain and battlefield bonuses use game state.
        for (int y = 0; y < 36; ++y) for (int x = 0; x < 36; ++x)
            game->getMap().getTile({x, y, 0}).terrainType = TerrainId(terrain);
        server.game = game; handler = std::make_unique<CGameHandler>(server, game);
        handler->randomizer->setSeed(seed);
        BattleSideArray<CGHeroInstance *> armyObjects = {};
        for (const auto & object : game->getMap().objects)
            if (auto * hero = dynamic_cast<CGHeroInstance *>(object.get()))
            {
                const auto side = hero->getOwner() == PlayerColor(0) ? BattleSide::ATTACKER : BattleSide::DEFENDER;
                if (!server.namedHeroes[static_cast<int>(side)]) neutralize(*hero);
                hero->clearSlots();
                if (!heroes.isNull() && !heroes.Vector().at(static_cast<int>(side)).isNull())
                {
                    const auto & config = heroes.Vector().at(static_cast<int>(side));
                    if (!config["attack"].isNull()) hero->setPrimarySkill(PrimarySkill::ATTACK, config["attack"].Integer(), ChangeValueMode::ABSOLUTE);
                    if (!config["defense"].isNull()) hero->setPrimarySkill(PrimarySkill::DEFENSE, config["defense"].Integer(), ChangeValueMode::ABSOLUTE);
                    if (!config["power"].isNull()) hero->setPrimarySkill(PrimarySkill::SPELL_POWER, config["power"].Integer(), ChangeValueMode::ABSOLUTE);
                    if (!config["knowledge"].isNull()) hero->setPrimarySkill(PrimarySkill::KNOWLEDGE, config["knowledge"].Integer(), ChangeValueMode::ABSOLUTE);
                    if (!config["skills"].isNull()) for (int i = 0; i < LIBRARY->skillh->size(); ++i) hero->setSecSkillLevel(SecondarySkill(i), 0, ChangeValueMode::ABSOLUTE);
                    for (const auto & skill : config["skills"].isNull() ? std::vector<JsonNode>{} : config["skills"].Vector()) hero->setSecSkillLevel(SecondarySkill(skill["id"].Integer()), skill["level"].Integer(), ChangeValueMode::ABSOLUTE);
                    if (!config["spells"].isNull()) hero->removeAllSpells();
                    for (const auto & spell : config["spells"].isNull() ? std::vector<JsonNode>{} : config["spells"].Vector()) hero->addSpellToSpellbook(SpellID(spell.Integer()));
                    if (!config["spells"].isNull() && !hero->getArt(ArtifactPosition::SPELLBOOK)) hero->putArtifact(ArtifactPosition::SPELLBOOK, game->createArtifact(ArtifactID::SPELLBOOK));
                    if (!config["artifacts"].isNull()) {
                        // Preserve native starting spellbook/machines unless a slot is overridden.
                        for (const auto & entry : config["artifacts"].Vector()) {
                            const auto slot = ArtifactPosition(entry["slot"].Integer());
                            const auto id = ArtifactID(entry["artifact"].Integer());
                            if (hero->getSlot(slot) && hero->getSlot(slot)->locked) throw std::runtime_error("Artifact slot is reserved by a combination");
                            if (hero->getArt(slot)) hero->removeArtifact(slot);
                            if (id.getNum() == -1) continue;
                            auto * artifact = game->createArtifact(id, entry["spell"].isNull() ? SpellID::NONE : SpellID(entry["spell"].Integer()));
                            if (!artifact->canBePutAt(hero, slot)) throw std::runtime_error("Artifact or combination does not fit the available slots");
                            hero->putArtifact(slot, artifact);
                        }
                    }
                    hero->mana = config["mana"].isNull() ? hero->manaLimit() : config["mana"].Integer();
                    if (hero->mana > hero->manaLimit()) throw std::runtime_error("Mana exceeds native hero limit");
                }
                const auto & stacks = armies.Vector().at(static_cast<int>(side)).Vector();
                for (size_t slot = 0; slot < stacks.size(); ++slot)
                    hero->setCreature(SlotID(stacks[slot]["slot"].Integer()), CreatureID(stacks[slot]["creature"].Integer()), stacks[slot]["count"].Integer());
                armyObjects[side] = hero;
            }
        if (!armyObjects[BattleSide::ATTACKER] || !armyObjects[BattleSide::DEFENDER]) throw std::runtime_error("Missing army objects");
        BattleLayout layout = BattleLayout::createDefaultLayout(*game, armyObjects[BattleSide::ATTACKER], armyObjects[BattleSide::DEFENDER]);
        layout.obstaclesAllowed = obstacles; layout.tacticsAllowed = true;
        for (const auto side : {BattleSide::ATTACKER, BattleSide::DEFENDER})
        {
            const auto & stacks = armies.Vector().at(static_cast<int>(side)).Vector();
            for (size_t slot = 0; slot < stacks.size(); ++slot)
            {
                const auto & stack = stacks[slot];
                if (!stack["hex"].isNull()) layout.units[side][slot] = BattleHex(stack["hex"].Integer());
            }
        }
        BattleSideArray<const CArmedInstance *> nativeArmies = {armyObjects[BattleSide::ATTACKER], armyObjects[BattleSide::DEFENDER]};
        // Army containers are on a real map; fighting heroes are explicitly opt-in.
        BattleStart begin; begin.battleID = BattleID(0);
        BattleSideArray<const CGHeroInstance *> fightingHeroes = {nullptr, nullptr};
        if (!heroes.isNull()) for (const auto side : {BattleSide::ATTACKER, BattleSide::DEFENDER})
            if (!heroes.Vector().at(static_cast<int>(side)).isNull()) fightingHeroes[side] = armyObjects[side];
        begin.info = BattleInfo::setupBattle(game.get(), battleTile, TerrainId(terrain), field, nativeArmies, fightingHeroes, layout, nullptr);
        std::set<int> occupied;
        // Let the engine place default double-wide formations. Explicit locations
        // must be honored exactly rather than silently relocated by getAvailableHex.
        for (const auto * unit : begin.info->battleGetAllStacks())
        {
            const auto & sideStacks = armies.Vector().at(static_cast<int>(unit->unitSide())).Vector();
            const auto entry = std::find_if(sideStacks.begin(), sideStacks.end(), [&](const JsonNode & stack) { return stack["slot"].Integer() == unit->unitSlot().getNum(); });
            const bool machine = unit->unitSlot() == SlotID::WAR_MACHINES_SLOT;
            if (!machine && entry == sideStacks.end()) throw std::runtime_error("Missing army slot");
            const auto & specified = machine ? JsonNode{} : (*entry)["hex"];
            if (!specified.isNull() && unit->initialPosition.toInt() != specified.Integer())
                throw std::runtime_error("Occupied or invalid deployment footprint");
            for (const auto & hex : battle::Unit::getHexes(unit->initialPosition, unit->unitType()->isDoubleWide(), unit->unitSide()))
                if (!(machine ? hex.isValid() : hex.isAvailable()) || !occupied.insert(hex.toInt()).second) throw std::runtime_error("Occupied or invalid deployment footprint");
        }
        handler->sendAndApply(begin);
        auto & battle = *game->currentBattles.front();
        handler->queries->addQuery(std::make_shared<CBattleQuery>(handler.get(), &battle));
        BattleFlowProcessor flow(handler->battles.get(), handler.get());
        flow.onBattleStarted(battle);
    }

    JsonNode state() const
    {
        JsonNode result = server.currentState();
        result["revision"].Integer() = revision;
        auto & legal = result["legal"];
        legal["moves"].Vector(); legal["shots"].Vector(); legal["melee"].Vector(); legal["heals"].Vector();
        legal["wait"].Bool() = false; legal["defend"].Bool() = false;
        result["queue"].Vector();
        for (auto & unit : result["units"].Vector()) unit["movement"].Vector();
        if (game->currentBattles.empty() || !result["winner"].isNull()) return result;
        const auto & battle = *game->currentBattles.front();
        if (battle.battleTacticDist())
        {
            result["activeStack"].clear();
            auto & tactics = result["tactics"];
            tactics["side"].Integer() = static_cast<int>(battle.battleGetTacticsSide());
            tactics["distance"].Integer() = battle.battleTacticDist();
            tactics["stacks"].Vector();
            for (const auto * stack : battle.battleGetAllStacks())
            {
                if (!stack->alive() || stack->unitSide() != battle.battleGetTacticsSide() || stack->unitSlot() == SlotID::WAR_MACHINES_SLOT) continue;
                JsonNode entry; entry["id"].Integer() = stack->unitId(); entry["moves"].Vector(); entry["movement"].Vector();
                const auto available = battle.battleGetAvailableHexes(stack, false);
                for (const auto & hex : battle.battleGetOccupiableHexes(available, stack)) entry["movement"].Vector().emplace_back(hex.toInt());
                for (const auto & hex : available)
                {
                    if (hex == stack->getPosition()) continue;
                    JsonNode move; move["hex"].Integer() = hex.toInt();
                    const auto path = battle.getPath(stack->getPosition(), hex, stack).first;
                    for (auto it = path.rbegin(); it != path.rend(); ++it) move["path"].Vector().emplace_back(it->toInt());
                    entry["moves"].Vector().push_back(std::move(move));
                }
                tactics["stacks"].Vector().push_back(std::move(entry));
            }
            return result;
        }
        // Inspection is available for either side, independently of whose turn
        // it is. Native reachability includes obstacles, spells and wide bodies.
        for (const auto * stack : battle.battleGetAllStacks())
        {
            if (!stack->alive()) continue;
            auto unit = std::find_if(result["units"].Vector().begin(), result["units"].Vector().end(),
                [&](const JsonNode & entry) { return entry["id"].Integer() == stack->unitId(); });
            if (unit == result["units"].Vector().end()) continue;
            for (const auto & hex : battle.battleGetOccupiableHexes(stack, true))
                (*unit)["movement"].Vector().emplace_back(hex.toInt());
        }
        const auto * actor = battle.battleActiveUnit();
        if (!actor) return result;
        legal["wait"].Bool() = !actor->waited(); legal["defend"].Bool() = true;
        std::vector<battle::Units> queue;
        battle.battleGetTurnOrder(queue, 14, 1);
        for (const auto & round : queue) for (const auto * unit : round) result["queue"].Vector().emplace_back(unit->unitId());
        const auto available = battle.battleGetAvailableHexes(actor, false);
        for (const auto & hex : available)
        {
            if (hex == actor->getPosition()) continue;
            JsonNode move; move["hex"].Integer() = hex.toInt();
            auto path = battle.getPath(actor->getPosition(), hex, actor).first;
            for (auto it = path.rbegin(); it != path.rend(); ++it) move["path"].Vector().emplace_back(it->toInt());
            legal["moves"].Vector().push_back(std::move(move));
        }
        for (const auto * target : battle.battleGetAllStacks())
        {
            if (!target->alive()) continue;
            if (battle.battleCanShoot(actor, target->getPosition())) legal["shots"].Vector().emplace_back(target->unitId());
            if (!battle.battleCanAttackUnit(actor, target)) continue;
            std::set<int> fromHexes;
            for (const auto & targetHex : target->getHexes())
                for (const auto direction : BattleHex::hexagonalDirections())
                {
                    if (!battle.battleCanAttackHex(available, actor, targetHex, direction)) continue;
                    const auto from = battle.fromWhichHexAttack(actor, targetHex, direction);
                    if (!from.isAvailable() || !fromHexes.insert(from.toInt()).second) continue;
                    JsonNode attack; attack["target"].Integer() = target->unitId(); attack["from"].Integer() = from.toInt();
                    legal["melee"].Vector().push_back(std::move(attack));
                }
        }
        if (actor->hasBonusOfType(BonusType::HEALER)) {
            for (const auto * target : battle.battleGetAllStacks())
                if (battle.battleGetOwner(target) == battle.battleGetOwner(actor) && target->canBeHealed()) legal["heals"].Vector().emplace_back(target->unitId());
        }
        return result;
    }

    JsonNode spellTargets(const JsonNode & request) const
    {
        fields(request, {"version", "requestId", "op", "revision", "stack", "spell", "caster"});
        if (integer(request["revision"], 0, INT64_MAX) != revision || game->currentBattles.empty()) throw std::runtime_error("Stale or ended battle");
        const auto & battle = *game->currentBattles.front();
        if (battle.battleTacticDist()) throw std::runtime_error("Spells unavailable during tactics");
        const auto * actor = battle.battleActiveUnit();
        if (!actor || integer(request["stack"], 0, INT32_MAX) != actor->unitId()) throw std::runtime_error("Stack is not active");
        if (!request["caster"].isNull() && (!request["caster"].isString() || (request["caster"].String() != "hero" && request["caster"].String() != "creature"))) throw std::runtime_error("Unsupported caster");
        const bool creatureCast = request["caster"].isString() && request["caster"].String() == "creature";
        const auto * stack = battle.battleGetStackByID(actor->unitId());
        const spells::Caster * caster = creatureCast ? static_cast<const spells::Caster *>(stack) : static_cast<const spells::Caster *>(battle.battleGetOwnerHero(actor));
        const auto mode = creatureCast ? spells::Mode::CREATURE_ACTIVE : spells::Mode::HERO;
        const auto * spell = SpellID(integer(request["spell"], 0, 69)).toSpell();
        if (!caster || !spell->isCombat() || spell->isCreatureAbility() || (creatureCast && (!stack->canCast() || !stack->hasBonusOfType(BonusType::SPELLCASTER, BonusSubtypeID(spell->getId())))) || !spell->canBeCast(&battle, mode, caster)) throw std::runtime_error("Spell unavailable");
        spells::BattleCast cast(&battle, caster, mode, spell); auto mechanics = spell->battleMechanics(&cast);
        const auto types = mechanics->getTargetTypes();
        JsonNode result; result["targets"].Vector();
        spells::Target prefix;
        std::function<void(size_t)> enumerate = [&](size_t index)
        {
            if (index == types.size() || (types.size() == 1 && types[0] == spells::AimType::NOTHING))
            {
                if (!mechanics->canBeCastAt(prefix)) return;
                JsonNode target; target.Vector();
                for (const auto & destination : prefix)
                {
                    JsonNode entry;
                    if (destination.unitValue) entry["unit"].Integer() = destination.unitValue->unitId();
                    else entry["hex"].Integer() = destination.hexValue.toInt();
                    target.Vector().push_back(std::move(entry));
                }
                result["targets"].Vector().push_back(std::move(target)); return;
            }
            if (types[index] == spells::AimType::CREATURE)
                for (const auto * unit : battle.battleGetAllStacks(true)) { prefix.emplace_back(unit); enumerate(index + 1); prefix.pop_back(); }
            else if (types[index] == spells::AimType::LOCATION || types[index] == spells::AimType::OBSTACLE)
                for (int hex = 0; hex < 187; ++hex) { prefix.emplace_back(BattleHex(hex)); enumerate(index + 1); prefix.pop_back(); }
        };
        if (types.size() > 2) throw std::runtime_error("Unsupported target arity");
        enumerate(0); return result;
    }

    JsonNode act(const JsonNode & request)
    {
        fields(request, {"version", "requestId", "op", "revision", "stack", "action", "hex", "target", "from", "spell", "targets"});
        if (integer(request["revision"], 0, INT64_MAX) != revision) throw std::runtime_error("Stale state revision");
        const auto current = state();
        if (game->currentBattles.empty() || !current["winner"].isNull()) throw std::runtime_error("Battle has ended");
        const auto & battle = *game->currentBattles.front();
        if (battle.battleTacticDist())
        {
            if (!request["action"].isString()) throw std::runtime_error("Missing action");
            const auto & action = request["action"].String();
            const auto side = battle.battleGetTacticsSide();
            BattleAction native;
            if (action == "ai")
            {
                auto callback = std::make_shared<AICallback>(battle.sideToPlayer(side));
                callback->onBattleStarted(&battle);
                TacticsHandler tactics(callback, BattleID(0), TacticsHandler::Settings{});
                server.events.clear();
                tactics.onTacticsStarted();
                // Execute each upstream decision against live state before the
                // handler chooses its next deployment, just as the VCMI client does.
                while (callback->tacticsAction)
                {
                    native = *callback->tacticsAction; callback->tacticsAction.reset();
                    if (!handler->battles->makePlayerBattleAction(BattleID(0), battle.sideToPlayer(side), native)) throw std::runtime_error("Engine rejected AI tactics action");
                    if (!battle.battleTacticDist()) break;
                    tactics.onActionFinished(native);
                }
                ++revision;
                JsonNode response; response["state"] = state(); response["events"].Vector() = server.events;
                return response;
            }
            else if (action == "endTactics") native = BattleAction::makeEndOFTacticPhase(side);
            else if (action == "tacticsMove")
            {
                const int id = integer(request["stack"], 0, INT32_MAX), hex = integer(request["hex"], 0, 186);
                bool found = false;
                for (const auto & entry : current["tactics"]["stacks"].Vector())
                    if (entry["id"].Integer() == id) for (const auto & move : entry["moves"].Vector()) if (move["hex"].Integer() == hex) found = true;
                if (!found) throw std::runtime_error("Illegal tactics destination or stack");
                native = BattleAction::makeMove(battle.battleGetStackByID(id), BattleHex(hex));
            }
            else throw std::runtime_error("Only deployment actions are available during tactics");
            server.events.clear();
            if (!handler->battles->makePlayerBattleAction(BattleID(0), battle.sideToPlayer(side), native)) throw std::runtime_error("Engine rejected tactics action");
            ++revision;
            JsonNode response; response["state"] = state(); response["events"].Vector() = server.events;
            return response;
        }
        const auto * actor = battle.battleActiveUnit();
        if (!actor || integer(request["stack"], 0, INT32_MAX) != actor->unitId()) throw std::runtime_error("Stack is not active");
        if (!request["action"].isString()) throw std::runtime_error("Missing action");
        const auto & action = request["action"].String();
        BattleAction native;
        if (action == "ai")
        {
            const auto player = battle.battleGetOwner(actor);
            const auto side = battle.playerToSide(player);
            auto callback = std::make_shared<AICallback>(player);
            callback->onBattleStarted(&battle);
            auto environment = std::make_shared<AIEnvironment>(*game, callback);
            int64_t ours = 0, theirs = 0;
            for (const auto * unit : battle.battleGetAllStacks())
                if (unit->alive()) (unit->unitSide() == side ? ours : theirs) += static_cast<int64_t>(unit->getCount()) * unit->unitType()->getAIValue();
            BattleEvaluator evaluator(environment, callback, actor, player, BattleID(0), side,
                theirs ? static_cast<float>(ours) / theirs : 1.0f, 2);
            const auto * stack = battle.battleGetStackByID(actor->unitId());
            if (!stack) throw std::runtime_error("Missing AI stack");
            if (stack->hasBonusOfType(BonusType::HEALER) && stack->hasBonusOfType(BonusType::SIEGE_WEAPON)) {
                CBattleAI machineAI; machineAI.initBattleInterface(environment, callback); native = machineAI.useHealingTent(BattleID(0), stack);
            } else native = evaluator.selectStackAction(stack);
            if (evaluator.canCastSpell() && evaluator.attemptCastingSpell(stack))
            {
                if (!callback->spellAction) throw std::runtime_error("AI did not return its spell choice");
                native = *callback->spellAction;
            }
        }
        else if (action == "spell" || action == "creatureSpell")
        {
            const bool creatureCast = action == "creatureSpell";
            const auto * stack = battle.battleGetStackByID(actor->unitId());
            const spells::Caster * caster = creatureCast ? static_cast<const spells::Caster *>(stack) : static_cast<const spells::Caster *>(battle.battleGetOwnerHero(actor));
            const auto mode = creatureCast ? spells::Mode::CREATURE_ACTIVE : spells::Mode::HERO;
            const auto * spell = SpellID(integer(request["spell"], 0, 69)).toSpell();
            if (!caster || !spell->isCombat() || spell->isCreatureAbility() || (creatureCast && (!stack->canCast() || !stack->hasBonusOfType(BonusType::SPELLCASTER, BonusSubtypeID(spell->getId())))) || !spell->canBeCast(&battle, mode, caster)) throw std::runtime_error("Caster cannot cast this spell now");
            spells::BattleCast cast(&battle, caster, mode, spell);
            if (!request["targets"].isVector() || request["targets"].Vector().size() > 2) throw std::runtime_error("Spell targets required");
            spells::Target targets;
            for (const auto & target : request["targets"].Vector())
            {
                fields(target, {"unit", "hex"});
                if (!target["unit"].isNull())
                {
                    const auto * unit = battle.battleGetStackByID(integer(target["unit"], 0, INT32_MAX), false);
                    if (!unit || !target["hex"].isNull()) throw std::runtime_error("Invalid unit spell target");
                    targets.emplace_back(unit);
                }
                else targets.emplace_back(BattleHex(integer(target["hex"], 0, 186)));
            }
            auto mechanics = spell->battleMechanics(&cast);
            const auto types = mechanics->getTargetTypes();
            const size_t targetCount = types.size() == 1 && types[0] == spells::AimType::NOTHING ? 0 : types.size();
            if (targets.size() != targetCount || !mechanics->canBeCastAt(targets)) throw std::runtime_error("Illegal spell target");
            native.actionType = creatureCast ? EActionType::MONSTER_SPELL : EActionType::HERO_SPELL; native.side = battle.playerToSide(battle.battleGetOwner(actor)); native.stackNumber = creatureCast ? actor->unitId() : -1; native.spell = spell->getId(); native.setTarget(targets);
        }
        else if (action == "wait" && current["legal"]["wait"].Bool()) native = BattleAction::makeWait(actor);
        else if (action == "defend") native = BattleAction::makeDefend(actor);
        else if (action == "heal") {
            const int target = integer(request["target"], 0, INT32_MAX);
            bool legal = false;
            for (const auto & id : current["legal"]["heals"].Vector()) if (id.Integer() == target) legal = true;
            if (!legal) throw std::runtime_error("Illegal healing target");
            native = BattleAction::makeHeal(actor, battle.battleGetStackByID(target));
        }
        else if (action == "move")
        {
            const int hex = integer(request["hex"], 0, 186);
            bool found = false;
            for (const auto & move : current["legal"]["moves"].Vector()) if (move["hex"].Integer() == hex) found = true;
            if (!found) throw std::runtime_error("Illegal movement destination");
            native = BattleAction::makeMove(actor, BattleHex(hex));
        }
        else if (action == "shoot" || action == "melee")
        {
            const int targetId = integer(request["target"], 0, INT32_MAX);
            const auto * target = battle.battleGetStackByID(targetId);
            if (!target) throw std::runtime_error("Unknown target");
            if (action == "shoot")
            {
                bool found = false;
                for (const auto & id : current["legal"]["shots"].Vector()) if (id.Integer() == targetId) found = true;
                if (!found) throw std::runtime_error("Illegal shooting target");
                native = BattleAction::makeShotAttack(actor, target);
            }
            else
            {
                const int from = integer(request["from"], 0, 186);
                bool found = false;
                for (const auto & option : current["legal"]["melee"].Vector())
                    if (option["target"].Integer() == targetId && option["from"].Integer() == from) found = true;
                if (!found) throw std::runtime_error("Illegal melee position");
                native = BattleAction::makeMeleeAttack(actor, target, BattleHex(from));
            }
        }
        else throw std::runtime_error("Unsupported or unavailable action");
        server.events.clear();
        if (!handler->battles->makePlayerBattleAction(BattleID(0), battle.battleGetOwner(actor), native))
            throw std::runtime_error("Engine rejected a advertised legal action");
        ++revision;
        JsonNode response; response["state"] = state(); response["events"].Vector() = server.events;
        return response;
    }
};

int main()
{
    try
    {
        VCMIDirs::get();
        auto library = std::make_unique<GameLibrary>(); LIBRARY = library.get();
        library->initializeFilesystem(false);
        loadCustomMetadata();
        const auto & mods = library->modh->getActiveMods();
        std::set<std::string> allowedMods = {"core", "vcmi"};
        if (!customPack.isNull()) allowedMods.insert("battle-lab-custom");
        if (std::set<std::string>(mods.begin(), mods.end()) != allowedMods) throw std::runtime_error("Unexpected active mods");
        library->initializeLibrary();
        if (!customPack.isNull()) for (const auto & definition : customPack["creatures"].Vector()) {
            const auto key = "battle-lab-custom:" + definition["id"].String();
            const auto found = std::find_if(LIBRARY->creh->objects.begin(), LIBRARY->creh->objects.end(), [&](const auto & creature) { return creature && creature->getJsonKey() == key; });
            if (found == LIBRARY->creh->objects.end()) throw std::runtime_error("Custom creature failed to initialize");
            customDefinitions.emplace((*found)->getIndex(), definition);
        }
        std::unique_ptr<BattleSession> session;
        std::string line;
        while (std::getline(std::cin, line))
        {
            JsonNode response; response["version"].Integer() = 1;
            try
            {
                if (line.size() > 1024 * 1024) throw std::runtime_error("Request exceeds 1 MB");
                JsonParsingSettings settings; settings.mode = JsonParsingSettings::JsonFormatMode::JSON;
                JsonParser parser(line.data(), line.size(), settings);
                const JsonNode request = parser.parse("battle-request");
                if (!parser.isValid() || !request.isStruct()) throw std::runtime_error("Invalid JSON request");
                if (!request["requestId"].isString() || request["requestId"].String().size() > 80) throw std::runtime_error("Invalid requestId");
                response["requestId"] = request["requestId"];
                if (integer(request["version"], 1, 1) != 1 || !request["op"].isString()) throw std::runtime_error("Unsupported protocol");
                const auto op = request["op"].String();
                JsonNode payload;
                if (op == "catalogue") { fields(request, {"version", "requestId", "op"}); payload = catalogue(); }
                else if (op == "deployment")
                {
                    auto preview = std::make_unique<BattleSession>(request);
                    payload["state"] = preview->state();
                    payload["events"].Vector();
                }
                else if (op == "create")
                {
                    auto candidate = std::make_unique<BattleSession>(request);
                    session = std::move(candidate);
                    payload["state"] = session->state(); payload["events"].Vector() = session->server.events;
                }
                else if (op == "spellTargets") { if (!session) throw std::runtime_error("Create a battle first"); payload = session->spellTargets(request); }
                else if (op == "act") { if (!session) throw std::runtime_error("Create a battle first"); payload = session->act(request); }
                else if (op == "state") { fields(request, {"version", "requestId", "op"}); if (!session) throw std::runtime_error("No active battle"); payload["state"] = session->state(); }
                else if (op == "dispose") { fields(request, {"version", "requestId", "op"}); session.reset(); }
                else throw std::runtime_error("Unknown operation");
                response["ok"].Bool() = true; response["result"] = std::move(payload);
            }
            catch (const std::exception & error) { response["ok"].Bool() = false; response["error"].String() = error.what(); }
            // VCMI's "compact" writer still indents non-compact nodes. Frame one
            // response per line; encoded string newlines remain escaped.
            auto json = response.toCompactString();
            std::erase(json, '\n'); std::erase(json, '\r');
            std::cout << json << std::endl;
        }
        session.reset(); library.reset(); LIBRARY = nullptr;
    }
    catch (const std::exception & error) { std::cerr << error.what() << "\n"; return 1; }
}
