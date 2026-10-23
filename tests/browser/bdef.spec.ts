import { test, expect } from '@playwright/test';

test('converted PMX skins match analytic surface and outline predictions through pinned GLTFLoader', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('bdef-conformance.html');
  await page.waitForFunction(() => (window as any).bdefConformance || (window as any).bdefConformanceError);
  expect(await page.evaluate(() => (window as any).bdefConformanceError)).toBeUndefined();
  expect(errors).toEqual([]);
  const result = await page.evaluate(() => (window as any).bdefConformance);
  expect(result.passed).toBe(12);
  console.log('Converter BDEF GPU evidence:', JSON.stringify(result));
});
