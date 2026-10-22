import { test, expect } from '@playwright/test';
import { makeEpub } from '../fixture.mjs';

test('reader file selection has a visible keyboard focus and supports Enter and Space', async ({ page }) => {
  for (const [key, viewport, name] of [
    ['Enter', { width: 1280, height: 720 }, 'desktop'],
    ['Space', { width: 390, height: 844 }, 'mobile'],
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/bibi/');
    const button = page.getByRole('button', { name: '选择 EPUB 文件' });
    await expect(button).toBeVisible();
    // Tab from the document, so clipped fallback links cannot silently precede
    // the visible control. Calling button.focus() would miss that regression.
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await expect(button).toBeInViewport();
    await expect(button).toHaveCSS('outline-style', 'solid');
    await expect(button).toHaveCSS('outline-width', '3px');
    await expect(button).toHaveCSS('outline-color', 'rgb(37, 99, 235)');
    await page.screenshot({ path: `test-results/reader-keyboard-${name}.png` });

    // A closed Bibi submenu also contains a home link; Tab must skip it.
    await page.keyboard.press('Tab');
    await expect(page.locator('.leafread-credits .leafread-brand')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(button).toBeFocused();

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.keyboard.press(key),
    ]);
    expect(chooser.isMultiple()).toBe(false);
  }
});

test('reader shell respects reduced motion without changing the default preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/bibi/');
  await expect(page.getByRole('button', { name: '选择 EPUB 文件' })).toBeVisible();
  for (const selector of ['#bibi-veil', '#bibi-panel', '#bibi-catcher']) {
    const durations = await page.locator(selector).evaluate(element => {
      return [null, '::before', '::after'].flatMap(pseudo => {
        const style = getComputedStyle(element, pseudo);
        return [style.transitionDuration, style.transitionDelay, style.animationDuration, style.animationDelay]
          .flatMap(value => value.split(',').map(Number.parseFloat));
      });
    });
    expect(durations.every(seconds => seconds <= 0.00001)).toBe(true);
  }

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const normalDuration = await page.locator('#bibi-veil').evaluate(element =>
    Number.parseFloat(getComputedStyle(element).transitionDuration));
  expect(normalDuration).toBeGreaterThan(0.01);
});

test('reader panels and credits leave the focus order when closed and recover when reopened', async ({ page }) => {
  await page.goto('/bibi/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'reading.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(makeEpub()),
  });
  await page.waitForFunction(() => window.Bibi?.Opened === 'Opened');

  const menuHome = page.locator('.leafread-menu-brand');
  const panel = page.locator('#bibi-panel');
  const chapter = panel.locator('nav a').first();
  const config = page.locator('#bibi-subpanel_config');
  const configHome = config.getByRole('link', { name: '返回叶读首页', includeHidden: true });
  const credits = page.locator('#bibi-poweredby');
  const creditHome = credits.locator('.leafread-brand');
  const engineCredit = credits.locator('.leafread-engine-credit');
  const expectUnfocusable = async link => {
    await menuHome.focus();
    await link.focus();
    await expect(menuHome).toBeFocused();
  };

  for (let cycle = 0; cycle < 2; cycle++) {
    await expect(panel).toHaveCSS('visibility', 'hidden');
    await expect(config).toHaveCSS('visibility', 'hidden');
    await expect(credits).toHaveCSS('visibility', 'hidden');
    for (const link of [chapter, configHome, creditHome, engineCredit]) await expectUnfocusable(link);
    // Tab must also skip the zero-height credits after the visible menu link.
    await page.keyboard.press('Tab');
    await expect(creditHome).not.toBeFocused();
    await expect(engineCredit).not.toBeFocused();

    await page.evaluate(() => I.Panel.open());
    await expect(panel).toHaveCSS('visibility', 'visible');
    await expect(chapter).toBeInViewport();
    await chapter.focus();
    await expect(chapter).toBeFocused();
    await expect(credits).toHaveCSS('visibility', 'visible');
    await expect(creditHome).toBeInViewport();
    await creditHome.focus();
    await expect(creditHome).toBeFocused();
    await page.evaluate(() => I.Panel.close());
    await expect(panel).toHaveCSS('visibility', 'hidden');
    await expect(credits).toHaveCSS('visibility', 'hidden');
    await expectUnfocusable(chapter);
    await expectUnfocusable(creditHome);

    await page.evaluate(() => I.Menu.Config.open());
    await expect(config).toHaveCSS('visibility', 'visible');
    await expect(configHome).toBeInViewport();
    await configHome.focus();
    await expect(configHome).toBeFocused();
    await page.evaluate(() => I.Menu.Config.close());
    await expect(config).toHaveCSS('visibility', 'hidden');
    await expectUnfocusable(configHome);
  }
});

test.describe('reader startup fallback', () => {
  test.use({ javaScriptEnabled: false });

  test('keeps the home link visible and usable when JavaScript is unavailable', async ({ page }) => {
    await page.goto('/bibi/');
    const home = page.getByRole('link', { name: '返回叶读首页，输入在线链接' });
    await expect(home).toBeInViewport();
    await page.keyboard.press('Tab');
    await expect(home).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/');
  });
});
