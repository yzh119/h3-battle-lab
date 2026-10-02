import * as THREE from 'three';
import './style.css';
import { creatureDefinitions, registerCreaturePack, creatureDefinition } from './creatures.ts';
import { Battle, movementPath, approachPath, initialUnits, stats, creatureStats, stackCount, topHealth, setStackCount, MAX_STACK_COUNT, occupied, obstacles, key, cellAt, type Unit, type Hex } from './battle.ts';
import { createWorld, worldPosition } from './world.ts';
import { UnitView, type Manifest } from './units.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="battle" aria-label="可旋转的三维六角格战场"></canvas>
  <div id="stack-labels" aria-label="场上兵力"></div><header><a class="brand" href="https://github.com/yzh119/h3-battle-lab" target="_blank" rel="noreferrer">H3 <span>BATTLE LAB</span></a><div class="top-label">战场实验室 <span>01 / 林地</span></div><div class="live"><i></i> 实时 3D</div></header>
  <aside class="panel"><div class="eyebrow">战场视角</div><h1>走进战场。</h1><p class="intro">换一个角度，看清每一次交锋。</p><select id="unit-picker" aria-label="选择场上单位"><option value="azure">骷髅兵</option><option value="ember">僵尸</option></select>
  <button id="start-battle">开始对战</button><p id="turn-status" role="status">配置阵容后开始对战</p><div class="button-row"><button id="wait-turn" disabled>等待</button><button id="defend-turn" disabled>防御</button></div><p id="turn-queue"></p>
  <details id="army-editor" open><summary>配置双方阵容</summary><label for="creature-picker">兵种</label><select id="creature-picker" aria-label="选择上场兵种"></select><label for="team-picker">阵营</label><select id="team-picker" aria-label="选择上场阵营"><option value="0">蓝方</option><option value="1">红方</option></select><label for="stack-count">每队数量</label><input id="stack-count" aria-label="每队数量" type="number" min="1" max="99999" step="1" value="20"><button id="apply-count" class="quiet">应用数量到选中队伍</button><p id="creature-note"></p><div class="button-row"><button id="add-unit">添加上场</button><button id="replace-unit">替换选中</button></div><button id="remove-unit" class="quiet">移除选中单位</button><p>每方最多 7 队 · 双方均可操控<br>替换保留所选单位的阵营和位置</p></details><details><summary>自定义兵种</summary><p>导入版本 1 的兵种 JSON，然后在阵容中选择。模型按兵种 ID 从本地美术清单匹配。</p><input id="creature-import" aria-label="导入自定义兵种 JSON" type="file" accept=".json,application/json"><p id="creature-import-status" role="status"></p></details><div class="section-label">镜头</div><div class="button-row"><button id="overview" class="active">全局</button><button id="closeup">兵种特写</button></div>
  <div class="button-row zoom-controls"><button id="zoom-out" aria-label="缩小战场">− 缩小</button><button id="zoom-in" aria-label="放大战场">＋ 放大</button></div><div class="section-label">场景</div><select id="background-picker" aria-label="战场背景"><option value="">自由 3D 场景</option></select><p id="scene-hint" class="intro">拖动旋转镜头</p><div class="section-label">环境</div><div class="button-row"><button id="day" class="active">暖阳</button><button id="dusk">阴天</button></div>
  <label class="switch"><span>显示六角格</span><input id="grid" type="checkbox"></label>
  <label class="switch"><span>实时阴影</span><input id="shadows" type="checkbox" checked></label>
  <label class="range"><span>画面精细度 <b id="quality-label">高</b></span><input id="quality" aria-label="画面精细度" type="range" min="1" max="2" step=".5" value="2"></label>
  <div class="divider"></div><p class="rules-note">原版 H3 基础战斗 · 部分实现<br>已接入回合、反击与部分兵种特性；英雄、魔法和完整兵种仍在开发。</p><div id="combat-log" role="log" aria-label="战斗记录"></div><div class="section-label">动作预览</div><div class="actions"><button data-action="idle">待机</button><button data-action="walk">行走</button><button data-action="attack">攻击</button><button data-action="hit">受击</button></div>
  <button id="reset" class="quiet">重置战场 ↺</button><details><summary>载入本地模型</summary><p>选择内嵌贴图的 GLB，替换当前选中的单位。</p><input id="import" aria-label="载入本地 GLB 模型" type="file" accept=".glb"></details>
  </aside>
  <div class="loading" id="loading"><span class="spinner"></span>正在准备战场</div>
  <div id="toast" role="status" aria-live="polite"></div>
  <footer><div class="selected"><span class="team-dot"></span><div><small>当前兵种</small><strong id="unit-name">骷髅兵</strong></div><span id="hp">100 / 100</span></div><div class="controls-hint">点击兵种选择 · 点击地面移动 · 点击敌军接近并攻击<br><span>拖动旋转 · 滚轮缩放 · 右键平移</span></div><div class="prototype">战场原型 <span id="asset-status">基础场景</span><small id="fps">—</small></div></footer>`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#battle');
const world = createWorld(canvas);
let units = initialUnits(), views = units.map(u => new UnitView(u));
views.forEach(v => world.scene.add(v.root));
let selected = views[0], busy = false, generation = 0, manifest: Manifest | undefined;
let battle: Battle | undefined;
let nextUnitId = 1;
const badges = new Map<string, HTMLDivElement>();
const labelPosition = new THREE.Vector3();
const catalogue: Record<string, { label: string; faction: string; draft?: boolean }> = Object.create(null);
let startingArmy: Unit[] = structuredClone(units);
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const clock = new THREE.Timer();
let messageTimer: ReturnType<typeof setTimeout>;
function message(text: string) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(messageTimer); messageTimer = setTimeout(() => $('#toast').classList.remove('show'), 3800); }
function updateSelection(view = selected) {
  selected = view;
  updateTurnUI();
  const picker = $<HTMLSelectElement>('#unit-picker'); picker.replaceChildren(...views.map(v => new Option(`${v.unit.team ? '红方' : '蓝方'} · ${v.unit.label} ×${stackCount(v.unit)}${v.unit.hp <= 0 ? '（阵亡）' : ''}`, v.unit.id)));
  $('#asset-status').textContent = `${views.filter(v => v.imported).length} / ${views.length} 个本地模型`;
  $('#unit-name').textContent = view.unit.label; $('#hp').textContent = `${stackCount(view.unit)} 只 · 末只 ${topHealth(view.unit)}/${stats(view.unit).health} HP`;
  $<HTMLSelectElement>('#unit-picker').value = view.unit.id;
  $<HTMLInputElement>('#stack-count').value = String(view.unit.initialCount);
  for (const [id, badge] of badges) if (!units.some(u => u.id === id)) { badge.remove(); badges.delete(id); }
  for (const unit of units) if (!badges.has(unit.id)) { const badge = document.createElement('div'); badge.className = 'stack-badge'; $('#stack-labels').append(badge); badges.set(unit.id, badge); }
  $('.team-dot').style.background = view.unit.team ? '#ef9a76' : '#acdada';
}
function updateTurnUI() {
  const inBattle = !!battle;
  for (const id of ['creature-import', 'apply-count', 'add-unit', 'replace-unit', 'remove-unit', 'start-battle']) $<HTMLButtonElement>('#' + id).disabled = inBattle;
  $<HTMLButtonElement>('#wait-turn').disabled = !battle?.active || !battle.canWait(battle.active.id);
  $<HTMLButtonElement>('#defend-turn').disabled = !battle?.active;
  $('#turn-status').textContent = battle ? battle.winner !== null ? `${battle.winner ? '红方' : '蓝方'}胜利 · 第 ${battle.round} 回合` : `第 ${battle.round} 回合 · ${battle.active!.team ? '红方' : '蓝方'} ${battle.active!.label}行动 · 速度 ${stats(battle.active!).speed}` : '配置阵容后开始对战';
  $('#turn-queue').textContent = battle ? battle.queue().map(id => units.find(u => u.id === id)!.label).join(' → ') : '';
}
function selectActive() {
  updateSelection(battle?.active ? views.find(v => v.unit.id === battle!.activeId)! : selected);
  world.showPath(null); hoverKey = '';
}
function acting(): boolean {
  if (!battle) { message('请先配置阵容并开始对战。'); return false; }
  if (!battle.canAct(selected.unit.id)) { message(battle.winner !== null ? '战斗已结束，可重置阵容再战。' : '请操控当前行动队伍。'); return false; }
  return true;
}
$('#start-battle').onclick = () => {
  if (busy || battle) return;
  try { battle = new Battle(units); $('#army-editor').removeAttribute('open'); world.grid.visible = true; $<HTMLInputElement>('#grid').checked = true; selectActive(); }
  catch { message('双方都需要至少一队存活兵种，且部署位置不能重叠。'); }
};
$('#wait-turn').onclick = () => { if (!busy && battle?.active && battle.wait(battle.active.id)) selectActive(); };
$('#defend-turn').onclick = () => { if (!busy && battle?.active && battle.defend(battle.active.id)) selectActive(); };
function point(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, world.camera);
}
let hoverKey = '';
canvas.addEventListener('pointermove', event => {
  if (event.buttons || busy) return; point(event);
  const hit = raycaster.intersectObjects(world.pickable)[0];
  if (!hit) { world.hover.visible = false; world.showPath(null); return; }
  const cell: Hex = hit.object.userData.cell; const k = key(cell); world.hover.visible = !obstacles.has(k);
  world.hover.position.copy(worldPosition(cell)); world.hover.position.y = .035;
  if (hoverKey !== k) { hoverKey = k; world.showPath(battle?.canAct(selected.unit.id) ? movementPath(selected.unit, cell, units) : null); }
});
let pressed = new THREE.Vector2();
canvas.addEventListener('pointerdown', event => { pressed.set(event.clientX, event.clientY); });
canvas.addEventListener('pointerup', async event => {
  if (event.button !== 0 || pressed.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5 || busy) return;
  point(event);
  const hitUnit = raycaster.intersectObjects(views.filter(v => v.unit.hp > 0).map(v => v.proxy))[0];
  if (hitUnit) {
    const view = views.find(v => v.unit.id === hitUnit.object.userData.unitId)!;
    if (view.unit.team !== selected.unit.team && selected.unit.hp > 0) await attack(view);
    else updateSelection(view);
    return;
  }
  const hit = raycaster.intersectObjects(world.pickable)[0];
  if (hit) await move(hit.object.userData.cell);
});

function face(view: UnitView, p: THREE.Vector3) { view.root.rotation.y = Math.atan2(p.x - view.root.position.x, p.z - view.root.position.z); }
const wait = (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds * 1000));
async function follow(route: Hex[], token: number) {
  const moving = selected; moving.play('walk');
  for (const cell of route) {
    if (token !== generation) return;
    const start = moving.root.position.clone(), end = worldPosition(cell); face(moving, end);
    const duration = start.distanceTo(end) / 3.1, began = performance.now();
    await new Promise<void>(resolve => {
      const step = () => {
        if (token !== generation) { resolve(); return; }
        const t = Math.min(1, (performance.now() - began) / (duration * 1000)); moving.root.position.lerpVectors(start, end, t);
        if (t < 1) requestAnimationFrame(step); else resolve();
      }; requestAnimationFrame(step);
    });
    if (token !== generation) return;
    moving.unit.cell = { ...cell };
  }
  if (token === generation) moving.play('idle');
}
async function move(cell: Hex) {
  if (busy || selected.unit.hp <= 0 || !acting()) return;
  const route = movementPath(selected.unit, cell, units);
  if (!route?.length) { message(`这格被占据，或超过速度范围（${stats(selected.unit).speed} 格）。`); return; }
  busy = true; world.showPath(route); const token = generation;
  try { const actor = selected.unit, from = { ...actor.cell }; await follow(route, token); if (token === generation) { actor.cell = from; battle!.move(actor.id, cell); selectActive(); } } finally { if (token === generation) { busy = false; world.showPath(null); } }
}
async function attack(defender: UnitView) {
  if (busy || selected.unit.hp <= 0 || defender.unit.hp <= 0 || selected.unit.team === defender.unit.team || !acting()) return;
  const token = generation, attacker = selected;
  const route = approachPath(attacker.unit, defender.unit, units);
  if (!route) { message('本回合速度不足，或无法接近敌军。'); return; }
  busy = true;
  try {
    await follow(route, token);
    if (token !== generation) return;
    const blows = battle!.melee(attacker.unit.id, defender.unit.id);
    for (const blow of blows ?? []) {
      if (token !== generation) return;
      const source = views.find(v => v.unit.id === blow.attacker)!, target = views.find(v => v.unit.id === blow.defender)!;
      face(source, target.root.position); const duration = source.play('attack', true); await wait(duration * .48);
      if (token !== generation) return;
      target.play(blow.remaining ? 'hit' : 'death', true);
      const text = `${blow.counter ? '反击 · ' : ''}${source.unit.label} → ${target.unit.label}：${blow.damage} 伤害，击杀 ${blow.killed}，剩余 ${blow.remaining}（范围 ${blow.range.min}–${blow.range.max}）`;
      message(text); const entry = document.createElement('p'); entry.textContent = text; $('#combat-log').prepend(entry);
      while ($('#combat-log').children.length > 12) $('#combat-log').lastElementChild!.remove();
      await wait(duration * .52);
    }
    if (token === generation) selectActive();
  } finally { if (token === generation) busy = false; }
}

function toggleButtons(a: string, b: string, active: string) { $(a).classList.toggle('active', active === a); $(b).classList.toggle('active', active === b); }
$('#zoom-in').onclick = () => world.zoomBy(1.2);
$('#zoom-out').onclick = () => world.zoomBy(1 / 1.2);
$('#overview').onclick = () => { world.resetCamera(); toggleButtons('#overview', '#closeup', '#overview'); };
$('#unit-picker').onchange = event => {
  if (busy) { $<HTMLSelectElement>('#unit-picker').value = selected.unit.id; return; }
  updateSelection(views.find(v => v.unit.id === (event.target as HTMLSelectElement).value)!);
  if ($('#closeup').classList.contains('active')) world.frameUnit(selected.root.position);
};
$('#closeup').onclick = () => { $<HTMLSelectElement>('#background-picker').value = ''; $('#scene-hint').textContent = '自由 3D 特写'; world.frameUnit(selected.root.position); toggleButtons('#overview', '#closeup', '#closeup'); };
$('#day').onclick = () => { world.setMood(false); toggleButtons('#day', '#dusk', '#day'); };
$('#dusk').onclick = () => { world.setMood(true); toggleButtons('#day', '#dusk', '#dusk'); };
$<HTMLInputElement>('#grid').onchange = e => { world.grid.visible = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('#shadows').onchange = e => { world.renderer.shadowMap.enabled = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('#quality').oninput = e => { const quality = +(e.target as HTMLInputElement).value; world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality)); $('#quality-label').textContent = quality === 2 ? '高' : quality === 1.5 ? '中' : '标准'; };
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => { button.onclick = () => {
  if (busy) return; const action = button.dataset.action!;
  if (selected.imported && !selected.clips.some(c => c.name.toLowerCase().includes(action))) { message('这个模型没有对应的动画片段。'); return; }
  selected.play(action, !['idle', 'walk'].includes(action));
}; });
function refreshCatalogue() {
  for (const def of creatureDefinitions()) catalogue[def.id] = { label: def.label + (def.ruleset === 'custom' ? ' · 自定义' : ''), faction: def.faction };
  if (manifest) for (const [kind, asset] of Object.entries(manifest.units)) if (creatureStats[kind]) catalogue[kind] = { label: asset.label + (creatureDefinition(kind).ruleset === 'custom' ? ' · 自定义' : ''), faction: asset.faction ?? catalogue[kind]?.faction ?? '本地', draft: asset.draft };
  const picker = $<HTMLSelectElement>('#creature-picker'); const value = picker.value; picker.replaceChildren();
  for (const faction of [...new Set(Object.values(catalogue).map(c => c.faction))]) {
    const group = document.createElement('optgroup'); group.label = faction;
    for (const [kind, info] of Object.entries(catalogue)) if (info.faction === faction) group.append(new Option(info.label + (info.draft ? ' · 草稿' : ''), kind));
    picker.append(group);
  }
  if (catalogue[value]) picker.value = value;
  describeCreature();
}
function describeCreature() {
  const kind = $<HTMLSelectElement>('#creature-picker').value;
  $('#creature-note').textContent = manifest?.units[kind] ? (catalogue[kind].draft ? '本地 3D 动画 · 美术草稿，外观仍在修订' : '本地 3D 模型与动画') : '未配置本地美术，将显示几何示意模型';
}
function saveArmy() { startingArmy = units.map(u => {
  const previous = startingArmy.find(s => s.id === u.id);
  return { ...u, cell: { ...(previous?.cell ?? u.cell) }, hp: u.initialCount * stats(u).health };
}); }
function readCount(): number | null {
  const input = $<HTMLInputElement>('#stack-count'), count = input.valueAsNumber;
  if (!Number.isInteger(count) || count < 1 || count > MAX_STACK_COUNT) { message(`数量须为 1–${MAX_STACK_COUNT} 的整数。`); return null; }
  return count;
}
$('#apply-count').onclick = () => {
  if (busy || battle) return; const count = readCount(); if (count === null) return;
  if (selected.unit.hp <= 0 && occupied(units, selected.unit.id).has(key(selected.unit.cell))) { message('该队伍的位置已被占据，请先重置战场。'); return; }
  setStackCount(selected.unit, count); selected.play('idle'); saveArmy(); updateSelection(); message('选中队伍数量已更新，生命已补满。');
};
async function configureUnit(replace: boolean) {
  if (busy || battle) return;
  const kind = $<HTMLSelectElement>('#creature-picker').value;
  const count = readCount(); if (count === null) return;
  const team = replace ? selected.unit.team : Number($<HTMLSelectElement>('#team-picker').value);
  if (!replace && units.filter(u => u.team === team).length >= 7) { message('每方最多 7 队，请先移除一队。'); return; }
  const blocked = occupied(units, '');
  const spawn = replace ? selected.unit.cell : Array.from({ length: 9 }, (_, i) => cellAt(team ? 12 : 4, i + 1)).find(c => !blocked.has(key(c)));
  if (!spawn) { message('部署区已被占满。'); return; }
  if (replace && occupied(units, selected.unit.id).has(key(spawn))) { message('该位置已被其它队伍占据，请先重置战场。'); return; }
  const old = selected, token = generation;
  const unit: Unit = { id: replace ? old.unit.id : `unit-${nextUnitId++}`, kind, label: creatureDefinition(kind).label, team, cell: { ...spawn }, hp: count * creatureStats[kind].health, initialCount: count };
  const view = new UnitView(unit); busy = true; $('#army-editor').setAttribute('aria-busy', 'true'); message('正在准备兵种…');
  try {
    const asset = manifest?.units[kind]; if (asset) await view.setAsset(asset);
    if (token !== generation) { view.dispose(); return; }
    if (replace) { const i = views.indexOf(old); views[i] = view; units[i] = unit; old.dispose(); }
    else { views.push(view); units.push(unit); }
    world.scene.add(view.root); updateSelection(view); saveArmy(); world.showPath(null);
    message(`${unit.label}已${replace ? '替换选中单位' : '加入' + (team ? '红方' : '蓝方')}${asset ? '' : '（示意模型）'}`);
  } catch { view.dispose(); if (token === generation) message('模型载入失败，原阵容已保留。'); }
  finally { if (token === generation) busy = false; $('#army-editor').removeAttribute('aria-busy'); }
}
$('#creature-picker').onchange = describeCreature;
$('#add-unit').onclick = () => void configureUnit(false);
$('#replace-unit').onclick = () => void configureUnit(true);
$('#remove-unit').onclick = () => {
  if (busy || battle) return;
  if (views.length === 1) { message('至少保留一个单位。'); return; }
  const old = selected; views = views.filter(v => v !== old); units = units.filter(u => u !== old.unit); old.dispose(); updateSelection(views[0]); saveArmy(); world.showPath(null);
};
$('#reset').onclick = async () => {
  battle = undefined; $('#army-editor').setAttribute('open', '');
  $('#combat-log').replaceChildren();
  const token = ++generation; busy = true; views.forEach(v => v.dispose()); units = structuredClone(startingArmy); views = units.map(u => new UnitView(u)); views.forEach(v => world.scene.add(v.root)); updateSelection(views[0]); world.showPath(null);
  if (manifest) await importManifest(manifest);
  if (token === generation) { busy = false; updateSelection(); message('当前阵容已重置。'); }
};
$<HTMLInputElement>('#import').onchange = async event => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file || busy) return;
  busy = true; const token = generation;
  const url = URL.createObjectURL(file); const target = selected;
  try { await target.setAsset({ label: file.name, url }); if (token !== generation) { target.dispose(); return; } target.unit.label = file.name.replace(/\.glb$/i, ''); updateSelection(target); world.frameUnit(target.root.position); message('本地模型已载入。'); }
  catch { message('模型载入失败，请使用贴图内嵌的 GLB。'); }
  finally { URL.revokeObjectURL(url); if (token === generation) busy = false; }
};
$<HTMLInputElement>('#creature-import').onchange = async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file || busy || battle) { input.value = ''; return; }
  busy = true; const token = generation;
  try {
    if (file.size > 1024 * 1024) throw new Error('兵种 JSON 不能超过 1 MB');
    const data: unknown = JSON.parse(await file.text());
    if (token !== generation) return;
    const pack = registerCreaturePack(data); refreshCatalogue();
    $<HTMLSelectElement>('#creature-picker').value = pack.creatures[0].id; describeCreature();
    $('#creature-import-status').textContent = `已导入 ${pack.creatures.length} 个自定义兵种`;
  } catch (error) { if (token === generation) $('#creature-import-status').textContent = `导入失败：${error instanceof Error ? error.message : String(error)}`; }
  finally { input.value = ''; if (token === generation) busy = false; }
};
async function importManifest(data: Manifest) {
  const results = await Promise.allSettled(views.map(v => data.units[v.unit.kind] ? v.setAsset(data.units[v.unit.kind]) : Promise.resolve()));
  const count = views.filter(v => v.imported).length; $('#asset-status').textContent = count ? `${count} 个本地 3D 模型` : '基础模型';
  if (results.some(r => r.status === 'rejected')) message('部分模型未能载入，已保留基础模型。');
}
$<HTMLSelectElement>('#background-picker').onchange = async event => {
  const url = (event.target as HTMLSelectElement).value;
  try {
    if (url) { await world.setBackdrop(url); $('#scene-hint').textContent = '高清背景 · 滚轮缩放 · 全局复位'; }
    else { world.freeCamera(); world.resetCamera(); $('#scene-hint').textContent = '拖动旋转镜头'; }
    toggleButtons('#overview', '#closeup', '#overview');
  } catch { message('背景载入失败，保留当前场景。'); }
};
async function boot() {
  try {
      const packResponse = await fetch('/local-assets/creatures.json');
      if (packResponse.ok && packResponse.headers.get('content-type')?.includes('json')) {
        try { registerCreaturePack(await packResponse.json()); } catch (error) { $('#creature-import-status').textContent = `本地兵种包无效：${error instanceof Error ? error.message : String(error)}`; }
      }
  } catch { /* Optional creature packs do not block the public scene. */ }
  try {
    const response = await fetch('/local-assets/manifest.json');
    if (response.ok && response.headers.get('content-type')?.includes('json')) { const data = await response.json(); if (data.units) { manifest = data;
      await importManifest(data);
      for (const background of data.backgrounds ?? []) { const option = new Option(background.label, background.url); $<HTMLSelectElement>('#background-picker').add(option); }
      if (data.backgrounds?.length) { await world.setBackdrop(data.backgrounds[0].url); $<HTMLSelectElement>('#background-picker').value = data.backgrounds[0].url; $('#scene-hint').textContent = '高清背景 · 滚轮缩放 · 全局复位'; }
    } }
  } catch { message('本地美术未载入；基础场景可正常使用。'); }
  refreshCatalogue(); updateSelection(); $('#loading').classList.add('hidden');
}
let frames = 0, last = performance.now();
world.renderer.setAnimationLoop(() => {
  clock.update(); const dt = Math.min(clock.getDelta(), .05); views.forEach(v => v.update(dt, v === selected));
  if (world.controls.enabled) world.controls.update();
  world.renderer.render(world.scene, world.camera);
  const canvasRect = canvas.getBoundingClientRect();
  for (const view of views) {
    const badge = badges.get(view.unit.id); if (!badge) continue;
    labelPosition.copy(view.root.position); labelPosition.y += .12; labelPosition.project(world.camera);
    badge.hidden = view.unit.hp <= 0 || Math.abs(labelPosition.z) > 1 || Math.abs(labelPosition.x) > 1 || Math.abs(labelPosition.y) > 1;
    badge.textContent = String(stackCount(view.unit)); badge.style.borderColor = view.unit.team ? '#ef9a76' : '#acdada';
    badge.style.left = `${canvasRect.left + (labelPosition.x + 1) * canvasRect.width / 2}px`; badge.style.top = `${canvasRect.top + (1 - labelPosition.y) * canvasRect.height / 2}px`;
  }
  frames++; if (performance.now() - last > 1000) { $('#fps').textContent = `${Math.round(frames * 1000 / (performance.now() - last))} FPS`; frames = 0; last = performance.now(); }
});
// Diagnostics and interaction hooks for renderer integration and browser checks.
Object.assign(window, { battleLab: { snapshot: () => ({ busy, round: battle?.round, activeId: battle?.activeId, winner: battle?.winner, queue: battle?.queue(), backdrop: world.isBackdrop(), zoom: world.camera.zoom, grid: world.grid.visible, units: views.map(v => ({ id: v.unit.id, kind: v.unit.kind, team: v.unit.team, hp: v.unit.hp, count: stackCount(v.unit), topHealth: topHealth(v.unit), initialCount: v.unit.initialCount, cell: v.unit.cell, imported: v.imported, animation: v.current, clips: v.clips.map(c => c.name), pose: v.poseSignature() })), draws: world.renderer.info.render.calls }), move, attack: () => { const enemy = views.find(v => v.unit.team !== selected.unit.team && v.unit.hp > 0); return enemy ? attack(enemy) : Promise.resolve(); } } });
boot();
