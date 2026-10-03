import { creatureStats, mechanism, type CreatureStats } from './creatures.ts';
export interface Hex { q: number; r: number }
export interface Unit { id: string; label: string; kind: string; team: number; cell: Hex; hp: number; initialCount: number }
export const COLS = 17;
export const ROWS = 11;
export const key = (h: Hex) => `${h.q},${h.r}`;
export const cellAt = (col: number, row: number): Hex => ({ q: col - Math.ceil(row / 2), r: row });
export const cells: Hex[] = Array.from({ length: COLS * ROWS }, (_, i) => cellAt(i % COLS, Math.floor(i / COLS)));
// The two outer columns are reserved for heroes, not creature movement.
const valid = new Set(cells.filter(h => {
  const col = h.q + Math.ceil(h.r / 2);
  return col > 0 && col < COLS - 1;
}).map(key));
export const isPlayable = (h: Hex): boolean => valid.has(key(h));
const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export function neighbors(h: Hex): Hex[] {
  if (!isPlayable(h)) return [];
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
export interface DamageOptions { ranged?: boolean }
// Single-blow damage; turn, retaliation and ammunition are controlled by Battle.
// VCMI base config: +5% per surplus attack (cap +300%), -2.5% per
// surplus defense (cap -70%). Integer ratios avoid floating point off-by-one damage.
export function damageRange(attacker: Unit, defender: Unit, defense = stats(defender).defense, options: DamageOptions = {}): DamageRange {
  if (attacker.hp <= 0 || defender.hp <= 0) return { min: 0, max: 0 };
  const a = stats(attacker), delta = a.attack - defense;
  const factor = delta >= 0 ? 1000 + Math.min(delta * 50, 3000) : 1000 - Math.min(-delta * 25, 700);
  const count = stackCount(attacker), shooter = mechanism(attacker.kind, 'shooter');
  const penalty = options.ranged ? !shooter?.noDistancePenalty && distance(attacker.cell, defender.cell) > 10 : shooter && !shooter.noMeleePenalty;
  const divisor = penalty ? 2000 : 1000;
  return { min: Math.max(1, Math.floor(count * a.minDamage * factor / divisor)), max: Math.max(1, Math.floor(count * a.maxDamage * factor / divisor)) };
}
export interface StrikeResult { damage: number; killed: number; remaining: number; range: DamageRange }
export function strike(attacker: Unit, defender: Unit, random = Math.random, defense = stats(defender).defense): StrikeResult | null {
  if (attacker.hp <= 0 || defender.hp <= 0 || attacker.team === defender.team || distance(attacker.cell, defender.cell) !== 1) return null;
  return dealDamage(attacker, defender, random, defense);
}
function dealDamage(attacker: Unit, defender: Unit, random: () => number, defense: number, options: DamageOptions = {}): StrikeResult {
  const range = damageRange(attacker, defender, defense, options);
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
export interface CombatBlow extends StrikeResult { attacker: string; defender: string; counter: boolean; ranged: boolean; secondary: boolean; attackIndex: number; healthAfter: number }
interface TurnState { acted: boolean; waited: boolean; retaliated: number; defending: boolean }
const freshTurn = (): TurnState => ({ acted: false, waited: false, retaliated: 0, defending: false });

/** Pure battle controller. UI selection never grants permission to act. */
export class Battle {
  round = 1;
  activeId: string | null = null;
  winner: number | null = null;
  private lastTeam: number | null = null;
  private turns = new Map<string, TurnState>();
  private ammunition = new Map<string, number>();
  readonly units: Unit[];
  constructor(units: Unit[]) {
    this.units = units;
    if (new Set(units.map(u => u.id)).size !== units.length || units.some(u => u.hp <= 0 || !valid.has(key(u.cell)))) throw new Error('Invalid army');
    if (new Set(units.map(u => key(u.cell))).size !== units.length || units.some(u => obstacles.has(key(u.cell)))) throw new Error('Occupied deployment');
    if (![0, 1].every(team => units.some(u => u.team === team)) || units.some(u => ![0, 1].includes(u.team))) throw new Error('Both teams required');
    for (const u of units) { stats(u); this.turns.set(u.id, freshTurn()); this.ammunition.set(u.id, mechanism(u.kind, 'shooter')?.shots ?? 0); }
    this.regenerate(); this.advance();
  }
  get active(): Unit | undefined { return this.units.find(u => u.id === this.activeId); }
  canAct(id: string): boolean { return this.winner === null && this.activeId === id; }
  canWait(id: string): boolean { return this.canAct(id) && !this.turns.get(id)!.waited; }
  shots(id: string): number { return this.ammunition.get(id) ?? 0; }
  canShoot(id: string, targetId: string): boolean {
    const unit = this.units.find(u => u.id === id), target = this.units.find(u => u.id === targetId);
    return !!unit && !!target && this.canAct(id) && this.shots(id) > 0 && target.hp > 0 && target.team !== unit.team &&
      !this.units.some(other => other.hp > 0 && other.team !== unit.team && distance(unit.cell, other.cell) === 1);
  }
  private attacks(unit: Unit, mode: 'melee' | 'ranged'): number {
    const extra = mechanism(unit.kind, 'additionalAttacks');
    return 1 + (extra && ((extra.mode ?? 'melee') === mode || extra.mode === 'both') ? extra.count : 0);
  }
  shoot(id: string, targetId: string, random = Math.random): CombatBlow[] | null {
    if (!this.canShoot(id, targetId)) return null;
    const attacker = this.active!, defender = this.units.find(u => u.id === targetId)!;
    const blows: CombatBlow[] = [];
    for (let i = 0; i < this.attacks(attacker, 'ranged') && defender.hp > 0 && this.shots(id) > 0; i++) {
      // Determine the affected set before the primary blow can kill its target.
      const targets = [defender, ...(!mechanism(attacker.kind, 'deathCloud') ? [] : this.units.filter(u => u !== defender && u.hp > 0 && distance(u.cell, defender.cell) === 1 && !mechanism(u.kind, 'undead')))];
      this.ammunition.set(id, this.shots(id) - 1);
      for (const target of targets) {
        const result = dealDamage(attacker, target, random, this.defense(target), { ranged: true });
        blows.push({ ...result, attacker: id, defender: target.id, counter: false, ranged: true, secondary: target !== defender, attackIndex: i, healthAfter: target.hp });
      }
    }
    this.finish(attacker); return blows;
  }
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
      if (result) blows.push({ ...result, attacker: a.id, defender: d.id, counter, ranged: false, secondary: false, attackIndex: blows.filter(b => !b.counter).length, healthAfter: d.hp });
    };
    const state = this.turns.get(defender.id)!;
    const attacks = this.attacks(attacker, 'melee');
    for (let i = 0; i < attacks && attacker.hp > 0 && defender.hp > 0; i++) {
      blow(attacker, defender, false);
      if (i === 0 && attacker.hp > 0 && defender.hp > 0 && !mechanism(attacker.kind, 'blocksRetaliation') && state.retaliated < (mechanism(defender.kind, 'retaliations')?.count ?? 1)) {
        state.retaliated++; blow(defender, attacker, true);
      }
    }
    this.finish(attacker); return blows;
  }
}
