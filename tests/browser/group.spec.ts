import { readRigBitmap } from './rig-bitmap';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { sourceVertex } from '../sdef-oracle';
import { groupPosition, groupWeights } from '../group-oracle';
import { PNG } from 'pngjs';
const preview='http://127.0.0.1:43180/mmd-gltf/';
// Keep all three source paths in one page to exercise replacement/disposal, but
// give each rig/motion its own existing test budget and identifiable source steps.
for (const rig of ['group-box', 'group-wedge']) for (const motion of ['group-a', 'group-b']) {
  test(`built group Demo: ${rig} / ${motion} / bytes + glb + gltf`, async ({ page }, info) => {
    const evidence = demoEvidence(page, info);
    const { phase, image, rendered } = evidence;
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await phase('load Demo and selected rig', async () => {
        await page.goto(`${preview}rig.html`);
        await expect(page.locator('#rig-preset')).toBeEnabled();
        await page.locator('#rig-model').selectOption(rig);
        await expect(page.locator('#status')).toContainText('Rig loaded');
        await expect(page.locator('#rig-preset')).toBeEnabled();
      });
      await rendered({ rig, pose: 'rest' });
      const rest = await image('rig rest');
      for (const source of ['bytes', 'glb', 'gltf']) await test.step(source, async () => {
        evidence.source(source);
        await phase('load motion', async () => {
          await page.locator('#motion-sample').selectOption(motion);
          await expect(page.locator('#motion-load')).toBeEnabled();
          await page.locator('#motion-source').selectOption(source);
          await page.locator('#motion-load').click();
          await expect(page.locator('#status')).toContainText('VMD loaded');
          await expect(page.locator('#motion-load')).toBeEnabled();
        });
        const selected = { rig, motion: `Motion ${motion.toUpperCase()} (${source})`, pose: 'motion', time: 0.719, playing: false };
        const seek = async (time: number) => {
          await phase(`seek ${time}`, async () => {
            await page.locator('#motion-time').fill(String(time));
            await page.locator('#motion-time').dispatchEvent('input');
          });
          await rendered({ ...selected, time });
        };
        await seek(0.719);
        const predictedFrame = await rendered();
        [0,1,2,3,9,23].forEach((vertex,i) => {
          const shape=rig.slice(6) as 'box'|'wedge';
          const predicted=groupPosition(shape,motion.slice(-1) as 'a'|'b',vertex,0.719,sourceVertex(shape,vertex).position.toArray());
          predicted.forEach((v,c) => expect(Math.abs(v-predictedFrame.vertices[i][c])).toBeLessThan(2e-6));
        });
        const controls = predictedFrame.weights;
        controls.forEach((w: number, i: number) => expect(Math.abs(w - groupWeights(motion.slice(-1) as 'a'|'b', 0.719)[i])).toBeLessThan(1e-6));
        const initial = await image('fractional group');
        expect(initial.equals(rest)).toBe(false);
        await seek(0.371);
        expect((await image('second fractional time')).equals(initial)).toBe(false);
        await seek(0.719);
        expect((await image('fractional restoration')).equals(initial)).toBe(true);

        const toon = initial;
        for (const mode of ['pbr', 'toon']) {
          await phase(`${mode} material`, () => page.locator('#rig-material').selectOption(mode));
          await rendered({ ...selected, mode, outlines: true });
          const on = await image(`${mode} outline on`);
          if (mode === 'pbr') expect(on.equals(toon)).toBe(false);
          else expect(on.equals(toon)).toBe(true);
          await phase(`${mode} outline off`, () => page.locator('#rig-outlines').selectOption('off'));
          await rendered({ ...selected, mode, outlines: false });
          expect((await image(`${mode} outline off`)).equals(on)).toBe(false);
          await phase(`${mode} restore outline`, () => page.locator('#rig-outlines').selectOption('on'));
          await rendered({ ...selected, mode, outlines: true });
          expect((await image(`${mode} restored outline`)).equals(on)).toBe(true);
        }
        await phase('actual loop crossing', async () => {
          await page.locator('#motion-loop').check();
          await seek(motion === 'group-a' ? 0.99 : 1.49);
          await page.locator('#motion-play').click();
          await expect.poll(() => page.evaluate(() => {
            const s=(window as any).mmdRig,c=s.playback.crossing;
            return !!c && c.before+c.delta>=c.duration && c.crossings>0 && c.revision<=s.rendered.revision && c.generation===s.playback.generation;
          })).toBe(true);
          await page.locator('#motion-pause').click();
          const paused=await page.evaluate(() => ({time:(window as any).mmdRig.time,weights:(window as any).mmdRig.weights}));
          await page.waitForTimeout(120);
          expect(await page.evaluate(() => ({time:(window as any).mmdRig.time,weights:(window as any).mmdRig.weights}))).toEqual(paused);
          await page.locator('#motion-loop').uncheck();
        });
        await phase('non-loop endpoint', async () => {
          const end=motion==='group-a'?1:1.5;
          await seek(end-0.01);await page.locator('#motion-play').click();
          await rendered({...selected,time:end,playing:false});
        });
        await seek(0.719);
        let previousPose: Buffer | undefined;
        for (const pose of ['a', 'b']) {
          await phase(`apply VPD ${pose}`, async () => {
            await page.locator('#rig-pose').selectOption(pose);
            await page.locator('#rig-preset').click();
            await expect(page.locator('#status')).toContainText('Applied VPD');
          });
          await rendered({ rig, pose, playing: false });
          const poseImage = await image(`VPD ${pose}`);
          expect(poseImage.equals(initial)).toBe(false);
          if (previousPose) expect(poseImage.equals(previousPose)).toBe(false);
          previousPose = poseImage;
          const heldWeights = await page.evaluate(() => (window as any).mmdRig.weights);
          expect(heldWeights).toEqual(controls);
          await phase('VPD reset preserving weights', () => page.locator('#rig-reset').click());
          expect(await page.evaluate(() => (window as any).mmdRig.weights)).toEqual(heldWeights);
          // Seeking must retake motion ownership after each VPD, including morphs.
          await seek(0.719);
          expect((await image(`VPD ${pose} to VMD`)).equals(initial)).toBe(true);
        }
        await phase('reset motion', () => page.locator('#motion-reset').click());
        await rendered({ rig, pose: 'rest', time: 0, playing: false, weights: [0, 0, 0, 0, 0, 0, 0, 0] });
        expect((await image('reset rest')).equals(rest)).toBe(true);
      });
      evidence.source('recovery and rig replacement');
      await phase('invalid file recovery', async () => {
        await page.locator('#motion-file').setInputFiles({ name: 'bad.vmd', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') });
        await page.locator('#motion-load').click();
        await expect(page.locator('#status')).toContainText('VMD: truncated');
        await expect(page.locator('#motion-load')).toBeEnabled();
      });
      await rendered({ rig, pose: 'rest' });
      expect((await image('failed load preserves rest')).equals(rest)).toBe(true);
      await phase('manual morph after error', async () => {
        await page.locator('#morph-controls input[data-target="4"]').fill('0.7');
        await page.locator('#morph-controls input[data-target="4"]').dispatchEvent('change');
      });
      await rendered({ rig, weights: [0, 0, 0, 0, 0.7, 0, 0, 0] });
      expect((await image('manual morph')).equals(rest)).toBe(false);
      await phase('reset manual group', () => page.locator('#morph-reset').click());
      await rendered({ rig, weights: [0, 0, 0, 0, 0, 0, 0, 0] });
      expect((await image('recovered reset')).equals(rest)).toBe(true);
      const nextMotion = motion === 'group-a' ? 'group-b' : 'group-a';
      await phase('load another motion after invalid file', async () => {
        await page.locator('#motion-sample').selectOption(nextMotion);
        await expect(page.locator('#motion-load')).toBeEnabled();
        await page.locator('#motion-source').selectOption('bytes');
        await page.locator('#motion-load').click();
        await expect(page.locator('#status')).toContainText('VMD loaded');
        await expect(page.locator('#motion-load')).toBeEnabled();
        await page.locator('#motion-time').fill('0.719');
        await page.locator('#motion-time').dispatchEvent('input');
      });
      await rendered({ rig, motion: `Motion ${nextMotion.toUpperCase()} (bytes)`, time: 0.719 });
      expect((await image('recovered motion')).equals(rest)).toBe(false);
      await phase('replace rig and dispose players', async () => {
        const disposed = await page.evaluate(() => (window as any).mmdRig.disposedPlayers);
        const next = rig === 'group-box' ? 'group-wedge' : 'group-box';
        await page.locator('#rig-model').selectOption(next);
        await expect(page.locator('#rig-preset')).toBeEnabled();
        await rendered({ rig: next, pose: 'rest', motion: '' });
        expect(await page.evaluate(() => (window as any).mmdRig.disposedPlayers)).toBeGreaterThan(disposed);
        expect((await image('replacement rig')).equals(rest)).toBe(false);
      });
      expect(errors).toEqual([]);
    } finally {
      await evidence.save();
    }
  });
}

function demoEvidence(page: Page, info: TestInfo) {
  const started = performance.now();
  const timings: object[] = [];
  let source = 'setup';
  const renders: object[] = [];
  async function phase<T>(name: string, action: () => Promise<T>): Promise<T> {
    return test.step(name, async () => {
      const start = performance.now();
      let passed = false;
      try { const value = await action(); passed = true; return value; }
      finally { timings.push({ source, name, elapsedMs: performance.now() - start, cumulativeMs: performance.now() - started, passed }); }
    });
  }
  async function rendered(expected: Record<string, unknown> = {}) {
    return phase(`render ${JSON.stringify(expected)}`, async () => {
      await page.waitForFunction(expected => {
        const state = (window as any).mmdRig, frame = state?.rendered;
        return frame && frame.revision === state.revision && Object.entries(expected).every(([key, value]) => JSON.stringify(frame[key]) === JSON.stringify(value));
      }, expected, { timeout: 30000 });
      const frame = await page.evaluate(() => (window as any).mmdRig.rendered);
      renders.push({ source, ...frame });
      return frame;
    });
  }
  async function image(name: string) {
    await rendered();
    return phase(`screenshot ${name}`, async () => {
      const canvas = page.locator('canvas');
      const bounds = (await canvas.boundingBox())!;
      // Element screenshots round fractional CSS bounds outwards. Align the
      // viewport and remove its decorative corner clip so no surrounding UI enters
      // exact restoration comparisons. This does not resize the framebuffer.
      const dx = Math.ceil(bounds.x) - bounds.x, dy = Math.ceil(bounds.y) - bounds.y;
      const capture = await canvas.screenshot({
        timeout: 30000,
        style: `#rig-viewport { transform: translate(${dx}px, ${dy}px); border-radius: 0; }`,
        path: info.outputPath(`${source}-${name.replaceAll(' ', '-')}.png`),
      });
      const pixels = PNG.sync.read(capture);
      const size = await canvas.evaluate(element => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }));
      expect({ width: pixels.width, height: pixels.height }).toEqual(size);
      // Restoration concerns the rendered bitmap. Chromium's CSS compositor can
      // resample an identical canvas after scrolling, even with aligned bounds.
      // Keep the screen capture above as evidence and retain exact PNG equality
      // on the intrinsic bitmap (no tolerance, crop, or pixel mask).
      const intrinsic = await readRigBitmap(page);
      await writeFile(info.outputPath(`${source}-${name.replaceAll(' ', '-')}-bitmap.png`), intrinsic);
      return intrinsic;
    });
  }
  return { phase, rendered, image, source(value: string) { source = value; }, async save() {
    const state = await page.evaluate(() => {
      const state = (window as any).mmdRig;
      if (!state) return undefined;
      const { bones, ...summary } = state;
      return summary;
    }).catch(() => undefined);
    const result = { scenario: info.title, elapsedMs: performance.now() - started, timings, renders, state };
    console.log('group Demo timings:', JSON.stringify(result));
    const path = info.outputPath('group-demo-timings.json');
    await writeFile(path, JSON.stringify(result, null, 2));
    await info.attach('group-demo-timings.json', { path, contentType: 'application/json' });
  } };
}

// Hold the real animation callback so control updates cannot accidentally pass
// as rendered evidence. Release it, then require changed and restored pixels.
test('built group Demo acknowledges fractional state and appearance only after rendering', async ({ page }, info) => {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    let held = false, notify: (() => void) | undefined;
    const pending: FrameRequestCallback[] = [];
    window.requestAnimationFrame = callback => request(time => {
      if (held) { pending.push(callback); notify?.(); notify = undefined; }
      else callback(time);
    });
    (window as any).rigFrameGate = {
      hold: () => new Promise<void>(resolve => { held = true; notify = resolve; }),
      release: () => { held = false; pending.splice(0).forEach(callback => request(callback)); },
    };
  });
  const evidence = demoEvidence(page, info);
  const { phase, rendered, image } = evidence;
  try {
    await phase('load regression motion', async () => {
      await page.goto(`${preview}rig.html`);
      await expect(page.locator('#rig-preset')).toBeEnabled();
      await page.locator('#rig-model').selectOption('group-box');
      await expect(page.locator('#rig-preset')).toBeEnabled();
      await page.locator('#motion-sample').selectOption('group-a');
      await expect(page.locator('#motion-load')).toBeEnabled();
      await page.locator('#motion-load').click();
      await expect(page.locator('#motion-load')).toBeEnabled();
    });
    await rendered({ rig: 'group-box', motion: 'Motion GROUP-A (bytes)', time: 0 });
    const before = await image('before held seek');
    await phase('hold frame and seek before drawing', async () => {
      await page.evaluate(() => (window as any).rigFrameGate.hold());
      const state = await page.evaluate(() => {
        const seek = document.querySelector<HTMLInputElement>('#motion-time')!;
        seek.value = '0.719';
        seek.dispatchEvent(new Event('input'));
        for (const [id, value] of [['rig-material', 'pbr'], ['rig-outlines', 'off']]) {
          const control = document.querySelector<HTMLSelectElement>(`#${id}`)!;
          control.value = value;
          control.dispatchEvent(new Event('change'));
        }
        return (window as any).mmdRig;
      });
      expect(state.time).toBe(0.719);
      expect(state.rendered.time).toBe(0);
      expect(state.mode).toBe('pbr');
      expect(state.rendered.mode).toBe('toon');
      expect(state.rendered.outlines).toBe(true);
      expect(state.rendered.comparison).toBe(false);
      expect(state.rendered.revision).toBeLessThan(state.revision);
      await page.evaluate(() => (window as any).rigFrameGate.release());
    });
    await rendered({ rig: 'group-box', motion: 'Motion GROUP-A (bytes)', time: 0.719, mode: 'pbr', outlines: false, comparison: false });
    expect((await image('drawn fractional seek')).equals(before)).toBe(false);
    await phase('restore time zero and appearance', async () => {
      await page.locator('#rig-material').selectOption('toon');
      await page.locator('#rig-outlines').selectOption('on');
      await page.locator('#motion-time').fill('0');
      await page.locator('#motion-time').dispatchEvent('input');
    });
    await rendered({ time: 0, mode: 'toon', outlines: true, comparison: false });
    expect((await image('drawn restoration')).equals(before)).toBe(true);
  } finally {
    await page.evaluate(() => (window as any).rigFrameGate?.release()).catch(() => {});
    await evidence.save();
  }
});

test('built group conformance: independent scalar rasters and applied GLB/glTF export round trips',async({page},info)=>{
  const {validateBytes,validateString}=await import('gltf-validator');
  await page.exposeFunction('validateGroupExport',async(record:any)=>{
    const bytes=Uint8Array.from(record.data);
    const report=record.binary?await validateBytes(bytes):await validateString(new TextDecoder().decode(bytes));
    const name=`${record.rig}-${record.motion}-${record.state}.${record.binary?'glb':'gltf'}`;
    await writeFile(info.outputPath(name),bytes);
    return {errors:report.issues.numErrors,warnings:report.issues.numWarnings,messages:report.issues.messages.filter((m:any)=>m.severity<2)};
  });
  await page.goto(`${preview}vmd-conformance.html?group`);
  await page.waitForFunction(()=>(window as any).vmdConformance||(window as any).vmdConformanceError,undefined,{timeout:180000});
  expect(await page.evaluate(()=>(window as any).vmdConformanceError)).toBeUndefined();
  const result=await page.evaluate(()=>(window as any).vmdConformance);
  expect(result.passed).toBe(144);expect(result.exports.cases.length).toBe(24);
  console.log('Group GPU/export evidence:',JSON.stringify({...result,evidence:undefined}));
  await writeFile(info.outputPath('group-conformance.json'),JSON.stringify(result,null,2));
  await info.attach('group-conformance.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});

test('built group targets precede actual SDEF/QDEF GPU positions and normals',async({page},info)=>{
  await page.goto(`${preview}group-advanced-conformance.html`);
  await page.waitForFunction(()=>(window as any).groupAdvanced||(window as any).groupAdvancedError,undefined,{timeout:180000});
  expect(await page.evaluate(()=>(window as any).groupAdvancedError)).toBeUndefined();
  const result=await page.evaluate(()=>(window as any).groupAdvanced);
  expect(result.evidence.length).toBe(8);
  console.log('Group advanced GPU evidence:',JSON.stringify(result));
  await writeFile(info.outputPath('group-advanced.json'),JSON.stringify(result,null,2));
  await info.attach('group-advanced.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
