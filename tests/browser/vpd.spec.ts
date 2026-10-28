import { openRigDemo } from './demo-controls';
import { readRigBitmap } from './rig-bitmap';
import { test, expect } from '@playwright/test';
const preview = 'http://127.0.0.1:43180/mmd-gltf/';

test('built VPD surfaces/outlines match independent scalar predictions for both rigs/poses through runtime and GLB/glTF reloads', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${preview}vpd-conformance.html`);
  await page.waitForFunction(() => (window as any).vpdConformance || (window as any).vpdConformanceError, undefined, { timeout: 180000 });
  expect(await page.evaluate(() => (window as any).vpdConformanceError)).toBeUndefined();
  expect(errors).toEqual([]);
  const result = await page.evaluate(() => (window as any).vpdConformance);
  expect(result.passed).toBe(240);
  await testInfo.attach('vpd-conformance.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  const summary = [];
  for (const rig of ['box','wedge']) for (const pose of ['a','b']) {
    const cases = result.evidence.filter((e: any) => e.rig===rig && e.pose===pose);
    summary.push({ rig, pose, comparisons: cases.length, maximumPositionError: Math.max(...cases.map((e: any) => e.maximumPositionError)), maximumOraclePixelMismatches: Math.max(...cases.map((e: any) => e.oraclePixelMismatches)) });
  }
  console.log('VPD GPU evidence:', JSON.stringify(summary));
});

test('built VPD demo: both rigs/poses, repeat/reset, encoding, local errors and recovery, Toon/PBR and outlines', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await openRigDemo(page, preview);
  await expect(page.locator('#rig-status')).toContainText('Ready');
  await page.waitForFunction(() => (window as any).mmdRig?.frames > 2);
  const snapshot = () => page.evaluate(() => (window as any).mmdRig.bones);
  const image = async () => { await page.waitForTimeout(200); return readRigBitmap(page); };
  for (const rig of ['box','wedge']) {
    if (rig==='wedge') {
      await page.locator('#rig-model').selectOption(rig);
      await expect(page.locator('#rig-state')).toHaveText('Rest state');
      await expect(page.locator('#rig-preset')).toBeEnabled();
    }
    const rest = await snapshot(), restImage = await image();
    await page.locator('#rig-pose').selectOption('a');
    await page.locator('#rig-preset').click(); await expect(page.locator('#rig-state')).toContainText('Pose A');
    const a = await snapshot(), aImage = await image();
    expect(a).not.toEqual(rest); expect(aImage.equals(restImage)).toBe(false);
    await page.locator('#rig-preset').click(); await page.waitForTimeout(200);
    expect(await snapshot()).toEqual(a); expect((await image()).equals(aImage)).toBe(true);
    await page.locator('#rig-pose').selectOption('b');
    await page.locator('#rig-preset').click(); await expect(page.locator('#rig-state')).toContainText('Pose B');
    expect(await snapshot()).not.toEqual(a);
    await page.locator('#rig-pose').selectOption('a'); await page.locator('#rig-preset').click(); await expect(page.locator('#rig-state')).toContainText('Pose A');
    expect(await snapshot()).toEqual(a); expect((await image()).equals(aImage)).toBe(true);
    await page.locator('#rig-reset').click(); await expect(page.locator('#rig-state')).toHaveText('Rest state');
    expect(await snapshot()).toEqual(rest); expect((await image()).equals(restImage)).toBe(true);
    await page.locator('#rig-preset').click(); await expect(page.locator('#rig-state')).toContainText('Pose A');
    await page.locator('#rig-material').selectOption('pbr'); const pbr = await image(); expect(pbr.equals(aImage)).toBe(false);
    await page.locator('#rig-outlines').selectOption('off'); const off = await image(); expect(off.equals(pbr)).toBe(false);
    await page.locator('#rig-outlines').selectOption('on'); expect((await image()).equals(pbr)).toBe(true);
    await page.locator('#rig-material').selectOption('toon');
    // Real byte upload: malformed Shift_JIS, ambiguous exact Japanese names, explicit map, and recovery.
    await page.locator('#rig-file').setInputFiles({name:'bad.vpd',mimeType:'application/octet-stream',buffer:Buffer.from([0x82])});
    await page.locator('#rig-encoding').selectOption('shift_jis');
    await page.locator('#rig-preset').click(); await expect(page.locator('#rig-status')).toContainText('malformed shift_jis'); expect(await snapshot()).toEqual(a);
    await page.locator('#rig-file').setInputFiles('tests/fixtures/pose-a.vpd');
    await page.locator('#rig-preset').click(); await expect(page.locator('#rig-status')).toContainText('ambiguous'); expect(await snapshot()).toEqual(a);
    await page.locator('#rig-map').fill('{"2":0,"3":259}');
    await page.locator('#rig-preset').click(); await expect(page.locator('#rig-status')).toContainText('Applied VPD'); expect(await snapshot()).toEqual(a);
    await page.locator('#rig-file').setInputFiles('tests/fixtures/pose-b.vpd');
    await page.locator('#rig-encoding').selectOption('utf-8'); await page.locator('#rig-map').fill('{"0":259}');
    await page.locator('#rig-preset').click(); await expect(page.locator('#rig-state')).toContainText('3 bone offsets'); await expect(page.locator('#rig-status')).toContainText('Applied VPD'); expect(await snapshot()).not.toEqual(a);
    await page.locator('#rig-reset').click(); await expect(page.locator('#rig-state')).toHaveText('Rest state'); expect(await snapshot()).toEqual(rest);
    await expect(page.locator('#physics-panel')).toBeHidden();
    await expect(page.locator('#ik-panel')).toBeHidden();
  }
  expect(errors).toEqual([]);
});
