import { creatureStats, mechanism, type CreatureStats } from './creatures.ts';
export interface Hex { q: number; r: number }
export interface Unit { id: string; label: string; kind: string; team: number; cell: Hex; hp: number; initialCount: number }
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
export { creatureStats } from './creatures.ts';
export type { CreatureStats } from './creatures.ts';
export const MAX_STACK_COUNT = 99999;
export function stats(unit: Unit): CreatureStats {
  const result = creatureStats[unit.kind];
  if (!result) throw new Error(`No combat stats for ${unit.kind}`);
  return result;
}
export function stackCount(unit: Unit): number { return Math.ceil(unit.hp / stats(unit).health); }
export function topHealth(unit: Unit): number { return unit.hp > 0 ? (unit.hp - 1) % stats(unit).health + 1 : 0; }
export function setStackCount(unit: Unit, count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_STACK_COUNT) throw new RangeError('Invalid stack count');
  unit.initialCount = count; unit.hp = count * stats(unit).health;
}
export function initialUnits(): Unit[] {
  return [
    { id: 'azure', label: '骷髅兵', kind: 'skeleton', team: 0, cell: cellAt(5, 5), hp: 120, initialCount: 20 },
    { id: 'ember', label: '僵尸', kind: 'zombie', team: 1, cell: cellAt(11, 5), hp: 300, initialCount: 20 },
  ];
}
export function occupied(units: Unit[], except: string): Set<string> {
  return new Set([...obstacles, ...units.filter(u => u.id !== except && u.hp > 0).map(u => key(u.cell))]);
}
export interface DamageRange { min: number; max: number }
// Unmodified single melee blow only: no heroes, spells, abilities or retaliation yet.
// VCMI base config: +5% per surplus attack (cap +300%), -2.5% per
// surplus defense (cap -70%). Integer ratios avoid floating point off-by-one damage.
export function damageRange(attacker: Unit, defender: Unit, defense = stats(defender).defense): DamageRange {
  if (attacker.hp <= 0 || defender.hp <= 0) return { min: 0, max: 0 };
  const a = stats(attacker), delta = a.attack - defense;
  const factor = delta >= 0 ? 1000 + Math.min(delta * 50, 3000) : 1000 - Math.min(-delta * 25, 700);
  const count = stackCount(attacker);
  return { min: Math.max(1, Math.floor(count * a.minDamage * factor / 1000)), max: Math.max(1, Math.floor(count * a.maxDamage * factor / 1000)) };
}
export interface StrikeResult { damage: number; killed: number; remaining: number; range: DamageRange }
export function strike(attacker: Unit, defender: Unit, random = Math.random, defense = stats(defender).defense): StrikeResult | null {
  if (attacker.hp <= 0 || defender.hp <= 0 || attacker.team === defender.team || distance(attacker.cell, defender.cell) !== 1) return null;
  const range = damageRange(attacker, defender, defense);
  // VCMI BattleInfo::getActualDamage averages min(10, count) inclusive rolls.
  const samples = Math.min(10, stackCount(attacker)); let total = 0;
  for (let i = 0; i < samples; i++) {
    const roll = range.min === range.max ? 0 : random();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('Random sample must be in [0, 1)');
    total += range.min + Math.floor(roll * (range.max - range.min + 1));
  }
  const damage = Math.floor(total / samples), before = stackCount(defender);
  defender.hp = Math.max(0, defender.hp - damage);
  return { damage, killed: before - stackCount(defender), remaining: stackCount(defender), range };
}

export const flying = (unit: Unit) => !!mechanism(unit.kind, 'flying');
export function movementPath(unit: Unit, to: Hex, units: Unit[]): Hex[] | null {
  const blocked = occupied(units, unit.id), budget = stats(unit).speed;
  if (!flying(unit)) return pathfind(unit.cell, to, blocked, budget);
  if (!valid.has(key(to)) || blocked.has(key(to)) || distance(unit.cell, to) > budget) return null;
  return key(unit.cell) === key(to) ? [] : [to];
}
export function approachPath(unit: Unit, target: Unit, units: Unit[]): Hex[] | null {
  if (target.hp <= 0 || target.team === unit.team) return null;
  return neighbors(target.cell).map(c => movementPath(unit, c, units)).filter((p): p is Hex[] => p !== null)
    .sort((a, b) => (flying(unit) ? distance(unit.cell, a.at(-1) ?? unit.cell) - distance(unit.cell, b.at(-1) ?? unit.cell) : a.length - b.length))[0] ?? null;
}
export interface CombatBlow extends StrikeResult { attacker: string; defender: string; counter: boolean }
interface TurnState { acted: boolean; waited: boolean; retaliated: number; defending: boolean }
const freshTurn = (): TurnState => ({ acted: false, waited: false, retaliated: 0, defending: false });

/** Pure battle controller. UI selection never grants permission to act. */
export class Battle {
  round = 1;
  activeId: string | null = null;
  winner: number | null = null;
  private lastTeam: number | null = null;
  private turns = new Map<string, TurnState>();
  readonly units: Unit[];
  constructor(units: Unit[]) {
    this.units = units;
    if (new Set(units.map(u => u.id)).size !== units.length || units.some(u => u.hp <= 0 || !valid.has(key(u.cell)))) throw new Error('Invalid army');
    if (new Set(units.map(u => key(u.cell))).size !== units.length || units.some(u => obstacles.has(key(u.cell)))) throw new Error('Occupied deployment');
    if (![0, 1].every(team => units.some(u => u.team === team)) || units.some(u => ![0, 1].includes(u.team))) throw new Error('Both teams required');
    for (const u of units) { stats(u); this.turns.set(u.id, freshTurn()); }
    this.regenerate(); this.advance();
  }
  get active(): Unit | undefined { return this.units.find(u => u.id === this.activeId); }
  canAct(id: string): boolean { return this.winner === null && this.activeId === id; }
  canWait(id: string): boolean { return this.canAct(id) && !this.turns.get(id)!.waited; }
  defense(unit: Unit): number {
    const base = stats(unit).defense;
    return base + (this.turns.get(unit.id)!.defending ? Math.max(1, Math.floor(base / 5)) : 0);
  }
  private pick(pending: Unit[], lastTeam: number | null): Unit {
    const normal = pending.filter(u => !this.turns.get(u.id)!.waited);
    const pool = normal.length ? normal : pending;
    const speed = (normal.length ? Math.max : Math.min)(...pool.map(u => stats(u).speed));
    const tied = pool.filter(u => stats(u).speed === speed);
    return tied.find(u => u.team === (lastTeam === null ? 0 : 1 - lastTeam)) ?? tied[0];
  }
  queue(): string[] {
    if (this.winner !== null) return [];
    const pending = this.units.filter(u => u.hp > 0 && !this.turns.get(u.id)!.acted);
    const order: string[] = []; let last = this.lastTeam;
    if (this.active) { order.push(this.active.id); pending.splice(pending.indexOf(this.active), 1); last = this.active.team; }
    while (pending.length) { const next = this.pick(pending, last); order.push(next.id); pending.splice(pending.indexOf(next), 1); last = next.team; }
    return order;
  }
  private advance(): void {
    const living = this.units.filter(u => u.hp > 0), teams = new Set(living.map(u => u.team));
    if (teams.size === 1) { this.winner = living[0].team; this.activeId = null; return; }
    let pending = living.filter(u => !this.turns.get(u.id)!.acted);
    if (!pending.length) {
      this.round++;
      for (const state of this.turns.values()) { const defending = state.defending; Object.assign(state, freshTurn(), { defending }); }
      this.regenerate(); pending = living;
    }
    const next = this.pick(pending, this.lastTeam), state = this.turns.get(next.id)!;
    this.activeId = next.id;
    // Defense expires when this stack next activates, not at the round boundary.
    state.defending = false;
  }
  private regenerate(): void {
    // Original manual p. 101: at the beginning of each combat round.
    // VCMI's current activation-time implementation is not inherited.
    for (const unit of this.units) {
      const regeneration = mechanism(unit.kind, 'regeneration');
      if (unit.hp > 0 && regeneration) unit.hp += Math.min(regeneration.health, stats(unit).health - topHealth(unit));
    }
  }

  private finish(unit: Unit): void { this.turns.get(unit.id)!.acted = true; this.lastTeam = unit.team; this.activeId = null; this.advance(); }
  wait(id: string): boolean {
    if (!this.canWait(id)) return false;
    this.turns.get(id)!.waited = true; this.lastTeam = this.active!.team; this.activeId = null; this.advance(); return true;
  }
  defend(id: string): boolean {
    if (!this.canAct(id)) return false;
    const unit = this.active!; this.turns.get(id)!.defending = true; this.finish(unit); return true;
  }
  move(id: string, to: Hex): Hex[] | null {
    if (!this.canAct(id)) return null;
    const unit = this.active!, route = movementPath(unit, to, this.units);
    if (!route?.length) return null;
    unit.cell = { ...to }; this.finish(unit); return route;
  }
  melee(id: string, targetId: string, random = Math.random): CombatBlow[] | null {
    if (!this.canAct(id)) return null;
    const attacker = this.active!, defender = this.units.find(u => u.id === targetId);
    if (!defender || defender.hp <= 0 || defender.team === attacker.team || distance(attacker.cell, defender.cell) !== 1) return null;
    const blows: CombatBlow[] = [];
    const blow = (a: Unit, d: Unit, counter: boolean) => {
      const result = strike(a, d, random, this.defense(d));
      if (result) blows.push({ ...result, attacker: a.id, defender: d.id, counter });
    };
    const state = this.turns.get(defender.id)!;
    const attacks = 1 + (mechanism(attacker.kind, 'additionalAttacks')?.count ?? 0);
    for (let i = 0; i < attacks && attacker.hp > 0 && defender.hp > 0; i++) {
      blow(attacker, defender, false);
      if (i === 0 && attacker.hp > 0 && defender.hp > 0 && !mechanism(attacker.kind, 'blocksRetaliation') && state.retaliated < (mechanism(defender.kind, 'retaliations')?.count ?? 1)) {
        state.retaliated++; blow(defender, attacker, true);
      }
    }
    this.finish(attacker); return blows;
  }
}
