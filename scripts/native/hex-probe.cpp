// Resource-free VCMI topology probe. Does not initialize GameLibrary or mods.
#include "Global.h"
#include "lib/battle/BattleHex.h"
#include "lib/battle/BattleHexArray.h"

int main()
{
    std::cout << "{\"available\":[";
    for (int i = 0; i < GameConstants::BFIELD_SIZE; ++i)
    {
        if (i) std::cout << ",";
        std::cout << (BattleHex(i).isAvailable() ? "true" : "false");
    }
    std::cout << "],\"distances\":[";
    for (int i = 0; i < GameConstants::BFIELD_SIZE; ++i)
    {
        if (i) std::cout << ",";
        std::cout << "[";
        for (int j = 0; j < GameConstants::BFIELD_SIZE; ++j)
        {
            if (j) std::cout << ",";
            std::cout << int(BattleHex::getDistance(BattleHex(i), BattleHex(j)));
        }
        std::cout << "]";
    }
    std::cout << "],\"neighbors\":[";
    for (int i = 0; i < GameConstants::BFIELD_SIZE; ++i)
    {
        if (i) std::cout << ",";
        std::cout << "[";
        bool first = true;
        for (const auto & hex : BattleHex(i).getNeighbouringTiles())
        {
            if (!first) std::cout << ",";
            first = false;
            std::cout << hex.toInt();
        }
        std::cout << "]";
    }
    std::cout << "]}\n";
}
