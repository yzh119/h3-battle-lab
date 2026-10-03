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
        self.process = subprocess.Popen([os.environ["BATTLE_LAB_BACKEND"]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
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


if __name__ == "__main__":
    unittest.main()
