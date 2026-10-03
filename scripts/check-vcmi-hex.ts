import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { cells, isPlayable, fromHexId, toHexId } from '../src/presentation.ts';

const file = process.argv[2];
if (!file) throw new Error('Usage: node --experimental-strip-types scripts/check-vcmi-hex.ts <probe.json>');
const reference = JSON.parse(readFileSync(file, 'utf8'));
assert.equal(reference.available?.length, cells.length);
assert.equal(reference.distances?.length, cells.length);
assert.equal(reference.neighbors?.length, cells.length);
for (const [i, cell] of cells.entries()) {
  assert.equal(isPlayable(cell), reference.available[i], `availability at hex ${i}`);
  assert.equal(toHexId(cell), i);
  assert.deepEqual(fromHexId(i), cell);
}
console.log(`Matched ${cells.length} native hex coordinate/availability checks. Paths and distances are computed by the engine.`);
