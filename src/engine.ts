/** Authoritative engine data and transport. No combat mechanics. */
export interface NativeUnit {
  id: number; creature: string; side: number; slot: number; hex: number;
  count: number; health: number; maxHealth: number; topHealth: number; shots: number;
  speed: number; flying: boolean; footprint: number[];
}
export interface EngineState {
  revision: number; round: number; activeStack: number | null; winner?: number | null;
  units: NativeUnit[]; obstacles: number[]; queue?: number[];
  legal?: { wait: boolean; defend: boolean; moves: { hex: number; path: number[] }[];
    shots: number[]; melee: { target: number; from: number }[] };
}
export interface EngineEvent {
  type: string; before: EngineState; after: EngineState;
  stack?: number; path?: number[]; attacker?: number; ranged?: boolean; counter?: boolean;
  victims?: { id: number; damage: number; killed: number; secondary: boolean }[];
}
export interface NativeCreature { id: number; key: string; label: string; health: number; speed: number; doubleWide: boolean }
export interface EngineResult { state: EngineState; events: EngineEvent[] }
export interface ArmyStack { creature: number; count: number; hex?: number }
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
  connect() { this.session = undefined; return this.request<{ backend: string; creatures: NativeCreature[]; rulesProfile: string; customPacks: boolean; heroSpells: boolean }>('catalogue'); }
  create(seed: number, armies: ArmyStack[][]) { return this.request<EngineResult>('create', { seed, armies }); }
  act(state: EngineState, action: string, options: Record<string, number> = {}) {
    return this.request<EngineResult>('act', { revision: state.revision, stack: state.activeStack, action, ...options });
  }
  dispose() { return this.request('dispose'); }
}
