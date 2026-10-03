/** Coordinate conversion and visible model data only. Legal actions come from VCMI. */
export interface Hex { q: number; r: number }
export interface VisualUnit { id: string; label: string; kind: string; team: number; armySlot: number; cell: Hex; hp: number; initialCount: number }
export const COLS = 17, ROWS = 11;
export const key = (h: Hex) => `${h.q},${h.r}`;
export const cellAt = (col: number, row: number): Hex => ({ q: col - Math.ceil(row / 2), r: row });
export const cells = Array.from({ length: COLS * ROWS }, (_, i) => cellAt(i % COLS, Math.floor(i / COLS)));
export const fromHexId = (id: number): Hex => cells[id];
export const toHexId = (h: Hex): number => (h.q + Math.ceil(h.r / 2)) + h.r * COLS;
export const isPlayable = (h: Hex): boolean => { const col = h.q + Math.ceil(h.r / 2); return Number.isInteger(col) && col > 0 && col < 16 && h.r >= 0 && h.r < 11; };
export const creatureArt = [
  ['pikeman', '枪兵'], ['halberdier', '戟兵'], ['archer', '弓箭手'], ['marksman', '神射手'],
  ['griffin', '狮鹫'], ['royalGriffin', '皇家狮鹫'], ['swordsman', '剑士'], ['crusader', '十字军'],
  ['monk', '僧侣'], ['zealot', '祭司'], ['cavalier', '骑兵'], ['champion', '骑士'], ['angel', '天使'], ['archangel', '大天使'],
  ['skeleton', '骷髅兵'], ['skeletonWarrior', '骷髅勇士'], ['walkingDead', '行尸'], ['zombieLord', '僵尸'],
  ['wight', '幽灵'], ['wraith', '阴魂'], ['vampire', '吸血鬼'], ['vampireLord', '吸血鬼王'],
  ['lich', '尸巫'], ['powerLich', '尸巫王'], ['blackKnight', '黑骑士'], ['dreadKnight', '恐怖骑士'], ['boneDragon', '骨龙'], ['ghostDragon', '幽灵龙'],
].map(([core, label], i) => ({ id: i < 14 ? i : i + 42, key: `core:${core}`, label,
  art: core === 'walkingDead' ? 'zombie' : core === 'zombieLord' ? 'zombie-upgraded' : core.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`),
  faction: i < 14 ? '城堡' : '墓园' }));
