import { test, expect } from '@playwright/test';

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
