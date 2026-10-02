import test from 'node:test';
import assert from 'node:assert/strict';
import { cellAt, cells, distance, neighbors, pathfind, key, initialUnits, occupied, strike, stackCount, topHealth, setStackCount, damageRange } from '../src/battle.ts';

test('hex neighbors have unit distance, stay on the board and are reciprocal', () => {
  for (const cell of cells) for (const next of neighbors(cell)) {
    assert.equal(distance(cell, next), 1);
    assert.ok(neighbors(next).some(n => key(n) === key(cell)));
  }
  assert.equal(neighbors(cellAt(8, 5)).length, 6);
  assert.ok(neighbors(cellAt(0, 0)).length < 6);
});
test('shortest paths respect occupancy, step budget and blocked destinations', () => {
  const start = cellAt(5, 5), goal = cellAt(9, 5);
  assert.equal(pathfind(start, goal, new Set())!.length, distance(start, goal));
  const blocker = key(cellAt(7, 5)); const path = pathfind(start, goal, new Set([blocker]));
  assert.ok(path); assert.ok(path.every(c => key(c) !== blocker));
  assert.equal(pathfind(start, goal, new Set(), 3), null);
  assert.equal(pathfind(start, goal, new Set([key(goal)])), null);
  assert.equal(pathfind(start, goal, new Set(neighbors(start).map(key))), null);
  assert.equal(pathfind(start, { q: 100, r: 100 }, new Set()), null);
});
test('stack health preserves the wounded last creature and casualties reduce damage', () => {
  const [a, b] = initialUnits(); b.cell = neighbors(a.cell)[0];
  assert.deepEqual(damageRange(a, b), { min: 20, max: 60 });
  assert.deepEqual(strike(a, b, () => 0), { damage: 20, killed: 1, remaining: 19, range: { min: 20, max: 60 } });
  assert.equal(b.hp, 280); assert.equal(topHealth(b), 10);
  assert.deepEqual(damageRange(b, a), { min: 39, max: 59 });
  setStackCount(a, 1); setStackCount(b, 1);
  strike(a, b, () => 0); assert.equal(stackCount(b), 1); assert.equal(topHealth(b), 14);
  setStackCount(a, 99999); strike(a, b, () => 0);
  assert.equal(b.hp, 0); assert.equal(stackCount(b), 0); assert.equal(topHealth(b), 0);
  assert.ok(!occupied([a, b], a.id).has(key(b.cell)));
});
test('attack-defense scaling and integer rounding use base creature stats', () => {
  const [a, b] = initialUnits(); a.kind = 'swordsman'; b.kind = 'skeleton';
  setStackCount(a, 10); setStackCount(b, 10);
  assert.deepEqual(damageRange(a, b), { min: 78, max: 117 });
  assert.deepEqual(damageRange(b, a), { min: 8, max: 24 });
  b.kind = 'crusader'; setStackCount(b, 10);
  assert.deepEqual(damageRange(a, b), { min: 57, max: 85 });
});
test('damage rolls average up to ten samples, reject invalid attacks without mutation', () => {
  const [a, b] = initialUnits(); const before = b.hp;
  assert.equal(strike(a, b), null); assert.equal(b.hp, before);
  b.cell = neighbors(a.cell)[0]; b.team = a.team;
  assert.equal(strike(a, b), null); b.team = 1;
  let calls = 0;
  assert.equal(strike(a, b, () => calls++ % 2 ? .999999 : 0)?.damage, 40);
  assert.equal(calls, 10);
  setStackCount(a, 1); calls = 0; strike(a, b, () => { calls++; return 0; }); assert.equal(calls, 1);
  assert.throws(() => strike(a, b, () => 1), RangeError);
  a.hp = 0; assert.equal(strike(a, b), null);
});
test('configuration rejects invalid counts without mutating the stack', () => {
  const [a] = initialUnits(), before = structuredClone(a);
  for (const n of [0, -1, 1.5, NaN, Infinity, 100000]) {
    assert.throws(() => setStackCount(a, n), RangeError); assert.deepEqual(a, before);
  }
});

import { Battle, movementPath, approachPath } from '../src/battle.ts';
import type { Unit } from '../src/battle.ts';
const troop = (id: string, kind: string, team: number, col: number, count = 20): Unit => {
  const u: Unit = { id, kind, label: kind, team, cell: cellAt(col, 5), hp: 1, initialCount: count };
  setStackCount(u, count); return u;
};
test('turns enforce speed, reject out-of-turn actions and consume movement', () => {
  const a = troop('a', 'skeleton', 0, 5), b = troop('b', 'zombie', 1, 11), battle = new Battle([a, b]);
  assert.equal(battle.activeId, 'a');
  assert.equal(battle.move('b', cellAt(10, 5)), null);
  assert.equal(battle.move('a', cellAt(10, 5)), null);
  assert.equal(battle.move('a', a.cell), null);
  assert.equal(battle.round, 1);
  assert.equal(battle.move('a', cellAt(7, 5))?.length, 2);
  assert.equal(battle.activeId, 'b');
  assert.ok(battle.defend('b')); assert.equal(battle.round, 2); assert.equal(battle.activeId, 'a');
});
test('wait phase reverses speed order and cannot wait twice', () => {
  const units = [troop('fast', 'wraith', 0, 4), troop('medium', 'swordsman', 1, 10), troop('slow', 'zombie', 1, 12)];
  const battle = new Battle(units);
  for (const id of ['fast', 'medium', 'slow']) { assert.equal(battle.activeId, id); assert.ok(battle.wait(id)); }
  assert.equal(battle.activeId, 'slow'); assert.equal(battle.wait('slow'), false);
  assert.deepEqual(battle.queue(), ['slow', 'medium', 'fast']);
  for (const id of ['slow', 'medium', 'fast']) { assert.equal(battle.activeId, id); battle.defend(id); }
  assert.equal(battle.round, 2); assert.equal(battle.activeId, 'fast');
});
test('equal speeds alternate sides while preserving army slot order', () => {
  const battle = new Battle([troop('a1', 'skeleton', 0, 3), troop('a2', 'skeleton', 0, 4), troop('b1', 'skeleton', 1, 10), troop('b2', 'skeleton', 1, 11)]);
  assert.deepEqual(battle.queue(), ['a1', 'b1', 'a2', 'b2']);
  for (const id of ['a1', 'b1', 'a2', 'b2']) { assert.equal(battle.activeId, id); battle.defend(id); }
  assert.equal(battle.activeId, 'a1');
});
test('Crusader attacks, receives one retaliation, then strikes with survivors', () => {
  const a = troop('a', 'crusader', 0, 5, 3), b = troop('b', 'swordsman', 1, 6, 15), battle = new Battle([a, b]);
  const hits = battle.melee('a', 'b', () => 0)!;
  assert.deepEqual(hits.map(h => [h.attacker, h.counter]), [['a', false], ['b', true], ['a', false]]);
  assert.equal(hits[0].damage, 21); assert.equal(hits[2].damage, 7);
  assert.equal(battle.activeId, 'b');
  const reply = battle.melee('b', 'a', () => 0)!;
  assert.deepEqual(reply.map(h => h.counter), [false]); // lethal attack ends exchange
  assert.equal(battle.winner, 1); assert.equal(battle.activeId, null);
  assert.equal(battle.defend('b'), false);
});
test('retaliation is once per round, does not consume the defender action, resets next round', () => {
  const a = troop('a', 'skeleton', 0, 5, 100), c = troop('c', 'skeleton', 0, 7, 100), b = troop('b', 'zombie', 1, 6, 100);
  const battle = new Battle([a, c, b]);
  assert.deepEqual(battle.melee('a', 'b', () => 0)!.map(h => h.counter), [false, true]);
  assert.equal(battle.activeId, 'c');
  assert.deepEqual(battle.melee('c', 'b', () => 0)!.map(h => h.counter), [false]);
  assert.equal(battle.activeId, 'b'); battle.defend('b');
  assert.equal(battle.round, 2);
  assert.deepEqual(battle.melee('a', 'b', () => 0)!.map(h => h.counter), [false, true]);
});
test('defense grants at least one point and persists across rounds until stack activation', () => {
  const a = troop('a', 'swordsman', 0, 5), b = troop('b', 'skeleton', 1, 6), battle = new Battle([a, b]);
  battle.defend('a'); assert.equal(battle.defense(a), 14);
  battle.defend('b'); assert.equal(battle.round, 2);
  assert.equal(battle.defense(a), 12); assert.equal(battle.defense(b), 5);
  battle.defend('a'); assert.equal(battle.defense(b), 4);
});
test('flying crosses surrounded cells, respects landing occupancy, and heals without resurrection once per round', () => {
  const a = troop('a', 'wraith', 0, 5), b = troop('b', 'zombie', 1, 11);
  const blockers = neighbors(a.cell).map((h, i) => ({ ...troop(`block${i}`, 'zombie', 1, 12), cell: h }));
  assert.equal(pathfind(a.cell, cellAt(8, 5), occupied([a, b, ...blockers], a.id), 7), null);
  assert.deepEqual(movementPath(a, cellAt(8, 5), [a, b, ...blockers]), [cellAt(8, 5)]);
  assert.equal(movementPath(a, b.cell, [a, b]), null);
  assert.equal(movementPath(a, cellAt(15, 5), [a, b]), null);
  assert.ok(approachPath(a, b, [a, b]));
  a.hp = 340; const battle = new Battle([a, b]);
  assert.equal(a.hp, 342); assert.equal(stackCount(a), 19);
  battle.wait('a'); a.hp -= 5; battle.defend('b');
  assert.equal(battle.activeId, 'a'); assert.equal(a.hp, 337);
  battle.defend('a'); assert.equal(a.hp, 342);
});
test('lethal opening strike prevents retaliation and second attacks', () => {
  const a = troop('a', 'crusader', 0, 5, 100), b = troop('b', 'zombie', 1, 6, 1), battle = new Battle([a, b]);
  assert.equal(battle.melee('a', 'b', () => 0)!.length, 1);
  assert.equal(battle.winner, 0); assert.deepEqual(battle.queue(), []);
});

import { readFileSync } from 'node:fs';
import { parseCreaturePack, registerCreaturePack, creatureDefinition } from '../src/creatures.ts';
const customPack = () => JSON.parse(readFileSync(new URL('../examples/custom-creatures.json', import.meta.url), 'utf8'));
test('creature format rejects unsupported fields/mechanisms, duplicates and bad stats atomically', () => {
  for (const change of [
    (p: any) => p.version = 2,
    (p: any) => p.creatures[0].stats.health = 0,
    (p: any) => p.creatures[0].stats.minDamage = 100,
    (p: any) => p.creatures[0].stats.typo = 5,
    (p: any) => p.creatures[0].mechanisms.push({ type: 'poison' }),
    (p: any) => p.creatures[0].mechanisms[0].extra = true,
    (p: any) => p.creatures[0].mechanisms[1].count = 1.5,
    (p: any) => p.creatures.push(structuredClone(p.creatures[0])),
    (p: any) => p.creatures[0].ruleset = 'h3-base',
    (p: any) => p.creatures[0].id = '__proto__',
  ]) { const pack = customPack(); change(pack); assert.throws(() => parseCreaturePack(pack)); }
  const pack = customPack(); pack.creatures.push({ ...structuredClone(pack.creatures[0]), id: 'skeleton' });
  assert.throws(() => registerCreaturePack(pack), /already registered/);
  assert.throws(() => creatureDefinition('custom-spectral-guard'));
});
test('imported mechanisms drive real combat and caller mutations cannot change registered rules', () => {
  const pack = customPack(); registerCreaturePack(pack); pack.creatures[0].stats.health = 999;
  assert.equal(creatureDefinition('custom-spectral-guard').stats.health, 24);
  assert.throws(() => registerCreaturePack(customPack()), /already registered/);
  const a = troop('a', 'custom-spectral-guard', 0, 5), b = troop('b', 'zombie', 1, 6, 100), battle = new Battle([a, b]);
  const hits = battle.melee('a', 'b', () => 0)!;
  assert.equal(hits.length, 2); assert.ok(hits.every(h => !h.counter)); assert.equal(a.hp, 480);
});
test('custom retaliation allowance and regeneration work independently of creature identity or flight', () => {
  const pack = customPack(), def = pack.creatures[0]; def.id = 'custom-healing-guard';
  def.mechanisms = [{ type: 'regeneration', health: 3 }, { type: 'retaliations', count: 2 }];
  def.stats.speed = 3; registerCreaturePack(pack);
  const a = troop('a', 'skeleton', 0, 5, 100), c = troop('c', 'skeleton', 0, 7, 100), b = troop('b', def.id, 1, 6, 100);
  b.hp -= 10; const battle = new Battle([a, c, b]); assert.equal(b.hp, 2393); // heals at round start before its turn
  assert.deepEqual(battle.melee('a', 'b', () => 0)!.map(h => h.counter), [false, true]);
  assert.deepEqual(battle.melee('c', 'b', () => 0)!.map(h => h.counter), [false, true]);
  const before = b.hp; battle.defend('b');
  assert.equal(b.hp, before + Math.min(3, 24 - topHealth({ ...b, hp: before })));
});
