import * as THREE from 'three';
import './style.css';
import { EngineClient, type EngineState, type EngineEvent, type NativeUnit } from './engine.ts';
import { creatureArt, cellAt, key, fromHexId, toHexId, type Hex, type VisualUnit } from './presentation.ts';
import { registerCreaturePack } from './creatures.ts';
import { createWorld, worldPosition } from './world.ts';
import { UnitView, type Manifest } from './units.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="battle" aria-label="可旋转的三维六角格战场"></canvas>
  <div id="stack-labels" aria-label="场上兵力"></div><header><a class="brand" href="https://github.com/yzh119/h3-battle-lab" target="_blank" rel="noreferrer">H3 <span>BATTLE LAB</span></a><div class="top-label">战场实验室 <span>01 / 林地</span></div><div class="live"><i></i> 实时 3D</div></header>
  <aside class="panel"><div class="eyebrow">战场视角</div><h1>走进战场。</h1><p class="intro">换一个角度，看清每一次交锋。</p><select id="unit-picker" aria-label="选择场上单位"><option value="azure">骷髅兵</option><option value="ember">僵尸</option></select>
  <button id="connect-engine">连接引擎</button><p id="engine-status" role="status">正在连接本地引擎…</p><button id="start-battle" disabled>开始对战</button><p id="turn-status" role="status">配置阵容后开始对战</p><div class="button-row"><button id="wait-turn" disabled>等待</button><button id="defend-turn" disabled>防御</button></div><p id="turn-queue"></p><label class="switch"><span>射手强制近战</span><input id="force-melee" type="checkbox"></label>
  <details id="army-editor" open><summary>配置双方阵容</summary><p id="selected-slot-label"></p><label for="creature-picker">兵种</label><select id="creature-picker" aria-label="选择上场兵种"></select><label for="team-picker">阵营</label><select id="team-picker" aria-label="选择上场阵营"><option value="0">蓝方</option><option value="1">红方</option></select><label for="stack-count">每队数量</label><input id="stack-count" aria-label="每队数量" type="number" min="1" max="99999" step="1" value="20"><button id="assign-slot">配置选中格子</button><button id="apply-count" class="quiet">应用数量到选中队伍</button><p id="creature-note"></p><div class="button-row"><button id="add-unit">添加上场</button><button id="replace-unit">替换选中</button></div><button id="remove-unit" class="quiet">移除选中单位</button><p>每方最多 7 队 · 双方均可操控<br>点击队伍格配置兵种与数量；空格也可直接选择</p></details><details><summary>自定义兵种</summary><p>验证版本 1 的兵种 JSON。引擎端导入正在开发，通过格式验证的定义暂不能加入对战。</p><input id="creature-import" aria-label="导入自定义兵种 JSON" type="file" accept=".json,application/json"><p id="creature-import-status" role="status"></p></details><div class="section-label">镜头</div><div class="button-row"><button id="overview" class="active">全局</button><button id="closeup">兵种特写</button></div>
  <div class="button-row zoom-controls"><button id="zoom-out" aria-label="缩小战场">− 缩小</button><button id="zoom-in" aria-label="放大战场">＋ 放大</button></div><div class="section-label">场景</div><select id="background-picker" aria-label="战场背景"><option value="">自由 3D 场景</option></select><p id="scene-hint" class="intro">拖动旋转镜头</p><div class="section-label">环境</div><div class="button-row"><button id="day" class="active">暖阳</button><button id="dusk">阴天</button></div>
  <label class="switch"><span>显示六角格</span><input id="grid" type="checkbox"></label>
  <label class="switch"><span>实时阴影</span><input id="shadows" type="checkbox" checked></label>
  <label class="range"><span>画面精细度 <b id="quality-label">高</b></span><input id="quality" aria-label="画面精细度" type="range" min="1" max="2" step=".5" value="2"></label>
  <div class="divider"></div><p class="rules-note">目标：原版 H3 基础战斗 · 一致性待验证<br>兵种行动与结果由 VCMI 计算；英雄、施法和美术接入仍在开发。</p><div id="combat-log" role="log" aria-label="战斗记录"></div><div class="section-label">动作预览</div><div class="actions"><button data-action="idle">待机</button><button data-action="walk">行走</button><button data-action="attack">攻击</button><button data-action="hit">受击</button></div>
  <button id="reset" class="quiet">重置战场 ↺</button><details><summary>载入本地模型</summary><p>选择内嵌贴图的 GLB，替换当前选中的单位。</p><input id="import" aria-label="载入本地 GLB 模型" type="file" accept=".glb"></details>
  </aside><div id="army-slots" aria-label="双方七格阵容"></div>
  <div class="loading" id="loading"><span class="spinner"></span>正在准备战场</div>
  <div id="toast" role="status" aria-live="polite"></div>
  <footer><div class="selected"><span class="team-dot"></span><div><small>当前兵种</small><strong id="unit-name">骷髅兵</strong></div><span id="hp">100 / 100</span></div><div class="controls-hint">点击兵种选择 · 点击地面移动 · 点击敌军接近并攻击<br><span>拖动旋转 · 滚轮缩放 · 右键平移</span></div><div class="prototype">战场原型 <span id="asset-status">基础场景</span><small id="fps">—</small></div></footer>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#battle'), world = createWorld(canvas), clock = new THREE.Timer();
const engine = new EngineClient();
let connected = false, busy = false, state: EngineState | undefined, manifest: Manifest | undefined, generation = 0, nextId = 1, projectiles = 0;
let views: UnitView[] = [], selected: UnitView;
let editorTeam = 0, editorSlot = 0;
const configured = () => views.map(v => ({ ...v.unit, cell: { ...v.unit.cell } }));
let startingArmy: VisualUnit[] = [];
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
function count(view: UnitView) { return nativeUnits.get(view.unit.id)?.count ?? view.unit.initialCount; }
function updateSelection(view = selected) {
  selected = view;
  $('#unit-picker').replaceChildren(...views.map(v => new Option(`${v.unit.team ? '红方' : '蓝方'} · ${v.unit.label} ×${count(v)}`, v.unit.id)));
  $<HTMLSelectElement>('#unit-picker').value = view.unit.id; $('#unit-name').textContent = view.unit.label;
  const native = nativeUnits.get(view.unit.id);
  $('#hp').textContent = native ? `${native.count} 只 · 末只 ${native.topHealth}/${native.maxHealth} HP · 弹药 ${native.shots}` : `${view.unit.initialCount} 只 · 配置中`;
  $('#asset-status').textContent = `${views.filter(v => v.imported).length} / ${views.length} 个本地模型`;
  $<HTMLInputElement>('#stack-count').value = String(view.unit.initialCount);
  for (const id of ['#creature-picker', '#team-picker', '#stack-count', '#apply-count', '#add-unit', '#replace-unit', '#remove-unit', '#creature-import', '#assign-slot'])
    ($<HTMLInputElement>(id)).disabled = busy || !!state;
  $<HTMLButtonElement>('#reset').disabled = busy;
  $<HTMLButtonElement>('#connect-engine').disabled = busy || !!state;
  $<HTMLButtonElement>('#start-battle').disabled = busy || !connected || !!state;
  $<HTMLButtonElement>('#wait-turn').disabled = busy || !state?.legal?.wait;
  $<HTMLButtonElement>('#defend-turn').disabled = busy || !state?.legal?.defend;
  const occupiedSlot = views.some(v => v.unit.team === editorTeam && v.unit.armySlot === editorSlot);
  for (const id of ['#apply-count', '#replace-unit', '#remove-unit']) $<HTMLButtonElement>(id).disabled = busy || !!state || !occupiedSlot;
  renderArmySlots();
  const active = views.find(v => nativeUnits.get(v.unit.id)?.id === state?.activeStack);
  $('#turn-status').textContent = state ? state.winner != null ? `${state.winner === 0 ? '蓝方' : state.winner === 1 ? '红方' : '双方'}${state.winner > 1 ? '平局' : '胜利'} · 第 ${state.round} 回合` : `第 ${state.round} 回合 · ${active?.unit.team ? '红方' : '蓝方'} ${active?.unit.label ?? ''}行动` : '配置阵容后开始对战';
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
      row.append(button);
    }
    group.append(row); root.append(group);
  }
  $('#selected-slot-label').textContent = `${editorTeam ? '红方' : '蓝方'} · 第 ${editorSlot + 1} 格`;
}
function applyState(next: EngineState, selectActor = false) {
  for (const unit of next.units) {
    const view = slotViews.get(`${unit.side}:${unit.slot}`); if (!view) continue;
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
async function action(kind: string, options: Record<string, number> = {}) {
  if (busy || !state || state.winner != null) return;
  const token = generation; busy = true; updateSelection();
  try {
    const result = await engine.act(state, kind, options);
    if (generation !== token) return;
    await playback(result.events, token);
    if (generation !== token) return;
    state = result.state; applyState(state, true); world.showPath(null);
  } catch (error) { if (generation === token) message(error instanceof Error ? error.message : String(error)); }
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
async function connect() {
  if (busy || state) return; busy = true; updateSelection(); $('#engine-status').textContent = '正在连接本地引擎…';
  try { const info = await engine.connect(); connected = info.backend === 'vcmi-native' && info.creatures.length === 28; $('#engine-status').textContent = 'VCMI 已连接 · 城堡与墓园 28 种兵种'; }
  catch (error) { connected = false; $('#engine-status').textContent = error instanceof Error ? error.message : '引擎连接失败'; }
  busy = false; updateSelection();
}
$('#connect-engine').onclick = () => void connect();
$('#start-battle').onclick = async () => {
  if (busy || !connected || state) return;
  if (![0, 1].every(team => views.some(v => v.unit.team === team))) { message('双方均须有队伍。'); return; }
  startingArmy = configured(); busy = true; updateSelection(); slotViews.clear();
  const armies = [0, 1].map(team => views.filter(v => v.unit.team === team).sort((a, b) => a.unit.armySlot - b.unit.armySlot).map(v => { slotViews.set(`${team}:${v.unit.armySlot}`, v); return { creature: metadata(v.unit.kind).id, count: v.unit.initialCount, slot: v.unit.armySlot }; }));
  try { const result = await engine.create(1337, armies); state = result.state; applyState(state, true); $('#army-editor').removeAttribute('open'); message('双方阵容已进入战场。'); }
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
$('#apply-count').onclick = () => { if (busy || state) return; const value = readCount(); if (value !== null) { selected.unit.initialCount = value; updateSelection(); } };
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
    if (manifest?.units[kind]) await view.setAsset(manifest.units[kind]);
    if (replace) { const index = views.indexOf(target!); target!.dispose(); views[index] = view; }
    else { views.push(view); const badge = document.createElement('div'); badge.className = 'stack-badge'; badge.style.borderColor = unit.team ? '#cf8e7b' : '#7babc9'; $('#stack-labels').append(badge); badges.set(unit.id, badge); }
    world.scene.add(view.root); editorTeam = team; editorSlot = slot; updateSelection(view);
  } catch { view.dispose(); message('模型载入失败，原阵容已保留。'); }
  finally { busy = false; updateSelection(); }
}
$('#assign-slot').onclick = () => void configureUnit(false, true);
$('#add-unit').onclick = () => void configureUnit(false); $('#replace-unit').onclick = () => void configureUnit(true);
$('#remove-unit').onclick = () => { if (busy || state || views.length < 2) return; const view = selected; views = views.filter(v => v !== view); view.dispose(); badges.get(view.unit.id)?.remove(); badges.delete(view.unit.id); updateSelection(views[0]); };
$('#reset').onclick = async () => {
  if (busy) return;
  const hadBattle = !!state;
  ++generation; state = undefined; busy = true; nativeUnits.clear(); slotViews.clear();
  try { if (connected) await engine.dispose(); } catch { connected = false; }
  const army = hadBattle && startingArmy.length ? startingArmy : configured();
  views.forEach(v => v.dispose()); views = []; badges.forEach(b => b.remove()); badges.clear();
  army.forEach(unit => attach({ ...unit, cell: { ...unit.cell }, hp: 1 })); selected = views[0]; editorTeam = selected.unit.team; editorSlot = selected.unit.armySlot; world.showPath(null); world.setObstacles([]); $('#combat-log').replaceChildren(); $('#army-editor').setAttribute('open', '');
  await importManifest(); busy = false; updateSelection();
};
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), pressed = new THREE.Vector2();
function point(event: PointerEvent) { const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, world.camera); }
canvas.onpointermove = event => { if (busy) return; point(event); const hit = raycaster.intersectObjects(world.pickable)[0]; world.hover.visible = !!hit; if (!hit) { world.showPath(null); return; } const cell = hit.object.userData.cell as Hex; world.hover.position.copy(worldPosition(cell)); world.hover.position.y = .035; const path = state?.legal?.moves.find(move => move.hex === toHexId(cell))?.path; world.showPath(path?.map(fromHexId) ?? null); };
canvas.onpointerdown = event => { pressed.set(event.clientX, event.clientY); };
canvas.onpointerup = event => { if (event.button !== 0 || busy || pressed.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return; point(event);
  const unit = raycaster.intersectObjects(views.map(v => v.proxy))[0]; if (unit) { const view = views.find(v => v.unit.id === unit.object.userData.unitId)!; if (state && nativeUnits.get(view.unit.id)?.side !== nativeUnits.get(viewFor(state.activeStack!)?.unit.id ?? '')?.side) void attack(view); else selectView(view); return; }
  const tile = raycaster.intersectObjects(world.pickable)[0]; if (tile) void move(tile.object.userData.cell);
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
async function importManifest() { if (!manifest) return; await Promise.allSettled(views.map(v => manifest!.units[v.unit.kind] ? v.setAsset(manifest!.units[v.unit.kind]) : Promise.resolve())); }
$<HTMLSelectElement>('#background-picker').onchange = async event => { const url = (event.target as HTMLSelectElement).value; try { if (url) await world.setBackdrop(url); else { world.freeCamera(); world.resetCamera(); } } catch { message('背景载入失败。'); } };
async function boot() {
  try { const response = await fetch('/local-assets/manifest.json'); if (response.ok && response.headers.get('content-type')?.includes('json')) { manifest = await response.json(); await importManifest(); for (const background of manifest?.backgrounds ?? []) $<HTMLSelectElement>('#background-picker').add(new Option(background.label, background.url)); if (manifest?.backgrounds?.length) { await world.setBackdrop(manifest.backgrounds[0].url); $<HTMLSelectElement>('#background-picker').value = manifest.backgrounds[0].url; } } } catch { /* Stand-ins remain available. */ }
  refreshCatalogue(); updateSelection(); $('#loading').classList.add('hidden'); void connect();
}
world.renderer.setAnimationLoop(() => { clock.update(); const dt = Math.min(clock.getDelta(), .05); views.forEach(v => v.update(dt, v === selected)); if (world.controls.enabled) world.controls.update(); world.renderer.render(world.scene, world.camera);
  const rect = canvas.getBoundingClientRect(); for (const view of views) { const badge = badges.get(view.unit.id); if (!badge) continue; const point = view.root.position.clone().add(new THREE.Vector3(0, .15, 0)).project(world.camera); badge.hidden = view.unit.hp <= 0 || Math.abs(point.z) > 1; badge.textContent = String(count(view)); badge.style.left = `${rect.left + (point.x + 1) * rect.width / 2}px`; badge.style.top = `${rect.top + (1 - point.y) * rect.height / 2}px`; } });
Object.assign(window, { battleLab: { snapshot: () => ({ connected, busy, projectiles, state, backdrop: world.isBackdrop(), canvas: canvas.getBoundingClientRect().toJSON(), grid: world.grid.visible, draws: world.renderer.info.render.calls, units: views.map(v => ({ ...v.unit, count: count(v), native: nativeUnits.get(v.unit.id), imported: v.imported, animation: v.current, clips: v.clips.map(c => c.name), pose: v.poseSignature() })) }), move, attack: () => { const target = views.find(v => nativeUnits.get(v.unit.id)?.side !== nativeUnits.get(viewFor(state?.activeStack ?? -1)?.unit.id ?? '')?.side); return target ? attack(target) : Promise.resolve(); } } });
void boot();
