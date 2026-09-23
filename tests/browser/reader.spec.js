import { test, expect } from '@playwright/test';
import { makeEpub, makeFixedEpub } from '../fixture.mjs';

test('desktop and mobile homepage, errors, and real 404', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('打开一本书，开始阅读。');
  await page.getByRole('button', { name: '开始阅读' }).click();
  await expect(page.getByRole('status')).toContainText('请输入有效');
  await page.getByLabel('EPUB 文件链接').fill('https://fixtures.example.org/html');
  await page.getByRole('button', { name: '开始阅读' }).click();
  await expect(page.getByRole('status')).toContainText('不是 EPUB');
  await page.getByLabel('EPUB 文件链接').fill('https://fixtures.example.org/missing.epub');
  await page.getByRole('button', { name: '开始阅读' }).click();
  await expect(page.getByRole('status')).toContainText('找不到');
  await page.goto('/');
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
  const missing = await page.goto('/not-a-page');
  expect(missing.status()).toBe(404);
});

test('URL → Worker proxy → Bibi, TOC, pagination, persistence and sanitization', async ({ page }) => {
  const errors = [];
  const tracking = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('tracker.example.org')) tracking.push(request.url()); });
  await page.goto('/');
  await page.getByLabel('EPUB 文件链接').fill('https://fixtures.example.org/book.epub?signature=a%2Bb');
  await page.getByRole('button', { name: '开始阅读' }).click();
  await page.waitForURL('**/bibi/?book=*');
  await page.waitForFunction(() => window.Bibi?.Opened === 'Opened');
  await expect(page.locator('#bibi-veil')).toHaveCSS('opacity', '0');
  await expect(page.locator('html')).not.toHaveClass(/busy/);
  expect(await page.title()).toContain('阅读测试');
  expect(await page.evaluate(() => window.__epubScriptRan)).toBeUndefined();
  expect(tracking).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.locator('#bibi-panel-bookinfo-navigation')).toContainText('第二章 继续旅程');
  const first = await page.evaluate(() => I.PageObserver.Current.Pages[0].Index);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => I.PageObserver.Current.Pages[0].Index)).toBeGreaterThan(first);
  await page.evaluate(() => E.dispatch('bibi:commands:open-panel'));
  await page.locator('#bibi-panel-bookinfo-navigation a').filter({ hasText: '第二章' }).click();
  await expect.poll(() => page.evaluate(() => I.PageObserver.Current.Pages[0].Item.Index)).toBe(1);
  await page.screenshot({ path: 'test-results/reader-desktop.png' });
  await page.reload();
  await page.waitForFunction(() => window.Bibi?.Opened === 'Opened');
  await expect.poll(() => page.evaluate(() => I.PageObserver.Current.Pages[0].Item.Index)).toBe(1);
  expect(errors).toEqual([]);
});

test('local EPUB loads on a mobile viewport without an upload', async ({ page }) => {
  const uploads = [];
  page.on('request', request => { if (request.method() === 'POST' || request.url().includes('/books/')) uploads.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('link', { name: '选择本地文件' }).click();
  await page.getByRole('button', { name: '选择 EPUB 文件' }).waitFor();
  await page.screenshot({ path: 'test-results/leafread-file-picker-mobile.png' });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '选择 EPUB 文件' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'reading.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(makeEpub()) });
  await page.waitForFunction(() => window.Bibi?.Opened === 'Opened');
  await expect(page.locator('#bibi-veil')).toHaveCSS('opacity', '0');
  await expect(page.locator('html')).not.toHaveClass(/busy/);
  expect(await page.title()).toContain('阅读测试');
  expect(uploads).toEqual([]);
  expect(await page.evaluate(() => window.__epubScriptRan)).toBeUndefined();
  await page.screenshot({ path: 'test-results/reader-mobile.png' });
});

for (const kind of ['reflowable', 'fixed-ltr', 'fixed-rtl']) {
  test(`${kind} stays single-page on wide and mobile screens`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1680, height: 900 });
    // An old view preference or shared scrolling URL must not restore spreads.
    await page.goto('/bibi/?reader-view-mode=vertical');
    const bytes = kind === 'reflowable' ? makeEpub() : makeFixedEpub({ rtl: kind === 'fixed-rtl' });
    await page.locator('input[type=file]').setInputFiles({ name: `${kind}.epub`, mimeType: 'application/epub+zip', buffer: Buffer.from(bytes) });
    await page.waitForFunction(() => window.Bibi?.Opened === 'Opened');
    await expect.poll(() => page.evaluate(() => I.PageObserver.Current.Pages.length)).toBe(1);
    expect(await page.evaluate(() => S.RVM)).toBe('paged');
    expect(await page.evaluate(() => R.Items.every(item => !item.Spreaded))).toBe(true);
    if (kind !== 'reflowable') {
      expect(await page.evaluate(() => R.Spreads.map(spread => spread.Items.length))).toEqual([1, 1, 1, 1]);
    }

    const first = await page.evaluate(() => I.PageObserver.Current.Pages[0].Index);
    await page.keyboard.press(kind === 'fixed-rtl' ? 'ArrowLeft' : 'ArrowRight');
    await expect.poll(() => page.evaluate(() => I.PageObserver.Current.Pages[0].Index)).toBe(first + 1);
    await expect.poll(() => page.evaluate(() => I.PageObserver.Current.Pages.length)).toBe(1);
    await page.screenshot({ path: `test-results/single-page-${kind}-desktop.png` });

    for (const viewport of [{ width: 2560, height: 1080 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.evaluate(() => R.Stage.Width)).toBe(viewport.width);
      await expect.poll(() => page.evaluate(() => R.LayingOut || I.PageObserver.Current.Pages.length)).toBe(1);
      expect(await page.evaluate(() => R.Items.every(item => !item.Spreaded))).toBe(true);
    }
    await page.screenshot({ path: `test-results/single-page-${kind}-mobile.png` });
    expect(errors).toEqual([]);
  });
}
