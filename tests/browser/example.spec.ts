import { orbitComparison } from './comparison-camera';
import { readComparisonBitmap, comparisonHalf } from './comparison-bitmap';
import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import manifest from '../../tools/gene-light-manifest.json' with { type: 'json' };

test.use({ contextOptions: { reducedMotion: 'reduce' } });
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
    if (Math.abs(png.data[i] - 208) + Math.abs(png.data[i + 1] - 208) + Math.abs(png.data[i + 2] - 208) > 24) {
      count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return { count, bounds: [minX, maxX, minY, maxY] };
}
function expectLightGrayBackground(bytes: Buffer, stacked = false) {
  const png = PNG.sync.read(bytes);
  // Empty corners inside each pane, away from borders, text and the model.
  for (const [x, y] of [[8, 8], stacked ? [8, png.height / 2 + 8] : [png.width / 2 + 8, 8]]) {
    const i = (Math.floor(y) * png.width + Math.floor(x)) * 4;
    expect([...png.data.subarray(i, i + 4)]).toEqual([208, 208, 208, 255]);
  }
}

test('built comparison keeps the light-gray fallback while assets load', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors = errorsFrom(page);
  let releaseAssets!: () => void;
  const assetsReady = new Promise<void>((resolve) => { releaseAssets = resolve; });
  await page.route('**/gene-light/**', async (route) => {
    await assetsReady;
    await route.continue();
  });
  try {
    await page.goto(`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/?demo=gene&backend=webgl`);
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('#viewport')).toHaveCSS('background-color', 'rgb(208, 208, 208)');
    for (const id of ['pmx', 'gltf']) await expect(page.locator(`#${id}-status`)).toContainText('Loading');
    expectLightGrayBackground(await page.locator('#viewport').screenshot());
    await page.setViewportSize({ width: 600, height: 1000 });
    expectLightGrayBackground(await page.locator('#viewport').screenshot(), true);
  } finally {
    releaseAssets();
  }
  await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
  expect(errors).toEqual([]);
});

for (const backend of ['webgl', 'webgpu']) {
  test(`matched PMX and glTF load, render, navigate and toggle on built ${backend} site`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    const errors = errorsFrom(page);
    page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    if (backend === 'webgpu') {
      await page.goto(`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/?demo=gene`);
      const available = await page.evaluate(async () => !!await (navigator as any).gpu?.requestAdapter());
      test.skip(!available, 'Native WebGPU adapter unavailable; WebGL2 is tested separately.');
    }
    await page.goto(`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/?demo=gene&backend=${backend}`);
    await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
    await page.waitForFunction(() => (window as any).mmdExample?.frames > 4);
    await expect(page.locator('#viewport h2')).toHaveText(['MMD', 'glTF']);
    for (const label of ['MMD', 'glTF']) await expect(page.locator('#viewport').getByRole('heading', { name: label, exact: true })).toBeVisible();
    await expect(page.locator('#uka-features p, footer > p.method-note')).toHaveCount(0);
    for (const copy of [/Uka: compare the original PMX/, /Solver-free BDEF subset:/, /PMX is a secondary reference/]) {
      await expect(page.getByText(copy)).not.toBeVisible();
    }
    await expect(page.locator('#viewport .hint')).toBeVisible();
    await expect(page.locator('#about-demo')).not.toHaveAttribute('open');
    const accuracy = page.locator('#about-demo > p').first();
    await expect(accuracy).toContainText('direct PMX-rendering reference');
    await expect(accuracy).toContainText('@takahirox/three-mmd');
    await expect(accuracy).toContainText('not native MikuMikuDance');
    await expect(accuracy).toContainText('Exact MMD visual/physics fidelity is unverified');
    await expect(accuracy).toContainText('solvers and physics use bounded profiles');
    await expect(accuracy).toContainText('IK evaluates all applicable source chains in both panes');
    await expect(accuracy).toContainText('Grant/append and physics remain off');
    await expect(accuracy).toBeHidden();
    await page.locator('#about-demo > summary').click();
    await expect(accuracy).toBeVisible();
    await expect(page.getByRole('link', { name: '@takahirox/three-mmd@0.1.2', exact: true })).toBeVisible();
    await page.locator('#about-demo > summary').click();
    await expect(accuracy).toBeHidden();
    for (const id of ['pmx', 'gltf']) await expect(page.locator(`#${id}-status`)).toContainText('Ready');
    const info = await page.evaluate(() => (window as any).mmdExample);
    expect(info.meshes).toBe(13);
    expect(info.reference).toMatchObject({ loader: 'MMDLoader', materials: 13, scale: 0.08, outlines: true, morphsActive: false });
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
    for (const view of ['orbited', 'quarter-turn', 'half-turn']) {
      if(view!=='orbited')await orbitComparison(page);
      await page.waitForTimeout(600);
      const path = `test-results/gene-${backend}-${view}.png`;
      const capture = await readComparisonBitmap(page);
      await writeFile(path,capture);
      expectLightGrayBackground(capture);
      captures.push(capture);
      const left = silhouette(capture, 0), right = silhouette(capture, 1);
      expect(left.count).toBeGreaterThan(10000);
      expect(right.count).toBeGreaterThan(10000);
      for (let i = 0; i < 4; i++) expect(Math.abs(left.bounds[i] - right.bounds[i])).toBeLessThanOrEqual(3);
      if (process.env.UPDATE_COMPARISON_EVIDENCE === '1' && backend === 'webgl') {
        await mkdir('docs/comparison', { recursive: true });
        await copyFile(path, `docs/comparison/outline-v0.1-${view}.png`);
      }
    }
    expect(captures[0].equals(captures[1])).toBe(false);
    expect(captures[0].equals(captures[2])).toBe(false);
    await orbitComparison(page,-2);
    await page.waitForTimeout(600);
    const outlineOn = await readComparisonBitmap(page);
    await page.selectOption('#outlines', 'off');
    await page.waitForTimeout(300);
    const outlineOff = await readComparisonBitmap(page);
    expectLightGrayBackground(outlineOff);
    // Require a visible contour change in each pane, excluding labels and hints.
    for (const half of [0, 1]) expect(silhouette(outlineOn, half).count).toBeGreaterThan(silhouette(outlineOff, half).count);
    expect(await page.evaluate(() => (window as any).mmdExample.reference.outlines)).toBe(false);
    await page.selectOption('#outlines', 'on');
    await page.waitForTimeout(300);
    expect((await readComparisonBitmap(page)).equals(outlineOn)).toBe(true);
    const pmxBefore = comparisonHalf(await readComparisonBitmap(page),0);
    const toon = comparisonHalf(await readComparisonBitmap(page),1);
    await page.selectOption('#material', 'pbr');
    await expect(page.locator('#gene-status')).toContainText('PBR fallback');
    await page.waitForTimeout(600);
    const pbr = comparisonHalf(await readComparisonBitmap(page),1);
    expectLightGrayBackground(await readComparisonBitmap(page));
    expect(pbr.equals(toon)).toBe(false);
    expect((comparisonHalf(await readComparisonBitmap(page),0)).equals(pmxBefore)).toBe(true);
    await page.selectOption('#material', 'toon');
    await expect(page.locator('#gene-status')).toContainText('MMD toon');
    await page.waitForTimeout(600);
    expect((comparisonHalf(await readComparisonBitmap(page),1)).equals(toon)).toBe(true);
    for (const file of manifest.files) {
      const response = await page.request.get(`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/gene-light/${file.path}`);
      expect(response.status()).toBe(200);
      expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(file.sha256);
    }
    for (const path of ['source-manifest.json', 'conversion.json']) {
      expect((await page.request.get(`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/gene-light/${path}`)).status()).toBe(200);
    }
    // Both views remain visible, equally sized and synchronized in the stacked mobile layout.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const left = (await page.locator('#pmx-pane').boundingBox())!, right = (await page.locator('#gltf-pane').boundingBox())!;
    expect(left.width).toBe(right.width); expect(left.height).toBe(right.height);
    expect(left.x).toBe(right.x); expect(right.y).toBeGreaterThanOrEqual(left.y + left.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    for (const pane of ['pmx', 'gltf']) {
      const heading = (await page.locator(`#${pane}-pane h2`).boundingBox())!;
      expect(heading.x).toBeGreaterThanOrEqual(left.x);
      expect(heading.x + heading.width).toBeLessThanOrEqual(left.x + left.width);
    }
    cameras = await page.evaluate(() => (window as any).mmdExample.cameras);
    expect(cameras[0]).toEqual(cameras[1]);
    expectLightGrayBackground(await readComparisonBitmap(page), true);
    expect(errors).toEqual([]);
  });
}

test('missing PMX image reports the reference failure clearly', async ({ page }) => {
  await page.route('**/gene-light/light/arm.png', (route) => route.fulfill({ status: 404, body: 'Missing test image' }));
  await page.goto(`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/?demo=gene&backend=webgl`);
  await expect(page.locator('#pmx-status')).toContainText('Load failed', { timeout: 90000 });
  await expect(page.locator('#gene-status')).toContainText('Could not load/render the comparison');
});
