import * as THREE from 'three';
import './style.css';
import { initialUnits, occupied, pathfind, strike, distance, neighbors, obstacles, key, cellAt, type Unit, type Hex } from './battle.ts';
import { createWorld, worldPosition } from './world.ts';
import { UnitView, type Manifest } from './units.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="battle" aria-label="可旋转的三维六角格战场"></canvas>
  <header><a class="brand" href="https://github.com/yzh119/h3-battle-lab" target="_blank" rel="noreferrer">H3 <span>BATTLE LAB</span></a><div class="top-label">战场实验室 <span>01 / 林地</span></div><div class="live"><i></i> 实时 3D</div></header>
  <aside class="panel"><div class="eyebrow">战场视角</div><h1>走进战场。</h1><p class="intro">换一个角度，看清每一次交锋。</p><select id="unit-picker" aria-label="选择场上单位"><option value="azure">骷髅兵</option><option value="ember">僵尸</option></select>
  <details id="army-editor" open><summary>配置双方阵容</summary><label for="creature-picker">兵种</label><select id="creature-picker" aria-label="选择上场兵种"></select><label for="team-picker">阵营</label><select id="team-picker" aria-label="选择上场阵营"><option value="0">蓝方</option><option value="1">红方</option></select><p id="creature-note"></p><div class="button-row"><button id="add-unit">添加上场</button><button id="replace-unit">替换选中</button></div><button id="remove-unit" class="quiet">移除选中单位</button><p>每方最多 7 队 · 双方均可操控<br>替换保留所选单位的阵营和位置</p></details><div class="section-label">镜头</div><div class="button-row"><button id="overview" class="active">全局</button><button id="closeup">兵种特写</button></div>
  <div class="button-row zoom-controls"><button id="zoom-out" aria-label="缩小战场">− 缩小</button><button id="zoom-in" aria-label="放大战场">＋ 放大</button></div><div class="section-label">场景</div><select id="background-picker" aria-label="战场背景"><option value="">自由 3D 场景</option></select><p id="scene-hint" class="intro">拖动旋转镜头</p><div class="section-label">环境</div><div class="button-row"><button id="day" class="active">暖阳</button><button id="dusk">阴天</button></div>
  <label class="switch"><span>显示六角格</span><input id="grid" type="checkbox"></label>
  <label class="switch"><span>实时阴影</span><input id="shadows" type="checkbox" checked></label>
  <label class="range"><span>画面精细度 <b id="quality-label">高</b></span><input id="quality" aria-label="画面精细度" type="range" min="1" max="2" step=".5" value="2"></label>
  <div class="divider"></div><div class="section-label">动作预览</div><div class="actions"><button data-action="idle">待机</button><button data-action="walk">行走</button><button data-action="attack">攻击</button><button data-action="hit">受击</button></div>
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
let nextUnitId = 1;
const catalogue: Record<string, { label: string; faction: string; draft?: boolean }> = {
  skeleton: { label: '骷髅兵', faction: '墓园' }, zombie: { label: '僵尸', faction: '墓园' },
  wight: { label: '幽灵', faction: '墓园' }, wraith: { label: '阴魂', faction: '墓园' },
  swordsman: { label: '剑士', faction: '城堡', draft: true }, crusader: { label: '十字军', faction: '城堡', draft: true },
};
let startingArmy: Unit[] = structuredClone(units);
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const clock = new THREE.Timer();
let messageTimer: ReturnType<typeof setTimeout>;
function message(text: string) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(messageTimer); messageTimer = setTimeout(() => $('#toast').classList.remove('show'), 3800); }
function updateSelection(view = selected) {
  selected = view;
  const picker = $<HTMLSelectElement>('#unit-picker'); picker.replaceChildren(...views.map(v => new Option(`${v.unit.team ? '红方' : '蓝方'} · ${v.unit.label}${v.unit.hp <= 0 ? '（阵亡）' : ''}`, v.unit.id)));
  $('#asset-status').textContent = `${views.filter(v => v.imported).length} / ${views.length} 个本地模型`;
  $('#unit-name').textContent = view.unit.label; $('#hp').textContent = `${view.unit.hp} / 100`;
  $<HTMLSelectElement>('#unit-picker').value = view.unit.id;
  $('.team-dot').style.background = view.unit.team ? '#ef9a76' : '#acdada';
}
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
  if (hoverKey !== k) { hoverKey = k; world.showPath(pathfind(selected.unit.cell, cell, occupied(units, selected.unit.id))); }
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
  if (selected.unit.hp <= 0) return;
  const route = pathfind(selected.unit.cell, cell, occupied(units, selected.unit.id));
  if (!route) { message('这格被占据，或超过本次可移动范围（8 格）。'); return; }
  busy = true; world.showPath(route); const token = generation;
  try { await follow(route, token); } finally { if (token === generation) { busy = false; world.showPath(null); } }
}
async function attack(defender: UnitView) {
  const token = generation; const attacker = selected;
  const routes = neighbors(defender.unit.cell).map(c => pathfind(attacker.unit.cell, c, occupied(units, attacker.unit.id))).filter((p): p is Hex[] => p !== null).sort((a, b) => a.length - b.length);
  if (!routes.length) { message('暂时无法接近敌军。'); return; }
  busy = true;
  try {
    if (distance(attacker.unit.cell, defender.unit.cell) > 1) await follow(routes[0], token);
    if (token !== generation) return;
    face(attacker, defender.root.position); const duration = attacker.play('attack', true); await wait(duration * .48);
    if (token !== generation) return;
    if (strike(attacker.unit, defender.unit)) { defender.play(defender.unit.hp ? 'hit' : 'death', true); message(`${attacker.unit.label}击中${defender.unit.label} · −25`); }
    await wait(duration * .52); if (token === generation) updateSelection(attacker);
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
  if (manifest) for (const [kind, asset] of Object.entries(manifest.units)) catalogue[kind] = { label: asset.label, faction: asset.faction ?? catalogue[kind]?.faction ?? '本地', draft: asset.draft };
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
function saveArmy() { startingArmy = structuredClone(units).map(u => ({ ...u, hp: 100 })); }
async function configureUnit(replace: boolean) {
  if (busy) return;
  const kind = $<HTMLSelectElement>('#creature-picker').value;
  const team = replace ? selected.unit.team : Number($<HTMLSelectElement>('#team-picker').value);
  if (!replace && units.filter(u => u.team === team).length >= 7) { message('每方最多 7 队，请先移除一队。'); return; }
  const blocked = occupied(units, '');
  const spawn = replace ? selected.unit.cell : Array.from({ length: 9 }, (_, i) => cellAt(team ? 12 : 4, i + 1)).find(c => !blocked.has(key(c)));
  if (!spawn) { message('部署区已被占满。'); return; }
  const old = selected, token = generation;
  const unit: Unit = { id: replace ? old.unit.id : `unit-${nextUnitId++}`, kind, label: catalogue[kind].label, team, cell: { ...spawn }, hp: 100 };
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
  if (busy) return;
  if (views.length === 1) { message('至少保留一个单位。'); return; }
  const old = selected; views = views.filter(v => v !== old); units = units.filter(u => u !== old.unit); old.dispose(); updateSelection(views[0]); saveArmy(); world.showPath(null);
};
$('#reset').onclick = async () => {
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
    const response = await fetch('/local-assets/manifest.json');
    if (response.ok && response.headers.get('content-type')?.includes('json')) { const data = await response.json(); if (data.units) { manifest = data; await importManifest(data);
      for (const background of data.backgrounds ?? []) { const option = new Option(background.label, background.url); $<HTMLSelectElement>('#background-picker').add(option); }
      if (data.backgrounds?.length) { await world.setBackdrop(data.backgrounds[0].url); $<HTMLSelectElement>('#background-picker').value = data.backgrounds[0].url; $('#scene-hint').textContent = '高清背景 · 滚轮缩放 · 全局复位'; }
    } }
  } catch { message('本地美术未载入；基础场景可正常使用。'); }
  refreshCatalogue(); updateSelection(); $('#loading').classList.add('hidden');
}
let frames = 0, last = performance.now();
world.renderer.setAnimationLoop(() => {
  clock.update(); const dt = Math.min(clock.getDelta(), .05); views.forEach(v => v.update(dt, v === selected)); if (world.controls.enabled) world.controls.update(); world.renderer.render(world.scene, world.camera);
  frames++; if (performance.now() - last > 1000) { $('#fps').textContent = `${Math.round(frames * 1000 / (performance.now() - last))} FPS`; frames = 0; last = performance.now(); }
});
// Diagnostics and interaction hooks for renderer integration and browser checks.
Object.assign(window, { battleLab: { snapshot: () => ({ busy, backdrop: world.isBackdrop(), zoom: world.camera.zoom, grid: world.grid.visible, units: views.map(v => ({ id: v.unit.id, kind: v.unit.kind, team: v.unit.team, hp: v.unit.hp, cell: v.unit.cell, imported: v.imported, animation: v.current, clips: v.clips.map(c => c.name), pose: v.poseSignature() })), draws: world.renderer.info.render.calls }), move, attack: () => { const enemy = views.find(v => v.unit.team !== selected.unit.team && v.unit.hp > 0); return enemy ? attack(enemy) : Promise.resolve(); } } });
boot();
