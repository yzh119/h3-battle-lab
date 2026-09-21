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
  await page.evaluate(async () => { await (window as any).battleLab.move({ q: 4, r: 5 }); });
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[0].cell)).toEqual({ q: 4, r: 5 });
  await page.evaluate(async () => { await (window as any).battleLab.attack(); });
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[1].hp)).toBe(75);
  await page.getByRole('button', { name: '重置战场' }).click();
  expect(await page.evaluate(() => (window as any).battleLab.snapshot().units[1].hp)).toBe(100);
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
  // Capacity checks do not need expensive software-rendered shadows; other tests cover the default renderer.
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
