import test from 'node:test';
import assert from 'node:assert/strict';
import { cellAt, cells, distance, neighbors, pathfind, key, initialUnits, occupied, strike } from '../src/battle.ts';

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
test('prototype melee rejects distance and friendly fire; dead units free occupancy', () => {
  const [a, b] = initialUnits();
  assert.equal(strike(a, b), false);
  b.cell = neighbors(a.cell)[0]; b.team = a.team;
  assert.equal(strike(a, b), false);
  b.team = 1; assert.equal(strike(a, b), true); assert.equal(b.hp, 75);
  for (let i = 0; i < 3; i++) strike(a, b);
  assert.equal(b.hp, 0); assert.equal(strike(a, b), false);
  assert.ok(!occupied([a, b], a.id).has(key(b.cell)));
});
