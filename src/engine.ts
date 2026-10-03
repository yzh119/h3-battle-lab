/** Authoritative engine data and transport. No combat mechanics. */
export interface NativeUnit {
  id: number; creature: string; label: string; side: number; controller: number; slot: number; hex: number;
  count: number; health: number; maxHealth: number; topHealth: number; shots: number;
  attack: number; defense: number; minDamage: number; maxDamage: number;
  speed: number; flying: boolean; footprint: number[];
}
export interface EngineState {
  revision: number; round: number; activeStack: number | null; winner?: number | null;
  heroes?: (NativeHero | null)[]; units: NativeUnit[]; obstacles: number[]; queue?: number[];
  legal?: { wait: boolean; defend: boolean; moves: { hex: number; path: number[] }[];
    shots: number[]; melee: { target: number; from: number }[] };
}
export interface EngineEvent {
  spell?: number; label?: string; side?: number; affected?: number[];
  type: string; before: EngineState; after: EngineState;
  stack?: number; path?: number[]; attacker?: number; ranged?: boolean; counter?: boolean;
  victims?: { id: number; damage: number; killed: number; secondary?: boolean }[];
}
export interface SpellDefinition { id: number; label: string; key: string; level: number }
export interface NativeHero { side: number; mana: number; maxMana: number; attack: number; defense: number; power: number; knowledge: number; spells: (SpellDefinition & { cost: number; castable: boolean })[] }
export interface HeroConfig { attack: number; defense: number; power: number; knowledge: number; mana?: number; skills: { id: number; level: number }[]; spells: number[] }
export type SpellTarget = { unit?: number; hex?: number }[];
export interface NativeCreature { id: number; key: string; label: string; health: number; speed: number; attack: number; defense: number; minDamage: number; maxDamage: number; shots: number; doubleWide: boolean }
export interface EngineResult { state: EngineState; events: EngineEvent[] }
export interface ArmyStack { creature: number; count: number; slot?: number; hex?: number }
export interface TownArmyPreset { weeks: number; profile: string; armies: { slot: number; base: number; upgraded: number; weekly: number; count: number }[][] }
export class EngineClient {
  private session?: string;
  async request<T>(op: string, data: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch('/api/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: this.session, request: { version: 1, op, ...data } }) });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('本地 VCMI 接口不可用；请使用配置了引擎的开发服务器。');
    const envelope = await response.json();
    if (!response.ok) throw new Error(envelope.error ?? 'VCMI connection failed');
    if (!envelope.response?.ok) throw new Error(envelope.response?.error ?? 'VCMI rejected request');
    this.session = envelope.session;
    return envelope.response.result as T;
  }
  connect() { this.session = undefined; return this.request<{ backend: string; battleAI?: string; spells: SpellDefinition[]; skills: { id: number; label: string }[]; tenWeekTownArmies: TownArmyPreset; creatures: NativeCreature[]; rulesProfile: string; customPacks: boolean; heroSpells: boolean }>('catalogue'); }
  deployment(seed: number, armies: ArmyStack[][], heroes?: (HeroConfig | null)[]) { return this.request<EngineResult>('deployment', { seed, armies, heroes }); }
  create(seed: number, armies: ArmyStack[][], heroes?: (HeroConfig | null)[]) { return this.request<EngineResult>('create', { seed, armies, heroes }); }
  act(state: EngineState, action: string, options: Record<string, unknown> = {}) {
    return this.request<EngineResult>('act', { revision: state.revision, stack: state.activeStack, action, ...options });
  }
  spellTargets(state: EngineState, spell: number) { return this.request<{ targets: SpellTarget[] }>('spellTargets', { revision: state.revision, stack: state.activeStack, spell }); }
  dispose() { return this.request('dispose'); }
}
