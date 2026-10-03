#pragma once
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
#include "lib/battle/CObstacleInstance.h"
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
    if (const auto winner = battle.battleIsFinished()) result["winner"].Integer() = static_cast<int>(*winner);
    auto & units = result["units"].Vector();
    for (const auto * stack : battle.battleGetAllStacks(true))
    {
        JsonNode unit;
        unit["id"].Integer() = stack->unitId();
        unit["creature"].String() = stack->unitType()->getJsonKey();
        unit["side"].Integer() = static_cast<int>(stack->unitSide());
        unit["slot"].Integer() = stack->unitSlot().getNum();
        unit["hex"].Integer() = stack->getPosition().toInt();
        unit["count"].Integer() = stack->getCount();
        unit["health"].Integer() = stack->getAvailableHealth();
        unit["shots"].Integer() = stack->shots.available();
        unit["maxHealth"].Integer() = stack->getMaxHealth();
        unit["topHealth"].Integer() = stack->getFirstHPleft();
        unit["speed"].Integer() = stack->getMovementRange();
        unit["attack"].Integer() = stack->getAttack(false);
        unit["defense"].Integer() = stack->getDefense(false);
        unit["minDamage"].Integer() = stack->getMinDamage(false);
        unit["maxDamage"].Integer() = stack->getMaxDamage(false);
        unit["flying"].Bool() = stack->hasBonusOfType(BonusType::FLYING);
        for (const auto & hex : stack->getHexes()) unit["footprint"].Vector().emplace_back(hex.toInt());
        units.push_back(std::move(unit));
    }
    result["obstacles"].Vector();
    for (const auto & obstacle : battle.battleGetAllObstacles())
        for (const auto & hex : obstacle->getBlockedTiles()) result["obstacles"].Vector().emplace_back(hex.toInt());
    return result;
}

class RecordingServer final : public IGameServer
{
    EServerState state = EServerState::GAMEPLAY;
public:
    std::shared_ptr<CGameState> game;
    std::vector<JsonNode> events;
    JsonNode lastState;
    JsonNode currentState() const { return game->currentBattles.empty() ? lastState : snapshot(*game); }
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
        event["before"] = currentState();
        if (auto * result = dynamic_cast<BattleResult *>(&pack))
        {
            event["type"].String() = "result";
            event["winner"].Integer() = static_cast<int>(result->winner);
            lastState = event["before"];
            lastState["winner"] = event["winner"];
            lastState["activeStack"].clear();
        }
        game->apply(pack);
        event["after"] = currentState();
        if (!game->currentBattles.empty()) lastState = event["after"];
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
