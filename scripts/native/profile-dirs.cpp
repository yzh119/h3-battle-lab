// SPDX-License-Identifier: GPL-2.0-or-later
// Replacement for VCMIDirs.cpp in the owned battle backend build.
#include "Global.h"
#include "lib/VCMIDirs.h"
#include <cstdlib>
#include <mutex>

namespace bfs = boost::filesystem;

bfs::path IVCMIDirs::userLogsPath() const { return userCachePath() / "logs"; }
bfs::path IVCMIDirs::userSavePath() const { return userDataPath() / "Saves"; }
bfs::path IVCMIDirs::userExtractedPath() const { return userCachePath() / "extracted"; }
std::string IVCMIDirs::genHelpString() const { return "Battle Lab isolated resource profile\n"; }
void IVCMIDirs::init()
{
    for (const auto & path : {userDataPath(), userCachePath(), userConfigPath(), userLogsPath(), userSavePath()})
        bfs::create_directories(path);
}

class BattleLabDirs final : public IVCMIDirs
{
    bfs::path root;
public:
    BattleLabDirs()
    {
        const char * value = std::getenv("BATTLE_LAB_PROFILE");
        if (!value || !*value) throw std::runtime_error("BATTLE_LAB_PROFILE is required");
        root = bfs::canonical(value);
        if (!bfs::is_regular_file(root / ".battle-lab-profile"))
            throw std::runtime_error("Not a prepared Battle Lab resource profile");
    }
    bfs::path userDataPath() const override { return root / "user"; }
    bfs::path userCachePath() const override { return root / "cache"; }
    bfs::path userConfigPath() const override { return root / "user" / "config"; }
    std::vector<bfs::path> dataPaths() const override { return {root / "data"}; }
    bfs::path binaryPath() const override { return root / "bin"; }
    bfs::path clientPath() const override { return binaryPath() / "vcmiclient"; }
    bfs::path mapEditorPath() const override { return binaryPath() / "vcmieditor"; }
    bfs::path serverPath() const override { return binaryPath() / "vcmiserver"; }
};

namespace VCMIDirs
{
    const IVCMIDirs & get()
    {
        static BattleLabDirs dirs;
        static std::once_flag initialized;
        std::call_once(initialized, [&] { dirs.init(); });
        return dirs;
    }
}
