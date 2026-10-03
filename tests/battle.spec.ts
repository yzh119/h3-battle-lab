import { test, expect } from '@playwright/test';

test('public checkout renders without private art and supports movement and combat', async ({ page }) => {
  await page.route('**/local-assets/**', route => route.fulfill({ status: 404, body: '' }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.waitForFunction(() => !!(window as any).battleLab); await expect(page.locator('#loading')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).battleLab.snapshot().draws)).toBeGreaterThan(0);
  await page.locator('#grid').check();
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().grid)).toBe(true);
  await page.getByRole('button', { name: '兵种特写' }).click();
  await page.getByRole('button', { name: '行走', exact: true }).click();
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[0].animation)).toBe('walk');
  await page.locator('#start-battle').click();
  await page.evaluate(async () => { await (window as any).battleLab.move({ q: 4, r: 5 }); });
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[0].cell)).toEqual({ q: 4, r: 5 });
  await expect(page.locator('#turn-status')).toContainText('红方');
  await page.locator('#defend-turn').click();
  await expect(page.locator('#turn-status')).toContainText('第 2 回合');
  await page.evaluate(async () => { await (window as any).battleLab.attack(); });
  const defender = await page.evaluate(() => (window as any).battleLab.snapshot().units[1]);
  expect(defender.hp).toBeGreaterThanOrEqual(242); expect(defender.hp).toBeLessThanOrEqual(281);
  expect(defender.count).toBe(Math.ceil(defender.hp / 15));
  await expect(page.locator('#combat-log')).toContainText('击杀');
  await expect(page.locator('#combat-log')).toContainText('反击');
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[0].hp)).toBeLessThan(120);
  await expect(page.locator('#replace-unit')).toBeDisabled();
  await page.getByRole('button', { name: '重置战场' }).click();
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[1].hp)).toBe(300);
  expect(errors).toEqual([]);
});

test('local GLB assets load and expose baked clips when available', async ({ page, request }) => {
  const response = await request.get('/local-assets/manifest.json');
  test.skip(!response.headers()['content-type']?.includes('json'), 'Private art is intentionally absent from the public repository');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.waitForFunction(() => !!(window as any).battleLab); await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
  await expect(page.locator('#background-picker option')).toHaveCount(15);
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().backdrop)).toBe(true);
  await page.locator('#battle').hover();
  await page.mouse.wheel(0, -250);
  await expect.poll(() => page.evaluate(() => (window as any).battleLab.snapshot().zoom)).toBeGreaterThan(1.5);
  await page.screenshot({ path: '.local/hd-battle-zoom.png' });
  await page.getByRole('button', { name: '缩小战场' }).click();
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().zoom)).toBeLessThan(1.5);
  await page.getByRole('button', { name: '全局', exact: true }).click();
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().zoom)).toBe(1);
  await page.screenshot({ path: '.local/hd-battle.png' });
  await page.locator('#background-picker').selectOption({ index: 2 });
  await expect.poll(() => page.evaluate(() => (window as any).battleLab.snapshot().backdrop)).toBe(true);
  await page.locator('#background-picker').selectOption('');
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().backdrop)).toBe(false);
  const snapshot = await page.evaluate(() => (window as any).battleLab.snapshot());
  expect(snapshot.units.every((u: any) => u.imported)).toBe(true);
  expect(snapshot.units[0].clips).toEqual(expect.arrayContaining(['idle', 'walk', 'attack', 'hit', 'death']));
  await page.getByRole('button', { name: '行走', exact: true }).click();
  await page.waitForTimeout(220);
  const pose = await page.evaluate(() => (window as any).battleLab.snapshot().units[0].pose);
  expect(pose.length).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[0].pose)).not.toBe(pose);
  await page.getByRole('button', { name: '兵种特写' }).click();
  await page.getByRole('button', { name: '攻击', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.local/battle-closeup.png' });
  await page.getByRole('button', { name: '全局', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.local/battle-overview.png' });
  await page.locator('#unit-picker').selectOption('ember');
  await page.getByRole('button', { name: '兵种特写' }).click();
  await page.getByRole('button', { name: '行走', exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: '.local/zombie-closeup.png' });
  expect(errors).toEqual([]);
});

test('army editor changes both teams, preserves composition on reset and enforces capacity', async ({ page }) => {
  // CI uses software WebGL; this case performs repeated edits of an eight-unit scene.
  test.setTimeout(process.env.CI ? 180000 : 90000);
  // Other tests still exercise the default shadow renderer.
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.route('**/local-assets/**', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#shadows').uncheck();
  await page.locator('#creature-picker').selectOption('crusader');
  await expect(page.locator('#creature-note')).toContainText('示意模型');
  await page.locator('#replace-unit').click();
  await expect.poll(() => page.evaluate(() => (window as any).battleLab.snapshot().units[0].kind)).toBe('crusader');
  await page.locator('#team-picker').selectOption('1');
  await page.locator('#creature-picker').selectOption('swordsman');
  for (let i = 0; i < 6; i++) {
    await page.locator('#add-unit').click();
    await expect(page.locator('#unit-picker option')).toHaveCount(i + 3);
  }
  let units = await page.evaluate(() => (window as any).battleLab.snapshot().units);
  expect(units.filter((u: any) => u.team === 1)).toHaveLength(7);
  expect(new Set(units.map((u: any) => JSON.stringify(u.cell))).size).toBe(8);
  await page.locator('#add-unit').click(); await expect(page.locator('#toast')).toContainText('最多 7');
  await page.locator('#reset').click();
  units = await page.evaluate(() => (window as any).battleLab.snapshot().units);
  expect(units).toHaveLength(8); expect(units[0].kind).toBe('crusader');
  await page.locator('#unit-picker').selectOption('ember'); await page.locator('#remove-unit').click();
  expect(await page.locator('#unit-picker option').count()).toBe(7);
});

test('expanded local roster loads Castle and Necropolis animation instances', async ({ page, request }) => {
  const response = await request.get('/local-assets/manifest.json');
  test.skip(!response.headers()['content-type']?.includes('json'), 'Private art absent');
  const manifest = await response.json();
  test.skip(!['swordsman', 'crusader', 'wight', 'wraith'].every(k => manifest.units[k]), 'Expanded local art absent');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
  for (const kind of ['swordsman', 'crusader', 'wight', 'wraith']) {
    await page.locator('#creature-picker').selectOption(kind);
    await page.locator('#team-picker').selectOption(kind === 'swordsman' || kind === 'crusader' ? '0' : '1');
    await page.locator('#add-unit').click();
    await expect.poll(() => page.evaluate((k) => (window as any).battleLab.snapshot().units.some((u: any) => u.kind === k && u.imported), kind), { timeout: 60000 }).toBe(true);
    await page.getByRole('button', { name: '行走', exact: true }).click();
    const pose = await page.evaluate(() => (window as any).battleLab.snapshot().units.at(-1).pose);
    await expect.poll(() => page.evaluate(() => (window as any).battleLab.snapshot().units.at(-1).pose)).not.toBe(pose);
    const unit = await page.evaluate(() => (window as any).battleLab.snapshot().units.at(-1));
    expect(unit.clips).toEqual(expect.arrayContaining(['idle', 'walk', 'attack', 'hit', 'death']));
  }
  expect(await page.locator('#unit-picker option').count()).toBe(6);
  await page.screenshot({ path: '.local/expanded-armies.png' });
  await page.locator('#unit-picker').selectOption('unit-2');
  await page.getByRole('button', { name: '兵种特写' }).click();
  await page.screenshot({ path: '.local/crusader-realtime.png' });
  expect(errors).toEqual([]);
});

test('failed model replacement leaves the existing army usable', async ({ page }) => {
  await page.route('**/local-assets/manifest.json', route => route.fulfill({ json: { units: { wight: { label: '幽灵', url: '/broken.glb' } } } }));
  await page.route('**/broken.glb', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#creature-picker').selectOption('wight'); await page.locator('#replace-unit').click();
  await expect(page.locator('#toast')).toContainText('原阵容已保留');
  const state = await page.evaluate(() => (window as any).battleLab.snapshot());
  expect(state.units.map((u: any) => u.kind)).toEqual(['skeleton', 'zombie']); expect(state.busy).toBe(false);
});

test('stack editor validates numbers, labels quantities and resets wounded stacks', async ({ page }) => {
  await page.route('**/local-assets/**', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#stack-count').fill('37'); await page.locator('#apply-count').click();
  await expect(page.locator('#hp')).toContainText('37 只');
  await expect(page.locator('.stack-badge').first()).toHaveText('37');
  await page.locator('#stack-count').fill('1.5'); await page.locator('#apply-count').click();
  await expect(page.locator('#toast')).toContainText('整数');
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[0].count)).toBe(37);
  await page.locator('#reset').click();
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[0].hp)).toBe(222);
  await page.locator('#stack-count').fill('12'); await page.locator('#creature-picker').selectOption('swordsman');
  await page.locator('#replace-unit').click();
  await expect.poll(() => page.evaluate(() => (window as any).battleLab.snapshot().units[0].hp)).toBe(420);
  await page.evaluate(async () => { await (window as any).battleLab.move({ q: 4, r: 5 }); });
  await page.locator('#stack-count').fill('9'); await page.locator('#apply-count').click();
  await page.locator('#reset').click();
  const unit = await page.evaluate(() => (window as any).battleLab.snapshot().units[0]);
  expect(unit.count).toBe(9); expect(unit.cell).toEqual({ q: 2, r: 5 });
});

test('custom creature packs import, reject bad mechanisms, and fight without artwork', async ({ page }) => {
  await page.route('**/local-assets/**', route => route.fulfill({ status: 404, body: '' }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#creature-import').setInputFiles('examples/custom-creatures.json');
  await expect(page.locator('#creature-import-status')).toContainText('已导入 1');
  await expect(page.locator('#creature-picker')).toHaveValue('custom-spectral-guard');
  await page.locator('#replace-unit').click();
  await expect.poll(() => page.evaluate(() => (window as any).battleLab.snapshot().units[0].kind)).toBe('custom-spectral-guard');
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[0].hp)).toBe(480);
  await page.locator('#creature-import').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, creatures: [{ id: 'bad', label: 'Bad', faction: 'Custom', ruleset: 'custom', stats: { health: 10, attack: 5, defense: 5, minDamage: 1, maxDamage: 2, speed: 4 }, mechanisms: [{ type: 'unknown' }] }] })) });
  await expect(page.locator('#creature-import-status')).toContainText('unsupported mechanism');
  expect(await page.locator('#creature-picker option[value="bad"]').count()).toBe(0);
  await page.locator('#start-battle').click();
  await expect(page.locator('#creature-import')).toBeDisabled();
  await page.evaluate(async () => { await (window as any).battleLab.attack(); });
  const snapshot = await page.evaluate(() => (window as any).battleLab.snapshot());
  expect(snapshot.units[1].hp).toBeLessThan(300);
  expect(snapshot.units[0].hp).toBe(480); // blocksRetaliation
  expect(snapshot.units.every((u: any) => !u.imported)).toBe(true);
  await expect(page.locator('#combat-log p')).toHaveCount(2); // additionalAttacks
  await expect(page.locator('#combat-log')).not.toContainText('反击');
  await page.screenshot({ path: '.local/custom-creature-fallback.png' });
  expect(errors).toEqual([]);
});

test('local creature data autoloads without an art manifest', async ({ page }) => {
  await page.route('**/local-assets/**', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/local-assets/creatures.json', route => route.fulfill({ path: 'examples/custom-creatures.json', contentType: 'application/json' }));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#creature-picker').selectOption('custom-spectral-guard');
  await page.locator('#replace-unit').click();
  await expect.poll(() => page.evaluate(() => (window as any).battleLab.snapshot().units[0].kind)).toBe('custom-spectral-guard');
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[0].imported)).toBe(false);
  await expect(page.locator('#creature-picker option:checked')).toContainText('自定义');
});

test('Marksman renders two shots, updates HP at impact, consumes arrows and resets ammo', async ({ page }) => {
  await page.route('**/local-assets/**', route => route.fulfill({ status: 404, body: '' }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#creature-picker').selectOption('marksman'); await page.locator('#replace-unit').click();
  await page.locator('#start-battle').click();
  await expect(page.locator('#hp')).toContainText('弹药 24');
  await page.evaluate(() => { (window as any).pendingShot = (window as any).battleLab.attack(); });
  await page.waitForFunction(() => {
    const state = (window as any).battleLab.snapshot();
    return state.projectiles > 0 && state.units[1].displayedHp === 300 && state.units[1].hp < 300;
  });
  await page.screenshot({ path: '.local/marksman-projectile-fallback.png' });
  await page.evaluate(() => (window as any).pendingShot);
  let state = await page.evaluate(() => (window as any).battleLab.snapshot());
  expect(state.units[0].shots).toBe(22); expect(state.units[0].hp).toBe(200);
  expect(state.units[0].cell).toEqual({ q: 2, r: 5 });
  expect(state.units[1].hp).toBeGreaterThanOrEqual(174); expect(state.units[1].hp).toBeLessThanOrEqual(216);
  expect(state.units[1].displayedHp).toBe(state.units[1].hp); expect(state.projectiles).toBe(0);
  await expect(page.locator('#combat-log p')).toHaveCount(2); await expect(page.locator('#combat-log')).toContainText('射击');
  await expect(page.locator('#combat-log')).not.toContainText('反击');
  await page.locator('#reset').click(); await page.locator('#start-battle').click();
  state = await page.evaluate(() => (window as any).battleLab.snapshot()); expect(state.units[0].shots).toBe(24);
  expect(errors).toEqual([]);
});

test('forced melee uses speed-limited approach and does not consume shooter ammo or ranged double attack', async ({ page }) => {
  await page.route('**/local-assets/**', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#creature-picker').selectOption('marksman'); await page.locator('#replace-unit').click();
  await page.locator('#force-melee').check(); await page.locator('#start-battle').click();
  await page.evaluate(() => (window as any).battleLab.attack());
  const state = await page.evaluate(() => (window as any).battleLab.snapshot());
  expect(state.units[0].shots).toBe(24); expect(state.units[0].cell).not.toEqual({ q: 2, r: 5 });
  expect(state.units[0].hp).toBeLessThan(200);
  await expect(page.locator('#combat-log p')).toHaveCount(2); // one melee and retaliation
  await expect(page.locator('#combat-log')).toContainText('反击'); await expect(page.locator('#combat-log')).not.toContainText('射击');
});

for (const kind of ['archer', 'marksman']) test(`local ${kind} export plays its real shooting animation when available`, async ({ page, request }) => {
  const response = await request.get('/local-assets/manifest.json');
  test.skip(!response.headers()['content-type']?.includes('json'), 'Private art absent');
  const manifest = await response.json(); test.skip(!manifest.units?.[kind], `${kind} art absent`);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 });
  await page.locator('#creature-picker').selectOption(kind); await page.locator('#replace-unit').click();
  await expect.poll(() => page.evaluate(k => (window as any).battleLab.snapshot().units.some((u: any) => u.kind === k && u.imported), kind), { timeout: 60000 }).toBe(true);
  const unit = await page.evaluate(() => (window as any).battleLab.snapshot().units[0]);
  expect(unit.clips).toEqual(expect.arrayContaining(['idle', 'walk', 'attack', 'hit', 'death', 'shoot']));
  await page.locator('#start-battle').click();
  await page.evaluate(() => { (window as any).pendingShot = (window as any).battleLab.attack(); });
  await page.waitForFunction(() => (window as any).battleLab.snapshot().units[0].animation === 'shoot');
  const pose = await page.evaluate(() => (window as any).battleLab.snapshot().units[0].pose);
  await expect.poll(() => page.evaluate(() => (window as any).battleLab.snapshot().units[0].pose)).not.toBe(pose);
  await page.evaluate(() => (window as any).pendingShot);
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[0].shots)).toBe(kind === 'archer' ? 11 : 22);
  await page.getByRole('button', { name: '兵种特写' }).click();
  await page.screenshot({ path: `.local/${kind}-ranged-local.png` });
  expect(errors).toEqual([]);
});
