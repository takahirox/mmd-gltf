import { openComparisonDetails } from './demo-controls';
import { orbitComparison } from './comparison-camera';
import { test, expect, type Page } from '@playwright/test';

test.use({ contextOptions: { reducedMotion: 'reduce' } });
const preview = `http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;
const rigState = (page: Page) => page.evaluate(() => (window as any).mmdRig);
async function expectMotionControlsToFit(page: Page) {
  const motion = (await page.locator('#motion-sample').boundingBox())!;
  const source = (await page.locator('#motion-source').boundingBox())!;
  for (const id of ['motion-sample', 'motion-source']) {
    const control = (await page.locator(`#${id}`).boundingBox())!;
    const label = (await page.locator(`label:has(>#${id})`).boundingBox())!;
    expect(control.x).toBeGreaterThanOrEqual(label.x);
    expect(control.x + control.width).toBeLessThanOrEqual(label.x + label.width + 1);
  }
  expect(motion.x + motion.width).toBeLessThanOrEqual(source.x);
}
async function selectRig(page: Page, value: string) {
  await page.locator('#rig-model').selectOption(value);
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await page.waitForFunction(value => {
    const state = (window as any).mmdRig;
    return state.rig === value && state.rendered?.rig === value && state.rendered.revision === state.revision;
  }, value);
}
function errorsFrom(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  return errors;
}

test('public character picker and credits exclude fixtures; explicit rig entry retains the harness', async ({ page }, testInfo) => {
  const errors = errorsFrom(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(preview);
  await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
  await expect(page.locator('#demo-model')).toHaveValue('uka');
  await page.locator('#about-demo > summary').click();
  await expect(page.locator('#about-demo h2')).toHaveText([
    'Uka · source & rights', 'Gene Light · source & rights',
  ]);
  await expect(page.locator('#about-demo')).not.toContainText(/synthetic|box|wedge|rig diagnostics/i);
  await expect(page.locator('#about-demo a').filter({ hasText: /box|wedge|pose|motion|solver|physics|sdef|qdef/i })).toHaveCount(0);
  await page.locator('#about-demo > summary').click();
  await expect(page.locator('a[href*="demo=rig"], a[href$="rig.html"], a[href*="conformance.html"]')).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('#demo-model option')).toHaveText(['Uka', 'Gene Light']);
    await expect(page.locator('#preset-picker')).toBeHidden();
    await expect(page.locator('#rig-demo')).toBeHidden();
    await expect(page.locator('#viewport h2')).toHaveText(['MMD', 'glTF']);
    await expect(page.locator('#about-demo')).not.toHaveAttribute('open');
    expect(await rigState(page)).toBeUndefined();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`public-${width}.png`), fullPage: true });
  }
  await page.locator('#demo-model').selectOption('gene');
  await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
  await expect(page.locator('#demo-model option')).toHaveText(['Uka', 'Gene Light']);
  await expect(page.locator('#preset-picker')).toBeHidden();

  await page.goto(`${preview}?demo=rig`);
  await expect(page.locator('#demo-model')).toHaveValue('rig');
  await expect(page.locator('#rig-status')).toContainText('Rig loaded', { timeout: 30000 });
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#preset-picker')).toBeVisible();
  await expect(page.locator('#rig-model option')).toHaveCount(24);
  await expect.poll(async () => (await rigState(page))?.frames).toBeGreaterThan(1);
  await expect(page.locator('#rig-demo #rig-state')).toHaveText('Rest state');
  await expect(page.locator('#rig-demo #morph-state')).toContainText('Weights:');
  await expect(page.locator('#rig-demo #motion-diagnostics')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('one built page: both directions, every preset, contextual controls and inactive viewer cleanup', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = errorsFrom(page);
  await page.goto(`${preview}?demo=rig`);
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await page.locator('#demo-model').selectOption('gene');
  await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
  await expect(page.locator('#preset-picker')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('landing-desktop.png') });
  const documentToken = await page.evaluate(() => { (window as any).demoDocument = 'same document'; return location.href; });
  await page.locator('#demo-model').selectOption('rig');
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#gene-demo')).toBeHidden();
  const geneFrames = await page.evaluate(() => (window as any).mmdExample.frames);
  await expect(page.locator('#physics-panel')).toBeHidden();
  await expect(page.locator('#ik-panel')).toBeHidden();
  await expect(page.locator('#motion-play')).toBeDisabled();
  const presets = await page.locator('#rig-model option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
  expect(presets).toHaveLength(24);
  for (const preset of presets) await selectRig(page, preset);

  await selectRig(page, 'bone-box');
  await page.locator('#motion-load').click();
  await expect(page.locator('#rig-status')).toContainText('VMD loaded');
  await page.locator('#motion-time').fill('0.4');
  await page.locator('#motion-time').dispatchEvent('input');
  const morph = page.locator('#morph-controls input').first();
  await morph.fill('0.6');
  await morph.dispatchEvent('change');
  expect((await rigState(page)).weights[0]).toBe(0.6);
  await page.screenshot({ path: testInfo.outputPath('morph-desktop.png') });
  await selectRig(page, 'physics-box-qdef');
  await expect(page.locator('#physics-panel')).toBeVisible();
  await expect(page.locator('#ik-panel')).toBeVisible();
  await page.locator('#motion-load').click();
  await expect(page.locator('#rig-status')).toContainText('VMD loaded');
  await page.locator('#motion-time').fill('0.4');
  await page.locator('#motion-time').dispatchEvent('input');
  await page.locator('#ik-override').selectOption('off');
  await page.locator('#physics-step').click();
  await expect(page.locator('#rig-status')).toContainText('Physics stepped');
  await page.locator('#rig-fit').click();
  await page.screenshot({ path: testInfo.outputPath('physics-desktop.png') });
  await page.locator('#motion-loop').check();
  await page.locator('#motion-play').click();
  await expect.poll(async () => (await rigState(page)).playing).toBe(true);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).mmdExample.frames)).toBe(geneFrames);
  await page.locator('#demo-model').selectOption('gene');
  await expect(page.locator('#gene-demo')).toBeVisible();
  await expect.poll(async () => (await rigState(page)).playing).toBe(false);
  const paused = await rigState(page);
  await page.waitForTimeout(250);
  expect((await rigState(page)).frames).toBe(paused.frames);
  expect((await rigState(page)).physics).toEqual(paused.physics);
  await page.locator('#material').selectOption('pbr');
  await openComparisonDetails(page);
  await page.locator('#outlines').uncheck();
  await orbitComparison(page,2);
  await expect(page.locator('#gene-status')).toContainText('PBR fallback');
  await page.locator('#demo-model').selectOption('rig');
  await expect.poll(async () => (await rigState(page)).frames).toBeGreaterThan(paused.frames);
  expect((await rigState(page)).playing).toBe(false);
  expect((await rigState(page)).rig).toBe('physics-box-qdef');
  await expect(page.locator('#rig-viewpoint')).toHaveValue('orbit');
  await page.locator('#rig-viewpoint').selectOption('front');
  await page.locator('#rig-material').selectOption('pbr');
  await page.locator('#rig-outlines').selectOption('off');
  await expect.poll(async () => (await rigState(page)).rendered.mode).toBe('pbr');
  await expect.poll(async () => (await rigState(page)).rendered.outlines).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await rigState(page)).frames).toBeGreaterThan(paused.frames + 1);
  expect((await page.locator('#rig-viewport').boundingBox())!.height).toBeGreaterThanOrEqual(340);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expectMotionControlsToFit(page);
  await page.screenshot({ path: testInfo.outputPath('physics-resized-mobile.png'), fullPage: true });
  expect(await page.locator('canvas').count()).toBe(2);
  expect(await page.evaluate(() => (window as any).demoDocument)).toBe('same document');
  expect(page.url()).toBe(documentToken);
  expect(errors).toEqual([]);
});

test('mobile viewport, keyboard disclosures, local error recovery and export', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = errorsFrom(page);
  await page.goto(`${preview}?demo=rig`);
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await page.locator('#demo-model').selectOption('gene');
  await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
  await page.screenshot({ path: testInfo.outputPath('landing-mobile.png'), fullPage: true });
  await page.locator('#demo-model').selectOption('rig');
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await selectRig(page, 'bone-wedge-qdef');
  // Exercise a real zero-size ResizeObserver delivery, then require rendering to resume.
  const beforeCollapse = (await rigState(page)).frames;
  await page.locator('#rig-viewport').evaluate(element => new Promise<void>(resolve => {
    const observer = new ResizeObserver(entries => {
      if (entries[0].contentRect.width === 0 && entries[0].contentRect.height === 0) { observer.disconnect(); resolve(); }
    });
    observer.observe(element); element.style.display = 'none';
  }));
  await page.locator('#rig-viewport').evaluate(element => { element.style.removeProperty('display'); });
  await expect.poll(async () => (await rigState(page)).frames).toBeGreaterThan(beforeCollapse);
  await expectMotionControlsToFit(page);
  const viewport = (await page.locator('#rig-viewport').boundingBox())!;
  expect(viewport.height).toBeGreaterThanOrEqual(340);
  expect(viewport.y).toBeLessThan(300);
  await expect(page.locator('#pose-controls')).not.toHaveAttribute('open');
  await page.locator('#motion-load').click();
  await expect(page.locator('#rig-status')).toContainText('VMD loaded');
  await page.locator('#motion-time').fill('0.4');
  await page.locator('#motion-time').dispatchEvent('input');
  const morphSummary = page.locator('#morph-panel > summary');
  await morphSummary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#morph-controls input').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('rig-mobile.png'), fullPage: true });
  await page.locator('#motion-controls .local-controls > summary').click();
  await page.locator('#motion-file').setInputFiles({ name: 'bad.vmd', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') });
  await expect(page.locator('#motion-source')).toHaveValue('bytes');
  await expect(page.locator('#motion-source option[value=glb]')).toHaveAttribute('disabled', '');
  await page.locator('#motion-load').click();
  await expect(page.locator('#rig-status')).toHaveAttribute('data-error', 'true');
  await expect(page.locator('#rig-status')).toContainText('VMD: truncated');
  await page.locator('#motion-sample').selectOption('bone-b');
  await expect(page.locator('#motion-load')).toBeEnabled();
  await page.locator('#motion-load').click();
  await expect(page.locator('#rig-status')).toHaveAttribute('data-error', 'false');
  await expect(page.locator('#rig-status')).toContainText('VMD loaded');
  await page.getByText('Export snapshot', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#rig-export-glb').click();
  expect((await downloadPromise).suggestedFilename()).toBe('bone-wedge-qdef-applied.glb');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('#about-demo > summary').click();
  await expect(page.getByRole('link', { name: 'CC BY 4.0', exact: true }).first()).toBeVisible();
  await expect(page.getByText('CG-CA Gene (c) 2023', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('comparison failure releases its canvas and can retry in place', async ({ page }, info) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/gene-light/light/arm.png', route => route.fulfill({ status: 404, body: 'Missing test image' }));
  await page.goto(`${preview}?demo=rig`);
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await page.locator('#demo-model').selectOption('gene');
  await expect(page.locator('#gene-status')).toContainText('Could not load/render the comparison', { timeout: 90000 });
  await expect(page.locator('#viewport canvas')).toHaveCount(0);
  await expect(page.locator('#comparison-details')).toBeHidden();
  await expect(page.locator('#gene-status')).toHaveAttribute('role','status');
  await expect(page.locator('#gene-status')).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry loading'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({path:info.outputPath('comparison-error-390.png'),fullPage:true});
  await page.unroute('**/gene-light/light/arm.png');
  await page.locator('#demo-retry').click();
  await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
  await expect(page.locator('#viewport canvas')).toHaveCount(1);
  await page.locator('#demo-model').selectOption('rig');
  await expect(page.locator('#rig-status')).toContainText('Rig loaded', { timeout: 30000 });
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await page.locator('#demo-model').selectOption('gene');
  await expect(page.locator('#viewport canvas')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('legacy rig URL preserves backend and selects the unified rig view', async ({ page }) => {
  await page.goto(`${preview}rig.html?backend=webgl`);
  await expect(page).toHaveURL(`${preview}?backend=webgl&demo=rig`);
  await expect(page.locator('#demo-model')).toHaveValue('rig');
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
});

test('failed rig loads can retry and failed replacement preserves the current rig', async ({ page }) => {
  await page.route('**/morph/box/rest.glb', route => route.fulfill({ status: 404, body: 'Missing test rig' }));
  await page.goto(`${preview}?demo=rig`);
  await expect(page.locator('#rig-status')).toHaveAttribute('data-error', 'true');
  await expect(page.locator('#demo-model')).toBeEnabled({ timeout: 30000 });
  await page.unroute('**/morph/box/rest.glb');
  await page.locator('#rig-retry').click();
  await expect(page.locator('#rig-status')).toContainText('Rig loaded');
  await expect.poll(async () => (await rigState(page)).frames).toBeGreaterThan(1);
  const before = (await rigState(page)).bones;
  await page.route('**/qdef/box/rest.glb', route => route.fulfill({ status: 404, body: 'Missing test replacement' }));
  await page.locator('#rig-model').selectOption('qdef-box');
  await expect(page.locator('#rig-status')).toHaveAttribute('data-error', 'true');
  await expect(page.locator('#rig-model')).toHaveValue('box');
  expect((await rigState(page)).bones).toEqual(before);
  await page.unroute('**/qdef/box/rest.glb');
  await selectRig(page, 'qdef-box');
  await expect(page.locator('#rig-status')).toHaveAttribute('data-error', 'false');
  await expect(page.locator('#rig-viewport canvas')).toHaveCount(1);
});

test('motion finishing after a model switch stays paused in its own viewer', async ({ page }, info) => {
  const errors = errorsFrom(page);
  await page.goto(`${preview}?demo=rig`);
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await page.locator('#demo-model').selectOption('gene');
  await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
  await page.locator('#demo-model').selectOption('rig');
  await expect(page.locator('#rig-model')).toBeEnabled({ timeout: 30000 });
  await selectRig(page, 'solver-box-bdef');
  await page.locator('#motion-source').selectOption('glb');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  let resumeWaitMs: number | undefined;
  await page.route('**/solver/box-bdef/a.glb', async route => {
    requests++;
    await pending;
    await route.continue();
  });
  try {
    await page.locator('#motion-load').click();
    await expect.poll(() => requests).toBeGreaterThan(0);
    await expect(page.locator('#rig-model')).toBeDisabled();
    await page.locator('#demo-model').selectOption('gene');
    const frames = (await rigState(page)).frames;
    release();
    await expect(page.locator('#rig-status')).toContainText('VMD loaded');
    await expect(page.locator('#gene-status')).toContainText('Ready');
    await expect(page.locator('#demo-model')).toHaveValue('gene');
    await page.waitForTimeout(250);
    expect((await rigState(page)).frames).toBe(frames);
    expect((await rigState(page)).playing).toBe(false);
    await page.locator('#demo-model').selectOption('rig');
    // A resumed software-rendered frame can take longer than expect.poll's
    // five seconds. Use the normal render acknowledgement wait, as selectRig
    // does, and reject a stale marker from an earlier revision or motion.
    const resumeStarted = performance.now();
    try {
      await page.waitForFunction(() => {
        const state = (window as any).mmdRig, rendered = state.rendered;
        return rendered?.revision === state.revision && rendered.rig === state.rig &&
          rendered.motion === state.motion && rendered.motion.includes('(glb)');
      });
    } finally { resumeWaitMs = performance.now() - resumeStarted; }
    expect((await rigState(page)).rendered.motion).toContain('(glb)');
    expect((await rigState(page)).playing).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    release();
    const observed = await page.evaluate(() => {
      const s = (window as any).mmdRig;
      return { rig: s.rig, motion: s.motion, playing: s.playing, frames: s.frames,
        revision: s.revision, rendered: s.rendered, error: s.error };
    }).catch(() => undefined);
    await info.attach('inactive-motion-frame.json', {
      body: JSON.stringify({ resumeWaitMs, observed }), contentType: 'application/json',
    });
  }
});

test('public layout: keyboard Details, responsive shared stage, framing and resource continuity', async ({ page }, info) => {
  test.setTimeout(300000);
  const errors = errorsFrom(page), requests: string[] = [];
  page.on('request', request => { if (/\/(uka|gene-light)\//.test(request.url())) requests.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(preview);
  await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
  const state = () => page.evaluate(() => (window as any).mmdExample);
  await page.waitForFunction(() => (window as any).mmdExample.frames > 2);
  const initialRequests = requests.length;
  await page.locator('#viewport canvas').evaluate(canvas => { (window as any).originalComparisonCanvas = canvas; });
  await expect(page.getByRole('checkbox', { name: 'IK', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Physics', exact: true })).not.toBeChecked();
  await expect(page.getByRole('group', { name: 'Playback', exact: true })).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Comparison controls', exact: true })).toHaveCount(1);
  await expect(page.locator('#comparison-details')).toBeHidden();
  await page.locator('#demo-model').focus();
  for (const id of ['comparison-motion', 'material', 'comparison-ik', 'comparison-physics', 'comparison-details-toggle']) {
    await page.keyboard.press('Tab');
    await expect(page.locator(`#${id}`)).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(page.locator('#comparison-details-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('checkbox', { name: 'Outline', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Reset camera', exact: true })).toBeEnabled();
  const initialCamera = (await state()).cameras[0].slice(0, 6);
  await orbitComparison(page);
  await page.locator('#comparison-camera-reset').click();
  await expect.poll(async () => (await state()).cameras[0].slice(0, 6)).toEqual(initialCamera);

  for (const [width, height] of [[1440, 900], [900, 900], [390, 844], [320, 844]]) {
    await page.setViewportSize({ width, height });
    for (const expanded of [false, true]) {
      if (await page.locator('#comparison-details-toggle').getAttribute('aria-expanded') !== String(expanded)) {
        await page.locator('#comparison-details-toggle').focus();
        await page.keyboard.press('Space');
      }
      await expect(page.locator('#comparison-details-toggle')).toHaveAttribute('aria-expanded', String(expanded));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const pmx = (await page.locator('#pmx-pane').boundingBox())!, gltf = (await page.locator('#gltf-pane').boundingBox())!;
      expect(pmx.width).toBeCloseTo(gltf.width, 0); expect(pmx.height).toBeCloseTo(gltf.height, 0);
      if (width <= 900) {
        expect(pmx.x).toBe(gltf.x); expect(gltf.y).toBeGreaterThanOrEqual(pmx.y + pmx.height);
        if (expanded) expect((await page.locator('#comparison-details').boundingBox())!.y)
          .toBeGreaterThan((await page.locator('.comparison-playback').boundingBox())!.y);
      } else if (expanded) {
        expect((await page.locator('#comparison-details').boundingBox())!.x).toBeGreaterThanOrEqual(gltf.x + gltf.width);
      }
      for (const id of ['demo-model', 'comparison-motion', 'material', 'comparison-ik', 'comparison-physics', 'comparison-details-toggle', 'comparison-time']) {
        const box = (await page.locator(`#${id}`).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.height).toBeGreaterThanOrEqual(id === 'comparison-ik' || id === 'comparison-physics' ? 20 : 44);
      }
      expect((await page.locator('#comparison-time').boundingBox())!.width).toBeGreaterThan(width <= 900 ? 180 : 200);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => (window as any).captureMMDComparisonCanvas());
      await page.screenshot({ path: info.outputPath(`after-${width}-${expanded ? 'expanded' : 'collapsed'}.png`), fullPage: true });
    }
  }
  await page.locator('#comparison-motion').selectOption('sample');
  await page.screenshot({ path: info.outputPath('after-320-sample.png'), fullPage: true });
  await page.locator('#comparison-motion').selectOption('rest');
  await page.setViewportSize({ width: 1440, height: 900 });
  const expandedWidth = (await page.locator('#viewport').boundingBox())!.width;
  await page.locator('#comparison-details-toggle').click();
  expect((await page.locator('#viewport').boundingBox())!.width).toBeGreaterThan(expandedWidth + 250);
  await expect.poll(async () => (await state()).cameras[0].slice(0, 6)).toEqual(initialCamera);
  await page.locator('#comparison-motion').selectOption('02_laugh');
  await page.locator('#comparison-play').click();
  await expect.poll(async () => (await state()).time).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('after-desktop-playing.png'), fullPage: true });
  await page.locator('#comparison-play').click();
  await page.locator('#comparison-motion').selectOption('rest');
  await openComparisonDetails(page);
  await page.locator('#expression').selectOption('smile');
  await page.locator('#material').selectOption('pbr');
  await page.locator('#outlines').uncheck();
  await expect.poll(async () => (await state()).reference.outlines).toBe(false);
  expect(requests.length).toBe(initialRequests);
  expect(await page.locator('#viewport canvas').evaluate(canvas => canvas === (window as any).originalComparisonCanvas)).toBe(true);
  expect(await page.evaluate(() => (window as any).readMMDComparisonResources().physics.native)).toBe(0);
  for (const model of ['gene', 'uka']) {
    await page.locator('#demo-model').selectOption(model);
    await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
    await expect(page.locator('#outlines')).toBeChecked();
    await expect(page.locator('#material')).toHaveValue('toon');
    await expect(page.locator('#comparison-ik')).toBeChecked();
    await expect(page.locator('#comparison-physics')).not.toBeChecked();
    await expect(page.locator('#comparison-download-pmx')).toHaveAttribute('href', new RegExp(model === 'gene' ? 'Gene_light.pmx$' : 'MS_Uka.pmx$'));
    await page.waitForFunction(() => (window as any).mmdExample.frames > 1);
    const camera = (await state()).cameras[0].slice(0, 6);
    await orbitComparison(page); await page.locator('#comparison-camera-reset').click();
    await expect.poll(async () => (await state()).cameras[0].slice(0, 6)).toEqual(camera);
    await expect(page.locator('#viewport canvas')).toHaveCount(1);
  }
  // The default damping preference can leave inertia after a real gesture.
  // Reset must cancel that inertia as well as restore the saved position.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#demo-model').selectOption('gene');
  await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
  await page.waitForFunction(() => (window as any).mmdExample.frames > 1);
  const dampedInitial = (await state()).cameras[0].slice(0, 6);
  const box = (await page.locator('#viewport canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await state()).cameras[0].slice(0, 6)).not.toEqual(dampedInitial);
  await page.locator('#comparison-camera-reset').click();
  await expect.poll(async () => (await state()).cameras[0].slice(0, 6)).toEqual(dampedInitial);
  await page.evaluate(() => (window as any).captureMMDComparisonCanvas());
  expect((await state()).cameras[0].slice(0, 6)).toEqual(dampedInitial);
  expect(errors).toEqual([]);
});
