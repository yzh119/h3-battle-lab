"""Verify real engine event/state consistency for the native ranged smoke test."""
import argparse
import json
from pathlib import Path


def verify(result):
    assert result["backend"] == "vcmi-native" and result["seed"] == 1337
    initial = {u["id"]: u for u in result["initial"]["units"]}
    shooter = next(u for u in initial.values() if u["creature"] == "core:marksman")
    target = next(u for u in initial.values() if u["creature"] == "core:walkingDead")
    assert shooter["shots"] == 24 and shooter["health"] == 200 and target["health"] == 300
    attacks = [e for e in result["events"] if e["type"] == "attack"]
    assert len(attacks) == 2
    health = target["health"]
    for index, event in enumerate(attacks):
        assert event["ranged"] and not event["counter"] and event["attacker"] == shooter["id"]
        assert len(event["victims"]) == 1
        hit = event["victims"][0]
        assert hit["id"] == target["id"] and hit["damage"] > 0
        before = {u["id"]: u for u in event["before"]["units"]}
        after = {u["id"]: u for u in event["after"]["units"]}
        assert before[target["id"]]["health"] == health
        health -= hit["damage"]
        assert after[target["id"]]["health"] == health
        assert before[target["id"]]["count"] - after[target["id"]]["count"] == hit["killed"]
        assert after[shooter["id"]]["shots"] == 23 - index
        assert after[shooter["id"]]["hex"] == shooter["hex"]
        assert after[shooter["id"]]["health"] == shooter["health"]
    # Every native update must continue from the previous authoritative state.
    previous = result["initial"]
    for event in result["events"]:
        assert event["before"] == previous
        previous = event["after"]
    assert result["final"] == previous
    assert result["final"]["activeStack"] == target["id"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result")
    parser.add_argument("--repeat", help="Second independently run result must match exactly")
    args = parser.parse_args()
    result = json.loads(Path(args.result).read_text())
    verify(result)
    if args.repeat:
        assert result == json.loads(Path(args.repeat).read_text()), "Seeded engine replay differed"
    print("Verified two native shots, ammo, casualty events, state continuity and turn advancement.")
