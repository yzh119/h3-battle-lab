import { test, expect } from '@playwright/test';
const snapshot = (page: any) => page.evaluate(() => (window as any).battleLab.snapshot());
async function missingArt(page: any) {
  await page.route('**/local-assets/**', (route: any) => route.fulfill({ status: 404, body: '' }));
}
async function open(page: any) {
  await page.goto('/'); await page.waitForFunction(() => !!(window as any).battleLab); await expect(page.locator('#loading')).toBeHidden({ timeout: 20000 });
  await expect.poll(async () => (await snapshot(page)).draws).toBeGreaterThan(0);
}

test('local manifest creature pack loads into native catalogue with double-wide deployment', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  const pack = { version: 1, creatures: [{ id: 'local-ring-test', label: '本地环击测试', faction: '自定义', ruleset: 'custom', doubleWide: true,
    stats: { health: 175, attack: 16, defense: 18, minDamage: 25, maxDamage: 45, speed: 5 },
    mechanisms: [{ type: 'attacksAllAdjacent' }, { type: 'blocksRetaliation' }] }] };
  await page.route('**/local-assets/**', route => {
    const path = new URL(route.request().url()).pathname;
    const value = path.endsWith('/manifest.json') ? { units: {}, creaturePack: '/local-assets/test-pack.json' } : path.endsWith('/test-pack.json') ? pack : null;
    return route.fulfill({ status: value ? 200 : 404, contentType: 'application/json', body: JSON.stringify(value) });
  });
  await open(page);
  await expect(page.locator('#engine-status')).toContainText('自定义模式');
  await expect(page.locator('#creature-import-status')).toContainText('1 个本地自定义兵种');
  await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#creature-picker').selectOption('local-ring-test');
  await page.locator('#replace-unit').click();
  await expect.poll(async () => (await snapshot(page)).units[0].footprint.length).toBe(2);
  expect((await snapshot(page)).units[0].imported).toBe(false);
  await page.locator('#connect-engine').click();
  await expect(page.locator('#creature-import-status')).toContainText('1 个本地自定义兵种');
  await expect(page.locator('#start-battle')).toBeEnabled();
  await expect(page.locator('#creature-picker option')).toHaveCount(29);
});

test('missing preinstalled creature pack preserves native base catalogue', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await page.route('**/local-assets/**', route => route.fulfill(new URL(route.request().url()).pathname.endsWith('/manifest.json')
    ? { status: 200, contentType: 'application/json', body: JSON.stringify({ units: {}, creaturePack: '/local-assets/missing.json' }) }
    : { status: 404, body: '' }));
  await open(page);
  await expect(page.locator('#creature-import-status')).toContainText('读取失败');
  await expect(page.locator('#engine-status')).toContainText('原版参考模式');
  await expect(page.locator('#creature-picker option')).toHaveCount(28);
  await expect(page.locator('#start-battle')).toBeEnabled();
});

test('public scene renders without art or engine; editing and camera remain available', async ({ page }) => {
  await missingArt(page);
  await page.route('**/api/engine', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '本地 VCMI 引擎尚未配置' }) }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await expect(page.locator('#engine-status')).toContainText('尚未配置');
  await expect(page.locator('#start-battle')).toBeDisabled();
  await expect(page.locator('#creature-picker option')).toHaveCount(28);
  await page.locator('#grid').check(); expect((await snapshot(page)).grid).toBe(true);
  await page.locator('#closeup').click(); await page.getByRole('button', { name: '行走', exact: true }).click();
  expect((await snapshot(page)).units[0].animation).toBe('walk');
  await page.locator('#creature-picker').selectOption('marksman'); await page.locator('#stack-count').fill('45');
  await page.locator('#replace-unit').click();
  await expect.poll(async () => (await snapshot(page)).units[0].kind).toBe('marksman');
  expect((await snapshot(page)).units[0].count).toBe(45);
  await page.locator('#reset').click(); await expect(page.locator('#replace-unit')).toBeEnabled();
  expect((await snapshot(page)).units[0].count).toBe(45); expect(errors).toEqual([]);
});

test('WASD moves the camera relative to its heading and ignores text input', async ({ page }) => {
  await missingArt(page); await open(page);
  await page.locator('#overview').click();
  const before = await snapshot(page);
  const forward = before.camera.target.map((v: number, i: number) => v - before.camera.position[i]);
  await page.keyboard.down('w');
  await expect.poll(async () => (await snapshot(page)).camera.target).not.toEqual(before.camera.target);
  await page.keyboard.up('w');
  const after = await snapshot(page);
  const delta = after.camera.target.map((v: number, i: number) => v - before.camera.target[i]);
  expect(delta[0] * forward[0] + delta[2] * forward[2]).toBeGreaterThan(0);
  expect(delta[1]).toBeCloseTo(0);
  for (let i = 0; i < 3; i++) expect(after.camera.position[i] - before.camera.position[i]).toBeCloseTo(delta[i]);
  expect(after.units.map((u: any) => u.position)).toEqual(before.units.map((u: any) => u.position));
  await expect(page.locator('#stack-count')).toBeEnabled();
  await page.locator('#stack-count').focus();
  await expect(page.locator('#stack-count')).toBeFocused();
  const focused = (await snapshot(page)).camera.target;
  await page.keyboard.down('a'); await page.waitForTimeout(250); await page.keyboard.up('a');
  expect((await snapshot(page)).camera.target).toEqual(focused);
  await page.locator('#overview').click();
  await page.keyboard.down('d'); await expect.poll(async () => (await snapshot(page)).camera.target).not.toEqual(focused);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const stopped = (await snapshot(page)).camera.target;
  await page.waitForTimeout(250); expect((await snapshot(page)).camera.target).toEqual(stopped);
  await page.keyboard.up('d');
});

test('clicking the battlefield after a select restores D movement and keeps labels out of the UI layer', async ({ page }) => {
  await missingArt(page); await open(page);
  await expect(page.locator('#connect-engine')).toBeEnabled();
  await page.waitForFunction(() => !(window as any).battleLab.snapshot().deploying);
  await page.locator('#closeup').click();
  await page.locator('#unit-picker').focus();
  await expect(page.locator('#unit-picker')).toBeFocused();
  const unit = (await snapshot(page)).units[0];
  await page.mouse.click(unit.screen.x, unit.screen.y);
  await expect(page.locator('#battle')).toBeFocused();
  const before = await snapshot(page);
  const forward = before.camera.target.map((v: number, i: number) => v - before.camera.position[i]);
  await page.keyboard.down('d');
  await expect.poll(async () => (await snapshot(page)).camera.target).not.toEqual(before.camera.target);
  await page.keyboard.up('d');
  const after = await snapshot(page), delta = after.camera.target.map((v: number, i: number) => v - before.camera.target[i]);
  expect(delta[0] * -forward[2] + delta[2] * forward[0]).toBeGreaterThan(0);
  expect(after.units.map((u: any) => u.position)).toEqual(before.units.map((u: any) => u.position));
  const labels = await page.locator('#stack-labels').boundingBox();
  expect(labels!.width).toBe(1); expect(labels!.height).toBe(1);
  expect(after.units.every((u: any) => u.countLabel.depthTest && u.countLabel.visible)).toBe(true);
});

test('army selection inspects both movement ranges and clicking a legal enemy attacks', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#creature-picker').selectOption('marksman'); await page.locator('#replace-unit').click();
  await expect(page.locator('#start-battle')).toBeEnabled();
  const redSlot = page.locator('.army-slot[data-team="1"][data-slot="0"]');
  const blueSlot = page.locator('.army-slot[data-team="0"][data-slot="0"]');
  await redSlot.click(); await page.locator('#closeup').click(); await blueSlot.click();
  const preview = await snapshot(page), red = preview.units.find((u: any) => u.team === 1);
  await page.mouse.click(red.screen.x, red.screen.y);
  let current = await snapshot(page);
  expect(current.selected).toBe(red.id);
  expect(current.movementRange).toEqual(current.deployment.units.find((u: any) => u.side === 1).movement);
  expect(current.movementRange.length).toBeGreaterThan(1);
  await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
  const initial = await snapshot(page), actor = initial.units.find((u: any) => u.native.id === initial.state.activeStack);
  await redSlot.click(); await page.locator('#closeup').click(); await blueSlot.click();
  const enemy = (await snapshot(page)).units.find((u: any) => u.team === 1);
  await redSlot.click();
  current = await snapshot(page);
  expect(current.selected).toBe(enemy.id); expect(current.state.revision).toBe(initial.state.revision);
  expect(current.movementRange).toEqual(current.state.units.find((u: any) => u.side === 1).movement);
  await page.screenshot({ path: '.local/selected-enemy-movement-range.png' });
  await expect(page.locator('#attack-selected')).toBeEnabled();
  await page.mouse.click(enemy.screen.x, enemy.screen.y);
  await expect.poll(async () => (await snapshot(page)).state.revision).toBe(initial.state.revision + 1);
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  current = await snapshot(page);
  expect(current.state.revision).toBe(initial.state.revision + 1);
  expect(current.state.units.find((u: any) => u.side === 1).health).toBeLessThan(enemy.native.health);
  await blueSlot.click();
  current = await snapshot(page);
  expect(current.selected).toBe(actor.id);
  expect(current.movementRange).toEqual(current.state.units.find((u: any) => u.id === actor.native.id).movement);
  expect(errors).toEqual([]);
});

test('nearer geometry actually occludes the 3D count label', async ({ page }) => {
  await missingArt(page); await open(page);
  const pixels = await page.evaluate(async () => {
    const THREE = await import(/* @vite-ignore */ '/node_modules/.vite/deps/three.js');
    const { UnitView } = await import(/* @vite-ignore */ '/src/units.ts');
    const { fromHexId } = await import(/* @vite-ignore */ '/src/presentation.ts');
    const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(512, 512);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
    camera.position.set(4, 5, 7); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
    const target = new THREE.WebGLRenderTarget(512, 512);
    const unit = new UnitView({ id: 'test', kind: 'skeleton', label: 'test', team: 0, armySlot: 0, cell: fromHexId(93), initialCount: 20, hp: 100 });
    unit.root.position.set(0, 0, 0); scene.add(unit.root); unit.updateCountLabel(20, camera, 512); scene.updateMatrixWorld(true);
    const anchor = unit.countLabel.getWorldPosition(new THREE.Vector3()); anchor.y += unit.countLabel.scale.y / 2;
    const screen = anchor.clone().project(camera), x = Math.round((screen.x + 1) * 256), y = Math.round((screen.y + 1) * 256);
    const read = () => { renderer.setRenderTarget(target); renderer.render(scene, camera); const pixel = new Uint8Array(4); renderer.readRenderTargetPixels(target, x, y, 1, 1, pixel); return [...pixel]; };
    const visible = read();
    const blocker = new THREE.Mesh(new THREE.PlaneGeometry(.8, .6), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    blocker.position.copy(anchor).addScaledVector(camera.position.clone().sub(anchor).normalize(), .4); blocker.lookAt(camera.position); scene.add(blocker);
    const occluded = read();
    // Negative control: the old overlay behaviour would cover the red geometry.
    unit.countLabel.material.depthTest = false; const overlay = read();
    unit.dispose(); blocker.geometry.dispose(); blocker.material.dispose(); target.dispose(); renderer.dispose();
    return { visible, occluded, overlay };
  });
  expect(pixels.visible[1]).toBeGreaterThan(30);
  expect(pixels.occluded).toEqual([255, 0, 0, 255]);
  expect(pixels.overlay[1]).toBeGreaterThan(30);
});

test('army capacity, selection and custom format validation work without combat', async ({ page }) => {
  test.setTimeout(process.env.CI ? 180000 : 90000);
  await page.setViewportSize({ width: 800, height: 600 });
  await missingArt(page); await open(page);
  await expect(page.locator('#replace-unit')).toBeEnabled(); await page.locator('#shadows').uncheck();
  await page.locator('#team-picker').selectOption('1');
  for (let i = 0; i < 6; i++) { await page.locator('#add-unit').click(); await expect(page.locator('#add-unit')).toBeEnabled(); }
  expect((await snapshot(page)).units.filter((u: any) => u.team === 1)).toHaveLength(7);
  await page.locator('#add-unit').click(); await expect(page.locator('#toast')).toContainText('最多 7');
  await page.locator('#remove-unit').click(); expect((await snapshot(page)).units).toHaveLength(7);
  await expect(page.locator('#creature-import')).toBeEnabled();
  await page.locator('#creature-import').setInputFiles('examples/custom-creatures.json');
  await expect(page.locator('#creature-import-status')).toContainText(process.env.BATTLE_LAB_BACKEND ? '已载入' : '已验证');
});

test('local GLBs expose clips and change bone transforms', async ({ page, request }) => {
  const response = await request.get('/local-assets/manifest.json');
  test.skip(!response.headers()['content-type']?.includes('json'), 'Private art is absent');
  await open(page); await expect.poll(async () => (await snapshot(page)).units.every((u: any) => u.imported), { timeout: 30000 }).toBe(true); const initial = await snapshot(page);
  expect(initial.units.every((u: any) => u.imported)).toBe(true);
  expect(initial.units[0].clips).toEqual(expect.arrayContaining(['idle', 'walk', 'attack', 'hit', 'death']));
  await page.getByRole('button', { name: '行走', exact: true }).click(); await page.waitForTimeout(220);
  const pose = (await snapshot(page)).units[0].pose; expect(pose.length).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot(page)).units[0].pose).not.toBe(pose);
});

test('real VCMI browser connection plays two shots and applies native state at impact', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await expect(page.locator('#engine-status')).toContainText('已连接');
  await page.locator('#creature-picker').selectOption('marksman'); await page.locator('#replace-unit').click();
  await expect(page.locator('#start-battle')).toBeEnabled(); await page.locator('#start-battle').click();
  await expect(page.locator('#wait-turn')).toBeEnabled();
  const before = await snapshot(page); expect(before.state.units).toHaveLength(2);
  expect(before.units[1].hp).toBe(300);
  const packet = page.waitForResponse(response => response.url().endsWith('/api/engine') && response.request().postDataJSON()?.request.op === 'act');
  await page.evaluate(() => { void (window as any).battleLab.attack(); });
  const authoritative = (await (await packet).json()).response.result;
  await page.waitForFunction(() => (window as any).battleLab.snapshot().projectiles === 1);
  expect((await snapshot(page)).units[1].hp).toBe(300);
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 15000 }).toBe(false);
  const after = await snapshot(page); expect(after.state).toEqual(authoritative.state);
  expect(after.units[1].hp).toBe(authoritative.state.units.find((u: any) => u.side === 1).health);
  expect(after.units[0].native.shots).toBe(22);
  await expect(page.locator('#combat-log p')).toHaveCount(2);
  await page.screenshot({ path: '.local/native-engine-browser.png' });
  await page.locator('#defend-turn').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  await page.locator('#reset').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  expect((await snapshot(page)).state).toBeUndefined(); expect((await snapshot(page)).units[0].count).toBe(20);
  expect(errors).toEqual([]);
});

test('seven-slot army bars configure exact empty positions and retain gaps on reset', async ({ page }) => {
  await missingArt(page); await open(page); await expect(page.locator('#assign-slot')).toBeEnabled();
  await expect(page.locator('.army-slot')).toHaveCount(14);
  const seventh = page.locator('.army-slot[data-team="0"][data-slot="6"]');
  await seventh.click(); await expect(page.locator('#selected-slot-label')).toHaveText('蓝方 · 第 7 格');
  await page.locator('#creature-picker').selectOption('marksman'); await page.locator('#stack-count').fill('73');
  await page.locator('#assign-slot').click(); await expect(seventh).toHaveAttribute('aria-label', '蓝方第 7 格 神射手 ×73');
  await page.locator('#remove-unit').click(); await expect(seventh).toHaveAttribute('aria-label', '蓝方第 7 格 空位');
  await seventh.click(); await page.locator('#creature-picker').selectOption('marksman'); await page.locator('#stack-count').fill('73'); await page.locator('#assign-slot').click();
  await expect(page.locator('#assign-slot')).toBeEnabled();
  await page.locator('#reset').click(); await expect(page.locator('#assign-slot')).toBeEnabled();
  const roster = (await snapshot(page)).units;
  expect(roster.filter((u: any) => u.team === 0).map((u: any) => u.armySlot).sort()).toEqual([0, 6]);
  if (process.env.BATTLE_LAB_BACKEND) {
    await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
    const state = (await snapshot(page)).state;
    expect(state.units.find((u: any) => u.side === 0 && u.slot === 6).count).toBe(73);
    expect(state.units.filter((u: any) => u.side === 0).map((u: any) => u.slot).sort()).toEqual([0, 6]);
  }
  await page.screenshot({ path: '.local/seven-slot-overview.png' });
});

test('overview and close-up share canvas bounds and restore the selected background', async ({ page }) => {
  await missingArt(page);
  await page.route('**/local-assets/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ units: {}, backgrounds: [{ label: '画布测试', url: '/test-backdrop.svg' }] }) }));
  await page.route('**/test-backdrop.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#687850"/></svg>' }));
  await open(page); await page.locator('#background-picker').selectOption('/test-backdrop.svg'); await expect.poll(async () => (await snapshot(page)).backdrop).toBe(true);
  if (process.env.BATTLE_LAB_BACKEND && process.env.BATTLE_LAB_PROFILE) await expect(page.locator('#start-battle')).toBeEnabled();
  const bounds = await page.locator('#battle').boundingBox();
  async function checkCamera() {
    const box = (await page.locator('#battle').boundingBox())!;
    const x = box.x + box.width * .6, y = box.y + box.height * .55;
    const before = await snapshot(page);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 75, y + 30, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await snapshot(page)).camera.position).not.toEqual(before.camera.position);
    expect((await snapshot(page)).units.map((u: any) => u.cell)).toEqual(before.units.map((u: any) => u.cell));
    const rotated = await snapshot(page);
    await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.move(x - 60, y + 25, { steps: 8 }); await page.mouse.up({ button: 'right' });
    await expect.poll(async () => (await snapshot(page)).camera.target).not.toEqual(rotated.camera.target);
    const panned = await snapshot(page); await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await snapshot(page)).camera.position).not.toEqual(panned.camera.position);
  }
  await checkCamera();
  await page.locator('#closeup').click(); expect((await snapshot(page)).backdrop).toBe(false);
  expect(await page.locator('#battle').boundingBox()).toEqual(bounds);
  await expect(page.locator('#closeup')).toHaveClass('active');
  await checkCamera();
  await page.locator('#overview').click(); expect((await snapshot(page)).backdrop).toBe(true);
  expect(await page.locator('#battle').boundingBox()).toEqual(bounds);
  await page.setViewportSize({ width: 1000, height: 760 });
  await expect.poll(async () => (await page.locator('#battle').boundingBox())?.width).not.toBe(bounds?.width);
  const resized = await page.locator('#battle').boundingBox();
  await page.locator('#closeup').click(); expect(await page.locator('#battle').boundingBox()).toEqual(resized);
  await page.locator('#overview').click(); expect(await page.locator('#battle').boundingBox()).toEqual(resized);
});

test('native ten-week complete-town button fills both seven-slot armies and supports upgrades', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); await open(page); await expect(page.locator('#ten-week-armies')).toBeEnabled();
  await page.locator('#preset-upgraded').uncheck(); await page.locator('#ten-week-armies').click();
  await expect(page.locator('#ten-week-armies')).toBeEnabled();
  const base = (await snapshot(page)).units;
  expect(base).toHaveLength(14);
  expect(base.filter((u: any) => u.team === 0).map((u: any) => u.count)).toEqual([280, 180, 170, 80, 60, 40, 20]);
  expect(base.filter((u: any) => u.team === 1).map((u: any) => u.count)).toEqual([300, 160, 140, 80, 60, 40, 20]);
  expect(base[0].kind).toBe('pikeman'); expect(base[6].kind).toBe('angel');
  await page.locator('#preset-upgraded').check(); await page.locator('#ten-week-armies').click(); await expect(page.locator('#ten-week-armies')).toBeEnabled();
  await expect(page.locator('#start-battle')).toBeEnabled();
  const upgraded = (await snapshot(page)).units;
  for (const unit of upgraded) {
    const native = (await snapshot(page)).deployment.units.find((u: any) => u.side === unit.team && u.slot === unit.armySlot);
    expect(unit.footprint).toEqual(native.footprint);
    if (native.footprint.length === 2) expect(unit.visualPosition[0]).not.toBe(unit.position[0]);
  }
  expect(upgraded.find((u: any) => u.kind === 'ghost-dragon').displayHeight).toBeGreaterThan(upgraded[0].displayHeight);
  expect(upgraded[0].kind).toBe('halberdier'); expect(upgraded[6].kind).toBe('archangel'); expect(upgraded[13].kind).toBe('ghost-dragon');
  await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
  const deployed = await snapshot(page);
  expect(deployed.state.units).toHaveLength(14);
  expect(deployed.units.map((u: any) => u.cell)).toEqual(upgraded.map((u: any) => u.cell)); await expect(page.locator('#ten-week-armies')).toBeDisabled();
  await page.locator('#reset').click(); await expect(page.locator('#ten-week-armies')).toBeEnabled();
  expect((await snapshot(page)).units.map((u: any) => u.count)).toEqual(upgraded.map((u: any) => u.count));
});

test('native attributes appear on hover and VCMI AI can take turns', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); await open(page);
  await expect(page.locator('#start-battle')).toBeEnabled();
  const slot = page.locator('.army-slot[data-team="0"][data-slot="0"]');
  await slot.hover(); await expect(page.locator('#unit-tooltip')).toContainText('骷髅兵');
  await expect(page.locator('#unit-tooltip')).toContainText('攻击 5 · 防御 4');
  await expect(page.locator('#unit-tooltip')).toContainText('VCMI 部署预览');
  await page.locator('#closeup').click();
  const bounds = await page.locator('#battle').boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await expect(page.locator('#unit-tooltip')).toContainText('骷髅兵');
  await page.mouse.move(bounds!.x + 5, bounds!.y + 5);
  await expect(page.locator('#unit-tooltip')).toBeHidden();
  await page.locator('#overview').click();
  await page.locator('#start-battle').click(); await expect(page.locator('#ai-step')).toBeEnabled();
  await page.locator('.army-slot[data-team="0"][data-slot="0"]').hover();
  await expect(page.locator('#unit-tooltip')).toContainText('VCMI 当前状态');
  await page.locator('#defend-turn').click(); await expect(page.locator('#ai-step')).toBeEnabled();
  await page.locator('.army-slot[data-team="0"][data-slot="0"]').hover();
  const native = (await snapshot(page)).state.units.find((u: any) => u.side === 0);
  await expect(page.locator('#unit-tooltip')).toContainText(`防御 ${native.defense}`);
  const revision = (await snapshot(page)).state.revision;
  await page.locator('#ai-step').click();
  await expect.poll(async () => (await snapshot(page)).state.revision).toBe(revision + 1);
  await page.locator('#ai-red').check(); await page.locator('#ai-blue').check();
  await expect.poll(async () => (await snapshot(page)).state.revision, { timeout: 30000 }).toBeGreaterThan(revision + 2);
  await page.locator('#ai-red').uncheck(); await page.locator('#ai-blue').uncheck();
});

test('local model with alternate skeleton scenes loads and animates', async ({ page, request }) => {
  const response = await request.get('/local-assets/manifest.json');
  test.skip(!response.headers()['content-type']?.includes('json'), 'Private art is absent');
  const manifest = await response.json(); test.skip(!manifest.units.cavalier, 'Alternate skeleton export absent');
  await page.route('**/local-assets/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ units: { cavalier: manifest.units.cavalier } }) }));
  await open(page); await expect(page.locator('#replace-unit')).toBeEnabled();
  await page.locator('#creature-picker').selectOption('cavalier'); await page.locator('#replace-unit').click();
  await expect.poll(async () => (await snapshot(page)).units[0].kind, { timeout: 20000 }).toBe('cavalier');
  await expect.poll(async () => (await snapshot(page)).units[0].imported, { timeout: 60000 }).toBe(true);
  await page.getByRole('button', { name: '行走', exact: true }).click();
  await page.waitForTimeout(100); const pose = (await snapshot(page)).units[0].pose;
  await expect.poll(async () => (await snapshot(page)).units[0].pose).not.toBe(pose);
});

test('hero spellbook casts native damage and renders summoned units', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#hero-editor > summary').click(); await page.locator('#hero-enabled-0').check();
  await page.locator('#hero-spells-0').selectOption(['15', '68']);
  await expect(page.locator('#start-battle')).toBeEnabled(); await page.locator('#start-battle').click();
  await expect(page.locator('#defend-turn')).toBeEnabled(); await page.locator('#spellbook summary').click();
  await expect(page.locator('#hero-status')).toContainText('100/100');
  await expect(page.locator('#cast-spell')).toBeEnabled();
  const before = await snapshot(page), enemy = before.state.units.find((u: any) => u.side === 1);
  await page.locator('#cast-spell').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  const after = await snapshot(page);
  expect(after.state.heroes[0].mana).toBe(95); expect(after.state.activeStack).toBe(before.state.activeStack);
  expect(after.state.units.find((u: any) => u.id === enemy.id).health).toBe(enemy.health - 40);
  await expect(page.locator('#cast-spell')).toBeDisabled(); await expect(page.locator('#combat-log')).toContainText('Magic Arrow');
  await page.locator('#reset').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#hero-spells-0').selectOption('68'); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#start-battle').click(); await expect(page.locator('#cast-spell')).toBeEnabled();
  await page.locator('#cast-spell').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  const summoned = (await snapshot(page)).units.find((u: any) => u.native?.creature === 'core:waterElemental');
  expect(summoned).toBeTruthy(); expect(summoned.count).toBe(6); expect(summoned.imported).toBe(false);
  expect((await snapshot(page)).draws).toBeGreaterThan(0); expect(errors).toEqual([]);
  await page.screenshot({ path: '.local/hero-spellbook-native.png' });
});


test('a pending model request does not block battlefield controls', async ({ page }) => {
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/local-assets/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ units: { skeleton: { label: '骷髅兵', url: '/local-assets/delayed.glb' }, cavalier: { label: '骑兵', url: '/local-assets/delayed.glb' } } }) }));
  await page.route('**/local-assets/delayed.glb', async route => { await pending; await route.fulfill({ status: 404, body: '' }); });
  await page.route('**/api/engine', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '引擎未配置' }) }));
  try {
    await open(page); await expect(page.locator('#apply-count')).toBeEnabled();
    expect((await snapshot(page)).units[0].imported).toBe(false);
    await page.locator('#stack-count').fill('37'); await page.locator('#apply-count').click();
    expect((await snapshot(page)).units[0].count).toBe(37);
    await page.locator('#creature-picker').selectOption('cavalier'); await page.locator('#replace-unit').click();
    await expect.poll(async () => (await snapshot(page)).units[0].kind).toBe('cavalier');
    await expect(page.locator('#apply-count')).toBeEnabled();
    release(); await expect(page.locator('#toast')).toContainText('继续使用示意模型');
    expect((await snapshot(page)).units[0].imported).toBe(false);
    expect((await snapshot(page)).units[0].count).toBe(37);
  } finally { release(); }
});


test('custom creature import uses native stats and survives reset, rejection and reconnect', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); await open(page);
  await expect(page.locator('#creature-import')).toBeEnabled();
  await page.locator('#creature-import').setInputFiles('examples/custom-creatures.json');
  await expect(page.locator('#creature-import-status')).toContainText('已载入');
  await expect(page.locator('#engine-status')).toContainText('自定义模式');
  await expect(page.locator('#creature-picker option')).toHaveCount(29);
  await page.locator('#creature-picker').selectOption('custom-spectral-guard'); await page.locator('#replace-unit').click();
  await expect.poll(async () => (await snapshot(page)).units[0].kind).toBe('custom-spectral-guard');
  await expect(page.locator('#start-battle')).toBeEnabled(); await page.locator('#start-battle').click();
  await expect(page.locator('#defend-turn')).toBeEnabled();
  const initial = await snapshot(page), unit = initial.state.units.find((u: any) => u.creature === 'battle-lab-custom:custom-spectral-guard');
  expect([unit.attack, unit.defense, unit.maxHealth, unit.speed, unit.flying]).toEqual([9, 8, 24, 7, true]);
  expect(initial.units[0].imported).toBe(false);
  await page.locator('#ai-step').click(); await expect.poll(async () => (await snapshot(page)).state.revision).toBe(1);
  await page.locator('#reset').click(); await expect(page.locator('#creature-import')).toBeEnabled();
  await page.locator('#creature-import').setInputFiles('examples/custom-creatures.json');
  await expect(page.locator('#creature-import-status')).toContainText('原引擎会话已保留');
  await expect(page.locator('#creature-picker option')).toHaveCount(29);
  await page.locator('#hero-editor > summary').click(); await page.locator('#hero-enabled-0').check();
  await page.locator('#hero-attack-0').fill('12');
  await expect(page.locator('#connect-engine')).toBeEnabled(); await page.locator('#connect-engine').click();
  await expect(page.locator('#start-battle')).toBeEnabled(); await expect(page.locator('#engine-status')).toContainText('自定义模式');
  expect((await snapshot(page)).units[0].kind).toBe('custom-spectral-guard');
  await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
  expect((await snapshot(page)).state.units.some((u: any) => u.creature === 'battle-lab-custom:custom-spectral-guard')).toBe(true);
  expect((await snapshot(page)).state.heroes[0].attack).toBe(12);
});

test('archangel active ability restores a dead army stack through the native engine', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await expect(page.locator('#replace-unit')).toBeEnabled();
  await page.locator('#creature-picker').selectOption('archangel'); await page.locator('#stack-count').fill('1'); await page.locator('#replace-unit').click();
  await expect(page.locator('#add-unit')).toBeEnabled();
  await page.locator('#creature-picker').selectOption('pikeman'); await page.locator('#team-picker').selectOption('0'); await page.locator('#stack-count').fill('10'); await page.locator('#add-unit').click();
  await page.locator('.army-slot[data-team="1"][data-slot="0"]').click();
  await page.locator('#creature-picker').selectOption('marksman'); await page.locator('#stack-count').fill('100'); await page.locator('#replace-unit').click();
  await expect(page.locator('#start-battle')).toBeEnabled(); await page.locator('#start-battle').click();
  await expect(page.locator('#wait-turn')).toBeEnabled();
  const before = await snapshot(page), angel = before.state.units.find((u: any) => u.creature === 'core:archangel'), pikeman = before.state.units.find((u: any) => u.creature === 'core:pikeman');
  await page.locator('#wait-turn').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  await page.evaluate((id: number) => (window as any).battleLab.attack(id), pikeman.id);
  await expect.poll(async () => (await snapshot(page)).state.activeStack).toBe(angel.id);
  expect((await snapshot(page)).state.units.find((u: any) => u.id === pikeman.id).count).toBe(0);
  await page.locator('#spellbook summary').click(); await expect(page.locator('#spell-caster')).toHaveValue('creature');
  await expect(page.locator('#hero-status')).toContainText('1 次');
  await expect(page.locator('#cast-spell')).toBeEnabled();
  const option = page.locator('#spell-target option').filter({ hasText: 'Pikeman' });
  await expect(option).toHaveCount(1);
  const corpse = (await snapshot(page)).units.find((u: any) => u.kind === 'pikeman');
  await page.mouse.click(corpse.screen.x, corpse.screen.y);
  await expect(page.locator('#toast')).toContainText('已选择施法目标');
  await expect(page.locator('#spell-target')).toHaveValue((await option.getAttribute('value'))!);
  await page.locator('#cast-spell').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  const after = await snapshot(page);
  expect(after.state.units.find((u: any) => u.id === pikeman.id).count).toBe(10);
  expect(after.state.units.find((u: any) => u.id === pikeman.id).health).toBe(100);
  expect(after.state.units.find((u: any) => u.id === angel.id).casts).toBe(0);
  expect(after.units.find((u: any) => u.kind === 'pikeman').animation).toBe('idle');
  await expect(page.locator('#combat-log')).toContainText('Resurrection'); expect(errors).toEqual([]);
});


test('native terrain and obstacle previews match combat and remain visible with a backdrop', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page);
  await page.route('**/local-assets/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ units: {}, backgrounds: [{ label: '场景测试', url: '/scenario-backdrop.svg' }] }) }));
  await page.route('**/scenario-backdrop.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#687850"/></svg>' }));
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await expect(page.locator('#terrain-picker option')).toHaveCount(8);
  await page.locator('#creature-picker').selectOption('crusader'); await page.locator('#replace-unit').click();
  await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#terrain-picker').selectOption('2'); await page.locator('#native-obstacles').check();
  await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#background-picker').selectOption('/scenario-backdrop.svg');
  await expect.poll(async () => (await snapshot(page)).backdrop).toBe(true);
  let before = await snapshot(page);
  expect(before.deployment.scenario).toEqual({ terrain: 2, battlefield: 'core:grass_pines', obstacles: true, layout: 148 });
  expect(before.terrain).toBe(2); expect(before.backdrop).toBe(true);
  expect(before.renderedObstacles).toBe(new Set(before.deployment.obstacles).size);
  expect(before.renderedObstacles).toBeGreaterThan(0);
  await page.locator('.army-slot[data-team="0"][data-slot="0"]').hover();
  await expect(page.locator('#unit-tooltip')).toContainText('攻击 13 · 防御 13');
  await expect(page.locator('#unit-tooltip')).toContainText('VCMI 部署预览');
  const firstLayout = before.deployment.obstacles;
  await page.locator('#next-layout').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  before = await snapshot(page); expect(before.deployment.scenario.layout).toBe(149);
  expect(before.deployment.obstacles).not.toEqual(firstLayout);
  await page.locator('#closeup').click(); expect((await snapshot(page)).renderedObstacles).toBe(before.renderedObstacles);
  await page.locator('#overview').click();
  await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
  const started = await snapshot(page);
  expect(started.state.scenario).toEqual(before.deployment.scenario);
  expect(started.state.obstacles).toEqual(before.deployment.obstacles);
  expect(started.units.map((u: any) => u.cell)).toEqual(before.units.map((u: any) => u.cell));
  await expect(page.locator('#terrain-picker')).toBeDisabled(); await expect(page.locator('#next-layout')).toBeDisabled();
  await page.screenshot({ path: '.local/native-terrain-obstacles.png' });
  await page.locator('#reset').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  const reset = await snapshot(page); expect(reset.deployment.scenario).toEqual(before.deployment.scenario);
  expect(reset.deployment.obstacles).toEqual(before.deployment.obstacles);
  await page.locator('#native-obstacles').uncheck(); await expect(page.locator('#start-battle')).toBeEnabled();
  expect((await snapshot(page)).renderedObstacles).toBe(0); expect(errors).toEqual([]);
});


test('named heroes keep native specialties, leveling and editable spellbooks', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#hero-editor > summary').click();
  await expect(page.locator('#hero-type-0 option')).toHaveCount(33);
  await page.locator('#hero-enabled-0').check(); await page.locator('#hero-type-0').selectOption('71');
  await page.locator('#hero-level-0').fill('20'); await page.locator('#hero-level-0').press('Tab');
  await expect(page.locator('#start-battle')).toBeEnabled();
  await expect(page.locator('#hero-specialty-0')).toContainText('Skeletons');
  await expect(page.locator('#hero-preview-0')).toContainText('Galthran · 20 级');
  const preview = (await snapshot(page)).deployment;
  expect(preview.heroes[0].type).toBe(71); expect(preview.heroes[0].level).toBe(20);
  await expect(page.locator('#hero-attack-0')).toBeDisabled();
  await expect(page.locator('#hero-attack-0')).toHaveValue(String(preview.heroes[0].attack));
  await page.locator('.army-slot[data-team="0"][data-slot="0"]').hover();
  const skeleton = preview.units.find((u: any) => u.side === 0);
  await expect(page.locator('#unit-tooltip')).toContainText(`攻击 ${skeleton.attack} · 防御 ${skeleton.defense}`);
  expect(skeleton.speed).toBe(5);
  await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
  expect((await snapshot(page)).state.heroes).toEqual(preview.heroes);
  await expect(page.locator('#hero-type-0')).toBeDisabled();
  await page.locator('#reset').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  await expect(page.locator('#hero-type-0')).toHaveValue('71'); await expect(page.locator('#hero-level-0')).toHaveValue('20');
  // Keep the native hero identity and specialty while authoring a specific spellbook.
  await page.locator('#hero-override-0').check(); await expect(page.locator('#hero-attack-0')).toBeEnabled();
  await page.locator('#hero-spells-0').selectOption('15');
  await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
  await page.locator('#spellbook summary').click(); await expect(page.locator('#hero-status')).toContainText('Galthran');
  await expect(page.locator('#cast-spell')).toBeEnabled();
  await page.locator('#cast-spell').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  await expect(page.locator('#combat-log')).toContainText('Magic Arrow');
  expect((await snapshot(page)).state.heroes[0].type).toBe(71); expect(errors).toEqual([]);
});


test('equipment preserves base attributes and native combination slots and scroll spells', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#hero-editor > summary').click(); await page.locator('#hero-enabled-0').check(); await page.locator('#hero-type-0').selectOption('71');
  await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#hero-equipment-0 summary').click(); await page.locator('#hero-artifact-0-3').selectOption('7');
  await expect(page.locator('#start-battle')).toBeEnabled();
  const equipped = (await snapshot(page)).deployment.heroes[0]; expect(equipped.attack).toBe(equipped.base.attack + 2);
  await expect(page.locator('#hero-attack-0')).toHaveValue(String(equipped.base.attack));
  await page.locator('#hero-override-0').check(); await expect(page.locator('#start-battle')).toBeEnabled();
  expect((await snapshot(page)).deployment.heroes[0].attack).toBe(equipped.attack);
  await page.locator('#hero-artifact-0-3').selectOption('129'); await expect(page.locator('#start-battle')).toBeEnabled();
  await expect(page.locator('#hero-artifact-0-0')).toBeDisabled();
  await expect(page.locator('#hero-equipment-status-0')).toContainText('组合占位');
  await page.locator('#hero-artifact-0-3').selectOption('7'); await expect(page.locator('#start-battle')).toBeEnabled(); await expect(page.locator('#hero-artifact-0-0')).toBeEnabled();
  await page.locator('#hero-knowledge-0').fill('10'); await page.locator('#hero-power-0').fill('3'); await page.locator('#hero-power-0').press('Tab');
  await page.locator('#hero-artifact-0-9').selectOption('1'); await page.locator('#hero-scroll-0-9').selectOption('68');
  await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
  expect((await snapshot(page)).state.heroes[0].attack).toBe(equipped.attack);
  await page.locator('#spellbook summary').click(); await page.locator('#spell-picker').selectOption('68'); await expect(page.locator('#cast-spell')).toBeEnabled();
  await page.locator('#cast-spell').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  expect((await snapshot(page)).units.some((u: any) => u.native?.creature === 'core:waterElemental')).toBe(true);
  await page.locator('#reset').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  await expect(page.locator('#hero-artifact-0-3')).toHaveValue('7'); await expect(page.locator('#hero-scroll-0-9')).toHaveValue('68');
});

test('ballista and ammo cart render outside army slots and use native double shots', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#creature-picker').selectOption('zombie'); await page.locator('#replace-unit').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#hero-editor > summary').click(); await page.locator('#hero-enabled-0').check(); await page.locator('#hero-spells-0').selectOption([]);
  await page.locator('#hero-skill-0-0').selectOption('20'); await page.locator('#hero-skill-level-0-0').selectOption('3');
  await page.locator('#hero-equipment-0 summary').click(); await page.locator('#hero-artifact-0-13').selectOption('4'); await page.locator('#hero-artifact-0-14').selectOption('5');
  await expect(page.locator('#start-battle')).toBeEnabled();
  const before = await snapshot(page); expect(before.units).toHaveLength(2); expect(before.previewMachines).toHaveLength(2);
  expect(before.previewMachines.map((u: any) => u.kind)).toEqual(expect.arrayContaining(['core:ballista', 'core:ammoCart']));
  await expect(page.locator('.army-slot')).toHaveCount(14);
  await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
  expect((await snapshot(page)).units).toHaveLength(4); expect((await snapshot(page)).previewMachines).toHaveLength(0);
  for (let i = 0; i < 10; i++) {
    const current = await snapshot(page); if (current.state.units.find((u: any) => u.id === current.state.activeStack).creature === 'core:ballista') break;
    await page.locator('#defend-turn').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  }
  const current = await snapshot(page), enemy = current.state.units.find((u: any) => u.side === 1);
  expect(current.state.units.find((u: any) => u.id === current.state.activeStack).creature).toBe('core:ballista');
  await page.evaluate(id => { void (window as any).battleLab.attack(id); }, enemy.id);
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 15000 }).toBe(false);
  await expect(page.locator('#combat-log p')).toHaveCount(2); await expect(page.locator('#combat-log')).toContainText('Ballista');
  await page.screenshot({ path: '.local/native-war-machines.png' });
  await page.locator('#reset').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  expect((await snapshot(page)).units).toHaveLength(2); expect((await snapshot(page)).previewMachines).toHaveLength(2); expect(errors).toEqual([]);
});

test('first aid tent uses native healing targets and updates rendered health', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#creature-picker').selectOption('archangel'); await page.locator('#stack-count').fill('5'); await page.locator('#replace-unit').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('.army-slot[data-team="1"][data-slot="0"]').click(); await page.locator('#creature-picker').selectOption('marksman'); await page.locator('#replace-unit').click();
  await page.locator('#hero-editor > summary').click(); await page.locator('#hero-enabled-0').check(); await page.locator('#hero-spells-0').selectOption([]);
  await page.locator('#hero-skill-0-0').selectOption('27'); await page.locator('#hero-skill-level-0-0').selectOption('3');
  await page.locator('#hero-equipment-0 summary').click(); await page.locator('#hero-artifact-0-15').selectOption('6');
  await expect(page.locator('#start-battle')).toBeEnabled(); await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
  const started = await snapshot(page), angel = started.state.units.find((u: any) => u.creature === 'core:archangel');
  await page.locator('#defend-turn').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  await page.evaluate(id => { void (window as any).battleLab.attack(id); }, angel.id); await expect.poll(async () => (await snapshot(page)).busy, { timeout: 15000 }).toBe(false);
  await expect(page.locator('#heal-unit')).toBeEnabled(); const hurt = (await snapshot(page)).state.units.find((u: any) => u.id === angel.id); expect(hurt.health).toBeLessThan(angel.health);
  await page.locator('#heal-unit').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  const healed = (await snapshot(page)).units.find((u: any) => u.native?.id === angel.id);
  expect(healed.hp).toBe(angel.health); expect(healed.count).toBe(hurt.count); await expect(page.locator('#combat-log')).toContainText('恢复');
});


test('imported champion faces the native movement direction instead of strafing', async ({ page, request }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  const response = await request.get('/local-assets/manifest.json');
  test.skip(!response.ok() || !response.headers()['content-type']?.includes('json'), 'Local art absent');
  const manifest = await response.json(); test.skip(!manifest.units.champion, 'Champion model absent');
  await page.route('**/local-assets/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ units: { champion: manifest.units.champion } }) }));
  await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#creature-picker').selectOption('champion'); await page.locator('#replace-unit').click();
  await expect.poll(async () => (await snapshot(page)).units[0].imported, { timeout: 60000 }).toBe(true);
  expect((await snapshot(page)).units[0].modelYaw).toBeCloseTo(Math.PI / 2);
  await expect(page.locator('#start-battle')).toBeEnabled(); await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
  const initial = await snapshot(page), actor = initial.state.units.find((u: any) => u.id === initial.state.activeStack);
  expect(actor.creature).toBe('core:champion');
  const destination = initial.state.legal.moves.find((m: any) => m.path.length >= 4 && m.hex % 17 > actor.hex % 17 + 1 && Math.floor(m.hex / 17) !== Math.floor(actor.hex / 17));
  expect(destination).toBeTruthy();
  await page.evaluate(async hex => { const p = await import(/* @vite-ignore */ '/src/presentation.ts'); void (window as any).battleLab.move(p.fromHexId(hex)); }, destination.hex);
  await expect.poll(async () => (await snapshot(page)).units[0].animation).toBe('walk');
  let previous = (await snapshot(page)).units[0], samples = 0;
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(30); const current = await snapshot(page), view = current.units[0];
    const dx = view.position[0] - previous.position[0], dz = view.position[2] - previous.position[2], distance = Math.hypot(dx, dz);
    if (view.animation === 'walk' && distance > .005 && Math.abs(view.heading - previous.heading) < .01) {
      // Corrected horse -X points along root +Z, which must match actual displacement.
      expect((Math.sin(view.heading) * dx + Math.cos(view.heading) * dz) / distance).toBeGreaterThan(.99); samples++;
    }
    previous = view; if (!current.busy) break;
  }
  expect(samples).toBeGreaterThan(2); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  expect((await snapshot(page)).units[0].native.hex).toBe(destination.hex);
  await page.locator('#closeup').click(); await page.screenshot({ path: '.local/champion-facing-fixed.png' });
});


test('failed imported 3D environment keeps the public scene and controls usable', async ({ page }) => {
  await missingArt(page);
  await page.route('**/local-assets/manifest.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ units: {}, environments: { missing: { label: '缺失场景', ground: '/local-assets/missing-ground.png', pieces: [{ url: '/local-assets/missing-scene.glb', height: 9, instances: [{ position: [28, 0, -22] }] }] } } }) }));
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await open(page);
  await expect(page.locator('#toast')).toContainText('三维场景载入失败');
  expect((await snapshot(page)).environment).toBeUndefined(); expect((await snapshot(page)).draws).toBeGreaterThan(0);
  await page.locator('#closeup').click(); expect((await snapshot(page)).camera.enabled).toBe(true);
  await page.locator('#creature-picker').selectOption('archer'); await page.locator('#replace-unit').click();
  expect((await snapshot(page)).units[0].kind).toBe('archer'); expect(errors).toEqual([]);
});


test('native tactics lets either side select stacks, preview deployment and enter the first round', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  for (const side of [0, 1]) {
    await page.locator('#hero-editor').evaluate(el => el.setAttribute('open', ''));
    for (const team of [0, 1]) {
      await page.locator(`#hero-enabled-${team}`).check();
      await page.locator(`#hero-skill-${team}-0`).selectOption(team === side ? '19' : '');
      await page.locator(`#hero-skill-level-${team}-0`).selectOption('3');
    }
    await expect(page.locator('#start-battle')).toBeEnabled();
    await page.locator('#start-battle').click(); await expect(page.locator('#end-tactics')).toBeEnabled();
    await expect(page.locator('#wait-turn')).toBeDisabled(); await expect(page.locator('#defend-turn')).toBeDisabled();
    const before = await snapshot(page);
    expect(before.state.tactics.side).toBe(side); expect(before.state.activeStack).toBeNull();
    const own = before.units.find((unit: any) => unit.native?.side === side);
    const enemy = before.units.find((unit: any) => unit.native?.side !== side);
    await page.locator('#unit-picker').selectOption(enemy.id); expect((await snapshot(page)).movementRange).toEqual([]);
    await page.locator('#unit-picker').selectOption(own.id);
    const entry = before.state.tactics.stacks.find((stack: any) => stack.id === own.native.id);
    expect((await snapshot(page)).movementRange).toEqual(entry.movement);
    for (let i = 0; i < 2; i++) {
      const current = await snapshot(page);
      const moves = current.state.tactics.stacks.find((stack: any) => stack.id === own.native.id).moves;
      const hex = moves[moves.length - 1].hex;
      await page.evaluate(async (hex: number) => { const { fromHexId } = await import(/* @vite-ignore */ '/src/presentation.ts'); await (window as any).battleLab.move(fromHexId(hex)); }, hex);
      await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
      const moved = await snapshot(page);
      expect(moved.units.find((unit: any) => unit.id === own.id).native.hex).toBe(hex);
      expect(moved.state.round).toBe(before.state.round); expect(moved.selected).toBe(own.id);
      expect(moved.state.tactics.side).toBe(side);
    }
    const deployed = (await snapshot(page)).state.units.map((unit: any) => unit.hex);
    await page.locator('#end-tactics').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
    const begun = await snapshot(page);
    expect(begun.state.tactics).toBeUndefined(); expect(begun.state.round).toBe(1);
    expect(begun.state.units.map((unit: any) => unit.hex)).toEqual(deployed);
    await expect(page.locator('#end-tactics')).toBeHidden();
    await page.locator('#reset').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  }
  expect(errors).toEqual([]);
});

test('VCMI AI deploys during tactics before normal automatic battle turns', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#hero-editor').evaluate(el => el.setAttribute('open', ''));
  await page.locator('#hero-enabled-0').check(); await page.locator('#hero-skill-0-0').selectOption('19');
  await page.locator('#hero-skill-level-0-0').selectOption('3');
  await expect(page.locator('#start-battle')).toBeEnabled(); await page.locator('#ai-blue').check();
  await page.locator('#start-battle').click();
  await expect.poll(async () => (await snapshot(page)).state?.revision ?? -1).toBeGreaterThanOrEqual(1);
  await page.locator('#ai-blue').uncheck();
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  expect((await snapshot(page)).state.tactics).toBeUndefined();
  expect((await snapshot(page)).state.round).toBeGreaterThanOrEqual(1);
});


test('both occupied hexes of a wide enemy accept canvas shooting clicks', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#creature-picker').selectOption('marksman'); await page.locator('#replace-unit').click();
  await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('.army-slot[data-team="1"][data-slot="0"]').click();
  await page.locator('#creature-picker').selectOption('bone-dragon'); await page.locator('#replace-unit').click();
  await expect(page.locator('#start-battle')).toBeEnabled();
  for (const index of [0, 1]) {
    await page.locator('#start-battle').click(); await expect(page.locator('#defend-turn')).toBeEnabled();
    const current = await snapshot(page);
    if (current.state.units.find((u: any) => u.id === current.state.activeStack).side === 1) {
      await page.locator('#defend-turn').click(); await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
    }
    await page.locator('#overview').click();
    const before = await snapshot(page), enemy = before.state.units.find((u: any) => u.side === 1);
    expect(enemy.footprint).toHaveLength(2); expect(before.state.legal.shots).toContain(enemy.id);
    const screen = await page.evaluate((hex: number) => (window as any).battleLab.hexScreenPosition(hex), enemy.footprint[index]);
    await page.mouse.move(screen.x, screen.y);
    expect((await snapshot(page)).pointerAttack).toMatchObject({ kind: 'shoot', target: enemy.id });
    const packet = page.waitForRequest(request => request.url().endsWith('/api/engine') && request.postDataJSON().request.op === 'act');
    await page.mouse.click(screen.x, screen.y);
    expect((await packet).postDataJSON().request).toMatchObject({ action: 'shoot', target: enemy.id });
    await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
    expect((await snapshot(page)).state.units.find((u: any) => u.id === enemy.id).health).toBeLessThan(enemy.health);
    await page.locator('#reset').click(); await expect(page.locator('#start-battle')).toBeEnabled();
  }
});

test('melee cursor changes with the pointed side and executes that native attack position', async ({ page }) => {
  test.skip(!process.env.BATTLE_LAB_BACKEND || !process.env.BATTLE_LAB_PROFILE, 'Native engine/profile absent');
  await missingArt(page); await open(page); await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('#creature-picker').selectOption('archangel'); await page.locator('#replace-unit').click();
  await expect(page.locator('#start-battle')).toBeEnabled();
  await page.locator('.army-slot[data-team="1"][data-slot="0"]').click();
  await page.locator('#creature-picker').selectOption('bone-dragon'); await page.locator('#replace-unit').click();
  await expect(page.locator('#start-battle')).toBeEnabled(); await page.locator('#start-battle').click();
  await expect(page.locator('#defend-turn')).toBeEnabled(); await page.locator('#overview').click();
  const before = await snapshot(page), enemy = before.state.units.find((u: any) => u.side === 1);
  const positions = enemy.footprint;
  let intents: any[] = [];
  for (const rotated of [false, true]) {
    if (rotated) {
      const canvas = (await snapshot(page)).canvas;
      await page.mouse.move(canvas.width * .65, canvas.height * .3); await page.mouse.down();
      await page.mouse.move(canvas.width * .65 + 80, canvas.height * .3 + 20, { steps: 8 }); await page.mouse.up();
      expect((await snapshot(page)).camera.position).not.toEqual(before.camera.position);
    }
    intents = [];
    for (const hex of positions) {
      const screen = await page.evaluate((hex: number) => (window as any).battleLab.hexScreenPosition(hex), hex);
      for (const offset of [-10, 10]) {
        await page.mouse.move(screen.x, screen.y + offset);
        const current = await snapshot(page);
        if (current.pointerAttack?.kind === 'melee') intents.push({ ...current.pointerAttack, x: screen.x, y: screen.y + offset, cursor: await page.locator('#battle').evaluate(el => (el as HTMLElement).style.cursor) });
      }
    }
    expect(new Set(intents.map(intent => intent.from)).size).toBeGreaterThan(1);
    expect(new Set(intents.map(intent => intent.cursor)).size).toBeGreaterThan(1);
    for (const intent of intents) expect(before.state.legal.melee).toContainEqual({ target: enemy.id, from: intent.from });
  }
  const chosen = intents[intents.length - 1];
  const packet = page.waitForRequest(request => request.url().endsWith('/api/engine') && request.postDataJSON().request.op === 'act');
  await page.mouse.click(chosen.x, chosen.y);
  expect((await packet).postDataJSON().request).toMatchObject({ action: 'melee', target: enemy.id, from: chosen.from });
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 20000 }).toBe(false);
  const after = await snapshot(page);
  expect(after.state.units.find((u: any) => u.id === before.state.activeStack).hex).toBe(chosen.from);
  expect(after.state.units.find((u: any) => u.id === enemy.id).health).toBeLessThan(enemy.health);
});
