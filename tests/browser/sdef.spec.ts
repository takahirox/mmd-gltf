import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const preview='http://127.0.0.1:43180/mmd-gltf/';
test('SDEF actual GPU positions/normals, independent rasters, VMD/VPD and serialized reloads',async({page},info)=>{
  test.setTimeout(420000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${preview}sdef-conformance.html`);
  await page.waitForFunction(()=>(window as any).sdefConformance||(window as any).sdefConformanceError,undefined,{timeout:400000});
  expect(await page.evaluate(()=>(window as any).sdefConformanceError)).toBeUndefined();expect(errors).toEqual([]);
  const result=await page.evaluate(()=>(window as any).sdefConformance);expect(result.passed).toBe(176);
  console.log('SDEF GPU evidence:',JSON.stringify({...result,evidence:undefined,maximumOraclePixelMismatches:Math.max(...result.evidence.map((e:any)=>e.oraclePixelMismatches))}));
  const report=info.outputPath('sdef-conformance.json');
  await writeFile(report,JSON.stringify(result,null,2));
  await info.attach('sdef-conformance.json',{path:report,contentType:'application/json'});
});
test('built SDEF Demo: both rigs, comparison, fractional motion, VPD handoff and recovery',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`${preview}rig.html`);
  await expect(page.locator('#rig-preset')).toBeEnabled();
  for(const rig of ['sdef-box','sdef-wedge']) {
    await page.locator('#rig-model').selectOption(rig);await expect(page.locator('#status')).toContainText('Rig loaded');
    for(const motion of ['combined-a','combined-b'])for(const source of ['bytes','glb','gltf']) {
      await page.locator('#motion-sample').selectOption(motion);await expect(page.locator('#motion-load')).toBeEnabled();
      await page.locator('#motion-source').selectOption(source);await page.locator('#motion-load').click();await expect(page.locator('#status')).toContainText('VMD loaded');
      await page.locator('#motion-time').fill('0.719');await page.locator('#motion-time').dispatchEvent('input');
      await expect.poll(()=>page.evaluate(()=>(window as any).mmdRig.time)).toBe(0.719);
      await page.waitForTimeout(100);const initial=await page.locator('canvas').screenshot();
      await page.locator('#sdef-comparison').check();await page.waitForTimeout(100);expect((await page.locator('canvas').screenshot()).equals(initial)).toBe(false);
      await page.locator('#sdef-comparison').uncheck();
      for(const mode of ['pbr','toon']) {await page.locator('#rig-material').selectOption(mode);await page.waitForTimeout(100);const on=await page.locator('canvas').screenshot();await page.locator('#rig-outlines').selectOption('off');await page.waitForTimeout(100);expect((await page.locator('canvas').screenshot()).equals(on)).toBe(false);await page.locator('#rig-outlines').selectOption('on');}
      for(const pose of ['a','b']){await page.locator('#rig-pose').selectOption(pose);await page.locator('#rig-preset').click();await expect(page.locator('#status')).toContainText('Applied VPD');}
      await page.locator('#motion-reset').click();await expect(page.locator('#rig-state')).toHaveText('Rest state');
    }
    await page.locator('#motion-file').setInputFiles({name:'bad.vmd',mimeType:'application/octet-stream',buffer:Buffer.from('bad')});
    await page.locator('#motion-load').click();await expect(page.locator('#status')).toContainText('VMD: truncated');
    await page.locator('#morph-controls input').first().fill('0.7');await page.locator('#morph-controls input').first().dispatchEvent('change');await expect.poll(()=>page.evaluate(()=>(window as any).mmdRig.weights[0])).toBe(0.7);
    await page.locator('#motion-reset').click();
  }
  expect(errors).toEqual([]);
});
