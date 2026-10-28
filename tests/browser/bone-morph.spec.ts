import { openRigDemo } from './demo-controls';
import { readRigBitmap } from './rig-bitmap';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { bonePrediction, boneControls } from '../bone-morph-oracle';
const preview='http://127.0.0.1:43180/mmd-gltf/';
// Exercise all three source paths across pairwise UI scenarios. Detailed
// cross-products remain in Node and independent GPU/raster conformance tests.
for (const [rig, motion, sources] of [['bone-box','bone-a',['bytes']], ['bone-wedge','bone-b',['glb','gltf']]] as const) {
  test(`built bone Demo: ${rig} / ${motion} / ${sources.join(" + ")}`, async ({ page }, info) => {
    const evidence = demoEvidence(page, info);
    const { phase, image, rendered } = evidence;
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await phase('load Demo and selected rig', async () => {
        await openRigDemo(page, preview);
        await expect(page.locator('#rig-preset')).toBeEnabled();
        await page.locator('#rig-model').selectOption(rig);
        await expect(page.locator('#rig-status')).toContainText('Rig loaded');
        await expect(page.locator('#rig-preset')).toBeEnabled();
      });
      await rendered({ rig, pose: 'rest' });
      const rest = await image('rig rest');
      for (const source of sources) await test.step(source, async () => {
        evidence.source(source);
        await phase('load motion', async () => {
          await page.locator('#motion-sample').selectOption(motion);
          await expect(page.locator('#motion-load')).toBeEnabled();
          await page.locator('#motion-source').selectOption(source);
          await page.locator('#motion-load').click();
          await expect(page.locator('#rig-status')).toContainText('VMD loaded');
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
          const shape=rig.slice(5) as 'box'|'wedge';
          const predicted=bonePrediction(shape,motion.slice(-1) as 'a'|'b',vertex,0.719).p.toArray();
          predicted.forEach((v,c) => expect(Math.abs(v-predictedFrame.vertices[i][c])).toBeLessThan(2e-6));
        });
        const controls = predictedFrame.weights;
        controls.forEach((w: number, i: number) => expect(Math.abs(w - boneControls(motion.slice(-1) as 'a'|'b', 0.719)[i])).toBeLessThan(1e-6));
        const initial = await image('fractional bone');
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
          await seek(motion === 'bone-a' ? 0.99 : 1.49);
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
          const end=motion==='bone-a'?1:1.5;
          await seek(end-0.01);await page.locator('#motion-play').click();
          await rendered({...selected,time:end,playing:false});
        });
        await seek(0.719);
        let previousPose: Buffer | undefined;
        for (const pose of ['a', 'b']) {
          await phase(`apply VPD ${pose}`, async () => {
            await page.locator('#rig-pose').selectOption(pose);
            await page.locator('#rig-preset').click();
            await expect(page.locator('#rig-status')).toContainText('Applied VPD');
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
        await rendered({ rig, pose: 'rest', time: 0, playing: false, weights: [0, 0, 0, 0, 0, 0] });
        expect((await image('reset rest')).equals(rest)).toBe(true);
      });
      evidence.source('recovery and rig replacement');
      await phase('invalid file recovery', async () => {
        await page.locator('#motion-file').setInputFiles({ name: 'bad.vmd', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') });
        await page.locator('#motion-load').click();
        await expect(page.locator('#rig-status')).toContainText('VMD: truncated');
        await expect(page.locator('#motion-load')).toBeEnabled();
      });
      await rendered({ rig, pose: 'rest' });
      expect((await image('failed load preserves rest')).equals(rest)).toBe(true);
      await phase('manual morph after error', async () => {
        await page.locator('#morph-controls input[data-target="4"]').fill('0.7');
        await page.locator('#morph-controls input[data-target="4"]').dispatchEvent('change');
      });
      await rendered({ rig, weights: [0, 0, 0, 0, 0.7, 0] });
      expect((await image('manual morph')).equals(rest)).toBe(false);
      await phase('reset manual bone', () => page.locator('#morph-reset').click());
      await rendered({ rig, weights: [0, 0, 0, 0, 0, 0] });
      expect((await image('recovered reset')).equals(rest)).toBe(true);
      const nextMotion = motion === 'bone-a' ? 'bone-b' : 'bone-a';
      await phase('load another motion after invalid file', async () => {
        await page.locator('#motion-sample').selectOption(nextMotion);
        await expect(page.locator('#motion-load')).toBeEnabled();
        await page.locator('#motion-source').selectOption('bytes');
        await page.locator('#motion-load').click();
        await expect(page.locator('#rig-status')).toContainText('VMD loaded');
        await expect(page.locator('#motion-load')).toBeEnabled();
        await page.locator('#motion-time').fill('0.719');
        await page.locator('#motion-time').dispatchEvent('input');
      });
      await rendered({ rig, motion: `Motion ${nextMotion.toUpperCase()} (bytes)`, time: 0.719 });
      expect((await image('recovered motion')).equals(rest)).toBe(false);
      await phase('replace rig and dispose players', async () => {
        const disposed = await page.evaluate(() => (window as any).mmdRig.disposedPlayers);
        const next = rig === 'bone-box' ? 'bone-wedge' : 'bone-box';
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
    return phase(`bitmap ${name}`, async () => {
      // Read the real render callback directly. Avoid redundant compositor captures
      // for every lifecycle state; failure screenshots and render traces remain.
      const intrinsic = await readRigBitmap(page);
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
    console.log('bone Demo timings:', JSON.stringify({scenario:info.title,elapsedMs:result.elapsedMs,phases:timings.length,renders:renders.length}));
    const path = info.outputPath('bone-demo-timings.json');
    await writeFile(path, JSON.stringify(result, null, 2));
    await info.attach('bone-demo-timings.json', { path, contentType: 'application/json' });
  } };
}


test('built bone morph raster and exports: both rigs/motions, bytes/GLB/glTF, Toon/PBR, Outline and both VPD handoffs',async({page},info)=>{
  const {validateBytes,validateString}=await import('gltf-validator');
  const Ajv=(await import('ajv')).default;
  const check=new Ajv({strict:false}).compile(JSON.parse(await readFile('extensions/MMD_morphs/schema/glTF.MMD_morphs.schema.json','utf8')));
  await page.exposeFunction('validateBoneExport',async(record:any)=>{
    const bytes=Uint8Array.from(record.data);
    const report=record.binary?await validateBytes(bytes):await validateString(new TextDecoder().decode(bytes));
    const json=JSON.parse(record.binary?Buffer.from(bytes).subarray(20,20+Buffer.from(bytes).readUInt32LE(12)).toString('utf8'):new TextDecoder().decode(bytes));
    expect(check(json.extensions.MMD_morphs),JSON.stringify(check.errors)).toBe(true);
    await writeFile(info.outputPath(`${record.rig}-${record.motion}-${record.source}-${record.state}.${record.binary?'glb':'gltf'}`),bytes);
    return {errors:report.issues.numErrors,warnings:report.issues.numWarnings};
  });
  await page.goto(`${preview}bone-morph-conformance.html`);
  await page.waitForFunction(()=>(window as any).boneMorph||(window as any).boneMorphError,undefined,{timeout:180000});
  expect(await page.evaluate(()=>(window as any).boneMorphError)).toBeUndefined();
  const result=await page.evaluate(()=>(window as any).boneMorph);
  expect(result.passed).toBe(240);expect(result.exports.cases.length).toBe(40);
  await writeFile('docs/bone-morph-raster-validation.json',JSON.stringify(result,null,2)+'\n');
});
test('bone morph actual SDEF/QDEF GPU positions and normals',async({page},info)=>{
  await page.goto(`${preview}bone-advanced-conformance.html`);
  await page.waitForFunction(()=>(window as any).boneAdvanced||(window as any).boneAdvancedError,undefined,{timeout:180000});
  expect(await page.evaluate(()=>(window as any).boneAdvancedError)).toBeUndefined();
  const result=await page.evaluate(()=>(window as any).boneAdvanced);
  expect(result.evidence.length).toBe(8);
  await writeFile('docs/bone-morph-gpu-validation.json',JSON.stringify(result,null,2)+'\n');
});
