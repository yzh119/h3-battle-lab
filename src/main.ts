import * as THREE from 'three';
import './style.css';
import { EngineClient, type EngineState, type EngineEvent, type NativeUnit, type TownArmyPreset, type NativeCreature, type EngineCatalogue } from './engine.ts';
import { creatureArt, cellAt, key, fromHexId, toHexId, type Hex, type VisualUnit } from './presentation.ts';
import { heroEditor, readHeroes, spellTargetLabel, setHeroEditorDisabled, showHeroPreview } from './heroes.ts';
import type { SpellTarget, ScenarioCatalogue, ScenarioConfig } from './engine.ts';
import { parseCreaturePack } from './creatures.ts';
import { createWorld, worldPosition } from './world.ts';
import { UnitView, type Manifest } from './units.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="battle" aria-label="可旋转的三维六角格战场"></canvas>
  <div id="unit-tooltip" role="tooltip" hidden></div><div id="stack-labels" aria-label="场上兵力"></div><header><a class="brand" href="https://github.com/yzh119/h3-battle-lab" target="_blank" rel="noreferrer">H3 <span>BATTLE LAB</span></a><div class="top-label">战场实验室 <span>01 / 林地</span></div><div class="live"><i></i> 实时 3D</div></header>
  <aside class="panel"><div class="eyebrow">战场视角</div><h1>走进战场。</h1><p class="intro">换一个角度，看清每一次交锋。</p><select id="unit-picker" aria-label="选择场上单位"><option value="azure">骷髅兵</option><option value="ember">僵尸</option></select>
  <button id="connect-engine">连接引擎</button><p id="engine-status" role="status">正在连接本地引擎…</p><button id="ten-week-armies" disabled>十周城镇产出</button><label class="switch"><span>使用升级兵种</span><input id="preset-upgraded" type="checkbox" checked></label><p class="preset-note">蓝方城堡 · 红方墓园<br>完整城镇，不含圣杯及额外奖励</p><button id="start-battle" disabled>开始对战</button><p id="turn-status" role="status">配置阵容后开始对战</p><div class="button-row"><button id="wait-turn" disabled>等待</button><button id="defend-turn" disabled>防御</button></div><button id="end-tactics" hidden disabled>完成战术布阵</button><button id="attack-selected" disabled>攻击选中目标</button><div id="healing-controls" hidden><select id="heal-target" aria-label="选择治疗目标" disabled></select><button id="heal-unit" disabled>急救帐篷治疗</button></div><label class="switch"><span>蓝方 VCMI AI</span><input id="ai-blue" type="checkbox"></label><label class="switch"><span>红方 VCMI AI</span><input id="ai-red" type="checkbox"></label><button id="ai-step" disabled>VCMI AI 行动一次</button><p id="turn-queue"></p><label class="switch"><span>射手强制近战</span><input id="force-melee" type="checkbox"></label>
  <details id="army-editor" open><summary>配置双方阵容</summary><p id="selected-slot-label"></p><label for="creature-picker">兵种</label><select id="creature-picker" aria-label="选择上场兵种"></select><label for="team-picker">阵营</label><select id="team-picker" aria-label="选择上场阵营"><option value="0">蓝方</option><option value="1">红方</option></select><label for="stack-count">每队数量</label><input id="stack-count" aria-label="每队数量" type="number" min="1" max="99999" step="1" value="20"><button id="assign-slot">配置选中格子</button><button id="apply-count" class="quiet">应用数量到选中队伍</button><p id="creature-note"></p><p id="model-revision"></p><div class="button-row"><button id="add-unit">添加上场</button><button id="replace-unit">替换选中</button></div><button id="remove-unit" class="quiet">移除选中单位</button><p>每方最多 7 队 · 双方均可操控<br>点击队伍格配置兵种与数量；空格也可直接选择</p></details><details id="scenario-editor" open><summary>战斗场景</summary><p>地形影响战斗属性；显示背景单独选择。障碍物目前以石块标出原生占位。</p><label>地形<select id="terrain-picker" aria-label="选择战斗地形" disabled></select></label><label>战场<select id="battlefield-picker" aria-label="选择战场类型" disabled></select></label><label class="switch"><input id="native-obstacles" type="checkbox" disabled>VCMI 障碍物</label><label>障碍布局<input id="obstacle-layout" aria-label="障碍布局编号" type="number" min="0" step="1" value="148" disabled></label><button id="next-layout" disabled>换一个布局</button><p id="scenario-status">连接原生引擎后可配置</p></details><details id="hero-editor"><summary>英雄与魔法</summary><p>城堡／墓园英雄及原生特长<br>升级由引擎分配，也可自定义属性、技能与魔法；装备加成与战争机器由引擎处理</p><div id="hero-configs"></div></details><details id="spellbook"><summary>战斗魔法与兵种能力</summary><select id="spell-caster" aria-label="选择施法者" disabled><option value="hero">英雄魔法</option><option value="creature">兵种能力</option></select><p id="hero-status">英雄参战后可施法</p><select id="spell-picker" aria-label="选择战斗魔法" disabled></select><select id="spell-target" aria-label="选择施法目标" disabled></select><button id="cast-spell" disabled>施放魔法</button><p id="spell-status" role="status"></p></details><details><summary>自定义兵种</summary><p>导入版本 1 的兵种 JSON；VCMI 通过独立 mod 加载机制。自定义模式与原版模式分别标记。</p><input id="creature-import" aria-label="导入自定义兵种 JSON" type="file" accept=".json,application/json"><p id="creature-import-status" role="status"></p></details><div class="section-label">镜头</div><div class="button-row"><button id="overview" class="active">全局</button><button id="closeup">兵种特写</button></div>
  <div class="button-row zoom-controls"><button id="zoom-out" aria-label="缩小战场">− 缩小</button><button id="zoom-in" aria-label="放大战场">＋ 放大</button></div><div class="section-label">场景</div><select id="background-picker" aria-label="战场背景"><option value="">自由 3D 场景</option></select><p id="scene-hint" class="intro">WASD 移动视角 · 左键旋转 · 右键平移 · 滚轮缩放</p><div class="section-label">环境</div><div class="button-row"><button id="day" class="active">暖阳</button><button id="dusk">阴天</button></div>
  <label class="switch"><span>显示六角格</span><input id="grid" type="checkbox" checked></label>
  <label class="switch"><span>实时阴影</span><input id="shadows" type="checkbox" checked></label>
  <label class="range"><span>画面精细度 <b id="quality-label">高</b></span><input id="quality" aria-label="画面精细度" type="range" min="1" max="2" step=".5" value="2"></label>
  <div class="divider"></div><p class="rules-note">目标：原版 H3 基础战斗 · 一致性待验证<br>兵种行动与结果由 VCMI 计算；完整规则一致性与围城仍在验证、开发。</p><div id="combat-log" role="log" aria-label="战斗记录"></div><div class="section-label">动作预览</div><div class="actions"><button data-action="idle">待机</button><button data-action="walk">行走</button><button data-action="attack">攻击</button><button data-action="hit">受击</button></div>
  <button id="reset" class="quiet">重置战场 ↺</button><details><summary>载入本地模型</summary><p>选择内嵌贴图的 GLB，替换当前选中的单位。</p><input id="import" aria-label="载入本地 GLB 模型" type="file" accept=".glb"></details>
  </aside><div id="army-slots" aria-label="双方七格阵容"></div>
  <div class="loading" id="loading"><span class="spinner"></span>正在准备战场</div>
  <div id="toast" role="status" aria-live="polite"></div>
  <footer><div class="selected"><span class="team-dot"></span><div><small>当前兵种</small><strong id="unit-name">骷髅兵</strong></div><span id="hp">100 / 100</span></div><div class="controls-hint">点击兵种查看范围 · 当前兵种点击地面移动 · 点击敌军攻击；队伍栏查看范围<br><span>WASD 移动视角 · 拖动旋转 · 滚轮缩放 · 右键平移</span></div><div class="prototype">战场原型 <span id="asset-status">基础场景</span><small id="fps">—</small></div></footer>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#battle'), world = createWorld(canvas), clock = new THREE.Timer();
const engine = new EngineClient();
let connected = false, busy = false, state: EngineState | undefined, manifest: Manifest | undefined, generation = 0, nextId = 1, projectiles = 0;
let previewMachines: UnitView[] = [];
function clearPreviewMachines() { previewMachines.forEach(view => view.dispose()); previewMachines = []; }
let views: UnitView[] = [], selected: UnitView, lastEditorSelection: UnitView | undefined;
let editorTeam = 0, editorSlot = 0;
let scenarios: ScenarioCatalogue | undefined, deployment: EngineState | undefined;
let townPreset: TownArmyPreset | undefined;
let spellTargets: SpellTarget[] = [], spellRequest = 0, spellKey = '';
let creatureSpellsAvailable = false;
let heroesAvailable = false, aiAvailable = false, aiTimer: ReturnType<typeof setTimeout> | undefined;
let deploying = false, deploymentRequest = 0;
const configured = () => views.filter(v => v.unit.armySlot >= 0).map(v => ({ ...v.unit, cell: { ...v.unit.cell } }));
let startingArmy: VisualUnit[] = [];
const nativeCreatures = new Map<string, NativeCreature>();
const nativeUnits = new Map<string, NativeUnit>();
const slotViews = new Map<string, UnitView>();
const badges = new Map<string, HTMLDivElement>();
function message(text: string) { $('#toast').textContent = text; $('#toast').classList.add('show'); }
let customArt: typeof creatureArt = [];
let customPacksAvailable = false;
const allArt = () => [...creatureArt, ...customArt];
const metadata = (kind: string) => allArt().find(c => c.art === kind)!;
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
  showAttackCursor();
  selected = view;
  $('#unit-picker').replaceChildren(...views.map(v => new Option(`${v.unit.team ? '红方' : '蓝方'} · ${v.unit.label} ×${count(v)}`, v.unit.id)));
  $<HTMLSelectElement>('#unit-picker').value = view.unit.id; $('#unit-name').textContent = view.unit.label;
  const native = nativeUnits.get(view.unit.id);
  $('#hp').textContent = native ? `${native.count} 只 · 末只 ${native.topHealth}/${native.maxHealth} HP · 弹药 ${native.shots}` : `${view.unit.initialCount} 只 · 配置中`;
  $('#model-revision').textContent = view.imported ? `素材版本：${view.sourceRevision ?? '未标记'}` : '程序示意模型';
  const rangeUnit = native ?? (!state ? deployment?.units.find(u => u.side === view.unit.team && u.slot === view.unit.armySlot && u.creature === metadata(view.unit.kind)?.key && u.count === view.unit.initialCount) : undefined);
  const tacticsStack = state?.tactics?.stacks.find(stack => stack.id === native?.id);
  world.showMovementRange(!busy && !deploying && state?.winner == null ? (state?.tactics ? tacticsStack?.movement : rangeUnit?.movement) ?? [] : [], view.unit.team);
  world.showPath(null);
  const targetId = native?.id;
  $<HTMLButtonElement>('#attack-selected').disabled = busy || targetId === undefined || !state?.legal || !($<HTMLInputElement>('#force-melee').checked ? state.legal.melee.some(option => option.target === targetId) : state.legal.shots.includes(targetId) || state.legal.melee.some(option => option.target === targetId));
  $('#asset-status').textContent = `${views.filter(v => v.imported).length} / ${views.length} 个本地模型`;
  if (lastEditorSelection !== view) { $<HTMLInputElement>('#stack-count').value = String(view.unit.initialCount); lastEditorSelection = view; }
  for (const id of ['#creature-picker', '#team-picker', '#stack-count', '#apply-count', '#add-unit', '#replace-unit', '#remove-unit', '#creature-import', '#assign-slot'])
    ($<HTMLInputElement>(id)).disabled = busy || !!state;
  for (const id of ['#terrain-picker', '#battlefield-picker', '#native-obstacles', '#obstacle-layout', '#next-layout']) $<HTMLInputElement>(id).disabled = busy || !!state || !scenarios;
  $<HTMLInputElement>('#creature-import').disabled = busy || deploying || !!state;
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
  $('#end-tactics').hidden = !state?.tactics;
  $<HTMLButtonElement>('#end-tactics').disabled = busy || !state?.tactics;
  setHeroEditorDisabled(busy || !!state || !heroesAvailable, deploying);
  const heals = state?.legal?.heals ?? [];
  $<HTMLSelectElement>('#heal-target').replaceChildren(...heals.map(id => { const target = state!.units.find(unit => unit.id === id)!; return new Option(`${target.label} ×${target.count} · ${target.topHealth}/${target.maxHealth} HP`, String(id)); }));
  $('#healing-controls').hidden = !heals.length;
  $<HTMLButtonElement>('#heal-unit').disabled = busy || !heals.length;
  $<HTMLSelectElement>('#heal-target').disabled = busy || !heals.length;
  refreshSpellbook();
  renderArmySlots();
  scheduleAI();
  const active = views.find(v => nativeUnits.get(v.unit.id)?.id === state?.activeStack);
  $('#turn-status').textContent = state ? state.winner != null ? `${state.winner === 0 ? '蓝方' : state.winner === 1 ? '红方' : '双方'}${state.winner > 1 ? '平局' : '胜利'} · 第 ${state.round} 回合` : state.tactics ? `${state.tactics.side ? '红方' : '蓝方'}战术布阵 · 选择己方兵种移动，完成后开战` : `第 ${state.round} 回合 · ${controller(nativeUnits.get(active?.unit.id ?? '')) ? '红方' : '蓝方'} ${active?.unit.label ?? ''}行动` : '配置阵容后开始对战';
  $('#turn-queue').textContent = (state?.queue ?? []).map(id => [...nativeUnits.values()].find(u => u.id === id)).map(u => u ? allArt().find(c => c.key === u.creature)?.label ?? u.label : '').join(' → ');
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
        const art = allArt().find(c => c.key === unit.creature);
        view = attach({ id: `engine-${unit.id}`, kind: art?.art ?? unit.creature, label: art?.label ?? unit.label, team: unit.side, armySlot: -1, cell: fromHexId(unit.hex), initialCount: unit.count, hp: unit.health });
        const asset = manifest?.units[view.unit.kind]; if (asset) void view.setAsset(asset).catch(() => {});
      }
    }
    const prior = nativeUnits.get(view.unit.id);
    if (unit.count > 0 && prior?.count === 0) view.play('idle');
    nativeUnits.set(view.unit.id, unit); view.unit.hp = unit.health; view.unit.cell = fromHexId(unit.hex);
    view.root.position.copy(worldPosition(view.unit.cell)); view.setFootprint(unit.footprint); view.playbackHp = undefined;
  }
  world.setObstacles(next.obstacles);
  if (next.scenario) world.setTerrain(next.scenario.terrain);
  if (selectActor) selected = views.find(v => nativeUnits.get(v.unit.id)?.id === (next.tactics?.stacks[0]?.id ?? next.activeStack)) ?? selected;
  updateSelection();
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function face(view: UnitView, position: THREE.Vector3) {
  const dx = position.x - view.root.position.x, dz = position.z - view.root.position.z;
  if (dx * dx + dz * dz > 1e-8) view.root.rotation.y = Math.atan2(dx, dz);
}
async function follow(view: UnitView, path: number[], token: number) {
  view.play('walk');
  for (const hex of path) {
    if (generation !== token) return;
    const from = view.root.position.clone(), to = worldPosition(fromHexId(hex)); if (from.distanceToSquared(to) < 1e-8) continue; face(view, to); const started = performance.now();
    await new Promise<void>(resolve => {
      const step = () => { if (generation !== token) { resolve(); return; } const t = Math.min(1, (performance.now() - started) / 240); view.root.position.lerpVectors(from, to, t); if (t < 1) requestAnimationFrame(step); else resolve(); }; requestAnimationFrame(step);
    });
  }
  view.play('idle');
}
async function projectile(source: UnitView, target: UnitView, token: number) {
  const shot = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffdf8d' }));
  const from = source.visualPosition().add(new THREE.Vector3(0, source.height * .6, 0)), to = target.visualPosition().add(new THREE.Vector3(0, target.height * .5, 0));
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
    if (event.type === 'heal') {
      applyState(event.after);
      for (const restored of event.restored ?? []) {
        const view = viewFor(restored.id); if (view) { const line = document.createElement('div'); line.textContent = `${view.unit.label}：恢复 ${restored.healed} HP`; $('#combat-log').append(line); }
      }
      await pause(180);
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
function clearDeadTargets() { views.forEach(view => view.allowDeadTarget = false); }
function refreshSpellbook() {
  const actor = state?.units.find(u => u.id === state?.activeStack);
  const hero = actor && state?.heroes?.[controller(actor)!];
  const picker = $<HTMLSelectElement>('#spell-picker'), targets = $<HTMLSelectElement>('#spell-target');
  const caster = $<HTMLSelectElement>('#spell-caster');
  caster.disabled = busy || !state || state.winner != null;
  caster.options[1].disabled = !creatureSpellsAvailable;
  if (!hero && actor?.spells?.length && creatureSpellsAvailable) caster.value = 'creature';
  const creature = caster.value === 'creature';
  const spells = creature ? actor?.spells : hero?.spells;
  const chosen = picker.value;
  picker.replaceChildren(...(spells ?? []).map(spell => new Option(`${spell.label}${!creature && 'cost' in spell ? ` · ${spell.cost} MP` : ''}${spell.castable ? '' : ' · 当前不可施放'}`, String(spell.id))));
  if ([...picker.options].some(option => option.value === chosen)) picker.value = chosen;
  else { const available = spells?.find(spell => spell.castable); if (available) picker.value = String(available.id); }
  $('#hero-status').textContent = creature ? `${actor?.label ?? '当前兵种'} · 能力剩余 ${actor?.casts ?? 0} 次` : hero ? `${controller(actor) ? '红方' : '蓝方'} · ${hero.label ?? '英雄'} · 魔力 ${hero.mana}/${hero.maxMana}` : '当前行动方没有参战英雄';
  const available = spells?.some(spell => String(spell.id) === picker.value && spell.castable);
  picker.disabled = busy || !spells?.some(spell => spell.castable) || state?.winner != null;
  $<HTMLButtonElement>('#cast-spell').disabled = busy || !available || !spellTargets.length || state?.winner != null;
  targets.disabled = busy || !available || !spellTargets.length;
  if (!available || !state || state.winner != null) { ++spellRequest; spellKey = ''; spellTargets = []; targets.replaceChildren(); clearDeadTargets(); $('#spell-status').textContent = creature ? '当前兵种没有可用的主动能力。' : '当前没有可施放的英雄魔法。'; return; }
  const key = `${state.revision}:${caster.value}:${picker.value}`;
  if (!busy && key !== spellKey) void loadSpellTargets();
}
async function loadSpellTargets() {
  if (!state || busy) return;
  const picker = $<HTMLSelectElement>('#spell-picker'), request = ++spellRequest, current = state;
  const caster = $<HTMLSelectElement>('#spell-caster').value as 'hero' | 'creature';
  spellKey = `${current.revision}:${caster}:${picker.value}`; spellTargets = []; clearDeadTargets(); $<HTMLButtonElement>('#cast-spell').disabled = true;
  $('#spell-status').textContent = '正在读取合法目标…';
  try {
    const result = await engine.spellTargets(current, Number(picker.value), caster);
    if (request !== spellRequest || state?.revision !== current.revision || busy) return;
    spellTargets = result.targets;
    for (const view of views) { const id = nativeUnits.get(view.unit.id)?.id; view.allowDeadTarget = spellTargets.some(target => target.some(destination => destination.unit === id)); }
    $<HTMLSelectElement>('#spell-target').replaceChildren(...spellTargets.map((target, i) => new Option(spellTargetLabel(target, state!.units), String(i))));
    $<HTMLSelectElement>('#spell-target').disabled = !spellTargets.length;
    $<HTMLButtonElement>('#cast-spell').disabled = !spellTargets.length;
    $('#spell-status').textContent = spellTargets.length ? '选择目标，或点击场上的单位／格子。' : '当前没有合法施法目标';
  } catch (error) { if (request === spellRequest) $('#spell-status').textContent = error instanceof Error ? error.message : String(error); }
}
$('#spell-caster').onchange = () => { spellKey = ''; refreshSpellbook(); };
$('#spell-picker').onchange = () => void loadSpellTargets();
$('#cast-spell').onclick = () => {
  const targets = spellTargets[Number($<HTMLSelectElement>('#spell-target').value)];
  if (targets) void action($<HTMLSelectElement>('#spell-caster').value === 'creature' ? 'creatureSpell' : 'spell', { spell: Number($<HTMLSelectElement>('#spell-picker').value), targets });
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
  const side = state.tactics?.side ?? controller(actor);
  if (side === undefined || !$<HTMLInputElement>(side ? '#ai-red' : '#ai-blue').checked) return;
  aiTimer = setTimeout(() => { aiTimer = undefined; void action('ai'); }, 400);
}
$('#heal-unit').onclick = () => void action('heal', { target: Number($<HTMLSelectElement>('#heal-target').value) });
$('#ai-step').onclick = () => void action('ai');
$('#end-tactics').onclick = () => void action('endTactics');
$('#attack-selected').onclick = () => void attack(selected);
$('#force-melee').onchange = () => updateSelection();
for (const id of ['#ai-blue', '#ai-red']) $(id).onchange = scheduleAI;
async function action(kind: string, options: Record<string, unknown> = {}) {
  if (busy || !state || state.winner != null) return;
  const token = generation; busy = true; updateSelection();
  try {
    const result = await engine.act(state, kind, options);
    if (generation !== token) return;
    await playback(result.events, token);
    if (generation !== token) return;
    state = result.state; clearPreviewMachines(); applyState(state, !state.tactics); world.showPath(null);
  } catch (error) { if (generation === token) { if (kind === 'ai') for (const id of ['#ai-blue', '#ai-red']) $<HTMLInputElement>(id).checked = false; message(error instanceof Error ? error.message : String(error)); } }
  finally { if (generation === token) { busy = false; updateSelection(); } }
}
async function attack(target: UnitView, from?: number) {
  if (!state?.legal) return;
  const id = nativeUnits.get(target.unit.id)?.id; if (id === undefined) return;
  if (!$<HTMLInputElement>('#force-melee').checked && state.legal.shots.includes(id)) { await action('shoot', { target: id }); return; }
  const choice = state.legal.melee.find(option => option.target === id && (from === undefined || option.from === from));
  if (choice) await action('melee', { target: id, from: choice.from }); else message('本回合没有可用的攻击位置。');
}
async function move(cell: Hex) {
  const hex = toHexId(cell), selectedId = nativeUnits.get(selected.unit.id)?.id;
  if (state?.tactics) {
    const stack = state.tactics.stacks.find(stack => stack.id === selectedId);
    if (!stack) { message('请选择拥有战术布阵权的一方的兵种。'); return; }
    if (stack.moves.some(move => move.hex === hex)) await action('tacticsMove', { stack: selectedId, hex });
    return;
  }
  if (state && selectedId !== state.activeStack) { message('请选择当前行动兵种后移动。'); return; }
  if (state?.legal?.moves.some(option => option.hex === hex)) await action('move', { hex });
}
function nativeArmies() {
  return [0, 1].map(team => views.filter(v => v.unit.team === team).sort((a, b) => a.unit.armySlot - b.unit.armySlot).map(v => ({ creature: metadata(v.unit.kind).id, count: v.unit.initialCount, slot: v.unit.armySlot })));
}
async function previewDeployment() {
  const request = ++deploymentRequest;
  if (!state) { deployment = undefined; clearPreviewMachines(); }
  if (!connected || state || ![0, 1].every(team => views.some(v => v.unit.team === team))) { deploying = false; updateSelection(); return; }
  deploying = true; updateSelection();
  try {
    const result = await engine.deployment(1337, nativeArmies(), (heroesAvailable ? readHeroes() : undefined), readScenario());
    if (request !== deploymentRequest || state) return;
    deployment = result.state;
    showHeroPreview(result.state.heroes);
    for (const machine of result.state.units.filter(unit => unit.slot < 0)) {
      const view = new UnitView({ id: `preview-${machine.id}`, kind: machine.creature, label: machine.label, team: machine.side, armySlot: -1, cell: fromHexId(machine.hex), initialCount: machine.count, hp: machine.health });
      view.setFootprint(machine.footprint); world.scene.add(view.root); previewMachines.push(view);
    }
    world.setObstacles(result.state.obstacles);
    if (result.state.scenario) world.setTerrain(result.state.scenario.terrain);
    $('#scenario-status').textContent = `${scenarios?.terrains.find(t => t.id === result.state.scenario?.terrain)?.label ?? '原生场景'} · 障碍占位 ${new Set(result.state.obstacles).size} 格`;
    for (const unit of result.state.units) {
      const view = views.find(v => v.unit.team === unit.side && v.unit.armySlot === unit.slot);
      if (view) { view.unit.cell = fromHexId(unit.hex); view.root.position.copy(worldPosition(view.unit.cell)); view.setFootprint(unit.footprint); }
    }
  } catch (error) { if (request === deploymentRequest) message(error instanceof Error ? error.message : String(error)); }
  finally { if (request === deploymentRequest) { deploying = false; updateSelection(); } }
}
const sceneLabels: Record<string, string> = {
  'core:dirt': '泥地', 'core:sand': '沙地', 'core:grass': '草地', 'core:snow': '雪地', 'core:swamp': '沼泽', 'core:rough': '粗糙地', 'core:subterra': '地下', 'core:lava': '熔岩',
  'core:sand_shore': '沙滩', 'core:sand_mesas': '沙漠', 'core:dirt_pines': '泥地松林', 'core:dirt_hills': '泥地丘陵', 'core:dirt_birches': '泥地桦林',
  'core:grass_pines': '草地松林', 'core:grass_hills': '草地丘陵', 'core:snow_trees': '雪地树林', 'core:snow_mountains': '雪山', 'core:swamp_trees': '沼泽树林', 'core:subterranean': '地下洞穴',
  'core:clover_field': '三叶草地', 'core:cursed_ground': '诅咒之地', 'core:evil_fog': '邪恶迷雾', 'core:fiery_fields': '烈火之地', 'core:holy_ground': '神圣之地',
  'core:lucid_pools': '明净之池', 'core:magic_clouds': '魔法云层', 'core:magic_plains': '魔法平原', 'core:rocklands': '岩石之地',
};
function sceneLabel(key: string, fallback: string) { return sceneLabels[key] ?? fallback; }
function refreshBattlefields() {
  const terrain = scenarios?.terrains.find(t => String(t.id) === $<HTMLSelectElement>('#terrain-picker').value);
  const picker = $<HTMLSelectElement>('#battlefield-picker'), previous = picker.value;
  picker.replaceChildren(...(terrain?.battlefields ?? []).map(field => new Option(`${sceneLabel(field.key, field.label)}${field.special ? ' · 特殊战场' : ''}`, field.key)));
  if (terrain?.battlefields.some(field => field.key === previous)) picker.value = previous;
}
function readScenario(): ScenarioConfig | undefined {
  if (!scenarios) return undefined;
  const layout = $<HTMLInputElement>('#obstacle-layout').valueAsNumber;
  if (!Number.isInteger(layout) || layout < 0 || layout >= scenarios.layoutCount) throw new Error(`障碍布局编号须为 0–${scenarios.layoutCount - 1} 的整数。`);
  return { terrain: Number($<HTMLSelectElement>('#terrain-picker').value), battlefield: $<HTMLSelectElement>('#battlefield-picker').value,
    obstacles: $<HTMLInputElement>('#native-obstacles').checked, layout };
}
$('#terrain-picker').onchange = () => { refreshBattlefields(); void previewDeployment(); };
$('#battlefield-picker').onchange = () => void previewDeployment();
$('#native-obstacles').onchange = () => void previewDeployment();
$('#obstacle-layout').onchange = () => void previewDeployment();
$('#next-layout').onclick = () => { if (!scenarios || busy || state) return; const input = $<HTMLInputElement>('#obstacle-layout'); input.value = String(((Number.isInteger(input.valueAsNumber) ? input.valueAsNumber : 0) + 1) % scenarios.layoutCount); void previewDeployment(); };
function readCatalogue(info: EngineCatalogue) {
  const priorScenarios = scenarios;
  scenarios = info.scenarios;
  if (scenarios) {
    const picker = $<HTMLSelectElement>('#terrain-picker'), selected = priorScenarios ? picker.value : String(scenarios.default.terrain);
    picker.replaceChildren(...scenarios.terrains.map(t => new Option(sceneLabel(t.key, t.label), String(t.id)))); picker.value = selected;
    refreshBattlefields();
    if (!priorScenarios) { $<HTMLSelectElement>('#battlefield-picker').value = scenarios.default.battlefield; $<HTMLInputElement>('#native-obstacles').checked = scenarios.default.obstacles; $<HTMLInputElement>('#obstacle-layout').value = String(scenarios.default.layout); }
    $<HTMLInputElement>('#obstacle-layout').max = String(scenarios.layoutCount - 1);
  }

  nativeCreatures.clear(); info.creatures.forEach(c => nativeCreatures.set(c.key, c));
  customPacksAvailable = info.customPacks;
  creatureSpellsAvailable = info.creatureSpells === true;
  customArt = info.creatures.filter(c => c.custom && c.art).map(c => ({ id: c.id, key: c.key, art: c.art!, label: c.label, faction: c.faction ?? '自定义' }));
  connected = info.backend === 'vcmi-native' && creatureArt.every(c => nativeCreatures.has(c.key));
  $('#engine-status').textContent = connected ? `VCMI 已连接 · ${info.rulesProfile === 'custom-reference' ? '自定义模式' : '原版参考模式'} · ${info.creatures.length} 种兵种` : '引擎兵种目录不完整';
  refreshCatalogue();
}
async function connect() {
  if (busy || state) return; busy = true; updateSelection(); $('#engine-status').textContent = '正在连接本地引擎…';
  try { const info = await engine.connect(); heroesAvailable = info.heroSpells === true; aiAvailable = info.battleAI === "VCMI BattleEvaluator"; townPreset = info.tenWeekTownArmies; if (!$('#hero-configs').children.length) heroEditor($('#hero-configs'), info.spells ?? [], info.skills ?? [], () => void previewDeployment(), info.namedHeroes, info.equipment); readCatalogue(info); }
  catch (error) { connected = false; heroesAvailable = false; aiAvailable = false; townPreset = undefined; nativeCreatures.clear(); $('#engine-status').textContent = error instanceof Error ? error.message : '引擎连接失败'; }
  if (connected && customPacksAvailable && manifest?.creaturePack) {
    try {
      const url = new URL(manifest.creaturePack, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith('/local-assets/')) throw new Error('预装兵种包必须来自本地资源目录。');
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('预装兵种包读取失败，保留原版兵种。');
      const text = await response.text();
      if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('兵种包不能超过 1 MB。');
      const pack = parseCreaturePack(JSON.parse(text));
      const existing = new Set(customArt.map(c => c.art));
      if (!pack.creatures.every(c => existing.has(c.id))) readCatalogue(await engine.importPack(pack));
      $('#creature-import-status').textContent = `已载入 ${pack.creatures.length} 个本地自定义兵种，可在阵容中选择。`;
    } catch (error) {
      $('#creature-import-status').textContent = error instanceof Error ? error.message : String(error);
    }
  }
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
  try { const result = await engine.create(1337, armies, (heroesAvailable ? readHeroes() : undefined), readScenario()); state = result.state; clearPreviewMachines(); applyState(state, true); $('#army-editor').removeAttribute('open'); message('双方阵容已进入战场。'); }
  catch (error) { message(error instanceof Error ? error.message : String(error)); }
  finally { busy = false; updateSelection(); }
};
$('#wait-turn').onclick = () => void action('wait'); $('#defend-turn').onclick = () => void action('defend');
function selectView(view: UnitView) { editorTeam = view.unit.team; editorSlot = view.unit.armySlot; updateSelection(view); }
$('#unit-picker').onchange = () => selectView(views.find(v => v.unit.id === $<HTMLSelectElement>('#unit-picker').value)!);
function readCount() { const value = $<HTMLInputElement>('#stack-count').valueAsNumber; if (!Number.isInteger(value) || value < 1 || value > 99999) { message('数量须为 1–99999 的整数。'); return null; } return value; }
function refreshCatalogue() {
  const selection = $<HTMLSelectElement>('#creature-picker').value;
  $('#creature-picker').replaceChildren();
  for (const faction of [...new Set(allArt().map(c => c.faction))]) { const group = document.createElement('optgroup'); group.label = faction;
    for (const creature of allArt().filter(c => c.faction === faction)) group.append(new Option(`${creature.label}${manifest?.units[creature.art] ? manifest.units[creature.art].draft ? ' · 美术草稿' : '' : ' · 示意模型'}`, creature.art));
    $('#creature-picker').append(group);
  }
  if (allArt().some(c => c.art === selection)) $<HTMLSelectElement>('#creature-picker').value = selection;
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
  const card = $('#unit-tooltip'), native = nativeUnits.get(view.unit.id) ?? (!state ? deployment?.units.find(u => u.side === view.unit.team && u.slot === view.unit.armySlot && u.creature === metadata(view.unit.kind)?.key && u.count === view.unit.initialCount) : undefined), base = nativeCreatures.get(metadata(view.unit.kind)?.key ?? '');
  const stats = native ?? base;
  const title = document.createElement('strong'); title.textContent = `${view.unit.team ? '红方' : '蓝方'} · ${view.unit.label}`;
  const text = document.createElement('div');
  text.textContent = stats ? `数量 ${count(view)}\n攻击 ${stats.attack} · 防御 ${stats.defense}\n伤害 ${stats.minDamage}–${stats.maxDamage} · 速度 ${stats.speed}\n生命 ${native ? `${native.topHealth}/${native.maxHealth}（末只）` : base!.health}\n弹药 ${stats.shots}\n${native ? state ? 'VCMI 当前状态' : 'VCMI 部署预览' : 'VCMI 兵种定义'}` : `数量 ${count(view)}\n连接引擎后查看战斗属性`;
  card.replaceChildren(title, text); card.hidden = false;
  card.style.left = `${Math.max(8, Math.min(x + 16, innerWidth - card.offsetWidth - 8))}px`;
  card.style.top = `${Math.max(8, Math.min(y + 16, innerHeight - card.offsetHeight - 8))}px`;
}
type PointerAttack = { kind: 'shoot' | 'melee'; target: number; from?: number; angle: number };
let pointerAttack: PointerAttack | undefined;
const attackCursors = new Map<string, string>();
function projectGround(position: THREE.Vector3) {
  world.camera.updateMatrixWorld();
  const rect = canvas.getBoundingClientRect(), p = position.clone().project(world.camera);
  return new THREE.Vector2(rect.left + (p.x + 1) * rect.width / 2, rect.top + (1 - p.y) * rect.height / 2);
}
function pickUnit() {
  const ground = raycaster.intersectObjects(world.pickable)[0];
  const hex = ground ? toHexId(ground.object.userData.cell) : undefined;
  const candidates = views.filter(view => view.displayedHp > 0 || view.allowDeadTarget);
  const body = raycaster.intersectObjects(candidates.map(view => view.proxy))[0];
  const view = body ? candidates.find(view => view.unit.id === body.object.userData.unitId)
    : hex === undefined ? undefined : candidates.find(view => view.footprint.includes(hex));
  return { view, ground };
}
function attackAt(view: UnitView, x: number, y: number): PointerAttack | undefined {
  const target = nativeUnits.get(view.unit.id)?.id;
  if (busy || !state?.legal || state.tactics || state.winner != null || target === undefined || $('#spellbook').hasAttribute('open')) return;
  if (!$<HTMLInputElement>('#force-melee').checked && state.legal.shots.includes(target)) return { kind: 'shoot', target, angle: 0 };
  const options = state.legal.melee.filter(option => option.target === target);
  const actor = viewFor(state.activeStack ?? -1);
  if (!options.length || !actor) return;
  const offset = actor.visualPosition().sub(actor.root.position);
  const mouse = new THREE.Vector2(x, y);
  const choice = options.reduce((best, option) => projectGround(worldPosition(fromHexId(option.from)).add(offset)).distanceToSquared(mouse) < projectGround(worldPosition(fromHexId(best.from)).add(offset)).distanceToSquared(mouse) ? option : best);
  const from = projectGround(worldPosition(fromHexId(choice.from)).add(offset));
  const toward = projectGround(view.visualPosition()).sub(from);
  return { kind: 'melee', target, from: choice.from, angle: Math.atan2(toward.y, toward.x) * 180 / Math.PI };
}
function showAttackCursor(attack?: PointerAttack) {
  pointerAttack = attack;
  if (!attack) { canvas.style.cursor = busy ? 'wait' : ''; return; }
  const angle = Math.round(attack.angle / 15) * 15, key = `${attack.kind}:${angle}`;
  let cursor = attackCursors.get(key);
  if (!cursor) {
    const drawing = attack.kind === 'shoot'
      ? '<circle cx="20" cy="20" r="12"/><path d="M20 2v10m0 16v10M2 20h10m16 0h10"/>'
      : `<g transform="rotate(${angle} 20 20)"><path fill="#f5d786" d="M5 17h18v-7l13 10-13 10v-7H5z"/></g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><g fill="none" stroke="#18231f" stroke-width="3" stroke-linejoin="round">${drawing}</g></svg>`;
    cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 20 20, crosshair`; attackCursors.set(key, cursor);
  }
  canvas.style.cursor = cursor;
}
canvas.onpointerleave = () => { hideAttributes(); showAttackCursor(); world.hover.visible = false; world.showPath(null); };
canvas.onpointermove = event => {
  if (event.buttons) { hideAttributes(); showAttackCursor(); world.showPath(null); return; }
  point(event);
  const { view, ground } = pickUnit();
  if (view) showAttributes(view, event.clientX, event.clientY); else hideAttributes();
  const intent = view ? attackAt(view, event.clientX, event.clientY) : undefined;
  showAttackCursor(intent);
  if (busy) { world.showPath(null); return; }
  world.hover.visible = !!ground;
  if (!ground) { world.showPath(null); return; }
  const cell = ground.object.userData.cell as Hex;
  world.hover.position.copy(worldPosition(cell)); world.hover.position.y = .035;
  const id = nativeUnits.get(selected.unit.id)?.id;
  const moves = state?.tactics ? state.tactics.stacks.find(stack => stack.id === id)?.moves : id === state?.activeStack ? state?.legal?.moves : undefined;
  const path = intent?.kind === 'melee' ? state?.legal?.moves.find(move => move.hex === intent.from)?.path : moves?.find(move => move.hex === toHexId(cell))?.path;
  world.showPath(path?.map(fromHexId) ?? null);
};
canvas.onpointerdown = event => { hideAttributes(); pressed.set(event.clientX, event.clientY); };
canvas.onpointerup = event => {
  if (event.button !== 0 || busy || pressed.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return;
  point(event);
  const { view, ground } = pickUnit();
  if (view) {
    const intent = attackAt(view, event.clientX, event.clientY);
    selectView(view);
    const native = nativeUnits.get(view.unit.id);
    if (chooseSpellTarget(native)) return;
    if (native && state?.legal?.heals?.includes(native.id)) {
      $<HTMLSelectElement>('#heal-target').value = String(native.id); message('已选择治疗目标，点击「急救帐篷治疗」确认。'); return;
    }
    if (intent) { showAttackCursor(); void attack(view, intent.from); }
    return;
  }
  if (ground && !chooseSpellTarget(undefined, toHexId(ground.object.userData.cell))) void move(ground.object.userData.cell);
};
$('#overview').onclick = () => { world.resetCamera(); $('#overview').classList.add('active'); $('#closeup').classList.remove('active'); }; $('#closeup').onclick = () => { world.frameUnit(selected.visualPosition()); $('#closeup').classList.add('active'); $('#overview').classList.remove('active'); };
$('#zoom-in').onclick = () => world.zoomBy(1.15); $('#zoom-out').onclick = () => world.zoomBy(1 / 1.15);
$('#day').onclick = () => world.setMood(false); $('#dusk').onclick = () => world.setMood(true);
$<HTMLInputElement>('#grid').onchange = event => { world.grid.visible = (event.target as HTMLInputElement).checked; };
$<HTMLInputElement>('#shadows').onchange = event => { world.renderer.shadowMap.enabled = (event.target as HTMLInputElement).checked; };
$<HTMLInputElement>('#quality').oninput = event => { const value = Number((event.target as HTMLInputElement).value); world.renderer.setPixelRatio(Math.min(devicePixelRatio, value)); $('#quality-label').textContent = value > 1 ? '高' : '标准'; };
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => { button.onclick = () => { if (!busy) selected.play(button.dataset.action!, true); }; });
$<HTMLInputElement>('#import').onchange = async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file || busy) return; busy = true; const url = URL.createObjectURL(file); try { await selected.setAsset({ label: file.name, url }); updateSelection(); } catch { message('模型载入失败，请使用贴图内嵌的 GLB。'); } finally { URL.revokeObjectURL(url); busy = false; } };
$<HTMLInputElement>('#creature-import').onchange = async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file || busy || state) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('兵种包不能超过 1 MB。');
    const pack = parseCreaturePack(JSON.parse(await file.text()));
    if (!connected || !customPacksAvailable) {
      $('#creature-import-status').textContent = `已验证 ${pack.creatures.length} 个兵种定义；连接支持自定义包的原生引擎后才能加入对战。`; return;
    }
    busy = true; updateSelection(); $('#creature-import-status').textContent = '正在初始化独立 VCMI mod…';
    const info = await engine.importPack(pack); readCatalogue(info);
    $('#creature-import-status').textContent = `已载入 ${pack.creatures.length} 个自定义兵种，可在阵容中选择。`;
  } catch (error) { $('#creature-import-status').textContent = error instanceof Error ? error.message : String(error); }
  finally { input.value = ''; busy = false; updateSelection(); if (connected && !state) void previewDeployment(); }
};
function loadModel(view: UnitView) {
  const asset = manifest?.units[view.unit.kind];
  if (asset) void view.setAsset(asset).then(() => { if (views.includes(view)) updateSelection(); }).catch(() => {
    if (views.includes(view)) message(`${view.unit.label}模型载入失败，继续使用示意模型。`);
  });
}
async function importManifest() { if (!manifest) return; await Promise.allSettled(views.map(v => manifest!.units[v.unit.kind] ? v.setAsset(manifest!.units[v.unit.kind]) : Promise.resolve())); }
$<HTMLSelectElement>('#background-picker').onchange = async event => { const url = (event.target as HTMLSelectElement).value; try { if (url.startsWith('environment:')) { const id = url.slice(12); await world.setEnvironment(id, manifest!.environments![id]); } else if (url) { world.clearEnvironment(); await world.setBackdrop(url); } else { world.clearEnvironment(); world.freeCamera(); world.resetCamera(); } } catch { message('背景载入失败。'); } };
async function boot() {
  try { const response = await fetch('/local-assets/manifest.json', { cache: 'no-store' }); if (response.ok && response.headers.get('content-type')?.includes('json')) { manifest = await response.json(); void importManifest().then(() => updateSelection()); for (const background of manifest?.backgrounds ?? []) $<HTMLSelectElement>('#background-picker').add(new Option(background.label, background.url));
      for (const [id, asset] of Object.entries(manifest?.environments ?? {})) $<HTMLSelectElement>('#background-picker').add(new Option(`${asset.label} · 3D`, `environment:${id}`));
      const first = Object.entries(manifest?.environments ?? {})[0]; if (first) { $<HTMLSelectElement>('#background-picker').value = `environment:${first[0]}`; void world.setEnvironment(first[0], first[1]).catch(() => message('三维场景载入失败，使用默认场景。')); }
    } } catch { /* Stand-ins remain available. */ }
  refreshCatalogue(); updateSelection(); $('#loading').classList.add('hidden'); void connect();
}
world.renderer.setAnimationLoop(() => { clock.update(); const dt = Math.min(clock.getDelta(), .05); views.forEach(v => v.update(dt, v === selected)); previewMachines.forEach(v => v.update(dt, false)); world.updateCamera(dt);
  for (const view of views) { view.updateCountLabel(count(view), world.camera, canvas.clientHeight); const badge = badges.get(view.unit.id); if (!badge) continue; badge.hidden = view.displayedHp <= 0; const text = `${view.unit.label} ×${count(view)}`; if (badge.textContent !== text) badge.textContent = text; } world.renderer.render(world.scene, world.camera); });
function unitScreenPosition(view: UnitView) {
  world.camera.updateMatrixWorld();
  const rect = canvas.getBoundingClientRect(), point = view.visualPosition().add(new THREE.Vector3(0, view.height / 2, 0)).project(world.camera);
  return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
}
Object.assign(window, { battleLab: { snapshot: () => ({ connected, busy, deploying, projectiles, pointerAttack, state, deployment, previewMachines: previewMachines.map(view => ({ ...view.unit })), renderedObstacles: world.obstacleCount(), terrain: world.terrain(), environment: world.environment(), backdrop: world.isBackdrop(), canvas: canvas.getBoundingClientRect().toJSON(), grid: world.grid.visible, selected: selected.unit.id, movementRange: world.movementRange(), camera: { position: world.camera.position.toArray(), target: world.controls.target.toArray(), enabled: world.controls.enabled }, draws: world.renderer.info.render.calls, units: views.map(v => ({ ...v.unit, screen: unitScreenPosition(v), count: count(v), native: nativeUnits.get(v.unit.id), imported: v.imported, sourceRevision: v.sourceRevision, animation: v.current, clips: v.clips.map(c => c.name), position: v.root.position.toArray(), visualPosition: v.visualPosition().toArray(), footprint: v.footprint, displayHeight: v.height, heading: v.root.rotation.y, modelYaw: v.model.rotation.y, countLabel: { depthTest: v.countLabel.material.depthTest, position: v.countLabel.getWorldPosition(new THREE.Vector3()).toArray(), visible: v.countLabel.visible }, pose: v.poseSignature() })) }), hexScreenPosition: (hex: number) => projectGround(worldPosition(fromHexId(hex))), move, attack: (targetId?: number) => { const target = targetId !== undefined ? viewFor(targetId) : views.find(v => controller(nativeUnits.get(v.unit.id)) !== controller(nativeUnits.get(viewFor(state?.activeStack ?? -1)?.unit.id ?? ''))); return target ? attack(target) : Promise.resolve(); } } });
void boot();
