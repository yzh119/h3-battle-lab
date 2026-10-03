// SPDX-License-Identifier: GPL-2.0-or-later
#include "Global.h"
#include "lib/GameLibrary.h"
#include "lib/VCMIDirs.h"
#include "lib/CCreatureHandler.h"
#include "lib/modding/CModHandler.h"

int main()
{
    try
    {
        // Resolve and validate the owned profile before initializing any resources.
        VCMIDirs::get();
        auto library = std::make_unique<GameLibrary>();
        LIBRARY = library.get();
        library->initializeFilesystem(false);
        const auto & mods = library->modh->getActiveMods();
        if (std::set<std::string>(mods.begin(), mods.end()) != std::set<std::string>{"core", "vcmi"})
            throw std::runtime_error("Unexpected active mods in base-reference profile");
        library->initializeLibrary();
        std::cout << "{\"backend\":\"vcmi-native\",\"rulesProfile\":\"base-reference\",\"activeMods\":[\"core\",\"vcmi\"],\"creatures\":[";
        bool first = true;
        for (int id = 0; id < 140; ++id)
        {
            const auto * creature = CreatureID(id).toCreature();
            // Original Castle (0..13) and Necropolis (56..69).
            if (id > 13 && (id < 56 || id > 69)) continue;
            if (!first) std::cout << ",";
            first = false;
            std::cout << "{\"id\":" << id << ",\"key\":\"" << creature->getJsonKey()
                << "\",\"health\":" << creature->getBaseHitPoints()
                << ",\"attack\":" << creature->getBaseAttack()
                << ",\"defense\":" << creature->getBaseDefense()
                << ",\"minDamage\":" << creature->getBaseDamageMin()
                << ",\"maxDamage\":" << creature->getBaseDamageMax()
                << ",\"speed\":" << creature->getBaseSpeed()
                << ",\"shots\":" << creature->getBaseShots() << "}";
        }
        std::cout << "]}\n";
        library.reset(); LIBRARY = nullptr;
    }
    catch (const std::exception & error)
    {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
