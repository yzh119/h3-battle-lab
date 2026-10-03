"""Check resource isolation without distributing or requiring original game data."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("prepare_profile", Path(__file__).resolve().parents[1] / "scripts/native/prepare-profile.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProfileTests(unittest.TestCase):
    def fixture(self, root):
        source, game = root / "engine", root / "game"
        for directory in (source / "config", source / "scripts", source / "Mods/vcmi", source / "Mods/custom-balance", game):
            directory.mkdir(parents=True)
        (source / "config/filesystem.json").write_text("{}")
        (source / "Mods/vcmi/mod.json").write_text("{}")
        (source / "Mods/custom-balance/mod.json").write_text("private balance")
        for name in ("h3bitmap.lod", "H3sprite.lod", "Hota.lod"):
            (game / name).write_bytes(b"fixture, not game data")
        return source, game

    def test_only_explicit_archives_and_essential_engine_mod_are_copied(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source, game = self.fixture(root)
            profile = module.prepare(source, game, root / "owned")
            self.assertTrue((profile / ".battle-lab-profile").is_file())
            self.assertTrue((profile / "data/Data/H3bitmap.lod").is_file())
            self.assertFalse((profile / "data/Data/Hota.lod").exists())
            self.assertEqual([p.name for p in (profile / "data/Mods").iterdir()], ["vcmi"])
            self.assertTrue((source / "Mods/custom-balance/mod.json").is_file())

    def test_existing_destination_and_incomplete_original_data_are_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source, game = self.fixture(root)
            existing = root / "existing"; existing.mkdir()
            marker = existing / "keep"; marker.write_text("original")
            with self.assertRaises(ValueError): module.prepare(source, game, existing)
            self.assertEqual(marker.read_text(), "original")
            (game / "H3sprite.lod").unlink()
            with self.assertRaises(ValueError): module.prepare(source, game, root / "missing-data")
            self.assertFalse((root / "missing-data").exists())


if __name__ == "__main__":
    unittest.main()
