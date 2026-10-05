import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cells, fromHexId, toHexId, isPlayable, creatureArt } from '../src/presentation.ts';
import { parseCreaturePack, registerCreaturePack, creatureDefinitions } from '../src/creatures.ts';

test('native hex IDs roundtrip through visible coordinates; borders stay reserved', () => {
  assert.equal(cells.length, 187);
  cells.forEach((cell, id) => { assert.deepEqual(fromHexId(id), cell); assert.equal(toHexId(cell), id); });
  assert.equal(cells.filter(isPlayable).length, 165);
  for (let row = 0; row < 11; row++) for (const col of [0, 16]) assert.equal(isPlayable(fromHexId(row * 17 + col)), false);
  assert.equal(creatureArt.length, 28);
  assert.equal(new Set(creatureArt.map(c => c.id)).size, 28);
});
const example = () => JSON.parse(readFileSync(new URL('../examples/custom-creatures.json', import.meta.url), 'utf8'));
test('custom double-wide ring attacker accepts explicit footprint and rejects malformed flags', () => {
  const pack = example();
  pack.creatures[0].doubleWide = true;
  pack.creatures[0].mechanisms = [{ type: 'attacksAllAdjacent' }, { type: 'blocksRetaliation' }];
  assert.equal(parseCreaturePack(pack).creatures[0].doubleWide, true);
  for (const invalid of [0, 1, 'true', null, []]) {
    pack.creatures[0].doubleWide = invalid;
    assert.throws(() => parseCreaturePack(pack), /doubleWide/);
  }
});
test('authoring format rejects unknown mechanisms and invalid ranges', () => {
  const pack = example(); assert.equal(parseCreaturePack(pack).version, 1);
  pack.creatures[0].mechanisms = [{ type: 'executeJavaScript' }]; assert.throws(() => parseCreaturePack(pack), /unsupported mechanism/);
  const bad = example(); bad.creatures[0].stats.minDamage = 100000; bad.creatures[0].stats.maxDamage = 1; assert.throws(() => parseCreaturePack(bad), /minDamage/);
});
test('registration protects original IDs and rejects entire packs atomically', () => {
  const pack = example(); pack.creatures.push({ ...structuredClone(pack.creatures[0]), id: 'marksman' });
  const before = creatureDefinitions().length; assert.throws(() => registerCreaturePack(pack), /already registered/);
  assert.equal(creatureDefinitions().length, before);
  const valid = example(); registerCreaturePack(valid); assert.throws(() => registerCreaturePack(valid), /already registered/);
});
