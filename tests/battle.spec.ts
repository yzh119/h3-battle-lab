import { test, expect } from '@playwright/test';
const snapshot = (page: any) => page.evaluate(() => (window as any).battleLab.snapshot());
async function missingArt(page: any) {
  await page.route('**/local-assets/**', (route: any) => route.fulfill({ status: 404, body: '' }));
}
async function open(page: any) {
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden();
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
  await page.locator('#creature-import').setInputFiles('examples/custom-creatures.json');
  await expect(page.locator('#creature-import-status')).toContainText('暂不能加入对战');
});

test('local GLBs expose clips and change bone transforms', async ({ page, request }) => {
  const response = await request.get('/local-assets/manifest.json');
  test.skip(!response.headers()['content-type']?.includes('json'), 'Private art is absent');
  await open(page); const initial = await snapshot(page);
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
  await expect.poll(async () => (await snapshot(page)).projectiles).toBe(1);
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
  await open(page); expect((await snapshot(page)).backdrop).toBe(true);
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
