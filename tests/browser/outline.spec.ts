import { test, expect } from '@playwright/test';
for (const backend of ['webgl', 'webgpu']) test(`production outline equation, encoded compositing, depth, loader and viewport conformance on ${backend}`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (backend === 'webgpu') {
    await page.goto('conformance.html');
    const available = await page.evaluate(async () => !!await (navigator as any).gpu?.requestAdapter());
    test.skip(!available, 'Native WebGPU adapter unavailable; mandatory WebGL2 readbacks run independently.');
  }
  await page.goto(`outline-conformance.html?backend=${backend}`);
  await page.waitForFunction(() => (window as any).outlineConformance || (window as any).outlineConformanceError);
  expect(await page.evaluate(() => (window as any).outlineConformanceError)).toBeUndefined();
  expect(errors).toEqual([]);
  const result = await page.evaluate(() => (window as any).outlineConformance);
  expect(result.passed).toBeGreaterThan(80);
  expect(result.gray[0]).toBeCloseTo(0.25, 2);
  console.log('Outline GPU conformance:', result);
});
