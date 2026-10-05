"""Public authoring-to-VCMI conversion and profile isolation checks."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('custom_pack', ROOT / 'scripts/native/custom-pack.py')
converter = importlib.util.module_from_spec(spec); spec.loader.exec_module(converter)


def creature(identifier='custom-test', mechanisms=None):
    return {'id': identifier, 'label': '测试兵种', 'faction': '测试分组', 'ruleset': 'custom',
            'stats': {'health': 100, 'attack': 10, 'defense': 10, 'minDamage': 7, 'maxDamage': 7, 'speed': 10},
            'mechanisms': mechanisms or []}


class CustomPackTests(unittest.TestCase):
    def test_double_wide_is_explicit_and_rejects_non_booleans(self):
        entry = creature(mechanisms=[{'type': 'attacksAllAdjacent'}])
        self.assertFalse(converter.convert({'version': 1, 'creatures': [entry]})['custom-test']['doubleWide'])
        entry['doubleWide'] = True
        value = converter.convert({'version': 1, 'creatures': [entry]})['custom-test']
        self.assertTrue(value['doubleWide'])
        self.assertEqual(value['abilities']['attacksAllAdjacent'], {'type': 'ATTACKS_ALL_ADJACENT'})
        for invalid in [0, 1, 'true', None, []]:
            entry['doubleWide'] = invalid
            with self.assertRaisesRegex(ValueError, 'doubleWide'): converter.convert({'version': 1, 'creatures': [entry]})

    def test_native_bonus_mapping_and_explicit_attack_ranges(self):
        mechanisms = [{'type': 'flying'}, {'type': 'additionalAttacks', 'count': 2, 'mode': 'ranged'},
                      {'type': 'shooter', 'shots': 12, 'noMeleePenalty': True, 'noDistancePenalty': True},
                      {'type': 'undead'}, {'type': 'deathCloud'}, {'type': 'regeneration', 'health': 5},
                      {'type': 'retaliations', 'count': 0}, {'type': 'blocksRetaliation'}]
        value = converter.convert({'version': 1, 'creatures': [creature(mechanisms=mechanisms)]})['custom-test']
        abilities = value['abilities']
        self.assertEqual(abilities['additionalAttacks'], {'type': 'ADDITIONAL_ATTACK', 'val': 2, 'effectRange': 'ONLY_DISTANCE_FIGHT'})
        self.assertEqual(abilities['retaliations'], {'type': 'NO_RETALIATION'})
        self.assertEqual(abilities['deathCloud']['subtype'], 'core:deathCloud')
        self.assertEqual(abilities['regeneration']['val'], 5)
        self.assertEqual(value['shots'], 12)
        self.assertEqual(value['aiValue'], 100)
        self.assertEqual(value['faction'], 'core:neutral')

    def test_duplicates_reserved_ids_boolean_numbers_and_unknown_mechanisms_reject_whole_pack(self):
        original = {'version': 1, 'creatures': [creature()]}
        invalids = []
        duplicate = copy.deepcopy(original); duplicate['creatures'].append(creature()); invalids.append(duplicate)
        for identifier in ['skeleton', '../escape', 'BadName']:
            invalids.append({'version': 1, 'creatures': [creature(identifier)]})
        for mechanism in [{'type': 'unknown'}, {'type': 'shooter', 'shots': True}, {'type': 'deathCloud'}]:
            invalids.append({'version': 1, 'creatures': [creature(mechanisms=[mechanism])]})
        value = copy.deepcopy(original); value['creatures'][0]['stats']['health'] = True; invalids.append(value)
        for value in invalids:
            with self.assertRaises(ValueError): converter.convert(value)
        self.assertEqual(original['creatures'][0]['stats']['health'], 100)

    def test_profile_only_links_base_data_and_adds_one_owned_mod(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / 'base'; (base / 'data/Mods/vcmi').mkdir(parents=True)
            for name in ['config', 'scripts', 'Data']: (base / 'data' / name).mkdir()
            marker = {'allowedMods': ['core', 'vcmi'], 'rulesProfile': 'base-reference'}
            (base / '.battle-lab-profile').write_text(json.dumps(marker))
            pack = {'version': 1, 'creatures': [creature()]}
            output = converter.prepare(base, root / 'custom', pack)
            self.assertEqual(sorted(p.name for p in (output / 'data/Mods').iterdir()), [converter.MOD, 'vcmi'])
            self.assertTrue((output / 'data/Data').is_symlink())
            self.assertFalse((base / 'data/Mods' / converter.MOD).exists())
            self.assertEqual(json.loads((base / '.battle-lab-profile').read_text()), marker)
            with self.assertRaises(ValueError): converter.prepare(base, output, pack)
            invalid = {'version': 1, 'creatures': [creature('skeleton')]}
            with self.assertRaises(ValueError): converter.prepare(base, root / 'invalid', invalid)
            self.assertFalse((root / 'invalid').exists())


if __name__ == '__main__': unittest.main()
