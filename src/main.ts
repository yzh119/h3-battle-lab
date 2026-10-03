import * as THREE from 'three';
import './style.css';
import { EngineClient, type EngineState, type EngineEvent, type NativeUnit, type TownArmyPreset, type NativeCreature } from './engine.ts';
import { creatureArt, cellAt, key, fromHexId, toHexId, type Hex, type VisualUnit } from './presentation.ts';
import { heroEditor, readHeroes, spellTargetLabel } from './heroes.ts';
import type { SpellTarget } from './engine.ts';
import { registerCreaturePack } from './creatures.ts';
import { createWorld, worldPosition } from './world.ts';
import { UnitView, type Manifest } from './units.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="battle" aria-label="可旋转的三维六角格战场"></canvas>
  <div id="unit-tooltip" role="tooltip" hidden></div><div id="stack-labels" aria-label="场上兵力"></div><header><a class="brand" href="https://github.com/yzh119/h3-battle-lab" target="_blank" rel="noreferrer">H3 <span>BATTLE LAB</span></a><div class="top-label">战场实验室 <span>01 / 林地</span></div><div class="live"><i></i> 实时 3D</div></header>
  <aside class="panel"><div class="eyebrow">战场视角</div><h1>走进战场。</h1><p class="intro">换一个角度，看清每一次交锋。</p><select id="unit-picker" aria-label="选择场上单位"><option value="azure">骷髅兵</option><option value="ember">僵尸</option></select>
  <button id="connect-engine">连接引擎</button><p id="engine-status" role="status">正在连接本地引擎…</p><button id="ten-week-armies" disabled>十周城镇产出</button><label class="switch"><span>使用升级兵种</span><input id="preset-upgraded" type="checkbox" checked></label><p class="preset-note">蓝方城堡 · 红方墓园<br>完整城镇，不含圣杯及额外奖励</p><button id="start-battle" disabled>开始对战</button><p id="turn-status" role="status">配置阵容后开始对战</p><div class="button-row"><button id="wait-turn" disabled>等待</button><button id="defend-turn" disabled>防御</button></div><label class="switch"><span>蓝方 VCMI AI</span><input id="ai-blue" type="checkbox"></label><label class="switch"><span>红方 VCMI AI</span><input id="ai-red" type="checkbox"></label><button id="ai-step" disabled>VCMI AI 行动一次</button><p id="turn-queue"></p><label class="switch"><span>射手强制近战</span><input id="force-melee" type="checkbox"></label>
  <details id="army-editor" open><summary>配置双方阵容</summary><p id="selected-slot-label"></p><label for="creature-picker">兵种</label><select id="creature-picker" aria-label="选择上场兵种"></select><label for="team-picker">阵营</label><select id="team-picker" aria-label="选择上场阵营"><option value="0">蓝方</option><option value="1">红方</option></select><label for="stack-count">每队数量</label><input id="stack-count" aria-label="每队数量" type="number" min="1" max="99999" step="1" value="20"><button id="assign-slot">配置选中格子</button><button id="apply-count" class="quiet">应用数量到选中队伍</button><p id="creature-note"></p><div class="button-row"><button id="add-unit">添加上场</button><button id="replace-unit">替换选中</button></div><button id="remove-unit" class="quiet">移除选中单位</button><p>每方最多 7 队 · 双方均可操控<br>点击队伍格配置兵种与数量；空格也可直接选择</p></details><details id="hero-editor"><summary>英雄与魔法</summary><p>自定义英雄 · 无特长和宝物<br>属性、技能与魔法效果由引擎处理</p><div id="hero-configs"></div></details><details id="spellbook"><summary>战斗魔法</summary><p id="hero-status">英雄参战后可施法</p><select id="spell-picker" aria-label="选择战斗魔法" disabled></select><select id="spell-target" aria-label="选择施法目标" disabled></select><button id="cast-spell" disabled>施放魔法</button><p id="spell-status" role="status"></p></details><details><summary>自定义兵种</summary><p>验证版本 1 的兵种 JSON。引擎端导入正在开发，通过格式验证的定义暂不能加入对战。</p><input id="creature-import" aria-label="导入自定义兵种 JSON" type="file" accept=".json,application/json"><p id="creature-import-status" role="status"></p></details><div class="section-label">镜头</div><div class="button-row"><button id="overview" class="active">全局</button><button id="closeup">兵种特写</button></div>
  <div class="button-row zoom-controls"><button id="zoom-out" aria-label="缩小战场">− 缩小</button><button id="zoom-in" aria-label="放大战场">＋ 放大</button></div><div class="section-label">场景</div><select id="background-picker" aria-label="战场背景"><option value="">自由 3D 场景</option></select><p id="scene-hint" class="intro">拖动旋转镜头</p><div class="section-label">环境</div><div class="button-row"><button id="day" class="active">暖阳</button><button id="dusk">阴天</button></div>
  <label class="switch"><span>显示六角格</span><input id="grid" type="checkbox" checked></label>
  <label class="switch"><span>实时阴影</span><input id="shadows" type="checkbox" checked></label>
  <label class="range"><span>画面精细度 <b id="quality-label">高</b></span><input id="quality" aria-label="画面精细度" type="range" min="1" max="2" step=".5" value="2"></label>
  <div class="divider"></div><p class="rules-note">目标：原版 H3 基础战斗 · 一致性待验证<br>兵种行动与结果由 VCMI 计算；英雄特长、宝物和完整规则验证仍在开发。</p><div id="combat-log" role="log" aria-label="战斗记录"></div><div class="section-label">动作预览</div><div class="actions"><button data-action="idle">待机</button><button data-action="walk">行走</button><button data-action="attack">攻击</button><button data-action="hit">受击</button></div>
  <button id="reset" class="quiet">重置战场 ↺</button><details><summary>载入本地模型</summary><p>选择内嵌贴图的 GLB，替换当前选中的单位。</p><input id="import" aria-label="载入本地 GLB 模型" type="file" accept=".glb"></details>
  </aside><div id="army-slots" aria-label="双方七格阵容"></div>
  <div class="loading" id="loading"><span class="spinner"></span>正在准备战场</div>
  <div id="toast" role="status" aria-live="polite"></div>
  <footer><div class="selected"><span class="team-dot"></span><div><small>当前兵种</small><strong id="unit-name">骷髅兵</strong></div><span id="hp">100 / 100</span></div><div class="controls-hint">点击兵种选择 · 点击地面移动 · 点击敌军接近并攻击<br><span>拖动旋转 · 滚轮缩放 · 右键平移</span></div><div class="prototype">战场原型 <span id="asset-status">基础场景</span><small id="fps">—</small></div></footer>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#battle'), world = createWorld(canvas), clock = new THREE.Timer();
const engine = new EngineClient();
let connected = false, busy = false, state: EngineState | undefined, manifest: Manifest | undefined, generation = 0, nextId = 1, projectiles = 0;
let views: UnitView[] = [], selected: UnitView, lastEditorSelection: UnitView | undefined;
let editorTeam = 0, editorSlot = 0;
let townPreset: TownArmyPreset | undefined;
let spellTargets: SpellTarget[] = [], spellRequest = 0, spellKey = '';
let heroesAvailable = false, aiAvailable = false, aiTimer: ReturnType<typeof setTimeout> | undefined;
let deploying = false, deploymentRequest = 0;
const configured = () => views.map(v => ({ ...v.unit, cell: { ...v.unit.cell } }));
let startingArmy: VisualUnit[] = [];
const nativeCreatures = new Map<string, NativeCreature>();
const nativeUnits = new Map<string, NativeUnit>();
const slotViews = new Map<string, UnitView>();
const badges = new Map<string, HTMLDivElement>();
function message(text: string) { $('#toast').textContent = text; $('#toast').classList.add('show'); }
const metadata = (kind: string) => creatureArt.find(c => c.art === kind)!;
function preview(kind: string, team: number, count: number, id = `unit-${nextId++}`, cell = cellAt(team ? 11 : 5, 5), armySlot = 0): VisualUnit {
  return { id, kind, label: metadata(kind).label, team, armySlot, cell, initialCount: count, hp: 1 };
}
function attach(unit: VisualUnit) {
  const view = new UnitView(unit); world.scene.add(view.root); views.push(view);
  const badge = document.createElement('div'); badge.className = 'stack-badge'; badge.style.borderColor = unit.team ? '#cf8e7b' : '#7babc9'; $('#stack-labels').append(badge); badges.set(unit.id, badge);
  return view;
}
attach(preview('skeleton', 0, 20, 'azure')); attach(preview('zombie', 1, 20, 'ember')); selected = views[0];
const controller = (unit?: NativeUnit) => unit?.controller ?? unit?.side;
function count(view: UnitView) { return nativeUnits.get(view.unit.id)?.count ?? view.unit.initialCount; }
function updateSelection(view = selected) {
  selected = view;
  $('#unit-picker').replaceChildren(...views.map(v => new Option(`${v.unit.team ? '红方' : '蓝方'} · ${v.unit.label} ×${count(v)}`, v.unit.id)));
  $<HTMLSelectElement>('#unit-picker').value = view.unit.id; $('#unit-name').textContent = view.unit.label;
  const native = nativeUnits.get(view.unit.id);
  $('#hp').textContent = native ? `${native.count} 只 · 末只 ${native.topHealth}/${native.maxHealth} HP · 弹药 ${native.shots}` : `${view.unit.initialCount} 只 · 配置中`;
  $('#asset-status').textContent = `${views.filter(v => v.imported).length} / ${views.length} 个本地模型`;
  if (lastEditorSelection !== view) { $<HTMLInputElement>('#stack-count').value = String(view.unit.initialCount); lastEditorSelection = view; }
  for (const id of ['#creature-picker', '#team-picker', '#stack-count', '#apply-count', '#add-unit', '#replace-unit', '#remove-unit', '#creature-import', '#assign-slot'])
    ($<HTMLInputElement>(id)).disabled = busy || !!state;
  $<HTMLButtonElement>('#ten-week-armies').disabled = busy || !!state || !townPreset;
  $<HTMLInputElement>('#preset-upgraded').disabled = busy || !!state;
  $<HTMLButtonElement>('#reset').disabled = busy;
  $<HTMLButtonElement>('#connect-engine').disabled = busy || !!state;
  $<HTMLButtonElement>('#start-battle').disabled = busy || deploying || !connected || !!state;
  $<HTMLButtonElement>('#wait-turn').disabled = busy || !state?.legal?.wait;
  $<HTMLButtonElement>('#defend-turn').disabled = busy || !state?.legal?.defend;
  const occupiedSlot = views.some(v => v.unit.team === editorTeam && v.unit.armySlot === editorSlot);
  for (const id of ['#apply-count', '#replace-unit', '#remove-unit']) $<HTMLButtonElement>(id).disabled = busy || !!state || !occupiedSlot;
  $<HTMLButtonElement>('#ai-step').disabled = busy || !aiAvailable || !state || state.winner != null;
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('#hero-configs input, #hero-configs select, #hero-configs button').forEach(input => input.disabled = busy || !!state || !heroesAvailable);
  refreshSpellbook();
  renderArmySlots();
  scheduleAI();
  const active = views.find(v => nativeUnits.get(v.unit.id)?.id === state?.activeStack);
  $('#turn-status').textContent = state ? state.winner != null ? `${state.winner === 0 ? '蓝方' : state.winner === 1 ? '红方' : '双方'}${state.winner > 1 ? '平局' : '胜利'} · 第 ${state.round} 回合` : `第 ${state.round} 回合 · ${controller(nativeUnits.get(active?.unit.id ?? '')) ? '红方' : '蓝方'} ${active?.unit.label ?? ''}行动` : '配置阵容后开始对战';
  $('#turn-queue').textContent = (state?.queue ?? []).map(id => [...nativeUnits.values()].find(u => u.id === id)).map(u => u ? creatureArt.find(c => c.key === u.creature)?.label : '').join(' → ');
}
function renderArmySlots() {
  const root = $('#army-slots'); root.replaceChildren();
  for (const team of [0, 1]) {
    const group = document.createElement('div'); group.className = 'army-slot-group';
    const title = document.createElement('p'); title.textContent = team ? '红方 · 七队' : '蓝方 · 七队'; group.append(title);
    const row = document.createElement('div'); row.className = 'army-slot-row';
    for (let slot = 0; slot < 7; slot++) {
      const view = views.find(v => v.unit.team === team && v.unit.armySlot === slot);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'army-slot'; button.dataset.team = String(team); button.dataset.slot = String(slot);
      button.setAttribute('aria-label', `${team ? '红方' : '蓝方'}第 ${slot + 1} 格${view ? ` ${view.unit.label} ×${count(view)}` : ' 空位'}`);
      const chosen = state ? view === selected : team === editorTeam && slot === editorSlot;
      button.setAttribute('aria-pressed', String(chosen)); button.disabled = busy || (!!state && !view);
      button.textContent = view ? `${slot + 1} ${view.unit.label} ×${count(view)}` : `${slot + 1} ＋`;
      button.onclick = () => {
        editorTeam = team; editorSlot = slot;
        if (view) updateSelection(view); else updateSelection();
        $<HTMLSelectElement>('#team-picker').value = String(team);
        if (view) $<HTMLSelectElement>('#creature-picker').value = view.unit.kind;
        else $<HTMLInputElement>('#stack-count').value = '20';
        if (!state) $('#army-editor').setAttribute('open', '');
      };
      if (view) {
        button.onpointermove = event => showAttributes(view, event.clientX, event.clientY);
        button.onpointerleave = hideAttributes;
        button.onfocus = () => { const rect = button.getBoundingClientRect(); showAttributes(view, rect.left, rect.top); };
        button.onblur = hideAttributes;
      }
      row.append(button);
    }
    group.append(row); root.append(group);
  }
  $('#selected-slot-label').textContent = editorSlot < 0 ? '召唤／镜像单位' : `${editorTeam ? '红方' : '蓝方'} · 第 ${editorSlot + 1} 格`;
}
function applyState(next: EngineState, selectActor = false) {
  for (const unit of next.units) {
    let view = views.find(v => nativeUnits.get(v.unit.id)?.id === unit.id);
    if (!view) {
      const configured = slotViews.get(`${unit.side}:${unit.slot}`);
      if (configured && !nativeUnits.has(configured.unit.id)) view = configured;
      else {
        const art = creatureArt.find(c => c.key === unit.creature);
        view = attach({ id: `engine-${unit.id}`, kind: art?.art ?? unit.creature, label: art?.label ?? unit.label, team: unit.side, armySlot: -1, cell: fromHexId(unit.hex), initialCount: unit.count, hp: unit.health });
        const asset = manifest?.units[view.unit.kind]; if (asset) void view.setAsset(asset).catch(() => {});
      }
    }
    const prior = nativeUnits.get(view.unit.id);
    if (unit.count > 0 && prior?.count === 0) view.play('idle');
    nativeUnits.set(view.unit.id, unit); view.unit.hp = unit.health; view.unit.cell = fromHexId(unit.hex);
    view.root.position.copy(worldPosition(view.unit.cell)); view.playbackHp = undefined;
  }
  world.setObstacles(next.obstacles);
  if (selectActor) selected = views.find(v => nativeUnits.get(v.unit.id)?.id === next.activeStack) ?? selected;
  updateSelection();
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function face(view: UnitView, position: THREE.Vector3) { view.root.lookAt(position.x, view.root.position.y, position.z); }
async function follow(view: UnitView, path: number[], token: number) {
  view.play('walk');
  for (const hex of path) {
    if (generation !== token) return;
    const from = view.root.position.clone(), to = worldPosition(fromHexId(hex)); face(view, to); const started = performance.now();
    await new Promise<void>(resolve => {
      const step = () => { if (generation !== token) { resolve(); return; } const t = Math.min(1, (performance.now() - started) / 240); view.root.position.lerpVectors(from, to, t); if (t < 1) requestAnimationFrame(step); else resolve(); }; requestAnimationFrame(step);
    });
  }
  view.play('idle');
}
async function projectile(source: UnitView, target: UnitView, token: number) {
  const shot = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffdf8d' }));
  const from = source.root.position.clone().add(new THREE.Vector3(0, 1.4, 0)), to = target.root.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  world.scene.add(shot); projectiles++; const start = performance.now();
  try { await new Promise<void>(resolve => { const step = () => { if (token !== generation) { resolve(); return; } const t = Math.min(1, (performance.now() - start) / 350); shot.position.lerpVectors(from, to, t); if (t < 1) requestAnimationFrame(step); else resolve(); }; requestAnimationFrame(step); }); }
  finally { projectiles--; shot.removeFromParent(); shot.geometry.dispose(); shot.material.dispose(); }
}
function viewFor(id: number) { return views.find(v => nativeUnits.get(v.unit.id)?.id === id); }
async function playback(events: EngineEvent[], token: number) {
  for (const event of events) {
    if (token !== generation) return;
    if (event.type === 'move') { const view = viewFor(event.stack!); if (view) await follow(view, event.path ?? [], token); }
    if (event.type === 'spell') {
      const line = document.createElement('div'); line.textContent = `${event.side ? '红方' : '蓝方'} · ${event.label ?? '施法'}`; $('#combat-log').append(line);
      const light = new THREE.PointLight('#b5d8ff', 8, 5); light.position.copy(selected.root.position).add(new THREE.Vector3(0, 2, 0)); world.scene.add(light);
      await pause(180); light.removeFromParent();
    }
    if (event.type === 'injury') {
      applyState(event.after);
      for (const hit of event.victims ?? []) {
        const victim = viewFor(hit.id); if (!victim) continue; victim.play(hit.killed >= (event.before.units.find(u => u.id === hit.id)?.count ?? Infinity) ? 'death' : 'hit', true);
        const line = document.createElement('div'); line.textContent = `${victim.unit.label}：${hit.damage} 伤害，击杀 ${hit.killed}`; $('#combat-log').append(line);
      }
      await pause(220);
    }
    if (event.type === 'attack') {
      const actor = viewFor(event.attacker!), target = viewFor(event.victims?.[0]?.id ?? -1);
      if (actor && target) {
        face(actor, target.root.position); const duration = actor.play(event.ranged ? 'shoot' : 'attack', true);
        await pause(duration * 480); if (token !== generation) return;
        if (event.ranged) await projectile(actor, target, token); if (token !== generation) return;
        applyState(event.after);
        for (const hit of event.victims ?? []) {
          const victim = viewFor(hit.id); if (!victim) continue;
          victim.play(nativeUnits.get(victim.unit.id)!.count > 0 ? 'hit' : 'death', true);
          const text = `${event.counter ? '反击' : event.ranged ? '射击' : '近战'} · ${actor.unit.label} → ${victim.unit.label}：${hit.damage} 伤害，击杀 ${hit.killed}`;
          const line = document.createElement('p'); line.textContent = text; $('#combat-log').prepend(line); message(text);
        }
        await pause(duration * 520);
      }
    }
    if (token !== generation) return; applyState(event.after);
  }
}
function refreshSpellbook() {
  const actor = state?.units.find(u => u.id === state?.activeStack);
  const hero = actor && state?.heroes?.[controller(actor)!];
  const picker = $<HTMLSelectElement>('#spell-picker'), targets = $<HTMLSelectElement>('#spell-target');
  const chosen = picker.value;
  picker.replaceChildren(...(hero?.spells ?? []).map(spell => new Option(`${spell.label} · ${spell.cost} MP${spell.castable ? '' : ' · 当前不可施放'}`, String(spell.id))));
  if ([...picker.options].some(option => option.value === chosen)) picker.value = chosen;
  else { const available = hero?.spells.find(spell => spell.castable); if (available) picker.value = String(available.id); }
  $('#hero-status').textContent = hero ? `${controller(actor) ? '红方' : '蓝方'}英雄 · 魔力 ${hero.mana}/${hero.maxMana}` : '当前行动方没有参战英雄';
  const available = hero?.spells.some(spell => String(spell.id) === picker.value && spell.castable);
  picker.disabled = busy || !hero?.spells.some(spell => spell.castable) || state?.winner != null;
  $<HTMLButtonElement>('#cast-spell').disabled = busy || !available || !spellTargets.length || state?.winner != null;
  targets.disabled = busy || !available || !spellTargets.length;
  if (!available || !state || state.winner != null) { ++spellRequest; spellKey = ''; spellTargets = []; targets.replaceChildren(); return; }
  const key = `${state.revision}:${picker.value}`;
  if (!busy && key !== spellKey) void loadSpellTargets();
}
async function loadSpellTargets() {
  if (!state || busy) return;
  const picker = $<HTMLSelectElement>('#spell-picker'), request = ++spellRequest, current = state;
  spellKey = `${current.revision}:${picker.value}`; spellTargets = []; $<HTMLButtonElement>('#cast-spell').disabled = true;
  $('#spell-status').textContent = '正在读取合法目标…';
  try {
    const result = await engine.spellTargets(current, Number(picker.value));
    if (request !== spellRequest || state?.revision !== current.revision || busy) return;
    spellTargets = result.targets;
    $<HTMLSelectElement>('#spell-target').replaceChildren(...spellTargets.map((target, i) => new Option(spellTargetLabel(target, state!.units), String(i))));
    $<HTMLSelectElement>('#spell-target').disabled = !spellTargets.length;
    $<HTMLButtonElement>('#cast-spell').disabled = !spellTargets.length;
    $('#spell-status').textContent = spellTargets.length ? '选择目标，或点击场上的单位／格子。' : '当前没有合法施法目标';
  } catch (error) { if (request === spellRequest) $('#spell-status').textContent = error instanceof Error ? error.message : String(error); }
}
$('#spell-picker').onchange = () => void loadSpellTargets();
$('#cast-spell').onclick = () => {
  const targets = spellTargets[Number($<HTMLSelectElement>('#spell-target').value)];
  if (targets) void action('spell', { spell: Number($<HTMLSelectElement>('#spell-picker').value), targets });
};
function chooseSpellTarget(unit?: NativeUnit, hex?: number) {
  if (!$('#spellbook').hasAttribute('open') || !spellTargets.length) return false;
  const index = spellTargets.findIndex(target => target.length === 1 && (unit ? target[0].unit === unit.id || target[0].hex === unit.hex : target[0].hex === hex));
  if (index < 0) { message('该位置不是当前魔法的合法目标；多目标魔法请使用目标列表。'); return true; }
  $<HTMLSelectElement>('#spell-target').value = String(index); message('已选择施法目标，点击「施放魔法」确认。'); return true;
}
function scheduleAI() {
  if (aiTimer) clearTimeout(aiTimer);
  aiTimer = undefined;
  if (busy || !state || state.winner != null || !aiAvailable) return;
  const actor = state.units.find(u => u.id === state!.activeStack);
  if (!actor || !$<HTMLInputElement>(controller(actor) ? '#ai-red' : '#ai-blue').checked) return;
  aiTimer = setTimeout(() => { aiTimer = undefined; void action('ai'); }, 400);
}
$('#ai-step').onclick = () => void action('ai');
for (const id of ['#ai-blue', '#ai-red']) $(id).onchange = scheduleAI;
async function action(kind: string, options: Record<string, unknown> = {}) {
  if (busy || !state || state.winner != null) return;
  const token = generation; busy = true; updateSelection();
  try {
    const result = await engine.act(state, kind, options);
    if (generation !== token) return;
    await playback(result.events, token);
    if (generation !== token) return;
    state = result.state; applyState(state, true); world.showPath(null);
  } catch (error) { if (generation === token) { if (kind === 'ai') for (const id of ['#ai-blue', '#ai-red']) $<HTMLInputElement>(id).checked = false; message(error instanceof Error ? error.message : String(error)); } }
  finally { if (generation === token) { busy = false; updateSelection(); } }
}
async function attack(target: UnitView) {
  if (!state?.legal) return;
  const id = nativeUnits.get(target.unit.id)?.id; if (id === undefined) return;
  if (!$<HTMLInputElement>('#force-melee').checked && state.legal.shots.includes(id)) { await action('shoot', { target: id }); return; }
  const choice = state.legal.melee.find(option => option.target === id);
  if (choice) await action('melee', { target: id, from: choice.from }); else message('本回合没有可用的攻击位置。');
}
async function move(cell: Hex) { const hex = toHexId(cell); if (state?.legal?.moves.some(option => option.hex === hex)) await action('move', { hex }); }
function nativeArmies() {
  return [0, 1].map(team => views.filter(v => v.unit.team === team).sort((a, b) => a.unit.armySlot - b.unit.armySlot).map(v => ({ creature: metadata(v.unit.kind).id, count: v.unit.initialCount, slot: v.unit.armySlot })));
}
async function previewDeployment() {
  const request = ++deploymentRequest;
  if (!connected || state || ![0, 1].every(team => views.some(v => v.unit.team === team))) { deploying = false; updateSelection(); return; }
  deploying = true; updateSelection();
  try {
    const result = await engine.deployment(1337, nativeArmies(), (heroesAvailable ? readHeroes() : undefined));
    if (request !== deploymentRequest || state) return;
    for (const unit of result.state.units) {
      const view = views.find(v => v.unit.team === unit.side && v.unit.armySlot === unit.slot);
      if (view) { view.unit.cell = fromHexId(unit.hex); view.root.position.copy(worldPosition(view.unit.cell)); }
    }
  } catch (error) { if (request === deploymentRequest) message(error instanceof Error ? error.message : String(error)); }
  finally { if (request === deploymentRequest) { deploying = false; updateSelection(); } }
}
async function connect() {
  if (busy || state) return; busy = true; updateSelection(); $('#engine-status').textContent = '正在连接本地引擎…';
  try { const info = await engine.connect(); heroesAvailable = info.heroSpells === true; aiAvailable = info.battleAI === "VCMI BattleEvaluator"; townPreset = info.tenWeekTownArmies; heroEditor($('#hero-configs'), info.spells ?? [], info.skills ?? [], () => void previewDeployment()); nativeCreatures.clear(); info.creatures.forEach(c => nativeCreatures.set(c.key, c)); connected = info.backend === 'vcmi-native' && info.creatures.length === 28; $('#engine-status').textContent = 'VCMI 已连接 · 城堡与墓园 28 种兵种'; }
  catch (error) { connected = false; heroesAvailable = false; aiAvailable = false; townPreset = undefined; nativeCreatures.clear(); $('#engine-status').textContent = error instanceof Error ? error.message : '引擎连接失败'; }
  busy = false; updateSelection(); await previewDeployment();
}
$('#connect-engine').onclick = () => void connect();
$('#ten-week-armies').onclick = async () => {
  if (busy || state || !townPreset) return;
  const upgraded = $<HTMLInputElement>('#preset-upgraded').checked;
  const candidates: UnitView[] = [];
  busy = true; updateSelection();
  try {
    for (const [team, army] of townPreset.armies.entries()) for (const stack of army) {
      const creature = creatureArt.find(c => c.id === (upgraded ? stack.upgraded : stack.base));
      if (!creature) throw new Error('引擎预设包含未支持的兵种。');
      const view = new UnitView(preview(creature.art, team, stack.count, undefined, cellAt(team ? 12 : 4, [0, 2, 4, 5, 6, 8, 10][stack.slot]), stack.slot));
      candidates.push(view);
    }
    for (const view of candidates) loadModel(view);
    views.forEach(view => view.dispose()); views = []; badges.forEach(badge => badge.remove()); badges.clear();
    for (const view of candidates) {
      views.push(view); world.scene.add(view.root);
      const badge = document.createElement('div'); badge.className = 'stack-badge'; badge.style.borderColor = view.unit.team ? '#cf8e7b' : '#7babc9'; badges.set(view.unit.id, badge); $('#stack-labels').append(badge);
    }
    selected = views.find(view => view.unit.team === editorTeam && view.unit.armySlot === editorSlot) ?? views[0];
    startingArmy = []; nativeUnits.clear(); slotViews.clear();
    message('已按完整城镇十周产量配置双方七队。');
  } catch (error) { candidates.forEach(view => view.dispose()); message(error instanceof Error ? error.message : String(error)); }
  finally { busy = false; updateSelection(); void previewDeployment(); }
};
$('#start-battle').onclick = async () => {
  if (busy || deploying || !connected || state) return;
  if (![0, 1].every(team => views.some(v => v.unit.team === team))) { message('双方均须有队伍。'); return; }
  startingArmy = configured(); busy = true; updateSelection(); slotViews.clear();
  const armies = [0, 1].map(team => views.filter(v => v.unit.team === team).sort((a, b) => a.unit.armySlot - b.unit.armySlot).map(v => { slotViews.set(`${team}:${v.unit.armySlot}`, v); return { creature: metadata(v.unit.kind).id, count: v.unit.initialCount, slot: v.unit.armySlot }; }));
  try { const result = await engine.create(1337, armies, (heroesAvailable ? readHeroes() : undefined)); state = result.state; applyState(state, true); $('#army-editor').removeAttribute('open'); message('双方阵容已进入战场。'); }
  catch (error) { message(error instanceof Error ? error.message : String(error)); }
  finally { busy = false; updateSelection(); }
};
$('#wait-turn').onclick = () => void action('wait'); $('#defend-turn').onclick = () => void action('defend');
function selectView(view: UnitView) { editorTeam = view.unit.team; editorSlot = view.unit.armySlot; updateSelection(view); }
$('#unit-picker').onchange = () => selectView(views.find(v => v.unit.id === $<HTMLSelectElement>('#unit-picker').value)!);
function readCount() { const value = $<HTMLInputElement>('#stack-count').valueAsNumber; if (!Number.isInteger(value) || value < 1 || value > 99999) { message('数量须为 1–99999 的整数。'); return null; } return value; }
function refreshCatalogue() {
  $('#creature-picker').replaceChildren();
  for (const faction of ['城堡', '墓园']) { const group = document.createElement('optgroup'); group.label = faction;
    for (const creature of creatureArt.filter(c => c.faction === faction)) group.append(new Option(`${creature.label}${manifest?.units[creature.art] ? manifest.units[creature.art].draft ? ' · 美术草稿' : '' : ' · 示意模型'}`, creature.art));
    $('#creature-picker').append(group);
  }
}
$('#team-picker').onchange = () => { editorTeam = Number($<HTMLSelectElement>('#team-picker').value); const view = views.find(v => v.unit.team === editorTeam && v.unit.armySlot === editorSlot); updateSelection(view ?? selected); };
$('#apply-count').onclick = () => { if (busy || state) return; const value = readCount(); if (value !== null) { selected.unit.initialCount = value; updateSelection(); void previewDeployment(); } };
async function configureUnit(replace: boolean, explicitSlot = false) {
  if (busy || state) return; const value = readCount(); if (value === null) return;
  const team = explicitSlot ? editorTeam : replace ? selected.unit.team : Number($<HTMLSelectElement>('#team-picker').value);
  const target = explicitSlot ? views.find(v => v.unit.team === team && v.unit.armySlot === editorSlot) : replace ? selected : undefined;
  replace = !!target;
  const slot = explicitSlot ? editorSlot : target?.unit.armySlot ?? [0, 1, 2, 3, 4, 5, 6].find(slot => !views.some(v => v.unit.team === team && v.unit.armySlot === slot));
  if (slot === undefined) { message('每方最多 7 队。'); return; }
  if (!replace && views.filter(v => v.unit.team === team).length >= 7) { message('每方最多 7 队。'); return; }
  const kind = $<HTMLSelectElement>('#creature-picker').value;
  const row = target ? target.unit.cell.r : [0, 2, 4, 5, 6, 8, 10][slot];
  const unit = preview(kind, team, value, target?.unit.id, target ? target.unit.cell : cellAt(team ? 12 : 4, row), slot);
  const view = new UnitView(unit); busy = true; updateSelection();
  try {
    loadModel(view);
    if (replace) { const index = views.indexOf(target!); target!.dispose(); views[index] = view; }
    else { views.push(view); const badge = document.createElement('div'); badge.className = 'stack-badge'; badge.style.borderColor = unit.team ? '#cf8e7b' : '#7babc9'; $('#stack-labels').append(badge); badges.set(unit.id, badge); }
    world.scene.add(view.root); editorTeam = team; editorSlot = slot; updateSelection(view);
  } catch { view.dispose(); message('模型载入失败，原阵容已保留。'); }
  finally { busy = false; updateSelection(); void previewDeployment(); }
}
$('#assign-slot').onclick = () => void configureUnit(false, true);
$('#add-unit').onclick = () => void configureUnit(false); $('#replace-unit').onclick = () => void configureUnit(true);
$('#remove-unit').onclick = () => { if (busy || state || views.length < 2) return; const view = selected; views = views.filter(v => v !== view); view.dispose(); badges.get(view.unit.id)?.remove(); badges.delete(view.unit.id); updateSelection(views[0]); void previewDeployment(); };
$('#reset').onclick = async () => {
  if (busy) return;
  const hadBattle = !!state;
  ++generation; ++deploymentRequest; deploying = false; state = undefined; busy = true; nativeUnits.clear(); slotViews.clear();
  try { if (connected) await engine.dispose(); } catch { connected = false; }
  const army = hadBattle && startingArmy.length ? startingArmy : configured();
  views.forEach(v => v.dispose()); views = []; badges.forEach(b => b.remove()); badges.clear();
  army.forEach(unit => attach({ ...unit, cell: { ...unit.cell }, hp: 1 })); selected = views[0]; editorTeam = selected.unit.team; editorSlot = selected.unit.armySlot; world.showPath(null); world.setObstacles([]); $('#combat-log').replaceChildren(); $('#army-editor').setAttribute('open', '');
  void importManifest().then(() => updateSelection()); busy = false; updateSelection(); await previewDeployment();
};
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), pressed = new THREE.Vector2();
function point(event: PointerEvent) { const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, world.camera); }
function hideAttributes() { $('#unit-tooltip').hidden = true; }
function showAttributes(view: UnitView, x: number, y: number) {
  const card = $('#unit-tooltip'), native = nativeUnits.get(view.unit.id), base = nativeCreatures.get(metadata(view.unit.kind)?.key ?? '');
  const stats = native ?? base;
  const title = document.createElement('strong'); title.textContent = `${view.unit.team ? '红方' : '蓝方'} · ${view.unit.label}`;
  const text = document.createElement('div');
  text.textContent = stats ? `数量 ${count(view)}\n攻击 ${stats.attack} · 防御 ${stats.defense}\n伤害 ${stats.minDamage}–${stats.maxDamage} · 速度 ${stats.speed}\n生命 ${native ? `${native.topHealth}/${native.maxHealth}（末只）` : base!.health}\n弹药 ${stats.shots}\n${native ? 'VCMI 当前状态' : 'VCMI 兵种定义'}` : `数量 ${count(view)}\n连接引擎后查看战斗属性`;
  card.replaceChildren(title, text); card.hidden = false;
  card.style.left = `${Math.max(8, Math.min(x + 16, innerWidth - card.offsetWidth - 8))}px`;
  card.style.top = `${Math.max(8, Math.min(y + 16, innerHeight - card.offsetHeight - 8))}px`;
}
canvas.onpointerleave = () => { hideAttributes(); world.hover.visible = false; world.showPath(null); };
canvas.onpointermove = event => { if (event.buttons) { hideAttributes(); return; } point(event);
  const unitHit = raycaster.intersectObjects(views.filter(v => v.unit.hp > 0).map(v => v.proxy))[0];
  const hovered = unitHit && views.find(v => v.unit.id === unitHit.object.userData.unitId);
  if (hovered) showAttributes(hovered, event.clientX, event.clientY); else hideAttributes();
  if (busy) return; const hit = raycaster.intersectObjects(world.pickable)[0]; world.hover.visible = !!hit; if (!hit) { world.showPath(null); return; } const cell = hit.object.userData.cell as Hex; world.hover.position.copy(worldPosition(cell)); world.hover.position.y = .035; const path = state?.legal?.moves.find(move => move.hex === toHexId(cell))?.path; world.showPath(path?.map(fromHexId) ?? null); };
canvas.onpointerdown = event => { hideAttributes(); pressed.set(event.clientX, event.clientY); };
canvas.onpointerup = event => { if (event.button !== 0 || busy || pressed.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return; point(event);
  const unit = raycaster.intersectObjects(views.map(v => v.proxy))[0]; if (unit) { const view = views.find(v => v.unit.id === unit.object.userData.unitId)!; if (chooseSpellTarget(nativeUnits.get(view.unit.id))) return; if (state && controller(nativeUnits.get(view.unit.id)) !== controller(nativeUnits.get(viewFor(state.activeStack!)?.unit.id ?? ''))) void attack(view); else selectView(view); return; }
  const tile = raycaster.intersectObjects(world.pickable)[0]; if (tile && !chooseSpellTarget(undefined, toHexId(tile.object.userData.cell))) void move(tile.object.userData.cell);
};
$('#overview').onclick = () => { world.resetCamera(); $('#overview').classList.add('active'); $('#closeup').classList.remove('active'); }; $('#closeup').onclick = () => { world.frameUnit(selected.root.position); $('#closeup').classList.add('active'); $('#overview').classList.remove('active'); };
$('#zoom-in').onclick = () => world.zoomBy(1.15); $('#zoom-out').onclick = () => world.zoomBy(1 / 1.15);
$('#day').onclick = () => world.setMood(false); $('#dusk').onclick = () => world.setMood(true);
$<HTMLInputElement>('#grid').onchange = event => { world.grid.visible = (event.target as HTMLInputElement).checked; };
$<HTMLInputElement>('#shadows').onchange = event => { world.renderer.shadowMap.enabled = (event.target as HTMLInputElement).checked; };
$<HTMLInputElement>('#quality').oninput = event => { const value = Number((event.target as HTMLInputElement).value); world.renderer.setPixelRatio(Math.min(devicePixelRatio, value)); $('#quality-label').textContent = value > 1 ? '高' : '标准'; };
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => { button.onclick = () => { if (!busy) selected.play(button.dataset.action!, true); }; });
$<HTMLInputElement>('#import').onchange = async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file || busy) return; busy = true; const url = URL.createObjectURL(file); try { await selected.setAsset({ label: file.name, url }); updateSelection(); } catch { message('模型载入失败，请使用贴图内嵌的 GLB。'); } finally { URL.revokeObjectURL(url); busy = false; } };
$<HTMLInputElement>('#creature-import').onchange = async event => { const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file || busy || state) return; try { if (file.size > 1024 * 1024) throw new Error('兵种包不能超过 1 MB'); const pack = registerCreaturePack(JSON.parse(await file.text())); $('#creature-import-status').textContent = `已验证 ${pack.creatures.length} 个兵种定义；引擎端自定义包转换仍在开发，暂不能加入对战。`; } catch (error) { $('#creature-import-status').textContent = error instanceof Error ? error.message : String(error); } finally { input.value = ''; } };
function loadModel(view: UnitView) {
  const asset = manifest?.units[view.unit.kind];
  if (asset) void view.setAsset(asset).then(() => { if (views.includes(view)) updateSelection(); }).catch(() => {
    if (views.includes(view)) message(`${view.unit.label}模型载入失败，继续使用示意模型。`);
  });
}
async function importManifest() { if (!manifest) return; await Promise.allSettled(views.map(v => manifest!.units[v.unit.kind] ? v.setAsset(manifest!.units[v.unit.kind]) : Promise.resolve())); }
$<HTMLSelectElement>('#background-picker').onchange = async event => { const url = (event.target as HTMLSelectElement).value; try { if (url) await world.setBackdrop(url); else { world.freeCamera(); world.resetCamera(); } } catch { message('背景载入失败。'); } };
async function boot() {
  try { const response = await fetch('/local-assets/manifest.json'); if (response.ok && response.headers.get('content-type')?.includes('json')) { manifest = await response.json(); void importManifest().then(() => updateSelection()); for (const background of manifest?.backgrounds ?? []) $<HTMLSelectElement>('#background-picker').add(new Option(background.label, background.url)); if (manifest?.backgrounds?.length) { void world.setBackdrop(manifest.backgrounds[0].url).catch(() => message('背景载入失败，继续使用 3D 场景。')); $<HTMLSelectElement>('#background-picker').value = manifest.backgrounds[0].url; } } } catch { /* Stand-ins remain available. */ }
  refreshCatalogue(); updateSelection(); $('#loading').classList.add('hidden'); void connect();
}
world.renderer.setAnimationLoop(() => { clock.update(); const dt = Math.min(clock.getDelta(), .05); views.forEach(v => v.update(dt, v === selected)); if (world.controls.enabled) world.controls.update(); world.renderer.render(world.scene, world.camera);
  const rect = canvas.getBoundingClientRect(); for (const view of views) { const badge = badges.get(view.unit.id); if (!badge) continue; const point = view.root.position.clone().add(new THREE.Vector3(0, .15, 0)).project(world.camera); badge.hidden = view.unit.hp <= 0 || Math.abs(point.z) > 1; badge.textContent = String(count(view)); badge.style.left = `${rect.left + (point.x + 1) * rect.width / 2}px`; badge.style.top = `${rect.top + (1 - point.y) * rect.height / 2}px`; } });
Object.assign(window, { battleLab: { snapshot: () => ({ connected, busy, deploying, projectiles, state, backdrop: world.isBackdrop(), canvas: canvas.getBoundingClientRect().toJSON(), grid: world.grid.visible, draws: world.renderer.info.render.calls, units: views.map(v => ({ ...v.unit, count: count(v), native: nativeUnits.get(v.unit.id), imported: v.imported, animation: v.current, clips: v.clips.map(c => c.name), pose: v.poseSignature() })) }), move, attack: () => { const target = views.find(v => controller(nativeUnits.get(v.unit.id)) !== controller(nativeUnits.get(viewFor(state?.activeStack ?? -1)?.unit.id ?? ''))); return target ? attack(target) : Promise.resolve(); } } });
void boot();
