"""Integration tests for a real compiled VCMI backend and private prepared profile.

Run with BATTLE_LAB_BACKEND and BATTLE_LAB_PROFILE; no mocked combat results.
"""
import json
import os
from pathlib import Path
import selectors
import subprocess
import unittest


@unittest.skipUnless(os.environ.get("BATTLE_LAB_BACKEND") and os.environ.get("BATTLE_LAB_PROFILE"), "Native engine/profile absent")
class NativeBackendTests(unittest.TestCase):
    def setUp(self):
        self.process = subprocess.Popen([os.environ["BATTLE_LAB_BACKEND"]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env={**os.environ, "BATTLE_LAB_PROFILE": str(getattr(self, "profile", os.environ["BATTLE_LAB_PROFILE"]))})
        self.sequence = 0

    def tearDown(self):
        self.process.stdin.close()
        try: self.process.wait(timeout=10)
        except subprocess.TimeoutExpired: self.process.kill(); self.process.wait()
        self.process.stdout.close()

    def request(self, op, **data):
        self.sequence += 1
        self.process.stdin.write(json.dumps({"version": 1, "requestId": str(self.sequence), "op": op, **data}) + "\n")
        self.process.stdin.flush()
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(15), "Native response timed out")
        line = self.process.stdout.readline()
        self.assertTrue(line, "Native process terminated")
        response = json.loads(line)
        self.assertEqual(response["requestId"], str(self.sequence))
        return response

    def create(self, left, right):
        response = self.request("create", seed=1337, armies=[left, right])
        self.assertTrue(response["ok"], response.get("error"))
        return response["result"]["state"]

    def act(self, state, action, **data):
        response = self.request("act", revision=state["revision"], stack=state["activeStack"], action=action, **data)
        self.assertTrue(response["ok"], response.get("error"))
        return response["result"]

    def test_roster_and_ranged_events_rejections_do_not_advance_state(self):
        catalogue = self.request("catalogue")["result"]
        self.assertEqual(len(catalogue["creatures"]), 28)
        state = self.create([{"creature": 3, "count": 20, "hex": 90}], [{"creature": 58, "count": 20, "hex": 96}])
        for data in [dict(revision=9, stack=state["activeStack"], action="defend"),
                     dict(revision=0, stack=999, action="defend"),
                     dict(revision=0, stack=state["activeStack"], action="move", hex=0),
                     dict(revision=0, stack=state["activeStack"], action="shoot", target=state["activeStack"])]:
            self.assertFalse(self.request("act", **data)["ok"])
            self.assertEqual(self.request("state")["result"]["state"], state)
        result = self.act(state, "shoot", target=state["legal"]["shots"][0])
        attacks = [e for e in result["events"] if e["type"] == "attack"]
        self.assertEqual(len(attacks), 2)
        shooter = next(u for u in result["state"]["units"] if u["creature"] == "core:marksman")
        self.assertEqual(shooter["shots"], 22)
        previous = attacks[0]["before"]
        for event in result["events"]:
            # Initial action announcements may precede the first strike.
            if event is attacks[0]: previous = event["before"]
            self.assertEqual(event["before"], previous)
            previous = event["after"]
        self.assertEqual(result["state"]["revision"], 1)

    def test_native_movement_wait_defend_melee_and_retaliation(self):
        state = self.create([{"creature": 7, "count": 20, "hex": 90}], [{"creature": 58, "count": 40, "hex": 94}])
        state = self.act(state, "wait")["state"]
        self.assertTrue(state["legal"]["moves"])
        actor = next(u for u in state["units"] if u["id"] == state["activeStack"])
        occupied = {h for u in state["units"] if u["id"] != actor["id"] and u["count"] for h in u["footprint"]}
        for move in state["legal"]["moves"]:
            self.assertEqual(move["path"][-1], move["hex"])
            self.assertTrue(all(0 <= h < 187 and h % 17 not in (0, 16) and h not in occupied for h in move["path"]))

        state = self.act(state, "defend")["state"]
        self.assertFalse(state["legal"]["wait"])
        options = state["legal"]["melee"]
        self.assertTrue(options)
        result = self.act(state, "melee", target=options[0]["target"], **{"from": options[0]["from"]})
        self.assertTrue(any(e["type"] == "move" for e in result["events"]))
        attacks = [e for e in result["events"] if e["type"] == "attack"]
        self.assertEqual(len(attacks), 3)  # native Crusader strike, retaliation, second strike
        self.assertEqual([e["counter"] for e in attacks], [False, True, False])

    def test_all_creatures_full_armies_and_double_wide_deployment(self):
        catalogue = {c["key"]: c for c in self.request("catalogue")["result"]["creatures"]}
        for creature in [*range(14), *range(56, 70)]:
            state = self.create([{"creature": creature, "count": 99999}], [{"creature": 58, "count": 99999}])
            self.assertEqual(len(state["units"]), 2)
            for unit in state["units"]:
                self.assertEqual(unit["speed"], catalogue[unit["creature"]]["speed"], "No native-terrain speed bonus on sand")
            self.assertTrue(all(u["count"] == 99999 for u in state["units"]))
            occupied = [hex for u in state["units"] for hex in u["footprint"]]
            self.assertEqual(len(occupied), len(set(occupied)))
        state = self.create([{"creature": c, "count": 10} for c in range(7)], [{"creature": c, "count": 10} for c in range(56, 63)])
        self.assertEqual(len(state["units"]), 14)
        self.assertFalse(self.request("create", seed=1, armies=[[{"creature": 10, "count": 1, "hex": 86}], [{"creature": 58, "count": 1, "hex": 96}]])["ok"])
        self.assertEqual(self.request("state")["result"]["state"], state)

    def test_complete_town_ten_week_preset_includes_growth_buildings(self):
        preset = self.request("catalogue")["result"]["tenWeekTownArmies"]
        self.assertEqual(preset["weeks"], 10)
        self.assertEqual(preset["profile"], "complete-town-no-grail")
        self.assertEqual([s["count"] for s in preset["armies"][0]], [280, 180, 170, 80, 60, 40, 20])
        self.assertEqual([s["count"] for s in preset["armies"][1]], [300, 160, 140, 80, 60, 40, 20])
        self.assertEqual([s["upgraded"] for s in preset["armies"][0]], list(range(1, 14, 2)))
        self.assertEqual([s["upgraded"] for s in preset["armies"][1]], list(range(57, 70, 2)))
        armies = [[{"creature": s["upgraded"], "count": s["count"], "slot": s["slot"]} for s in army] for army in preset["armies"]]
        state = self.create(*armies)
        self.assertEqual(len(state["units"]), 14)
        for unit in state["units"]:
            self.assertEqual(unit["count"], armies[unit["side"]][unit["slot"]]["count"])

    def test_sparse_slots_remain_stable_and_duplicate_slots_are_rejected(self):
        state = self.create([{"creature": 3, "count": 73, "slot": 6, "hex": 90}, {"creature": 0, "count": 12, "slot": 2}], [{"creature": 58, "count": 20, "slot": 4, "hex": 96}])
        self.assertEqual(sorted((u["side"], u["slot"]) for u in state["units"]), [(0, 2), (0, 6), (1, 4)])
        marksman = next(u for u in state["units"] if u["creature"] == "core:marksman")
        self.assertEqual(marksman["hex"], 90)
        self.assertEqual(marksman["count"], 73)
        duplicate = self.request("create", seed=1, armies=[[{"creature": 0, "count": 1, "slot": 6}, {"creature": 3, "count": 1, "slot": 6}], [{"creature": 58, "count": 1}]])
        self.assertFalse(duplicate["ok"])
        self.assertEqual(self.request("state")["result"]["state"], state)

    def test_lethal_native_attack_finishes_and_new_battle_resets(self):
        state = self.create([{"creature": 3, "count": 100, "hex": 90}], [{"creature": 58, "count": 1, "hex": 96}])
        result = self.act(state, "shoot", target=state["legal"]["shots"][0])
        self.assertEqual(result["state"]["winner"], 0)
        self.assertTrue(any(e["type"] == "result" for e in result["events"]))
        self.assertFalse(self.request("act", revision=1, stack=0, action="defend")["ok"])
        reset = self.create([{"creature": 3, "count": 20}], [{"creature": 58, "count": 20}])
        self.assertIsNone(reset.get("winner"))
        self.assertEqual(reset["revision"], 0)

    def test_attributes_and_deployment_preview_preserve_active_battle(self):
        catalogue = self.request('catalogue')['result']
        marksman = next(c for c in catalogue['creatures'] if c['id'] == 3)
        self.assertEqual((marksman['attack'], marksman['defense'], marksman['minDamage'], marksman['maxDamage'], marksman['shots']), (6, 3, 2, 3, 24))
        armies = [[{'creature': 3, 'count': 20, 'slot': 5}], [{'creature': 58, 'count': 10, 'slot': 2}]]
        active = self.create(*armies)
        preview = self.request('deployment', seed=1337, armies=armies)
        self.assertTrue(preview['ok'], preview.get('error'))
        self.assertEqual(preview['result']['state']['units'], active['units'])
        defended = self.act(active, 'defend')['state']
        actor = next(u for u in defended['units'] if u['id'] == active['activeStack'])
        self.assertGreater(actor['defense'], marksman['defense'])
        self.assertEqual(actor['attack'], marksman['attack'])

    def test_real_vcmi_ai_shoots_and_completes_battle(self):
        self.assertEqual(self.request('catalogue')['result']['battleAI'], 'VCMI BattleEvaluator')
        state = self.create([{'creature': 3, 'count': 100}], [{'creature': 58, 'count': 5}])
        first = self.act(state, 'ai')
        self.assertTrue(any(e.get('ranged') for e in first['events']))
        self.assertFalse(self.request('act', revision=state['revision'], stack=state['activeStack'], action='ai')['ok'])
        state = first['state']
        for _ in range(30):
            if state.get('winner') is not None: break
            state = self.act(state, 'ai')['state']
        self.assertEqual(state.get('winner'), 0)

    def hero(self, spells, skills=None):
        return {'attack': 2, 'defense': 2, 'power': 3, 'knowledge': 10, 'skills': skills or [], 'spells': spells}

    def hero_battle(self, spells, skills=None, armies=None):
        armies = armies or [[{'creature': 3, 'count': 30}], [{'creature': 58, 'count': 100}]]
        response = self.request('create', seed=1337, armies=armies, heroes=[self.hero(spells, skills), None])
        self.assertTrue(response['ok'], response.get('error'))
        return response['result']['state']

    def spell_targets(self, state, spell):
        response = self.request('spellTargets', revision=state['revision'], stack=state['activeStack'], spell=spell)
        self.assertTrue(response['ok'], response.get('error'))
        return response['result']['targets']

    def test_hero_spell_damage_mana_cooldown_and_rejection_are_native(self):
        state = self.hero_battle([15])
        marksman = next(u for u in state['units'] if u['side'] == 0)
        self.assertEqual((marksman['attack'], marksman['defense']), (8, 5))
        target = next(u for u in state['units'] if u['side'] == 1)
        result = self.act(state, 'spell', spell=15, targets=self.spell_targets(state, 15)[0])
        after = result['state']
        self.assertEqual(after['heroes'][0]['mana'], 95)
        self.assertEqual(after['activeStack'], state['activeStack'])
        self.assertEqual(next(u for u in after['units'] if u['id'] == target['id'])['health'], target['health'] - 40)
        self.assertTrue(any(e['type'] == 'spell' for e in result['events']))
        self.assertFalse(self.request('act', revision=after['revision'], stack=after['activeStack'], action='spell', spell=15, targets=[{'unit': target['id']}])['ok'])
        self.assertEqual(self.request('state')['result']['state'], after)
        self.act(after, 'defend')
        self.assertFalse(self.request('create', seed=1337, armies=[[{'creature': 3, 'count': 1}], [{'creature': 58, 'count': 1}]], heroes=[self.hero([0]), None])['ok'])

    def test_native_mass_haste_teleport_clone_and_summoning(self):
        armies = [[{'creature': 3, 'count': 30}, {'creature': 0, 'count': 30}], [{'creature': 58, 'count': 100}]]
        state = self.hero_battle([53], [{'id': 15, 'level': 3}], armies)
        result = self.act(state, 'spell', spell=53, targets=self.spell_targets(state, 53)[0])['state']
        for original in state['units']:
            if original['side'] == 0:
                self.assertEqual(next(u for u in result['units'] if u['id'] == original['id'])['speed'], original['speed'] + 5)
        state = self.hero_battle([63], armies=armies)
        targets = self.spell_targets(state, 63)
        self.assertTrue(all(len(target) == 2 for target in targets))
        target = targets[0]
        teleported = self.act(state, 'spell', spell=63, targets=target)['state']
        self.assertEqual(next(u for u in teleported['units'] if u['id'] == target[0]['unit'])['hex'], target[1]['hex'])
        for spell, creature in [(65, 'core:marksman'), (68, 'core:waterElemental')]:
            state = self.hero_battle([spell], armies=armies)
            result = self.act(state, 'spell', spell=spell, targets=self.spell_targets(state, spell)[0])['state']
            created = [u for u in result['units'] if u['id'] not in {u['id'] for u in state['units']}]
            self.assertEqual(len(created), 1)
            self.assertEqual(created[0]['creature'], creature)
            self.assertGreater(created[0]['count'], 0)
            self.assertTrue(created[0]['footprint'])

    def test_native_ai_can_cast_before_its_unit_acts(self):
        state = self.hero_battle([15])
        result = self.act(state, 'ai')
        self.assertTrue(any(e['type'] == 'spell' for e in result['events']))
        self.assertEqual(result['state']['heroes'][0]['mana'], 95)
        self.assertEqual(result['state']['activeStack'], state['activeStack'])
        following = self.act(result['state'], 'ai')
        self.assertEqual(following['state']['heroes'][0]['mana'], 95)
        self.assertFalse(any(e['type'] == 'spell' for e in following['events']))

    def test_hypnotized_stack_uses_engine_controller(self):
        state = self.hero_battle([60], armies=[[{'creature': 3, 'count': 30}], [{'creature': 0, 'count': 1}]])
        targets = self.spell_targets(state, 60)
        state = self.act(state, 'spell', spell=60, targets=targets[0])['state']
        hypnotized = next(u for u in state['units'] if u['side'] == 1)
        self.assertEqual(hypnotized['controller'], 0)
        state = self.act(state, 'defend')['state']
        self.assertEqual(state['activeStack'], hypnotized['id'])
        self.act(state, 'defend')

    def test_resurrection_and_animate_dead_restore_native_corpses(self):
        for spell, guardian, victim in [(38, 13, 0), (39, 65, 56)]:
            armies = [[{'creature': guardian, 'count': 1}, {'creature': victim, 'count': 2}], [{'creature': 3, 'count': 100}]]
            state = self.hero_battle([spell], [{'id': 17, 'level': 3}], armies)
            corpse = next(u for u in state['units'] if u['side'] == 0 and u['slot'] == 1)
            state = self.act(state, 'defend')['state']
            self.assertEqual(next(u for u in state['units'] if u['id'] == state['activeStack'])['side'], 1)
            state = self.act(state, 'shoot', target=corpse['id'])['state']
            self.assertEqual(next(u for u in state['units'] if u['id'] == corpse['id'])['count'], 0)
            target = next(target for target in self.spell_targets(state, spell) if target[0].get('unit') == corpse['id'])
            state = self.act(state, 'spell', spell=spell, targets=target)['state']
            restored = next(u for u in state['units'] if u['id'] == corpse['id'])
            self.assertEqual(restored['count'], 2)
            self.assertEqual(restored['health'], restored['maxHealth'] * 2)


    def test_archangel_resurrection_restores_corpse_consumes_native_cast_and_rejects_repeat(self):
        state = self.create([{'creature': 13, 'count': 1}, {'creature': 0, 'count': 10, 'hex': 90}], [{'creature': 3, 'count': 100, 'hex': 96}])
        archangel = next(u for u in state['units'] if u['creature'] == 'core:archangel')
        pikeman = next(u for u in state['units'] if u['creature'] == 'core:pikeman')
        self.assertEqual(archangel['casts'], 1)
        self.assertEqual([s['id'] for s in archangel['spells']], [38])
        self.assertFalse(self.request('spellTargets', revision=state['revision'], stack=state['activeStack'], spell=38, caster='creature')['ok'])
        state = self.act(state, 'wait')['state']
        state = self.act(state, 'shoot', target=pikeman['id'])['state']
        self.assertEqual(next(u for u in state['units'] if u['id'] == pikeman['id'])['count'], 0)
        self.assertEqual(state['activeStack'], archangel['id'])
        targets = self.request('spellTargets', revision=state['revision'], stack=state['activeStack'], spell=38, caster='creature')
        self.assertTrue(targets['ok'], targets.get('error'))
        self.assertIn([{'unit': pikeman['id']}], targets['result']['targets'])
        invalid = self.request('act', revision=state['revision'], stack=state['activeStack'], action='creatureSpell', spell=38, targets=[{'unit': next(u['id'] for u in state['units'] if u['side'] == 1)}])
        self.assertFalse(invalid['ok']); self.assertEqual(self.request('state')['result']['state'], state)
        result = self.act(state, 'creatureSpell', spell=38, targets=[{'unit': pikeman['id']}])
        after = result['state']; revived = next(u for u in after['units'] if u['id'] == pikeman['id'])
        self.assertEqual((revived['count'], revived['health']), (10, 100))
        self.assertEqual(next(u for u in after['units'] if u['id'] == archangel['id'])['casts'], 0)
        self.assertTrue(any(e['type'] == 'spell' and e['spell'] == 38 for e in result['events']))
        # Advance native turns to the angel again; its one cast never refills.
        for _ in range(8):
            if after['activeStack'] == archangel['id']: break
            after = self.act(after, 'defend')['state']
        self.assertEqual(after['activeStack'], archangel['id'])
        repeat = self.request('act', revision=after['revision'], stack=after['activeStack'], action='creatureSpell', spell=38, targets=[{'unit': pikeman['id']}])
        self.assertFalse(repeat['ok']); self.assertEqual(self.request('state')['result']['state'], after)

    def test_noncasters_and_undead_targets_cannot_use_archangel_resurrection(self):
        state = self.create([{'creature': 13, 'count': 1}, {'creature': 56, 'count': 10, 'hex': 90}], [{'creature': 3, 'count': 100, 'hex': 96}])
        skeleton = next(u for u in state['units'] if u['creature'] == 'core:skeleton')
        state = self.act(state, 'wait')['state']
        forbidden = self.request('act', revision=state['revision'], stack=state['activeStack'], action='creatureSpell', spell=38, targets=[{'unit': skeleton['id']}])
        self.assertFalse(forbidden['ok']); self.assertEqual(self.request('state')['result']['state'], state)
        state = self.act(state, 'shoot', target=skeleton['id'])['state']
        targets = self.request('spellTargets', revision=state['revision'], stack=state['activeStack'], spell=38, caster='creature')
        if targets['ok']: self.assertNotIn([{'unit': skeleton['id']}], targets['result']['targets'])
        forbidden = self.request('act', revision=state['revision'], stack=state['activeStack'], action='creatureSpell', spell=38, targets=[{'unit': skeleton['id']}])
        self.assertFalse(forbidden['ok']); self.assertEqual(self.request('state')['result']['state'], state)


    def test_scenario_catalogue_and_native_terrain_bonuses(self):
        catalogue = self.request('catalogue')['result']
        scenes = catalogue['scenarios']
        self.assertEqual([t['id'] for t in scenes['terrains']], list(range(8)))
        self.assertEqual(scenes['layoutCount'], 1296)
        self.assertFalse(scenes['default']['obstacles'])
        for terrain in scenes['terrains']:
            self.assertTrue(all(field['label'] for field in terrain['battlefields']))
            self.assertNotIn('core:ship', [field['key'] for field in terrain['battlefields']])
        base = {c['key']: c for c in catalogue['creatures']}
        armies = [[{'creature': 7, 'count': 20}], [{'creature': 58, 'count': 100}]]
        for terrain in scenes['terrains']:
            scenario = dict(terrain=terrain['id'], battlefield=terrain['battlefields'][0]['key'], obstacles=False, layout=148)
            response = self.request('deployment', seed=1337, armies=armies, scenario=scenario)
            self.assertTrue(response['ok'], response.get('error'))
            state = response['result']['state']
            self.assertEqual(state['scenario'], scenario)
            self.assertEqual(state['obstacles'], [])
            for unit in state['units']:
                bonus = int((unit['side'] == 0 and terrain['id'] == 2) or (unit['side'] == 1 and terrain['id'] == 0))
                for stat in ['attack', 'defense', 'speed']:
                    self.assertEqual(unit[stat], base[unit['creature']][stat] + bonus)

    def test_native_obstacle_layout_preview_occupancy_and_pathfinding(self):
        armies = [[{'creature': 11, 'count': 20}, {'creature': 7, 'count': 20}], [{'creature': 58, 'count': 100}]]
        scenario = dict(terrain=2, battlefield='core:grass_pines', obstacles=True, layout=148)
        preview = self.request('deployment', seed=1337, armies=armies, scenario=scenario)['result']['state']
        state = self.request('create', seed=1337, armies=armies, scenario=scenario)['result']['state']
        self.assertEqual(preview['obstacles'], state['obstacles'])
        self.assertEqual(preview['units'], state['units'])
        blocked = set(state['obstacles'])
        self.assertTrue(blocked)
        occupied = {h for unit in state['units'] for h in unit['footprint']}
        self.assertFalse(blocked & occupied)
        actor = next(u for u in state['units'] if u['id'] == state['activeStack'])
        self.assertEqual(len(actor['footprint']), 2)
        self.assertTrue(state['legal']['moves'])
        for move in state['legal']['moves']:
            for hex_id in move['path']:
                footprint = {hex_id, hex_id - 1}  # Native attacker double-wide orientation.
                self.assertFalse(footprint & blocked)
                self.assertFalse(footprint & (occupied - set(actor['footprint'])))
        shifted = self.request('deployment', seed=1337, armies=armies, scenario={**scenario, 'layout': 149})
        self.assertTrue(shifted['ok'], shifted.get('error'))
        self.assertNotEqual(shifted['result']['state']['obstacles'], state['obstacles'])
        self.assertEqual(self.request('state')['result']['state'], state)
        # Moving to a generated blocked hex and deploying on it must be rejected atomically.
        self.assertFalse(self.request('act', revision=state['revision'], stack=state['activeStack'], action='move', hex=min(blocked))['ok'])
        invalid = [[{'creature': 7, 'count': 20, 'hex': min(blocked)}], armies[1]]
        self.assertFalse(self.request('create', seed=1337, armies=invalid, scenario=scenario)['ok'])
        self.assertEqual(self.request('state')['result']['state'], state)
        after = self.act(state, 'ai')['state']
        self.assertTrue(all(not blocked.intersection(unit['footprint']) for unit in after['units'] if unit['count']))

    def test_special_ground_native_magic_and_spell_restrictions(self):
        armies = [[{'creature': 3, 'count': 30}, {'creature': 0, 'count': 30}], [{'creature': 58, 'count': 100}]]
        for field, expected in [('core:grass_pines', [3, 0]), ('core:magic_plains', [5, 5])]:
            response = self.request('create', seed=1337, armies=armies, heroes=[self.hero([53]), None], scenario=dict(terrain=2, battlefield=field, obstacles=False, layout=148))
            self.assertTrue(response['ok'], response.get('error'))
            state = response['result']['state']
            target = self.spell_targets(state, 53)[0]
            after = self.act(state, 'spell', spell=53, targets=target)['state']
            allies = sorted((u for u in state['units'] if u['side'] == 0), key=lambda u: u['slot'])
            self.assertEqual([next(u for u in after['units'] if u['id'] == before['id'])['speed'] - before['speed'] for before in allies], expected)
        response = self.request('create', seed=1337, armies=armies, heroes=[self.hero([15, 18]), None], scenario=dict(terrain=2, battlefield='core:cursed_ground', obstacles=False, layout=148))
        self.assertTrue(response['ok'], response.get('error'))
        state = response['result']['state']
        spells = {s['id']: s for s in state['heroes'][0]['spells']}
        self.assertTrue(spells[15]['castable'])
        self.assertFalse(spells[18]['castable'])
        self.assertFalse(self.request('spellTargets', revision=state['revision'], stack=state['activeStack'], spell=18)['ok'])
        self.assertEqual(self.request('state')['result']['state'], state)

    def test_invalid_scene_configuration_preserves_active_battle(self):
        armies = [[{'creature': 7, 'count': 20}], [{'creature': 58, 'count': 100}]]
        state = self.create(*armies)
        for bad in [{'terrain': 8}, {'layout': 1296}, {'layout': -1}, {'obstacles': 1}, {'terrain': 0, 'battlefield': 'core:grass_pines'}, {'battlefield': 'core:ship'}, {'unknown': True}]:
            response = self.request('create', seed=1337, armies=armies, scenario=bad)
            self.assertFalse(response['ok'], bad)
            self.assertEqual(self.request('state')['result']['state'], state)


if __name__ == "__main__":
    unittest.main()
