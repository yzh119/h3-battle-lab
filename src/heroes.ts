/** Hero configuration and spell target labels. Rules stay in the engine. */
import type { HeroConfig, SpellDefinition, NativeUnit, SpellTarget, NativeHero, NamedHeroCatalogue } from './engine.ts';

export function heroEditor(root: HTMLElement, spells: SpellDefinition[], skills: { id: number; label: string }[], changed: () => void, named?: NamedHeroCatalogue) {
  root.replaceChildren();
  for (const side of [0, 1]) {
    const group = document.createElement('fieldset'); group.className = 'hero-config';
    const legend = document.createElement('legend'); legend.textContent = side ? '红方英雄' : '蓝方英雄'; group.append(legend);
    const enabled = document.createElement('label'); enabled.className = 'switch'; enabled.textContent = '英雄参战';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.id = `hero-enabled-${side}`; enabled.append(toggle); group.append(enabled);
    if (named) {
      const label = document.createElement('label'); label.textContent = '原版英雄';
      const picker = document.createElement('select'); picker.id = `hero-type-${side}`; picker.setAttribute('aria-label', `${side ? '红' : '蓝'}方英雄类型`);
      picker.add(new Option('自定义英雄 · 无特长', ''));
      for (const faction of ['Castle', 'Necropolis']) {
        const options = document.createElement('optgroup'); options.label = faction === 'Castle' ? '城堡' : '墓园';
        named.heroes.filter(hero => hero.faction === faction).forEach(hero => options.append(new Option(`${hero.label} · ${hero.class}`, String(hero.id)))); picker.append(options);
      }
      label.append(picker); group.append(label);
      const detail = document.createElement('p'); detail.id = `hero-specialty-${side}`; detail.textContent = '自定义英雄没有特长。'; group.append(detail);
      const levelLabel = document.createElement('label'); levelLabel.textContent = '英雄等级';
      const level = document.createElement('input'); level.type = 'number'; level.min = '1'; level.max = String(named.maxLevel); level.step = '1'; level.value = '1'; level.id = `hero-level-${side}`; levelLabel.append(level); group.append(levelLabel);
      const overrideLabel = document.createElement('label'); overrideLabel.className = 'switch'; overrideLabel.textContent = '自定义属性、技能与魔法';
      const override = document.createElement('input'); override.type = 'checkbox'; override.id = `hero-override-${side}`; overrideLabel.append(override); group.append(overrideLabel);
      picker.addEventListener('change', () => {
        override.checked = false;
        const selected = named.heroes.find(hero => String(hero.id) === picker.value);
        detail.textContent = selected ? `${selected.specialty} · ${selected.description.replace(/[{}]/g, '')}` : '自定义英雄没有特长。';
      });
      const preview = document.createElement('p'); preview.id = `hero-preview-${side}`; group.append(preview);
    }
    for (const [field, label, value] of [['attack', '攻击', 2], ['defense', '防御', 2], ['power', '法强', 3], ['knowledge', '知识', 10]] as const) {
      const row = document.createElement('label'); row.textContent = label;
      const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '99'; input.step = '1'; input.value = String(value); input.id = `hero-${field}-${side}`; row.append(input); group.append(row);
    }
    const skillLabel = document.createElement('p'); skillLabel.textContent = '次级技能 · 最多八项'; group.append(skillLabel);
    for (let slot = 0; slot < 8; slot++) {
      const row = document.createElement('div'); row.className = 'button-row';
      const skill = document.createElement('select'); skill.id = `hero-skill-${side}-${slot}`; skill.setAttribute('aria-label', `${side ? '红' : '蓝'}方第 ${slot + 1} 项技能`);
      skill.add(new Option('无技能', '')); skills.forEach(s => skill.add(new Option(s.label, String(s.id))));
      const level = document.createElement('select'); level.id = `hero-skill-level-${side}-${slot}`; level.setAttribute('aria-label', `${side ? '红' : '蓝'}方第 ${slot + 1} 项技能等级`);
      ['初级', '中级', '高级'].forEach((name, i) => level.add(new Option(name, String(i + 1)))); row.append(skill, level); group.append(row);
    }
    const label = document.createElement('label'); label.textContent = '已学魔法（可多选）';
    const learned = document.createElement('select'); learned.id = `hero-spells-${side}`; learned.multiple = true; learned.size = 6;
    spells.forEach(spell => { const option = new Option(`${spell.label} · ${spell.level} 级`, String(spell.id)); option.selected = spell.id === 15; learned.add(option); });
    label.append(learned); group.append(label);
    const all = document.createElement('button'); all.type = 'button'; all.textContent = '选择全部战斗魔法'; all.onclick = () => { [...learned.options].forEach(option => option.selected = true); changed(); }; group.append(all);
    group.onchange = changed; root.append(group);
  }
}
export function readHeroes(): (HeroConfig | null)[] {
  return [0, 1].map(side => {
    if (!document.querySelector<HTMLInputElement>(`#hero-enabled-${side}`)?.checked) return null;
    const type = document.querySelector<HTMLSelectElement>(`#hero-type-${side}`)?.value;
    const config: HeroConfig = {};
    if (type) {
      const level = document.querySelector<HTMLInputElement>(`#hero-level-${side}`)!;
      if (!Number.isInteger(level.valueAsNumber) || level.valueAsNumber < 1 || level.valueAsNumber > Number(level.max)) throw new Error(`英雄等级须为 1–${level.max} 的整数。`);
      config.type = Number(type); config.level = level.valueAsNumber;
      if (!document.querySelector<HTMLInputElement>(`#hero-override-${side}`)!.checked) return config;
    }
    config.skills = []; config.spells = [];
    for (const field of ['attack', 'defense', 'power', 'knowledge'] as const) {
      const value = Number(document.querySelector<HTMLInputElement>(`#hero-${field}-${side}`)!.value);
      if (!Number.isInteger(value) || value < 0 || value > 99) throw new Error('英雄属性须为 0–99 的整数。');
      config[field] = value;
    }
    for (let slot = 0; slot < 8; slot++) {
      const value = document.querySelector<HTMLSelectElement>(`#hero-skill-${side}-${slot}`)!.value;
      if (value !== '') config.skills.push({ id: Number(value), level: Number(document.querySelector<HTMLSelectElement>(`#hero-skill-level-${side}-${slot}`)!.value) });
    }
    if (new Set(config.skills.map(s => s.id)).size !== config.skills.length) throw new Error('同一英雄不能重复配置次级技能。');
    config.spells = [...document.querySelector<HTMLSelectElement>(`#hero-spells-${side}`)!.selectedOptions].map(option => Number(option.value));
    return config;
  });
}
export function spellTargetLabel(target: SpellTarget, units: NativeUnit[]) {
  return target.length ? target.map(destination => {
    if (destination.unit !== undefined) { const unit = units.find(u => u.id === destination.unit); return unit ? `${unit.side ? '红' : '蓝'}方 ${unit.label} ×${unit.count}` : `单位 ${destination.unit}`; }
    return `格子 ${destination.hex}`;
  }).join(' → ') : '全场／无指定目标';
}


export function setHeroEditorDisabled(locked: boolean, pending = false) {
  for (const side of [0, 1]) {
    const type = document.querySelector<HTMLSelectElement>(`#hero-type-${side}`)?.value;
    const overriding = document.querySelector<HTMLInputElement>(`#hero-override-${side}`)?.checked;
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(`#hero-configs fieldset:nth-child(${side + 1}) input, #hero-configs fieldset:nth-child(${side + 1}) select, #hero-configs fieldset:nth-child(${side + 1}) button`).forEach(input => {
      const presetControl = ['enabled', 'type', 'level', 'override'].some(field => input.id === `hero-${field}-${side}`);
      input.disabled = locked || (!presetControl && !!type && !overriding) || ((input.id === `hero-level-${side}` || input.id === `hero-override-${side}`) && !type) || (input.id === `hero-override-${side}` && pending);
    });
  }
}
export function showHeroPreview(heroes?: (NativeHero | null)[]) {
  for (const side of [0, 1]) {
    const hero = heroes?.[side], preview = document.querySelector<HTMLElement>(`#hero-preview-${side}`);
    if (preview) preview.textContent = hero ? `${hero.label} · ${hero.level} 级 · 魔力 ${hero.mana}/${hero.maxMana}` : '英雄未参战';
    if (!hero || !document.querySelector<HTMLSelectElement>(`#hero-type-${side}`)?.value || document.querySelector<HTMLInputElement>(`#hero-override-${side}`)!.checked) continue;
    for (const field of ['attack', 'defense', 'power', 'knowledge'] as const) document.querySelector<HTMLInputElement>(`#hero-${field}-${side}`)!.value = String(hero[field]);
    for (let slot = 0; slot < 8; ++slot) {
      const skill = hero.skills?.[slot];
      document.querySelector<HTMLSelectElement>(`#hero-skill-${side}-${slot}`)!.value = skill ? String(skill.id) : '';
      document.querySelector<HTMLSelectElement>(`#hero-skill-level-${side}-${slot}`)!.value = String(skill?.level ?? 1);
    }
    const learned = new Set(hero.spells.map(spell => spell.id));
    [...document.querySelector<HTMLSelectElement>(`#hero-spells-${side}`)!.options].forEach(option => option.selected = learned.has(Number(option.value)));
  }
}
