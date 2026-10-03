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
