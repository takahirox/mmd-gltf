import { test, expect } from '@playwright/test';

// Playwright disables the cache by default. Exercise real history restoration.
test.use({ launchOptions: {
  ignoreDefaultArgs: ['--disable-back-forward-cache'],
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
} });

const preview = `http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;

for (const demo of ['gene', 'rig']) {
  test(`cached ${demo} viewer resumes after repeated Back navigation`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Chrome's plain-text README viewer requests an unrelated root favicon.
    const isFavicon = (url: string) => url === new URL('/favicon.ico',preview).href;
    page.on('console', message => {
      if (message.type() === 'error' && !isFavicon(message.location().url)) errors.push(`${message.text()} (${message.location().url})`);
    });
    page.on('response', response => { if (response.status() >= 400 && !isFavicon(response.url())) errors.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.goto(`${preview}?demo=rig`);
    await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
    await page.locator('#demo-model').selectOption('gene');
    await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
    await page.locator('#material').selectOption('pbr');
    await page.locator('#demo-model').selectOption('rig');
    await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
    await page.locator('#rig-model').selectOption('physics-box-qdef');
    await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
    await page.locator('#motion-load').click();
    await expect(page.locator('#rig-status')).toContainText('VMD loaded');
    await page.locator('#motion-loop').check();
    if (demo === 'gene') await page.locator('#demo-model').selectOption('gene');
    else await page.locator('#motion-play').click();

    await page.evaluate(() => {
      const w = window as any;
      w.cacheTest = { restores: 0, canvases: Array.from(document.querySelectorAll('canvas')) };
      window.addEventListener('pagehide', event => {
        w.cacheTest.persisted = event.persisted;
        w.cacheTest.frames = { gene: w.mmdExample.frames, rig: w.mmdRig.frames };
        w.cacheTest.time = w.mmdRig.time;
      });
      window.addEventListener('pageshow', event => {
        if (event.persisted) w.cacheTest.restores++;
      });
    });
    for (let visit = 1; visit <= 2; visit++) {
      await page.locator('#about-demo').evaluate((details: HTMLDetailsElement) => { details.open = true; });
      await page.locator('a[href="./gene-light/README.md"]').click();
      await expect(page).toHaveURL(`${preview}gene-light/README.md`);
      // A cache restore commits without firing a new document load event.
      await page.goBack({ waitUntil: 'commit' });
      await expect(page).toHaveURL(`${preview}?demo=rig`);
      // A fresh document must fail: persisted=true and this token survive only in the cache.
      await expect.poll(() => page.evaluate(() => (window as any).cacheTest?.restores)).toBe(visit);
      expect(await page.evaluate(() => (window as any).cacheTest.persisted)).toBe(true);
      await expect(page.locator('#demo-model')).toHaveValue(demo);
      await expect(page.locator('#viewport canvas')).toHaveCount(1);
      await expect(page.locator('#rig-viewport canvas')).toHaveCount(1);
      expect(await page.evaluate(() => (window as any).cacheTest.canvases.every((canvas: HTMLCanvasElement) => canvas.isConnected))).toBe(true);
      // The README link scrolls to the footer. Measure the selected viewer's
      // rendering with its viewport visible after history restores that scroll.
      await page.locator(demo === 'gene' ? '#viewport' : '#rig-viewport').scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(demo => {
        const w = window as any;
        return (demo === 'gene' ? w.mmdExample : w.mmdRig).frames - w.cacheTest.frames[demo];
      }, demo)).toBeGreaterThan(2);
      const inactive = demo === 'gene' ? 'rig' : 'gene';
      expect(await page.evaluate(inactive => {
        const w = window as any;
        return (inactive === 'gene' ? w.mmdExample : w.mmdRig).frames - w.cacheTest.frames[inactive];
      }, inactive)).toBe(0);
      await expect(page.locator('#gene-status')).toContainText('PBR fallback');
      expect(await page.evaluate(() => (window as any).mmdRig.playing)).toBe(demo === 'rig');
      if (demo === 'rig') {
        await expect.poll(() => page.evaluate(() => {
          const w = window as any;
          return w.mmdRig.time !== w.cacheTest.time;
        })).toBe(true);
        // Exercise the retained player, physics and controls after restoration.
        await page.locator('#motion-pause').click();
        await page.locator('#physics-step').click();
        await expect(page.locator('#rig-status')).toContainText('Physics stepped');
        await page.locator('#motion-play').click();
      } else {
        await page.locator('#outlines').selectOption(visit === 1 ? 'off' : 'on');
        await expect.poll(() => page.evaluate(() => (window as any).mmdExample.reference.outlines)).toBe(visit !== 1);
      }
    }
    // The other retained viewer must still activate normally after restoration.
    await page.locator('#demo-model').selectOption(demo === 'gene' ? 'rig' : 'gene');
    expect(errors).toEqual([]);
  });
}
