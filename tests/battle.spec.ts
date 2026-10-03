import { test, expect } from '@playwright/test';
const snapshot = (page: any) => page.evaluate(() => (window as any).battleLab.snapshot());
async function missingArt(page: any) {
  await page.route('**/local-assets/**', (route: any) => route.fulfill({ status: 404, body: '' }));
}
async function open(page: any) {
  await page.goto('/'); await page.waitForFunction(() => !!(window as any).battleLab); await expect(page.locator('#loading')).toBeHidden({ timeout: 20000 });
  await expect.poll(async () => (await snapshot(page)).draws).toBeGreaterThan(0);
}

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
  await open(page); await expect.poll(async () => (await snapshot(page)).backdrop).toBe(true);
  const bounds = await page.locator('#battle').boundingBox();
  await page.locator('#closeup').click(); expect((await snapshot(page)).backdrop).toBe(false);
  expect(await page.locator('#battle').boundingBox()).toEqual(bounds);
  await expect(page.locator('#closeup')).toHaveClass('active');
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
  await page.locator('#hero-editor summary').click(); await page.locator('#hero-enabled-0').check();
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
  await page.locator('#hero-editor summary').click(); await page.locator('#hero-enabled-0').check();
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
  await page.locator('#hero-editor summary').click();
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
