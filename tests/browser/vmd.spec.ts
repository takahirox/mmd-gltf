import { openRigDemo } from './demo-controls';
import { readRigBitmap } from './rig-bitmap';
import { test, expect, type Page } from '@playwright/test';
import { morphWeights } from '../morph-oracle';
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

for (const rig of ['box', 'wedge']) test(`built Demo VMD lifecycle: ${rig}, both motions/sources, fractional seek, playback/loop, VPD handoff, local failure recovery and cleanup`, async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openRigDemo(page, preview);
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
    await page.locator('canvas').screenshot(); return readRigBitmap(page);
  };
  {
    if (rig === 'wedge') {
      await page.locator('#rig-model').selectOption(rig);
      // The previous reset already says Rest state. Await this rig's real
      // rendered revision before checking its controls or capturing its rest.
      await page.waitForFunction(rig => {
        const state = (window as any).mmdRig;
        return state.ready && state.rig === rig && state.rendered?.rig === rig &&
          state.rendered.revision === state.revision;
      }, rig, { timeout: 30000 });
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
        await expect(page.locator('#motion-diagnostics')).toContainText('Omitted execution');
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
        await expect(page.locator('#rig-status')).toContainText('Applied VPD');
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
    await expectCrossing(page, rig, 'gltf', 'Motion B (gltf)');
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
    await expect(page.locator('#rig-status')).toContainText('VMD: truncated');
    expect(await snapshot()).toEqual(before);
    await page.locator('#motion-file').setInputFiles('tests/fixtures/motion-a.vmd');
    await page.locator('#motion-load').click();
    await expect(page.locator('#rig-status')).toContainText('requires explicit mapping');
    expect(await snapshot()).toEqual(before);
    await page
      .locator('#motion-map')
      .fill('{"93af96bc2e8d9c205b6475706c6963":0,"7469705f626f756e646172795f3135":259}');
    await page.locator('#motion-load').click();
    await expect(page.locator('#rig-status')).toContainText('VMD loaded');
    await seek(0.371);
    expect(await snapshot()).not.toEqual(before);
    await page.locator('#motion-reset').click();
    expect(await snapshot()).toEqual(rest);
  }
  const disposed = (await state()).disposedPlayers;
  expect(disposed).toBeGreaterThanOrEqual(12);
  // Retain cross-rig replacement, now in both directions, after local recovery.
  const replacement = rig === 'box' ? 'wedge' : 'box';
  await page.locator('#rig-model').selectOption(replacement);
  await page.waitForFunction(rig => {
    const state = (window as any).mmdRig;
    return state.rig === rig && state.rendered?.rig === rig &&
      state.rendered.revision === state.revision;
  }, replacement, { timeout: 30000 });
  expect((await state()).disposedPlayers).toBeGreaterThanOrEqual(disposed + 2);
  expect((await state()).motion).toBe('');
  expect(errors).toEqual([]);
});

test('built morph conformance: combined weights and morph-before-BDEF predictions through Toon/PBR and Outline', async ({page},testInfo) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${preview}vmd-conformance.html?morph`);
  await page.waitForFunction(()=> (window as any).vmdConformance || (window as any).vmdConformanceError,undefined,{timeout:180000});
  expect(await page.evaluate(()=> (window as any).vmdConformanceError)).toBeUndefined();
  expect(errors).toEqual([]);
  const result=await page.evaluate(()=> (window as any).vmdConformance);
  expect(result.passed).toBe(144);
  console.log('Morph GPU evidence:',JSON.stringify({comparisons:result.passed,
    maximumWeightError:Math.max(...result.evidence.map((e:any)=>e.maximumWeightError)),
    maximumPositionError:Math.max(...result.evidence.map((e:any)=>e.maximumPositionError)),
    maximumOraclePixelMismatches:Math.max(...result.evidence.map((e:any)=>e.oraclePixelMismatches))}));
  await testInfo.attach('morph-conformance.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});

test('built Demo morph controls and combined lifecycle on both rigs, local motion recovery and morph-only source',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await openRigDemo(page, preview);
  await expect(page.locator('#rig-preset')).toBeEnabled();
  const state=()=>page.evaluate(()=>(window as any).mmdRig);
  const snapshot=async()=>{const s=await state();return {bones:s.bones,weights:s.weights};};
  const seek=async(t:number)=>{
    await page.locator('#motion-time').fill(String(t));await page.locator('#motion-time').dispatchEvent('input');
    await expect.poll(async()=>(await state()).time).toBe(t);
  };
  for(const rig of ['box','wedge']) {
    await page.locator('#rig-model').selectOption(rig);await expect(page.locator('#rig-preset')).toBeEnabled();
    expect((await state()).weights).toEqual([0,0,0,0,0]);
    for(const motion of ['combined-a','combined-b']) for(const source of ['bytes','glb','gltf']) {
      await page.locator('#motion-sample').selectOption(motion);await expect(page.locator('#motion-load')).toBeEnabled();
      await page.locator('#motion-source').selectOption(source);await page.locator('#motion-load').click();
      await expect(page.locator('#rig-status')).toContainText('VMD loaded');
      await seek(0.719);const desired=await snapshot();
      expect(desired.weights[0]+desired.weights[1]).toBeGreaterThan(1);
      expect(desired.weights.slice(2)).toEqual([0,0,0]);
      await seek(0.371);await seek(0.719);expect(await snapshot()).toEqual(desired);
      for(const mode of ['toon','pbr']) {
        await page.locator('#rig-material').selectOption(mode);
        await page.locator('#rig-outlines').selectOption('on');await page.waitForTimeout(100);
        const before=await page.locator('canvas').screenshot();
        await page.locator('#morph-controls input').first().fill('1.8');
        await page.locator('#morph-controls input').first().dispatchEvent('change');
        await expect.poll(async()=>(await state()).weights[0]).toBe(1.8);
        await page.waitForTimeout(100);expect((await page.locator('canvas').screenshot()).equals(before)).toBe(false);
        expect((await state()).playing).toBe(false);
        await seek(0.719);expect(await snapshot()).toEqual(desired);
      }
      await page.locator('#motion-play').click();await page.locator('#motion-pause').click();
      await seek(0.719);const weights=(await state()).weights;
      await page.locator('#rig-pose').selectOption('b');await page.locator('#rig-preset').click();
      expect((await state()).weights).toEqual(weights);expect((await state()).playing).toBe(false);
      await page.locator('#rig-reset').click();expect((await state()).weights).toEqual(weights);
      await seek(0.719);expect(await snapshot()).toEqual(desired);
      await page.locator('#motion-reset').click();expect((await state()).weights).toEqual([0,0,0,0,0]);
    }
    await page.locator('#motion-sample').selectOption('only');await expect(page.locator('#motion-load')).toBeEnabled();
    await page.locator('#motion-source').selectOption('glb');await page.locator('#motion-load').click();
    await expect(page.locator('#rig-status')).toContainText('VMD loaded');const bones=(await state()).bones;
    await seek(0.8);expect((await state()).bones).toEqual(bones);expect((await state()).weights[0]).toBeGreaterThan(1);
    await page.locator('#motion-loop').check();await seek(0.99);await page.locator('#motion-play').click();
    await expectCrossing(page, rig, 'glb', 'Motion ONLY (glb)');await page.locator('#motion-pause').click();
    await page.locator('#motion-loop').uncheck();
    await page.locator('#motion-file').setInputFiles('tests/fixtures/combined-a.vmd');
    await expect(page.locator('#motion-source')).toHaveValue('bytes');
    await expect(page.locator('#motion-sample')).toHaveValue('local');
    await expect(page.locator('#motion-morph-map')).toHaveValue('{}');
    await page.locator('#motion-map').fill('{"93af96bc2e8d9c205b6475706c6963":0,"7469705f626f756e646172795f3135":259}');
    const before=await snapshot();await page.locator('#motion-load').click();
    await expect(page.locator('#rig-status')).toContainText('ambiguous PMX name');expect(await snapshot()).toEqual(before);
    await page.locator('#motion-morph-map').fill('{"8fce82a2":1}');await page.locator('#motion-load').click();
    await expect(page.locator('#rig-status')).toContainText('VMD loaded');
    await seek(0.5);await page.locator('#morph-reset').click();expect((await state()).weights).toEqual([0,0,0,0,0]);
    await seek(0.5);expect((await state()).weights[0]).toBeGreaterThan(0);
  }
  expect((await state()).disposedPlayers).toBeGreaterThan(20);expect(errors).toEqual([]);
});

// This predicate requires a recorded update that actually crossed duration and
// was submitted by the corresponding render. It cannot pass on a seek alone.
async function expectCrossing(page: Page, rig: string, source: string, motion: string) {
  await expect.poll(() => page.evaluate(({ rig, source, motion }) => {
    const s = (window as any).mmdRig, c = s.playback.crossing;
    return s.playing && !!c && c.generation === s.playback.generation && c.rig === rig && c.source === source && c.motion === motion &&
      c.playingBefore && c.playing && c.loop && c.duration > 0 && c.delta > 0 &&
      c.before + c.delta >= c.duration && c.crossings > 0 &&
      Math.abs(c.after - (c.before + c.delta) % c.duration) < 1e-12 &&
      c.frame <= s.rendered.frame && c.revision <= s.rendered.revision;
  }, { rig, source, motion })).toBe(true);
}

// Gate the actual renderer RAF chain; other RAF consumers (including canvas
// capture) continue. Supply a controlled performance clock, never player/UI data.
async function installPlaybackGate(page: Page) {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window), realNow = performance.now.bind(performance);
    let held = false, target: FrameRequestCallback | undefined, pending: FrameRequestCallback | undefined;
    let notify: (() => void) | undefined, now = 0, offset = 0;
    performance.now = () => held ? now : realNow() + offset;
    window.requestAnimationFrame = callback => request(time => {
      if (held && (!target || callback === target)) {
        target = callback; pending = callback; notify?.(); notify = undefined;
      } else callback(time);
    });
    (window as any).playbackGate = {
      hold: () => new Promise<void>(resolve => { now = realNow() + offset; held = true; notify = resolve; }),
      step: (ms: number) => new Promise<void>(resolve => {
        const callback = pending!; pending = undefined; now += ms; notify = resolve;
        request(time => callback(time));
      }),
      release: () => {
        offset = now - realNow(); held = false;
        if (pending) request(pending);
        pending = target = undefined;
      },
    };
  });
}

async function seekDemo(page: Page, time: number) {
  await page.locator('#motion-time').fill(String(time));
  await page.locator('#motion-time').dispatchEvent('input');
}

test('built Demo delayed real frames retain crossing/render/canvas evidence and isolate ownership', async ({ page }, info) => {
  await installPlaybackGate(page);
  const traces: object[] = [], errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const state = () => page.evaluate(() => (window as any).mmdRig);
  const step = async (ms: number) => {
    await page.evaluate(ms => (window as any).playbackGate.step(ms), ms);

  };
  const cleared = async (previous: number) => {
    const s = await state();
    expect(s.playback.generation).toBeGreaterThan(previous);
    expect(s.playback.crossing).toBeNull(); expect(s.playback.updates).toEqual([]);
    return s.playback.generation;
  };
  try {
    for (const rig of ['box', 'wedge']) {
      await openRigDemo(page, preview);
      await expect(page.locator('#rig-preset')).toBeEnabled();
      expect((await state()).playback.crossing).toBeNull();
      await page.locator('#rig-model').selectOption(rig);
      await expect(page.locator('#rig-preset')).toBeEnabled();
      const rest = (await state()).bones;
      await page.locator('#motion-sample').selectOption('only');
      await expect(page.locator('#motion-load')).toBeEnabled();
      await page.locator('#motion-source').selectOption('glb');
      await page.locator('#motion-load').click();
      await expect(page.locator('#motion-load')).toBeEnabled();
      await page.locator('#motion-loop').check();
      await seekDemo(page, 0.99);
      await page.waitForFunction(() => { const s = (window as any).mmdRig; return s.rendered?.revision === s.revision; });
      await page.evaluate(() => (window as any).playbackGate.hold());
      await step(0); // Prime last=controlled performance.now() while paused.
      const before = await state();
      const canvas = page.locator('canvas');
      const beforeImage = await canvas.screenshot({ path: info.outputPath(`${rig}-before.png`) });
      await page.locator('#motion-play').click();
      const held = await state();
      expect(held.time).toBe(0.99); expect(held.playing).toBe(true);
      expect(held.playback.crossing).toBeNull();
      expect(held.rendered.revision).toBeLessThan(held.revision);
      expect(held.rendered.frame).toBe(before.rendered.frame);
      // No callback means neither an update nor rendered acknowledgement.
      await expect(expectCrossing(page, rig, 'glb', 'Motion ONLY (glb)')).rejects.toThrow();
      await step(2360);
      let s = await state(), c = s.playback.crossing;
      await expectCrossing(page, rig, 'glb', 'Motion ONLY (glb)');
      expect(c.before).toBe(0.99); expect(c.delta).toBeCloseTo(2.36, 12);
      expect(c.after).toBeCloseTo(0.35, 12); expect(c.crossings).toBe(3);
      expect(s.playing).toBe(true); expect(s.bones).toEqual(rest);
      s.weights.forEach((w: number, i: number) => expect(Math.abs(w - morphWeights('a', 0.35)[i])).toBeLessThan(1e-7));
      expect(c.revision).toBe(s.rendered.revision); expect(c.frame).toBe(s.rendered.frame);
      expect(c.after).toBe(s.rendered.time); expect(c.weights).toEqual(s.rendered.weights);
      const drawn = await canvas.screenshot({ path: info.outputPath(`${rig}-crossing.png`) });
      expect(drawn.equals(beforeImage)).toBe(false);
      expect((await state()).rendered).toEqual(s.rendered);
      traces.push({ rig, delayed: c, rendered: s.rendered });
      // Later frames leave the crossing durable even outside the old window.
      await step(500); s = await state();
      expect(s.time).toBeCloseTo(0.85, 12); expect(s.playing).toBe(true);
      expect(s.playback.crossing).toEqual(c);
      s.weights.forEach((w: number, i: number) => expect(Math.abs(w - morphWeights('a', 0.85)[i])).toBeLessThan(1e-7));
      await expectCrossing(page, rig, 'glb', 'Motion ONLY (glb)');
      const aliased: object[] = [];
      for (let i = 0; i < 5; i++) {
        await step(1000); s = await state();
        expect(s.time).toBeCloseTo(0.85, 12);
        expect(s.time < 0.5).toBe(false);
        await expectCrossing(page, rig, 'glb', 'Motion ONLY (glb)');
        aliased.push(s.playback.crossing);
      }
      traces.push({ rig, aliased });
      // Paused playback must not produce another update despite a delayed frame.
      await page.locator('#motion-pause').click();
      const paused = await state(); await step(3200); s = await state();
      expect(s.time).toBe(paused.time); expect(s.playback).toEqual(paused.playback);
      expect(s.rendered.playing).toBe(false);
      await seekDemo(page, 0.35); let generation = await cleared(s.playback.generation);
      await step(3200);
      expect((await state()).time).toBe(0.35);
      await expect(expectCrossing(page, rig, 'glb', 'Motion ONLY (glb)')).rejects.toThrow();
      expect((await canvas.screenshot()).equals(drawn)).toBe(true);
      // Motion reload/replacement, reset, both VPD poses, manual ownership and
      // model replacement must not borrow a previous crossing.
      const cross = async () => {
        await seekDemo(page, 0.99); await page.locator('#motion-play').click(); await step(1360);
        await expectCrossing(page, rig, 'glb', 'Motion ONLY (glb)');
        await page.locator('#motion-pause').click();
        return (await state()).playback.generation;
      };
      for (const pose of ['a', 'b']) {
        generation = await cross();
        await page.locator('#rig-pose').selectOption(pose); await page.locator('#rig-preset').click();
        await expect(page.locator('#rig-preset')).toBeEnabled();
        await expect(page.locator('#rig-status')).toContainText('Applied VPD');
        await cleared(generation); expect((await state()).playing).toBe(false);
      }
      generation = await cross(); await page.locator('#motion-reset').click(); await cleared(generation);
      expect((await state()).weights).toEqual([0, 0, 0, 0, 0]); expect((await state()).bones).toEqual(rest);
      generation = await cross(); await page.locator('#motion-load').click();
      await expect(page.locator('#motion-load')).toBeEnabled(); await cleared(generation);
      generation = await cross();
      await page.locator('#morph-controls input').first().fill('1.8');
      await page.locator('#morph-controls input').first().dispatchEvent('change');
      await cleared(generation); expect((await state()).playing).toBe(false);
      generation = await cross();
      await page.locator('#motion-sample').selectOption('combined-a');
      await expect(page.locator('#motion-load')).toBeEnabled(); await page.locator('#motion-load').click();
      await expect(page.locator('#motion-load')).toBeEnabled(); await cleared(generation);
      generation = (await state()).playback.generation;
      await page.locator('#rig-model').selectOption(rig === 'box' ? 'wedge' : 'box');
      await expect(page.locator('#rig-preset')).toBeEnabled(); await cleared(generation);
      expect((await state()).disposedPlayers).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  } finally {
    await info.attach('loop-traces.json', { body: JSON.stringify(traces, null, 2), contentType: 'application/json' });
    console.log('Demo loop traces:', JSON.stringify(traces));
    await page.evaluate(() => (window as any).playbackGate?.release()).catch(() => {});
  }
});
