"""Custom authoring mechanisms must execute in a real compiled VCMI mod."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result
native = module('native_tests', ROOT / 'tests/native-backend.test.py')
converter = module('custom_pack', ROOT / 'scripts/native/custom-pack.py')
authoring = module('authoring_tests', ROOT / 'tests/custom-pack.test.py')

@unittest.skipUnless(os.environ.get('BATTLE_LAB_BACKEND') and os.environ.get('BATTLE_LAB_PROFILE'), 'Native engine/profile absent')
class NativeCustomTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        guard = authoring.creature('custom-guard', [{'type': 'flying'}, {'type': 'additionalAttacks', 'count': 1}, {'type': 'blocksRetaliation'}])
        shooter = authoring.creature('custom-cloud', [{'type': 'shooter', 'shots': 12, 'noDistancePenalty': True}, {'type': 'additionalAttacks', 'count': 1, 'mode': 'ranged'}, {'type': 'deathCloud'}, {'type': 'undead'}])
        undead = authoring.creature('custom-undead', [{'type': 'undead'}]); undead['stats']['speed'] = 1
        living = authoring.creature('custom-living'); living['stats']['speed'] = 1
        regen = authoring.creature('custom-regen', [{'type': 'regeneration', 'health': 5}]); regen['stats']['speed'] = 1
        no_retaliation = authoring.creature('custom-no-retaliation', [{'type': 'retaliations', 'count': 0}]); no_retaliation['stats']['speed'] = 1
        two_retaliations = authoring.creature('custom-two-retaliations', [{'type': 'retaliations', 'count': 2}]); two_retaliations['stats']['speed'] = 1
        plain = authoring.creature('custom-shooter', [{'type': 'shooter', 'shots': 12, 'noDistancePenalty': True}])
        pack = {'version': 1, 'creatures': [guard, shooter, undead, living, regen, no_retaliation, two_retaliations, plain]}
        profile = converter.prepare(os.environ['BATTLE_LAB_PROFILE'], Path(self.directory.name) / 'profile', pack)
        self.engine = native.NativeBackendTests(); self.engine.profile = profile; self.engine.setUp()
        self.catalogue = self.engine.request('catalogue')['result']
        self.ids = {c['art']: c['id'] for c in self.catalogue['creatures'] if c.get('custom')}

    def tearDown(self):
        self.engine.tearDown(); self.directory.cleanup()

    def test_stats_flight_extra_melee_and_blocked_retaliation(self):
        self.assertEqual(self.catalogue['rulesProfile'], 'custom-reference')
        self.assertEqual(len(self.catalogue['creatures']), 36)
        state = self.engine.create([{'creature': self.ids['custom-guard'], 'count': 1, 'hex': 90}], [{'creature': 58, 'count': 20, 'hex': 91}])
        guard = next(u for u in state['units'] if u['side'] == 0)
        self.assertEqual([guard[k] for k in ['maxHealth', 'attack', 'defense', 'speed', 'flying']], [100, 10, 10, 10, True])
        option = next(m for m in state['legal']['melee'] if m['from'] == 90)
        result = self.engine.act(state, 'melee', target=option['target'], **{'from': 90})
        attacks = [e for e in result['events'] if e['type'] == 'attack']
        self.assertEqual(len(attacks), 2); self.assertFalse(any(e['counter'] for e in attacks))
        self.assertEqual(next(u for u in result['state']['units'] if u['id'] == guard['id'])['health'], 100)
        ai = self.engine.act(result['state'], 'ai')
        self.assertEqual(ai['state']['revision'], 2)

    def test_ranged_double_attack_cloud_hits_living_friend_and_spares_undead_neighbor(self):
        state = self.engine.create([{'creature': self.ids['custom-cloud'], 'count': 1, 'hex': 90}, {'creature': self.ids['custom-living'], 'count': 1, 'hex': 97}],
                                   [{'creature': 58, 'count': 20, 'hex': 96}, {'creature': self.ids['custom-undead'], 'count': 1, 'hex': 95}])
        main = next(u for u in state['units'] if u['creature'] == 'core:walkingDead')
        result = self.engine.act(state, 'shoot', target=main['id'])
        units = {u['creature']: u for u in result['state']['units']}
        self.assertEqual(units['battle-lab-custom:custom-cloud']['shots'], 10)
        self.assertLess(units['battle-lab-custom:custom-living']['health'], 100)
        self.assertEqual(units['battle-lab-custom:custom-undead']['health'], 100)
        self.assertLess(units['core:walkingDead']['health'], 300)
        self.assertEqual(len([e for e in result['events'] if e['type'] == 'attack']), 2)

    def test_regeneration_runs_at_native_activation_and_restores_only_injured_top_creature(self):
        state = self.engine.create([{'creature': self.ids['custom-shooter'], 'count': 1, 'hex': 90}], [{'creature': self.ids['custom-regen'], 'count': 2, 'hex': 96}])
        target = next(u for u in state['units'] if u['side'] == 1)
        result = self.engine.act(state, 'shoot', target=target['id'])
        after = next(u for u in result['state']['units'] if u['id'] == target['id'])
        self.assertEqual(after['health'], 198); self.assertEqual(after['count'], 2)
        self.assertEqual(result['state']['activeStack'], target['id'])
        attack = next(e for e in result['events'] if e['type'] == 'attack')
        self.assertEqual(next(u for u in attack['after']['units'] if u['id'] == target['id'])['health'], 193)

    def test_zero_and_two_retaliations_are_enforced_by_native_processor(self):
        for defender, expected in [('custom-no-retaliation', 0), ('custom-two-retaliations', 2)]:
            state = self.engine.create([{'creature': self.ids['custom-shooter'], 'count': 1, 'hex': 90}, {'creature': self.ids['custom-shooter'], 'count': 1, 'hex': 74}, {'creature': self.ids['custom-shooter'], 'count': 1, 'hex': 108}],
                                       [{'creature': self.ids[defender], 'count': 1, 'hex': 91}])
            counters = 0
            for _ in range(3):
                option = next(m for m in state['legal']['melee'] if m['from'] == next(u['hex'] for u in state['units'] if u['id'] == state['activeStack']))
                result = self.engine.act(state, 'melee', target=option['target'], **{'from': option['from']})
                counters += sum(e['counter'] for e in result['events'] if e['type'] == 'attack'); state = result['state']
            self.assertEqual(counters, expected)

if __name__ == '__main__': unittest.main()
