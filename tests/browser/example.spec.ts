import { test, expect } from '@playwright/test';

function errorsFrom(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  return errors;
}
test('production TSL graph matches independent numerical fixtures on WebGL2', async ({ page }) => {
  const errors = errorsFrom(page);
  await page.goto('conformance.html');
  await page.waitForFunction(() => (window as any).conformance || (window as any).conformanceError);
  expect(await page.evaluate(() => (window as any).conformanceError)).toBeUndefined();
  const result = await page.evaluate(() => (window as any).conformance);
  expect(result.passed).toBeGreaterThan(35);
  expect(result.loader).toBe(true);
  expect(errors).toEqual([]);
  console.log('GPU conformance:', result);
});
for (const backend of ['webgl', 'webgpu']) {
  test(`generated Gene GLB loads, renders and toggles on ${backend}`, async ({ page }) => {
    const errors = errorsFrom(page);
    if (backend === 'webgpu') {
      await page.goto('http://127.0.0.1:43180/mmd-gltf/');
      const available = await page.evaluate(async () => !!await (navigator as any).gpu?.requestAdapter());
      test.skip(!available, 'Native WebGPU adapter unavailable; WebGL2 is tested separately.');
    }
    await page.goto(`http://127.0.0.1:43180/mmd-gltf/?backend=${backend}`);
    await expect(page.locator('#status')).toContainText('Ready', { timeout: 90000 });
    await page.waitForFunction(() => (window as any).mmdExample?.frames > 4);
    const info = await page.evaluate(() => (window as any).mmdExample);
    expect(info.meshes).toBe(13);
    expect(info.backend).toBe(backend === 'webgl' ? 'WebGL2' : 'WebGPU');
    const toon = await page.locator('canvas').screenshot();
    await page.selectOption('#material', 'pbr');
    await expect(page.locator('#status')).toContainText('PBR fallback');
    await page.waitForTimeout(300);
    const pbr = await page.locator('canvas').screenshot();
    expect(pbr.equals(toon)).toBe(false);
    await page.selectOption('#material', 'toon');
    await expect(page.locator('#status')).toContainText('MMD toon');
    // Model occupies the center; require color variety so an empty clear frame cannot pass.
    const variety = await page.evaluate(async (png) => {
      const source = new Image(); source.src = `data:image/png;base64,${png}`;
      await source.decode();
      const copy = document.createElement('canvas'); copy.width = copy.height = 64;
      const c = copy.getContext('2d')!; c.drawImage(source, 0, 0, 64, 64);
      return new Set(Array.from(c.getImageData(0, 0, 64, 64).data).filter((_, i) => i % 4 !== 3)).size;
    }, toon.toString('base64'));
    expect(variety).toBeGreaterThan(40);
    for (const path of ['README.md', 'README.ja.md', 'source-manifest.json', 'conversion.json']) {
      expect((await page.request.get(`http://127.0.0.1:43180/mmd-gltf/gene-light/${path}`)).status()).toBe(200);
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/gene-${backend}.png`, fullPage: true });
  });
}
