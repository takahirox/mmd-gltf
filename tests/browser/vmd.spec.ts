import { test, expect } from '@playwright/test';
const preview = 'http://127.0.0.1:43180/mmd-gltf/';
test('built VMD conformance: both motions/rigs, direct bytes + GLB/glTF, independent scalar skin/normal oracle, Toon/PBR + outlines', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${preview}vmd-conformance.html`);
  await page.waitForFunction(
    () => (window as any).vmdConformance || (window as any).vmdConformanceError,
    undefined,
    { timeout: 180000 },
  );
  expect(await page.evaluate(() => (window as any).vmdConformanceError)).toBeUndefined();
  expect(errors).toEqual([]);
  const result = await page.evaluate(() => (window as any).vmdConformance);
  expect(result.passed).toBe(144);
  console.log(
    'VMD GPU evidence:',
    JSON.stringify({
      comparisons: result.passed,
      maximumPositionError: Math.max(...result.evidence.map((e: any) => e.maximumPositionError)),
      maximumRotationError: Math.max(...result.evidence.map((e: any) => e.maximumRotationError)),
      maximumOraclePixelMismatches: Math.max(...result.evidence.map((e: any) => e.oraclePixelMismatches)),
    }),
  );
  await testInfo.attach('vmd-conformance.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});

test('built Demo VMD lifecycle: both rigs/motions/sources, fractional seek, playback/loop, VPD handoff, local failure recovery and cleanup', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${preview}rig.html`);
  await expect(page.locator('#rig-preset')).toBeEnabled();
  const state = () => page.evaluate(() => (window as any).mmdRig),
    snapshot = async () => (await state()).bones;
  const seek = async (time: number) => {
    await page.locator('#motion-time').fill(String(time));
    await page.locator('#motion-time').dispatchEvent('input');
    await expect.poll(async () => (await state()).time).toBe(time);
  };
  const image = async () => {
    await page.waitForTimeout(100);
    return page.locator('canvas').screenshot();
  };
  for (const rig of ['box', 'wedge']) {
    if (rig === 'wedge') {
      await page.locator('#rig-model').selectOption(rig);
      await expect(page.locator('#rig-state')).toHaveText('Rest state');
      await expect(page.locator('#rig-preset')).toBeEnabled();
    }
    const rest = await snapshot();
    for (const motion of ['a', 'b']) {
      await page.locator('#motion-sample').selectOption(motion);
      await expect(page.locator('#motion-load')).toBeEnabled();
      let canonical: unknown;
      for (const source of ['bytes', 'glb', 'gltf']) {
        await page.locator('#motion-source').selectOption(source);
        await page.locator('#motion-load').click();
        await expect(page.locator('#rig-state')).toContainText(`Motion ${motion.toUpperCase()} (${source})`);
        await expect(page.locator('#status')).toContainText('Omitted execution');
        await seek(0.371);
        const initial = await snapshot();
        expect(initial).not.toEqual(rest);
        if (canonical) expect(initial).toEqual(canonical);
        else canonical = initial;
        await seek(0.719);
        expect(await snapshot()).not.toEqual(initial);
        await seek(0.371);
        expect(await snapshot()).toEqual(initial);
        const toon = await image();
        await page.locator('#rig-material').selectOption('pbr');
        const pbr = await image();
        expect(pbr.equals(toon)).toBe(false);
        await page.locator('#rig-outlines').selectOption('off');
        const off = await image();
        expect(off.equals(pbr)).toBe(false);
        await page.locator('#rig-outlines').selectOption('on');
        expect((await image()).equals(pbr)).toBe(true);
        await page.locator('#rig-material').selectOption('toon');
        await page.locator('#motion-play').click();
        await expect.poll(async () => (await state()).time).toBeGreaterThan(0.371);
        await page.locator('#motion-pause').click();
        const paused = await snapshot(),
          time = (await state()).time;
        await page.waitForTimeout(150);
        expect(await snapshot()).toEqual(paused);
        expect((await state()).time).toBe(time);
        await seek(0.371);
        await page.locator('#motion-play').click();
        await page.locator('#rig-pose').selectOption('b');
        await page.locator('#rig-preset').click();
        await expect(page.locator('#status')).toContainText('Applied VPD');
        expect((await state()).playing).toBe(false);
        await seek(0.371);
        expect(await snapshot()).toEqual(initial);
        await page.locator('#motion-reset').click();
        await expect(page.locator('#rig-state')).toHaveText('Rest state');
        expect(await snapshot()).toEqual(rest);
      }
    }
    await page.locator('#motion-loop').check();
    await seek(1.32);
    await page.locator('#motion-play').click();
    await expect.poll(async () => (await state()).time).toBeLessThan(0.5);
    await page.locator('#motion-pause').click();
    expect((await state()).playing).toBe(false);
    await page.locator('#motion-loop').uncheck();
    await seek(0.371);
    const before = await snapshot();
    await page
      .locator('#motion-file')
      .setInputFiles({
        name: 'broken.vmd',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('bad'),
      });
    await page.locator('#motion-load').click();
    await expect(page.locator('#status')).toContainText('VMD: truncated');
    expect(await snapshot()).toEqual(before);
    await page.locator('#motion-file').setInputFiles('tests/fixtures/motion-a.vmd');
    await page.locator('#motion-load').click();
    await expect(page.locator('#status')).toContainText('requires explicit mapping');
    expect(await snapshot()).toEqual(before);
    await page
      .locator('#motion-map')
      .fill('{"93af96bc2e8d9c205b6475706c6963":0,"7469705f626f756e646172795f3135":259}');
    await page.locator('#motion-load').click();
    await expect(page.locator('#status')).toContainText('VMD loaded');
    await seek(0.371);
    expect(await snapshot()).not.toEqual(before);
    await page.locator('#motion-reset').click();
    expect(await snapshot()).toEqual(rest);
  }
  expect((await state()).disposedPlayers).toBeGreaterThanOrEqual(24);
  expect(errors).toEqual([]);
});
