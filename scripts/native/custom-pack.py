"""Validate an authoring pack and prepare an isolated standard VCMI mod profile."""
import argparse
import json
import re
import shutil
from pathlib import Path

MOD = 'battle-lab-custom'
MECHANISMS = ['flying', 'additionalAttacks', 'regeneration', 'retaliations', 'blocksRetaliation', 'attacksAllAdjacent', 'shooter', 'undead', 'deathCloud']
RESERVED = {'pikeman', 'halberdier', 'archer', 'marksman', 'griffin', 'royal-griffin', 'swordsman', 'crusader', 'monk', 'zealot', 'cavalier', 'champion', 'angel', 'archangel', 'skeleton', 'skeleton-warrior', 'zombie', 'zombie-upgraded', 'wight', 'wraith', 'vampire', 'vampire-lord', 'lich', 'power-lich', 'black-knight', 'dread-knight', 'bone-dragon', 'ghost-dragon'}


def fields(value, allowed, path):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(f'{path}: expected object with supported fields')


def integer(value, low, high, path):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{path}: expected integer {low}–{high}')


def convert(pack):
    fields(pack, ['version', 'creatures'], 'pack')
    if type(pack.get('version')) is not int or pack['version'] != 1 or not isinstance(pack.get('creatures'), list) or not 1 <= len(pack['creatures']) <= 256:
        raise ValueError('pack: expected version 1 and 1–256 creatures')
    result = {}
    for i, creature in enumerate(pack['creatures']):
        path = f'creatures[{i}]'
        fields(creature, ['id', 'label', 'faction', 'ruleset', 'stats', 'mechanisms', 'doubleWide'], path)
        identifier = creature.get('id')
        if not isinstance(identifier, str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,63}', identifier) or identifier in RESERVED or identifier in result:
            raise ValueError(f'{path}.id: invalid, reserved or duplicate')
        for name in ['label', 'faction']:
            value = creature.get(name)
            if not isinstance(value, str) or not value.strip() or len(value) > 80:
                raise ValueError(f'{path}.{name}: expected 1–80 characters')
        if creature.get('ruleset') != 'custom':
            raise ValueError(f'{path}.ruleset: custom required')
        if 'doubleWide' in creature and type(creature['doubleWide']) is not bool:
            raise ValueError(path + '.doubleWide: expected boolean')
        stats = creature.get('stats')
        fields(stats, ['health', 'attack', 'defense', 'minDamage', 'maxDamage', 'speed', 'aiValue'], path + '.stats')
        for name in ['health', 'minDamage', 'maxDamage']:
            integer(stats.get(name), 1, 100000, path + '.stats.' + name)
        for name in ['attack', 'defense']:
            integer(stats.get(name), 0, 1000, path + '.stats.' + name)
        integer(stats.get('speed'), 1, 50, path + '.stats.speed')
        integer(stats.get('aiValue', 100), 1, 1000000, path + '.stats.aiValue')
        if stats['minDamage'] > stats['maxDamage']:
            raise ValueError(path + '.stats: minDamage exceeds maxDamage')
        mechanisms = creature.get('mechanisms')
        if not isinstance(mechanisms, list) or len(mechanisms) > 8:
            raise ValueError(path + '.mechanisms: expected at most eight mechanisms')
        abilities, seen, shots = {}, set(), None
        for j, mechanism in enumerate(mechanisms):
            mp = f'{path}.mechanisms[{j}]'
            if not isinstance(mechanism, dict): raise ValueError(mp + ': expected object')
            kind = mechanism.get('type')
            if kind not in MECHANISMS or kind in seen: raise ValueError(mp + ': unknown or duplicate mechanism')
            seen.add(kind)
            if kind in ['flying', 'blocksRetaliation', 'attacksAllAdjacent', 'undead', 'deathCloud']:
                fields(mechanism, ['type'], mp)
                abilities[kind] = {'type': {'attacksAllAdjacent': 'ATTACKS_ALL_ADJACENT', 'flying': 'FLYING', 'blocksRetaliation': 'BLOCKS_RETALIATION', 'undead': 'UNDEAD', 'deathCloud': 'SPELL_LIKE_ATTACK'}[kind]}
                if kind == 'deathCloud': abilities[kind]['subtype'] = 'core:deathCloud'
            elif kind == 'additionalAttacks':
                fields(mechanism, ['type', 'count', 'mode'], mp); integer(mechanism.get('count'), 1, 4, mp + '.count')
                mode = mechanism.get('mode', 'melee')
                if mode not in ['melee', 'ranged', 'both']: raise ValueError(mp + '.mode: invalid mode')
                abilities[kind] = {'type': 'ADDITIONAL_ATTACK', 'val': mechanism['count']}
                if mode != 'both': abilities[kind]['effectRange'] = 'ONLY_MELEE_FIGHT' if mode == 'melee' else 'ONLY_DISTANCE_FIGHT'
            elif kind == 'regeneration':
                fields(mechanism, ['type', 'health'], mp); integer(mechanism.get('health'), 1, 100000, mp + '.health')
                abilities[kind] = {'type': 'HP_REGENERATION', 'val': mechanism['health']}
            elif kind == 'retaliations':
                fields(mechanism, ['type', 'count'], mp); integer(mechanism.get('count'), 0, 100, mp + '.count')
                abilities[kind] = {'type': 'NO_RETALIATION'} if mechanism['count'] == 0 else {'type': 'ADDITIONAL_RETALIATION', 'val': mechanism['count'] - 1}
            elif kind == 'shooter':
                fields(mechanism, ['type', 'shots', 'noMeleePenalty', 'noDistancePenalty'], mp); integer(mechanism.get('shots'), 1, 1000, mp + '.shots')
                shots = mechanism['shots']; abilities[kind] = {'type': 'SHOOTER'}
                for flag, bonus in [('noMeleePenalty', 'NO_MELEE_PENALTY'), ('noDistancePenalty', 'NO_DISTANCE_PENALTY')]:
                    if flag in mechanism and type(mechanism[flag]) is not bool: raise ValueError(mp + '.' + flag + ': expected boolean')
                    if mechanism.get(flag): abilities[flag] = {'type': bonus}
        if ('deathCloud' in seen or any(m['type'] == 'additionalAttacks' and m.get('mode') == 'ranged' for m in mechanisms)) and 'shooter' not in seen:
            raise ValueError(path + '.mechanisms: ranged mechanisms require shooter')
        value = {'name': {'singular': creature['label'], 'plural': creature['label']}, 'faction': 'core:neutral', 'level': 1,
                 'doubleWide': creature.get('doubleWide', False), 'special': True, 'excludeFromRandomization': True, 'cost': {}, 'growth': 0, 'fightValue': stats.get('aiValue', 100), 'aiValue': stats.get('aiValue', 100),
                 'hitPoints': stats['health'], 'attack': stats['attack'], 'defense': stats['defense'], 'speed': stats['speed'],
                 'damage': {'min': stats['minDamage'], 'max': stats['maxDamage']}, 'abilities': abilities,
                 'graphics': {'animation': 'CPKMAN.DEF'}, 'sound': {}}
        if shots is not None: value['shots'] = shots
        result[identifier] = value
    return result


def prepare(base, output, pack):
    definitions = convert(pack)  # Entire pack validated before any filesystem change.
    base, output = Path(base).resolve(), Path(output).absolute()
    marker = json.loads((base / '.battle-lab-profile').read_text())
    if marker.get('allowedMods') not in (['vcmi'], ['core', 'vcmi']): raise ValueError('A base-only prepared profile is required')
    if output.exists(): raise ValueError('Destination exists; use a new profile')
    output.mkdir(parents=True)
    try:
        data = output / 'data'; data.mkdir()
        for name in ['config', 'scripts', 'Data']:
            (data / name).symlink_to(base / 'data' / name, target_is_directory=True)
        mods = data / 'Mods'; mods.mkdir(); (mods / 'vcmi').symlink_to(base / 'data/Mods/vcmi', target_is_directory=True)
        mod = mods / MOD; (mod / 'Content/config').mkdir(parents=True)
        (mod / 'mod.json').write_text(json.dumps({'name': 'Battle Lab custom creatures', 'version': '1.0.0', 'modType': 'Creatures', 'creatures': ['config/creatures.json']}) + '\n')
        (mod / 'Content/config/creatures.json').write_text(json.dumps(definitions, ensure_ascii=False) + '\n')
        (output / '.battle-lab-profile').write_text(json.dumps({**marker, 'rulesProfile': 'custom-reference', 'allowedMods': ['core', 'vcmi', MOD]}) + '\n')
        (output / '.battle-lab-custom').write_text(json.dumps(pack, ensure_ascii=False) + '\n')
        config = output / 'user/config'; config.mkdir(parents=True)
        (config / 'modSettings.json').write_text(json.dumps({'activePreset': 'default', 'presets': {'default': {'mods': ['vcmi', MOD], 'settings': {}}}}) + '\n')
    except BaseException:
        shutil.rmtree(output); raise
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True); parser.add_argument('--out', required=True); parser.add_argument('--pack', required=True)
    args = parser.parse_args()
    raw = Path(args.pack).read_bytes()
    if len(raw) > 1024 * 1024: raise ValueError('Pack exceeds 1 MB')
    prepare(args.base, args.out, json.loads(raw))
    print('Prepared isolated custom-reference profile.')
