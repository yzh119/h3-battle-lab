// SPDX-License-Identifier: GPL-2.0-or-later
// Local JSON-lines engine service; GUI and transports do not compute combat.
#include "battle-context.h"
#include "lib/json/JsonParser.h"
#include "lib/battle/ReachabilityInfo.h"
#include "server/queries/BattleQueries.h"
#include "server/queries/QueriesProcessor.h"
#include <cmath>

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
bool allowedCreature(int id) { return (id >= 0 && id <= 13) || (id >= 56 && id <= 69); }

JsonNode catalogue()
{
    JsonNode result;
    result["backend"].String() = "vcmi-native";
    result["rulesProfile"].String() = "base-reference";
    result["customPacks"].Bool() = false;
    result["heroSpells"].Bool() = false;
    for (int id = 0; id < 70; ++id)
    {
        if (!allowedCreature(id)) continue;
        const auto * creature = CreatureID(id).toCreature();
        JsonNode entry;
        entry["id"].Integer() = id;
        entry["key"].String() = creature->getJsonKey();
        entry["label"].String() = creature->getNameSingularTranslated();
        entry["health"].Integer() = creature->getBaseHitPoints();
        entry["speed"].Integer() = creature->getBaseSpeed();
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
        fields(request, {"version", "requestId", "op", "seed", "armies"});
        const auto seed = integer(request["seed"], 0, 2147483647);
        const auto & armies = request["armies"];
        if (!armies.isVector() || armies.Vector().size() != 2) throw std::runtime_error("Two armies required");
        for (const auto & army : armies.Vector())
        {
            if (!army.isVector() || army.Vector().empty() || army.Vector().size() > 7) throw std::runtime_error("Each army requires 1..7 stacks");
            for (const auto & stack : army.Vector())
            {
                fields(stack, {"creature", "count", "hex"});
                const int id = integer(stack["creature"], 0, 69);
                if (!allowedCreature(id)) throw std::runtime_error("Only original Castle/Necropolis creatures supported");
                integer(stack["count"], 1, 99999);
                if (!stack["hex"].isNull() && !BattleHex(integer(stack["hex"], 0, 186)).isAvailable())
                    throw std::runtime_error("Unavailable deployment hex");
            }
        }
        TinyH3M::TinyH3MBuilder builder(EMapFormat::SOD);
        builder.size(36).name("BattleLab").playerActive(PlayerColor(0)).playerActive(PlayerColor(1))
            .hero({5, 5, 0}, HeroTypeID(0), PlayerColor(0)).heroGarrison({{CreatureID(0), 1}})
            .hero({7, 7, 0}, HeroTypeID(1), PlayerColor(1)).heroGarrison({{CreatureID(0), 1}});
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
        server.game = game; handler = std::make_unique<CGameHandler>(server, game);
        handler->randomizer->setSeed(seed);
        BattleSideArray<CGHeroInstance *> armyObjects = {};
        for (const auto & object : game->getMap().objects)
            if (auto * hero = dynamic_cast<CGHeroInstance *>(object.get()))
            {
                const auto side = hero->getOwner() == PlayerColor(0) ? BattleSide::ATTACKER : BattleSide::DEFENDER;
                neutralize(*hero); hero->clearSlots();
                const auto & stacks = armies.Vector().at(static_cast<int>(side)).Vector();
                for (size_t slot = 0; slot < stacks.size(); ++slot)
                    hero->setCreature(SlotID(slot), CreatureID(stacks[slot]["creature"].Integer()), stacks[slot]["count"].Integer());
                armyObjects[side] = hero;
            }
        if (!armyObjects[BattleSide::ATTACKER] || !armyObjects[BattleSide::DEFENDER]) throw std::runtime_error("Missing army objects");
        BattleLayout layout = BattleLayout::createDefaultLayout(*game, armyObjects[BattleSide::ATTACKER], armyObjects[BattleSide::DEFENDER]);
        layout.obstaclesAllowed = false; layout.tacticsAllowed = false;
        for (const auto side : {BattleSide::ATTACKER, BattleSide::DEFENDER})
        {
            const auto & stacks = armies.Vector().at(static_cast<int>(side)).Vector();
            for (size_t slot = 0; slot < stacks.size(); ++slot)
            {
                const auto & stack = stacks[slot];
                if (!stack["hex"].isNull()) layout.units[side][slot] = BattleHex(stack["hex"].Integer());
            }
        }
        const std::string fieldName = "core:sand_shore";
        const auto field = LIBRARY->identifiers()->getIdentifier(ModScope::scopeGame(), "battlefield", fieldName);
        if (!field) throw std::runtime_error("Missing neutral battlefield");
        BattleSideArray<const CArmedInstance *> nativeArmies = {armyObjects[BattleSide::ATTACKER], armyObjects[BattleSide::DEFENDER]};
        // Army containers are on a real map. No fighting heroes are granted in this first interface.
        BattleStart begin; begin.battleID = BattleID(0);
        begin.info = BattleInfo::setupBattle(game.get(), {4, 4, 0}, TerrainId::SAND, BattleField(*field), nativeArmies, {nullptr, nullptr}, layout, nullptr);
        std::set<int> occupied;
        // Let the engine place default double-wide formations. Explicit locations
        // must be honored exactly rather than silently relocated by getAvailableHex.
        for (const auto * unit : begin.info->battleGetAllStacks())
        {
            const auto & specified = armies.Vector().at(static_cast<int>(unit->unitSide())).Vector().at(unit->unitSlot().getNum())["hex"];
            if (!specified.isNull() && unit->initialPosition.toInt() != specified.Integer())
                throw std::runtime_error("Occupied or invalid deployment footprint");
            for (const auto & hex : battle::Unit::getHexes(unit->initialPosition, unit->unitType()->isDoubleWide(), unit->unitSide()))
                if (!hex.isAvailable() || !occupied.insert(hex.toInt()).second) throw std::runtime_error("Occupied or invalid deployment footprint");
        }
        handler->sendAndApply(begin);
        auto & battle = *game->currentBattles.front();
        handler->queries->addQuery(std::make_shared<CBattleQuery>(handler.get(), &battle));
        battle.tacticDistance = 1; battle.tacticsSide = BattleSide::ATTACKER;
        if (!handler->battles->makePlayerBattleAction(BattleID(0), PlayerColor(0), BattleAction::makeEndOFTacticPhase(BattleSide::ATTACKER)))
            throw std::runtime_error("Failed to begin battle");
    }

    JsonNode state() const
    {
        JsonNode result = server.currentState();
        result["revision"].Integer() = revision;
        auto & legal = result["legal"];
        legal["moves"].Vector(); legal["shots"].Vector(); legal["melee"].Vector();
        legal["wait"].Bool() = false; legal["defend"].Bool() = false;
        result["queue"].Vector();
        if (game->currentBattles.empty() || !result["winner"].isNull()) return result;
        const auto & battle = *game->currentBattles.front();
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
            if (!target->alive() || !battle.battleCanAttackUnit(actor, target)) continue;
            if (battle.battleCanShoot(actor, target->getPosition())) legal["shots"].Vector().emplace_back(target->unitId());
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
        return result;
    }

    JsonNode act(const JsonNode & request)
    {
        fields(request, {"version", "requestId", "op", "revision", "stack", "action", "hex", "target", "from"});
        if (integer(request["revision"], 0, INT64_MAX) != revision) throw std::runtime_error("Stale state revision");
        const auto current = state();
        if (game->currentBattles.empty() || !current["winner"].isNull()) throw std::runtime_error("Battle has ended");
        const auto & battle = *game->currentBattles.front();
        const auto * actor = battle.battleActiveUnit();
        if (!actor || integer(request["stack"], 0, INT32_MAX) != actor->unitId()) throw std::runtime_error("Stack is not active");
        if (!request["action"].isString()) throw std::runtime_error("Missing action");
        const auto & action = request["action"].String();
        BattleAction native;
        if (action == "wait" && current["legal"]["wait"].Bool()) native = BattleAction::makeWait(actor);
        else if (action == "defend") native = BattleAction::makeDefend(actor);
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
        if (!handler->battles->makePlayerBattleAction(BattleID(0), battle.sideToPlayer(actor->unitSide()), native))
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
        const auto & mods = library->modh->getActiveMods();
        if (std::set<std::string>(mods.begin(), mods.end()) != std::set<std::string>{"core", "vcmi"}) throw std::runtime_error("Unexpected active mods");
        library->initializeLibrary();
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
                else if (op == "create")
                {
                    auto candidate = std::make_unique<BattleSession>(request);
                    session = std::move(candidate);
                    payload["state"] = session->state(); payload["events"].Vector() = session->server.events;
                }
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
