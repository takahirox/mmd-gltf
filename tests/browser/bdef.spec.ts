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

test('built synthetic rig has repeatable preset, rest reset, Toon, core PBR and Outline controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:43180/mmd-gltf/rig.html');
  await expect(page.locator('#status')).toContainText('Ready');
  await page.waitForFunction(() => (window as any).mmdRig?.frames > 2);
  const rest = await page.locator('canvas').screenshot();
  await page.locator('#rig-preset').click();
  await expect(page.locator('#rig-state')).toContainText('90°');
  await page.waitForTimeout(200);
  const preset = await page.locator('canvas').screenshot();
  expect(preset.equals(rest)).toBe(false);
  await page.locator('#rig-preset').click(); await page.waitForTimeout(200);
  expect((await page.locator('canvas').screenshot()).equals(preset)).toBe(true);
  await page.locator('#rig-reset').click(); await page.waitForTimeout(200);
  expect((await page.locator('canvas').screenshot()).equals(rest)).toBe(true);
  await page.locator('#rig-material').selectOption('pbr'); await page.waitForTimeout(200);
  const pbr = await page.locator('canvas').screenshot(); expect(pbr.equals(rest)).toBe(false);
  await page.locator('#rig-preset').click(); await page.waitForTimeout(200);
  expect((await page.locator('canvas').screenshot()).equals(pbr)).toBe(false);
  await page.locator('#rig-outlines').selectOption('off'); await page.waitForTimeout(200);
  const off = await page.locator('canvas').screenshot();
  await page.locator('#rig-outlines').selectOption('on'); await page.waitForTimeout(200);
  expect((await page.locator('canvas').screenshot()).equals(off)).toBe(false);
  expect(errors).toEqual([]);
});
