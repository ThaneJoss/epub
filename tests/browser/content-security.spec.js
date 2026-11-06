import { test, expect } from '@playwright/test';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { makeEpub, makeFixedEpub } from '../fixture.mjs';

function editEpub(bytes, edit) {
  const files = unzipSync(bytes);
  edit(files);
  return zipSync({
    ...files,
    mimetype: [files.mimetype, { level: 0 }],
  });
}

async function openLocalEpub(page, bytes, name) {
  await page.goto('/bibi/');
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(bytes),
  });
  await page.waitForFunction(() => window.Bibi?.Opened === 'Opened');
}

test('EPUB navigation keeps its links without injecting styles or requesting resources', async ({ page }) => {
  const trackingPath = `/books/${Buffer.from('https://tracker.example.org/read?id=nav').toString('base64url')}.epub`;
  const requests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/books/') || url.hostname === 'tracker.example.org') {
      requests.push(request.url());
    }
  });
  // A regression must be observed without sending traffic to an external host.
  await page.route('**/books/**', route => route.abort());
  await page.route('https://tracker.example.org/**', route => route.abort());

  const bytes = editEpub(makeEpub(), files => {
    files['OEBPS/nav.xhtml'] = strToU8(`
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
        <head><title>目录</title></head>
        <body>
          <nav epub:type="toc" style="position:fixed;inset:0;z-index:999999">
            <style>
              html#bibi { --epub-nav-injected: yes; }
              html#bibi #bibi-menu { display:none!important; }
            </style>
            <h2>安全目录</h2>
            <img src="${trackingPath}" alt="tracking"/>
            <svg xmlns="http://www.w3.org/2000/svg">
              <image href="${trackingPath}"/>
            </svg>
            <ol>
              <li><a href="one.xhtml">第一章 开始阅读</a></li>
              <li><a href="two.xhtml"><span>第二章 继续旅程</span></a></li>
            </ol>
          </nav>
        </body>
      </html>
    `);
  });

  await openLocalEpub(page, bytes, 'navigation-security.epub');
  const navigation = page.locator('#bibi-panel-bookinfo-navigation');
  const nav = navigation.locator('nav');
  await expect(nav).toHaveAttribute('epub:type', 'toc');
  await expect(nav.locator('h2')).toHaveText('安全目录');
  await expect(navigation.locator('style, img, svg, video, audio, source, iframe, object, embed, link')).toHaveCount(0);
  await expect(navigation.locator('[style]')).toHaveCount(0);
  expect(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--epub-nav-injected').trim(),
  )).toBe('');

  await page.evaluate(() => E.dispatch('bibi:commands:open-panel'));
  await nav.getByRole('link', { name: '第二章 继续旅程' }).click();
  await expect.poll(() =>
    page.evaluate(() => I.PageObserver.Current.Pages[0].Item.Index),
  ).toBe(1);
  expect(requests).toEqual([]);
});

test('fixed-layout XHTML retains each page viewport without OPF or image fallback dimensions', async ({ page }) => {
  const pages = [
    { id: 'one', width: 600.5, height: 800.25 },
    { id: 'two', width: 800, height: 600 },
    { id: 'three', width: 600, height: 800 },
    { id: 'four', width: 800, height: 600 },
  ];
  const bytes = editEpub(makeFixedEpub(), files => {
    files['OEBPS/content.opf'] = strToU8(strFromU8(files['OEBPS/content.opf'])
      .replace('<meta name="original-resolution" content="600x800"/>', ''));
    for (const { id, width, height } of pages) {
      files[`OEBPS/${id}.xhtml`] = strToU8(`
        <html xmlns="http://www.w3.org/1999/xhtml">
          <head>
            <title>${id}</title>
            <meta name="viewport" content="width=${width}, height=${height}"/>
          </head>
          <body style="margin:0">
            <div style="position:absolute;left:0;top:0">页面起点</div>
            <p style="position:absolute;left:${width - 80}px;top:${height - 50}px">页面边缘</p>
          </body>
        </html>
      `);
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await openLocalEpub(page, bytes, 'fixed-page-viewports.epub');
  expect(await page.evaluate(() => B.ICBViewport)).toBeNull();

  const currentLayout = () => page.evaluate(() => {
    const item = I.PageObserver.Current.Pages[0].Item;
    return {
      index: item.Index,
      width: item.Viewport?.Width,
      height: item.Viewport?.Height,
      frameWidth: item.style.width,
      frameHeight: item.style.height,
    };
  });
  for (const [index, { width, height }] of pages.entries()) {
    if (index) await page.keyboard.press('ArrowRight');
    await expect.poll(currentLayout).toEqual({
      index,
      width,
      height,
      frameWidth: `${width}px`,
      frameHeight: `${height}px`,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => R.Stage.Width)).toBe(390);
  await expect.poll(currentLayout).toEqual({
    index: 3,
    width: 800,
    height: 600,
    frameWidth: '800px',
    frameHeight: '600px',
  });
  await expect.poll(() =>
    page.evaluate(() => I.PageObserver.Current.Pages.length),
  ).toBe(1);
});

test('viewport reconstruction accepts finite positive dimensions and discards other metadata', async ({ page }) => {
  await openLocalEpub(page, makeEpub(), 'viewport-policy.epub');
  const cases = [
    { name: 'comma', content: 'width=600, height=800', expected: [600, 800] },
    { name: 'semicolon', content: 'width=600; height=800', expected: [600, 800] },
    { name: 'whitespace and case', content: 'HEIGHT = 800 WIDTH = 600', expected: [600, 800] },
    { name: 'decimal', content: 'width=600.5,height=800.25', expected: [600.5, 800.25] },
    { name: 'fraction', content: 'width=0.5,height=1.25', expected: [0.5, 1.25] },
    { name: 'leading decimal point', content: 'width=.5,height=.75', expected: [0.5, 0.75] },
    { name: 'scientific notation', content: 'width=1e-7,height=2e-7', expected: [1e-7, 2e-7] },
    { name: 'unrelated option', content: 'width=600,height=800,initial-scale=2', expected: [600, 800] },
    { name: 'missing height', content: 'width=600', expected: null },
    { name: 'zero', content: 'width=0,height=800', expected: null },
    { name: 'negative', content: 'width=600,height=-800', expected: null },
    { name: 'non-finite', content: 'width=Infinity,height=800', expected: null },
    { name: 'overflow', content: `width=${'9'.repeat(400)},height=800`, expected: null },
    { name: 'hexadecimal', content: 'width=0x258,height=800', expected: null },
    { name: 'units', content: 'width=600px,height=800', expected: null },
    { name: 'duplicate dimension', content: 'width=600,width=700,height=800', expected: null },
  ];
  const results = await page.evaluate(samples => samples.map(({ content }) => {
    const source = {
      Content: `<html><head>
        <meta http-equiv="refresh" content="0;url=https://tracker.example.org/refresh">
        <meta http-equiv="Content-Security-Policy" content="default-src *">
        <meta name="viewport" content="${content}" style="display:none" data-original="unsafe">
        <meta name="viewport" content="width=900,height=900">
        </head><body><p>正文</p></body></html>`,
    };
    const clean = O.sanitizeItemSource(source, { As: 'HTML' });
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    const viewport = O.getViewportByMetaContent(content);
    return {
      bibiViewport: viewport ? [viewport.Width, viewport.Height] : null,
      viewports: Array.from(doc.querySelectorAll('meta[name="viewport"]'), meta => {
        const value = meta.getAttribute('content');
        return {
          dimensions: [
            Number(/\bwidth\s*=\s*([^,;\s]+)/i.exec(value)?.[1]),
            Number(/\bheight\s*=\s*([^,;\s]+)/i.exec(value)?.[1]),
          ],
          attributes: Array.from(meta.attributes, attribute => attribute.name).sort(),
        };
      }),
      policies: Array.from(doc.querySelectorAll('meta[http-equiv]'), meta => ({
        kind: meta.httpEquiv.toLowerCase(),
        content: meta.content,
      })),
    };
  }), cases);

  for (const [index, sample] of cases.entries()) {
    const result = results[index];
    expect(result.bibiViewport, sample.name).toEqual(sample.expected);
    expect(result.viewports, sample.name).toEqual(sample.expected ? [{
      dimensions: sample.expected,
      attributes: ['content', 'name'],
    }] : []);
    expect(result.policies, sample.name).toHaveLength(1);
    expect(result.policies[0].kind, sample.name).toBe('content-security-policy');
    expect(result.policies[0].content, sample.name).toContain("script-src 'none'");
  }
});
