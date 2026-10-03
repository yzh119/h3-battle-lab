// SPDX-License-Identifier: GPL-2.0-or-later
#include "battle-context.h"

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
