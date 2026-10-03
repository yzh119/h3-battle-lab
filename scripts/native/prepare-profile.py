"""Copy an explicit base-data allowlist into a NEW private Battle Lab profile."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ARCHIVES = (
    "H3ab_bmp.lod", "h3abp_bm.lod", "H3bitmap.lod", "H3pbitma.lod",
    "H3ab_spr.lod", "h3abp_sp.lod", "H3sprite.lod",
)


def prepare(source, game_data, output):
    source, game_data, output = map(lambda p: Path(p).resolve(), (source, game_data, output))
    if output.exists():
        raise ValueError("Profile destination already exists; use a new directory")
    for required in (source / "config", source / "scripts", source / "Mods/vcmi"):
        if not required.is_dir():
            raise ValueError(f"Missing engine directory: {required.name}")
    files = {p.name.lower(): p for p in game_data.iterdir() if p.is_file()}
    if not all(name.lower() in files for name in ("H3bitmap.lod", "H3sprite.lod")):
        raise ValueError("Original SoD H3bitmap.lod and H3sprite.lod are required")
    output.mkdir(parents=True)
    try:
        data = output / "data"
        for name in ("config", "scripts"):
            shutil.copytree(source / name, data / name)
        # Only the engine's essential mod, never the user's Mods directory.
        shutil.copytree(source / "Mods/vcmi", data / "Mods/vcmi")
        (data / "Data").mkdir()
        archive_hashes = {}
        for name in ARCHIVES:
            if name.lower() not in files:
                continue
            target = data / "Data" / name
            shutil.copy2(files[name.lower()], target)
            digest = hashlib.sha256()
            with target.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            archive_hashes[name] = digest.hexdigest()
        (output / ".battle-lab-profile").write_text(json.dumps({
            "version": 1, "rulesProfile": "base-reference", "allowedMods": ["core", "vcmi"],
            "archives": archive_hashes,
        }, indent=2) + "\n")
    except BaseException:
        shutil.rmtree(output)
        raise
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vcmi-source", required=True)
    parser.add_argument("--game-data", required=True, help="Directory containing original H3 LODs")
    parser.add_argument("--out", required=True, help="New ignored/private profile directory")
    args = parser.parse_args()
    prepare(args.vcmi_source, args.game_data, args.out)
    print("Prepared isolated base-reference profile; original-game parity still needs verification.")
