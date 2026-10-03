// SPDX-License-Identifier: GPL-2.0-or-later
// Real server battle smoke test. Fixed scenario, not the final backend protocol.
#include "Global.h"
#include "lib/GameLibrary.h"
#include "lib/VCMIDirs.h"
#include "lib/CSkillHandler.h"
#include "lib/CStack.h"
#include "lib/StartInfo.h"
#include "lib/battle/BattleInfo.h"
#include "lib/battle/BattleLayout.h"
#include "lib/callback/GameRandomizer.h"
#include "lib/entities/hero/CHero.h"
#include "lib/gameState/CGameState.h"
#include "lib/mapping/CMap.h"
#include "lib/mapping/CMapService.h"
#include "lib/mapping/MapFormatH3M.h"
#include "lib/filesystem/CMemoryBuffer.h"
#include "lib/modding/CModHandler.h"
#include "lib/modding/ModScope.h"
#include "lib/modding/IdentifierStorage.h"
#include "lib/networkPacks/PacksForClientBattle.h"
#include "server/CGameHandler.h"
#include "server/IGameServer.h"
#include "server/battles/BattleProcessor.h"
#include "test/mock/TinyH3MBuilder.h"

class MemoryMap final : public CMapService
{
    std::vector<uint8_t> bytes;
public:
    explicit MemoryMap(std::vector<uint8_t> bytes) : bytes(std::move(bytes)) {}
    std::unique_ptr<CMap> loadMap(const ResourcePath &, IGameInfoCallback * cb) const override
    {
        CMemoryBuffer buffer;
        buffer.write(bytes.data(), bytes.size()); buffer.seek(0);
        CMapLoaderH3M loader("BattleLabProbe", "core", "ASCII", &buffer);
        return loader.loadMap(cb);
    }
    std::unique_ptr<CMapHeader> loadMapHeader(const ResourcePath &, bool = false) const override
    {
        CMemoryBuffer buffer;
        buffer.write(bytes.data(), bytes.size()); buffer.seek(0);
        CMapLoaderH3M loader("BattleLabProbe", "core", "ASCII", &buffer);
        return loader.loadMapHeader();
    }
};

JsonNode snapshot(const CGameState & state)
{
    JsonNode result;
    if (state.currentBattles.empty()) return result;
    const auto & battle = *state.currentBattles.front();
    result["round"].Integer() = battle.getRound();
    result["activeStack"].Integer() = battle.activeStack;
    auto & units = result["units"].Vector();
    for (const auto * stack : battle.battleGetAllStacks(true))
    {
        JsonNode unit;
        unit["id"].Integer() = stack->unitId();
        unit["creature"].String() = stack->unitType()->getJsonKey();
        unit["side"].Integer() = static_cast<int>(stack->unitSide());
        unit["hex"].Integer() = stack->getPosition().toInt();
        unit["count"].Integer() = stack->getCount();
        unit["health"].Integer() = stack->getAvailableHealth();
        unit["shots"].Integer() = stack->shots.available();
        units.push_back(std::move(unit));
    }
    return result;
}

class RecordingServer final : public IGameServer
{
    EServerState state = EServerState::GAMEPLAY;
public:
    std::shared_ptr<CGameState> game;
    std::vector<JsonNode> events;
    void setState(EServerState value) override { state = value; }
    EServerState getState() const override { return state; }
    bool isPlayerHost(const PlayerColor &) const override { return true; }
    bool hasPlayerAt(PlayerColor, GameConnectionID) const override { return true; }
    bool hasBothPlayersAtSameConnection(PlayerColor, PlayerColor) const override { return true; }
    void sendPack(CPackForClient &, GameConnectionID) override {}
    void applyPack(CPackForClient & pack) override
    {
        JsonNode event;
        event["nativePack"].String() = typeid(pack).name();
        if (auto * attack = dynamic_cast<BattleAttack *>(&pack))
        {
            event["type"].String() = "attack";
            event["attacker"].Integer() = attack->stackAttacking;
            event["ranged"].Bool() = attack->shot();
            event["counter"].Bool() = attack->counter();
            for (const auto & hit : attack->bsa)
            {
                JsonNode victim;
                victim["id"].Integer() = hit.stackAttacked;
                victim["damage"].Integer() = hit.damageAmount;
                victim["killed"].Integer() = hit.killedAmount;
                victim["secondary"].Bool() = hit.isSecondary();
                event["victims"].Vector().push_back(std::move(victim));
            }
        }
        else if (auto * move = dynamic_cast<BattleStackMoved *>(&pack))
        {
            event["type"].String() = "move";
            event["stack"].Integer() = move->stack;
            for (const auto & hex : move->tilesToMove) event["path"].Vector().emplace_back(hex.toInt());
        }
        else if (auto * active = dynamic_cast<BattleSetActiveStack *>(&pack))
        {
            event["type"].String() = "activeStack";
            event["stack"].Integer() = active->stack;
        }
        else if (dynamic_cast<BattleNextRound *>(&pack)) event["type"].String() = "round";
        else event["type"].String() = "nativeUpdate";
        event["before"] = snapshot(*game);
        game->apply(pack);
        event["after"] = snapshot(*game);
        events.push_back(std::move(event));
    }
};

void neutralize(CGHeroInstance & hero)
{
    for (const auto & bonus : hero.getHeroType()->specialty) hero.removeBonus(bonus);
    for (int i = 0; i < LIBRARY->skillh->size(); ++i)
        hero.setSecSkillLevel(SecondarySkill(i), 0, ChangeValueMode::ABSOLUTE);
    for (auto skill : {PrimarySkill::ATTACK, PrimarySkill::DEFENSE, PrimarySkill::SPELL_POWER, PrimarySkill::KNOWLEDGE})
        hero.setPrimarySkill(skill, 0, ChangeValueMode::ABSOLUTE);
}

int main()
{
    try
    {
        VCMIDirs::get();
        auto library = std::make_unique<GameLibrary>(); LIBRARY = library.get();
        library->initializeFilesystem(false);
        const auto & mods = library->modh->getActiveMods();
        if (std::set<std::string>(mods.begin(), mods.end()) != std::set<std::string>{"core", "vcmi"})
            throw std::runtime_error("Unexpected active mods");
        library->initializeLibrary();
        TinyH3M::TinyH3MBuilder builder(EMapFormat::SOD);
        builder.size(36).name("BattleLabProbe").playerActive(PlayerColor(0)).playerActive(PlayerColor(1))
            .hero({5, 5, 0}, HeroTypeID(0), PlayerColor(0)).heroGarrison({{CreatureID(3), 20}})
            .hero({7, 7, 0}, HeroTypeID(1), PlayerColor(1)).heroGarrison({{CreatureID(58), 20}});
        MemoryMap maps(builder.build());
        auto game = std::make_shared<CGameState>(); game->preInit(LIBRARY);
        StartInfo start;
        start.mapname = "BattleLabProbe"; start.mode = EStartMode::NEW_GAME;
        for (int i = 0; i < 2; ++i)
        {
            auto & player = start.playerInfos[PlayerColor(i)];
            player.color = PlayerColor(i); player.name = "Battle Lab";
            player.connectedPlayerIDs.insert(static_cast<PlayerConnectionID>(i));
            player.bonus = PlayerStartingBonus::GOLD;
        }
        GameRandomizer randomizer(*game); randomizer.setSeed(1337);
        Load::ProgressAccumulator progress;
        game->init(&maps, &start, randomizer, progress, false);
        RecordingServer server; server.game = game;
        auto handler = std::make_unique<CGameHandler>(server, game);
        handler->randomizer->setSeed(1337);
        BattleSideArray<const CGHeroInstance *> heroes = {};
        for (const auto & object : game->getMap().objects)
            if (auto * hero = dynamic_cast<CGHeroInstance *>(object.get()))
            {
                neutralize(*hero); heroes[hero->getOwner() == PlayerColor(0) ? BattleSide::ATTACKER : BattleSide::DEFENDER] = hero;
            }
        if (!heroes[BattleSide::ATTACKER] || !heroes[BattleSide::DEFENDER]) throw std::runtime_error("Missing fixture heroes");
        BattleLayout layout;
        layout.units[BattleSide::ATTACKER][0] = BattleHex(5, 5);
        layout.units[BattleSide::DEFENDER][0] = BattleHex(11, 5);
        BattleSideArray<const CArmedInstance *> armies = {heroes[BattleSide::ATTACKER], heroes[BattleSide::DEFENDER]};
        BattleStart begin; begin.battleID = BattleID(0);
        const std::string fieldName = "core:sand_shore";
        const auto field = LIBRARY->identifiers()->getIdentifier(ModScope::scopeGame(), "battlefield", fieldName);
        if (!field) throw std::runtime_error("Missing neutral battlefield");
        begin.info = BattleInfo::setupBattle(game.get(), {4, 4, 0}, TerrainId::SAND, BattleField(*field), armies, heroes, layout, nullptr);
        handler->sendAndApply(begin);
        auto & battle = *game->currentBattles.front();
        // End tactics through the actual processor to activate battle-start triggers/turn flow.
        battle.tacticDistance = 1; battle.tacticsSide = BattleSide::ATTACKER;
        if (!handler->battles->makePlayerBattleAction(BattleID(0), PlayerColor(0), BattleAction::makeEndOFTacticPhase(BattleSide::ATTACKER)))
            throw std::runtime_error("Failed to begin combat");
        JsonNode result; result["backend"].String() = "vcmi-native"; result["seed"].Integer() = 1337;
        result["initial"] = snapshot(*game);
        const auto * shooter = battle.battleActiveUnit();
        const auto * target = battle.battleGetStackByPos(BattleHex(11, 5));
        if (!shooter || shooter->unitType()->getIndex() != 3 || !target) throw std::runtime_error("Unexpected first activation");
        server.events.clear();
        if (!handler->battles->makePlayerBattleAction(BattleID(0), PlayerColor(0), BattleAction::makeShotAttack(shooter, target)))
            throw std::runtime_error("Native shot rejected");
        result["events"].Vector() = std::move(server.events);
        result["final"] = snapshot(*game);
        std::cout << result.toString() << "\n";
        handler.reset(); server.game.reset(); game.reset(); library.reset(); LIBRARY = nullptr;
    }
    catch (const std::exception & error) { std::cerr << error.what() << "\n"; return 1; }
}
