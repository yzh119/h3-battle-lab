/** Hero configuration and spell target labels. Rules stay in the engine. */
import type { HeroConfig, SpellDefinition, NativeUnit, SpellTarget } from './engine.ts';

export function heroEditor(root: HTMLElement, spells: SpellDefinition[], skills: { id: number; label: string }[], changed: () => void) {
  root.replaceChildren();
  for (const side of [0, 1]) {
    const group = document.createElement('fieldset'); group.className = 'hero-config';
    const legend = document.createElement('legend'); legend.textContent = side ? '红方英雄' : '蓝方英雄'; group.append(legend);
    const enabled = document.createElement('label'); enabled.className = 'switch'; enabled.textContent = '英雄参战';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.id = `hero-enabled-${side}`; enabled.append(toggle); group.append(enabled);
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
    const config: HeroConfig = { attack: 0, defense: 0, power: 0, knowledge: 0, skills: [], spells: [] };
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
