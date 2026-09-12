import { test, expect } from '@playwright/test';

const url = 'http://127.0.0.1:8100/';
const releasePayload = {
  tag_name: 'v0.2.0',
  published_at: '2026-09-11T00:00:00Z',
  body: '剧情互动版\n六章二十四节点完整贯通',
  assets: [{
    name: 'FrostStory-arm64.apk',
    size: 241001702,
    browser_download_url: 'https://github.com/JackLee992/frost-story/releases/download/v0.2.0/FrostStory-arm64.apk'
  }]
};

async function stubReleaseData(page) {
  await page.route('https://api.github.com/repos/JackLee992/frost-story/releases/latest', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(releasePayload)
  }));
  await page.route('https://raw.githubusercontent.com/JackLee992/frost-story/main/distribution/content-manifest.json', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ version: '0.2.0' })
  }));
}

for (const viewport of [{ width: 390, height: 844, name: 'mobile' }, { width: 1440, height: 1000, name: 'desktop' }]) {
  test(`下载页 ${viewport.name} 布局和动态版本`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await stubReleaseData(page);
    await page.goto(url, { waitUntil: 'networkidle' });

    const download = page.locator('#downloadLink');
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute('href', /releases\/download\/v0\.2\.0\/FrostStory-arm64\.apk$/);
    await expect(page.locator('#downloadMeta')).toContainText('230 MB');
    await expect(page.locator('#contentVersion')).toHaveText('v0.2.0');
    await expect(page.locator('#contentState')).toContainText('六章 24 节点');
    await expect(page.locator('.chapter-list article')).toHaveCount(6);
    expect(await page.locator('.phone-shot img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('.keyart').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(errors).toEqual([]);

    if (viewport.name === 'mobile') {
      const box = await download.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.screenshot({ path: `artifacts/qa/site-${viewport.name}.png`, fullPage: true });
    await context.close();
  });
}
