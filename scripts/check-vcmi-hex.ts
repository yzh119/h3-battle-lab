import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { cells, distance, isPlayable, neighbors, key } from '../src/battle.ts';

const file = process.argv[2];
if (!file) throw new Error('Usage: node --experimental-strip-types scripts/check-vcmi-hex.ts <probe.json>');
const reference = JSON.parse(readFileSync(file, 'utf8'));
assert.equal(reference.available?.length, cells.length);
assert.equal(reference.distances?.length, cells.length);
assert.equal(reference.neighbors?.length, cells.length);
const ids = new Map(cells.map((cell, id) => [key(cell), id]));
for (const [i, cell] of cells.entries()) {
  assert.equal(isPlayable(cell), reference.available[i], `availability at hex ${i}`);
  assert.equal(reference.distances[i].length, cells.length);
  if (isPlayable(cell)) {
    assert.deepEqual(neighbors(cell).map(h => ids.get(key(h))).sort((a, b) => a! - b!),
      [...reference.neighbors[i]].sort((a, b) => a - b), `neighbors at hex ${i}`);
  }
  for (const [j, other] of cells.entries()) {
    assert.equal(distance(cell, other), reference.distances[i][j], `distance ${i} -> ${j}`);
  }
}
console.log(`Matched ${cells.length} availability checks, 165 playable neighbor sets and ${cells.length ** 2} native distances. Combat parity remains unverified.`);
