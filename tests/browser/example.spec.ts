import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { mkdir, copyFile } from 'node:fs/promises';
import manifest from '../../tools/gene-light-manifest.json' with { type: 'json' };

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
function silhouette(bytes: Buffer, half: number) {
  const png = PNG.sync.read(bytes);
  const width = png.width / 2;
  let count = 0, minX = width, maxX = 0, minY = png.height, maxY = 0;
  for (let y = 85; y < png.height - 45; y++) for (let x = 2; x < width - 2; x++) {
    const i = (y * png.width + half * width + x) * 4;
    if (Math.abs(png.data[i] - 32) + Math.abs(png.data[i + 1] - 43) + Math.abs(png.data[i + 2] - 59) > 24) {
      count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return { count, bounds: [minX, maxX, minY, maxY] };
}
for (const backend of ['webgl', 'webgpu']) {
  test(`matched PMX and glTF load, render, navigate and toggle on built ${backend} site`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    const errors = errorsFrom(page);
    page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    if (backend === 'webgpu') {
      await page.goto('http://127.0.0.1:43180/mmd-gltf/');
      const available = await page.evaluate(async () => !!await (navigator as any).gpu?.requestAdapter());
      test.skip(!available, 'Native WebGPU adapter unavailable; WebGL2 is tested separately.');
    }
    await page.goto(`http://127.0.0.1:43180/mmd-gltf/?backend=${backend}`);
    await expect(page.locator('#status')).toContainText('Ready', { timeout: 90000 });
    await page.waitForFunction(() => (window as any).mmdExample?.frames > 4);
    for (const label of ['Direct PMX reference', 'MMD glTF']) await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '@takahirox/three-mmd@0.1.2', exact: true })).toBeVisible();
    for (const id of ['pmx', 'gltf']) await expect(page.locator(`#${id}-status`)).toContainText('Ready');
    const info = await page.evaluate(() => (window as any).mmdExample);
    expect(info.meshes).toBe(13);
    expect(info.reference).toMatchObject({ loader: 'MMDLoader', materials: 13, scale: 0.08, outlines: false, morphsActive: false });
    expect(info.backend).toBe(backend === 'webgl' ? 'WebGL2' : 'WebGPU');
    for (const edge of ['min', 'max']) for (let axis = 0; axis < 3; axis++) {
      expect(info.reference.bounds[edge][axis]).toBeCloseTo(info.gltf.bounds[edge][axis], 6);
    }
    expect(info.cameras[0]).toEqual(info.cameras[1]);
    const canvas = page.locator('canvas');
    const rect = (await canvas.boundingBox())!;
    const originalCamera = info.cameras[0];
    // Orbit from the PMX pane, then zoom from the glTF pane; both must update the same camera.
    await page.mouse.move(rect.x + rect.width * 0.25, rect.y + rect.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.45, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    let cameras = await page.evaluate(() => (window as any).mmdExample.cameras);
    expect(cameras[0]).toEqual(cameras[1]);
    expect(cameras[0]).not.toEqual(originalCamera);
    const orbitCamera = cameras[0];
    await page.mouse.move(rect.x + rect.width * 0.75, rect.y + rect.height * 0.5);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(600);
    cameras = await page.evaluate(() => (window as any).mmdExample.cameras);
    expect(cameras[0]).toEqual(cameras[1]);
    expect(cameras[0]).not.toEqual(orbitCamera);
    const captures: Buffer[] = [];
    for (const view of ['front', 'side', 'back']) {
      await page.selectOption('#viewpoint', view);
      await page.waitForTimeout(600);
      const path = `test-results/gene-${backend}-${view}.png`;
      const capture = await page.locator('#viewport').screenshot({ path });
      captures.push(capture);
      const left = silhouette(capture, 0), right = silhouette(capture, 1);
      expect(left.count).toBeGreaterThan(10000);
      expect(right.count).toBeGreaterThan(10000);
      for (let i = 0; i < 4; i++) expect(Math.abs(left.bounds[i] - right.bounds[i])).toBeLessThanOrEqual(3);
      if (process.env.UPDATE_COMPARISON_EVIDENCE === '1' && backend === 'webgl') {
        await mkdir('docs/comparison', { recursive: true });
        await copyFile(path, `docs/comparison/three-mmd-0.1.2-${view}.png`);
      }
    }
    expect(captures[0].equals(captures[1])).toBe(false);
    expect(captures[0].equals(captures[2])).toBe(false);
    await page.selectOption('#viewpoint', 'front');
    await page.waitForTimeout(600);
    const pmxBefore = await page.locator('#pmx-pane').screenshot();
    const toon = await page.locator('#gltf-pane').screenshot();
    await page.selectOption('#material', 'pbr');
    await expect(page.locator('#status')).toContainText('PBR fallback');
    await page.waitForTimeout(600);
    const pbr = await page.locator('#gltf-pane').screenshot();
    expect(pbr.equals(toon)).toBe(false);
    expect((await page.locator('#pmx-pane').screenshot()).equals(pmxBefore)).toBe(true);
    await page.selectOption('#material', 'toon');
    await expect(page.locator('#status')).toContainText('MMD toon');
    await page.waitForTimeout(600);
    expect((await page.locator('#gltf-pane').screenshot()).equals(toon)).toBe(true);
    for (const file of manifest.files) {
      const response = await page.request.get(`http://127.0.0.1:43180/mmd-gltf/gene-light/${file.path}`);
      expect(response.status()).toBe(200);
      expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(file.sha256);
    }
    for (const path of ['source-manifest.json', 'conversion.json']) {
      expect((await page.request.get(`http://127.0.0.1:43180/mmd-gltf/gene-light/${path}`)).status()).toBe(200);
    }
    // Both views remain visible, equally sized and synchronized in the stacked mobile layout.
    await page.setViewportSize({ width: 600, height: 1000 });
    await page.waitForTimeout(600);
    const left = (await page.locator('#pmx-pane').boundingBox())!, right = (await page.locator('#gltf-pane').boundingBox())!;
    expect(left.width).toBe(right.width); expect(left.height).toBe(right.height);
    expect(left.x).toBe(right.x); expect(right.y).toBeGreaterThanOrEqual(left.y + left.height);
    cameras = await page.evaluate(() => (window as any).mmdExample.cameras);
    expect(cameras[0]).toEqual(cameras[1]);
    expect(errors).toEqual([]);
  });
}

test('missing PMX image reports the reference failure clearly', async ({ page }) => {
  await page.route('**/gene-light/light/arm.png', (route) => route.fulfill({ status: 404, body: 'Missing test image' }));
  await page.goto('http://127.0.0.1:43180/mmd-gltf/?backend=webgl');
  await expect(page.locator('#pmx-status')).toContainText('Load failed', { timeout: 90000 });
  await expect(page.locator('#status')).toContainText('Could not load/render the comparison');
});
