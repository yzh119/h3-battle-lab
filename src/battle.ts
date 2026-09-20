export interface Hex { q: number; r: number }
export interface Unit { id: string; label: string; kind: string; team: number; cell: Hex; hp: number }
export const COLS = 17;
export const ROWS = 11;
export const key = (h: Hex) => `${h.q},${h.r}`;
export const cellAt = (col: number, row: number): Hex => ({ q: col - Math.floor(row / 2), r: row });
export const cells: Hex[] = Array.from({ length: COLS * ROWS }, (_, i) => cellAt(i % COLS, Math.floor(i / COLS)));
const valid = new Set(cells.map(key));
const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export function neighbors(h: Hex): Hex[] {
  return directions.map(([q, r]) => ({ q: h.q + q, r: h.r + r })).filter(c => valid.has(key(c)));
}
export function distance(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}
export function pathfind(from: Hex, to: Hex, blocked: Set<string>, budget = 8): Hex[] | null {
  if (!valid.has(key(from)) || !valid.has(key(to)) || (blocked.has(key(to)) && key(from) !== key(to))) return null;
  const queue = [{ cell: from, path: [] as Hex[] }];
  const seen = new Set([key(from)]);
  for (let i = 0; i < queue.length; i++) {
    const { cell, path } = queue[i];
    if (key(cell) === key(to)) return path;
    if (path.length >= budget) continue;
    for (const next of neighbors(cell)) {
      if (blocked.has(key(next)) || seen.has(key(next))) continue;
      seen.add(key(next)); queue.push({ cell: next, path: [...path, next] });
    }
  }
  return null;
}
export const obstacles = new Set([cellAt(8, 2), cellAt(8, 3), cellAt(9, 7)].map(key));
export function initialUnits(): Unit[] {
  return [
    { id: 'azure', label: '骷髅兵', kind: 'skeleton', team: 0, cell: cellAt(5, 5), hp: 100 },
    { id: 'ember', label: '僵尸', kind: 'zombie', team: 1, cell: cellAt(11, 5), hp: 100 },
  ];
}
export function occupied(units: Unit[], except: string): Set<string> {
  return new Set([...obstacles, ...units.filter(u => u.id !== except && u.hp > 0).map(u => key(u.cell))]);
}
export function strike(attacker: Unit, defender: Unit): boolean {
  if (attacker.hp <= 0 || defender.hp <= 0 || attacker.team === defender.team || distance(attacker.cell, defender.cell) !== 1) return false;
  defender.hp = Math.max(0, defender.hp - 25); return true;
}
