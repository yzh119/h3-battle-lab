import { creatureArt } from './presentation.ts';
/** Versioned creature data. No renderer, local mod settings, or executable scripts. */
export interface CreatureStats { health: number; attack: number; defense: number; minDamage: number; maxDamage: number; speed: number; aiValue?: number }
export type Mechanism =
  | { type: 'flying' }
  | { type: 'additionalAttacks'; count: number; mode?: 'melee' | 'ranged' | 'both' }
  | { type: 'regeneration'; health: number }
  | { type: 'retaliations'; count: number }
  | { type: 'blocksRetaliation' }
  | { type: 'shooter'; shots: number; noMeleePenalty?: boolean; noDistancePenalty?: boolean }
  | { type: 'undead' }
  | { type: 'deathCloud' };
export interface CreatureDefinition {
  id: string; label: string; faction: string; ruleset: 'h3-base' | 'custom';
  stats: CreatureStats; mechanisms: Mechanism[];
}
export interface CreaturePack { version: 1; creatures: CreatureDefinition[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function fields(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key}: unsupported field`);
}
function integer(value: unknown, min: number, max: number, path: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${path}: expected integer ${min}–${max}`);
}
export function parseCreaturePack(value: unknown): CreaturePack {
  if (!object(value)) throw new Error('pack: expected object');
  fields(value, ['version', 'creatures'], 'pack');
  if (value.version !== 1 || !Array.isArray(value.creatures) || !value.creatures.length || value.creatures.length > 256) throw new Error('pack: expected version 1 and 1–256 creatures');
  const ids = new Set<string>();
  for (const [i, entry] of value.creatures.entries()) {
    const path = `creatures[${i}]`;
    if (!object(entry)) throw new Error(`${path}: expected object`);
    fields(entry, ['id', 'label', 'faction', 'ruleset', 'stats', 'mechanisms'], path);
    if (typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(entry.id) || ids.has(entry.id)) throw new Error(`${path}.id: invalid or duplicate`);
    ids.add(entry.id);
    for (const field of ['label', 'faction']) if (typeof entry[field] !== 'string' || !(entry[field] as string).trim() || (entry[field] as string).length > 80) throw new Error(`${path}.${field}: expected 1–80 characters`);
    if (entry.ruleset !== 'custom') throw new Error(`${path}.ruleset: imported creatures must declare custom`);
    if (!object(entry.stats)) throw new Error(`${path}.stats: expected object`);
    fields(entry.stats, ['health', 'attack', 'defense', 'minDamage', 'maxDamage', 'speed', 'aiValue'], `${path}.stats`);
    for (const field of ['health', 'minDamage', 'maxDamage']) integer(entry.stats[field], 1, 100000, `${path}.stats.${field}`);
    for (const field of ['attack', 'defense']) integer(entry.stats[field], 0, 1000, `${path}.stats.${field}`);
    integer(entry.stats.speed, 1, 50, `${path}.stats.speed`);
    if (entry.stats.aiValue !== undefined) integer(entry.stats.aiValue, 1, 1000000, `${path}.stats.aiValue`);
    if ((entry.stats.minDamage as number) > (entry.stats.maxDamage as number)) throw new Error(`${path}.stats: minDamage exceeds maxDamage`);
    if (!Array.isArray(entry.mechanisms) || entry.mechanisms.length > 8) throw new Error(`${path}.mechanisms: expected array`);
    const types = new Set<string>();
    for (const [j, mechanism] of entry.mechanisms.entries()) {
      const mp = `${path}.mechanisms[${j}]`;
      if (!object(mechanism) || typeof mechanism.type !== 'string' || types.has(mechanism.type)) throw new Error(`${mp}: invalid or duplicate mechanism`);
      types.add(mechanism.type);
      switch (mechanism.type) {
        case 'flying': case 'blocksRetaliation': case 'undead': case 'deathCloud': fields(mechanism, ['type'], mp); break;
        case 'additionalAttacks':
          fields(mechanism, ['type', 'count', 'mode'], mp); integer(mechanism.count, 1, 4, `${mp}.count`);
          if (mechanism.mode !== undefined && !['melee', 'ranged', 'both'].includes(String(mechanism.mode))) throw new Error(`${mp}.mode: expected melee, ranged or both`);
          break;
        case 'shooter':
          fields(mechanism, ['type', 'shots', 'noMeleePenalty', 'noDistancePenalty'], mp); integer(mechanism.shots, 1, 1000, `${mp}.shots`);
          for (const flag of ['noMeleePenalty', 'noDistancePenalty']) if (mechanism[flag] !== undefined && typeof mechanism[flag] !== 'boolean') throw new Error(`${mp}.${flag}: expected boolean`);
          break;
        case 'retaliations': fields(mechanism, ['type', 'count'], mp); integer(mechanism.count, 0, 100, `${mp}.count`); break;
        case 'regeneration': fields(mechanism, ['type', 'health'], mp); integer(mechanism.health, 1, 100000, `${mp}.health`); break;
        default: throw new Error(`${mp}.type: unsupported mechanism ${mechanism.type}`);
      }
    }
    if ((types.has('deathCloud') || entry.mechanisms.some((m: any) => m.type === 'additionalAttacks' && m.mode === 'ranged')) && !types.has('shooter')) throw new Error(`${path}.mechanisms: ranged mechanisms require shooter`);
  }
  return structuredClone(value) as unknown as CreaturePack;
}
function freezeDefinition(def: CreatureDefinition): CreatureDefinition {
  Object.freeze(def.stats); def.mechanisms.forEach(Object.freeze); Object.freeze(def.mechanisms); return Object.freeze(def);
}
const definitions = new Map<string, CreatureDefinition>();
const reserved = new Set(creatureArt.map(c => c.art));
export const creatureDefinitions = () => [...definitions.values()];
export function creatureDefinition(id: string): CreatureDefinition {
  const def = definitions.get(id); if (!def) throw new Error(`No creature definition for ${id}`); return def;
}
/** Authoring registry only. Importing does not activate engine mechanisms. */
export function registerCreaturePack(value: unknown): CreaturePack {
  const pack = parseCreaturePack(value);
  for (const def of pack.creatures) if (reserved.has(def.id) || definitions.has(def.id)) throw new Error(`${def.id}: creature ID already registered; use a new ID`);
  for (const def of pack.creatures) definitions.set(def.id, freezeDefinition(structuredClone(def)));
  return pack;
}
