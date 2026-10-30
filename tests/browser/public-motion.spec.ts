import { PNG } from 'pngjs';
import { test, expect } from '@playwright/test';
import { readComparisonBitmap, comparisonHalf } from './comparison-bitmap';
const preview=`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;

for(const model of ['uka','gene'])test(`${model}: pinned real VMD, shared absolute seek, pixels, pause, loop and cleanup`,async({page},testInfo)=>{
  test.setTimeout(300000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const ammo:string[]=[];page.on('request',r=>{if(/ammo|bullet/i.test(r.url()))ammo.push(r.url());});
  await page.setViewportSize({width:1200,height:1000});
  await page.goto(`${preview}?demo=${model}`);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  const state=()=>page.evaluate(()=>(window as any).mmdExample);
  const rest=await readComparisonBitmap(page);
  const initial=await state();
  expect(initial.execution).toMatchObject({ik:model==='uka',ikState:model==='uka'?'on':'unavailable',grant:false,physics:false,helper:false,fallbackMixer:false});
  expect(initial.execution.chains.map((s:any)=>s.executed.length)).toEqual(model==='uka'?[10,10,10]:[0,0,0]);
  if(model==='gene') {
    await expect(page.locator('#comparison-ik')).toBeDisabled();
    await expect(page.locator('#comparison-ik')).not.toBeChecked();
    await expect(page.locator('#comparison-ik')).toHaveAttribute('title',/append dependency 35/);
    for(const chain of initial.execution.chains)expect(chain).toMatchObject({supported:5,unsupported:1,available:false,executed:[]});
    await expect(page.locator('#pmx-status')).toContainText('IK unavailable');
  }
  expect(initial.binding.boneTracks).toBe(model==='uka'?301:212);
  expect(initial.binding.activeMorphs.length).toBeGreaterThanOrEqual(3);
  expect(initial.preview.targets.flat().every((n:number)=>n<=10)).toBe(true);
  await expect(page.locator('#comparison-play')).toBeDisabled();
  await page.locator('#comparison-motion').selectOption('sample');
  await expect(page.locator('#expression')).toBeDisabled();
  const seek=async(time:number)=>{
    await page.locator('#comparison-time').fill(String(time));await page.locator('#comparison-time').dispatchEvent('input');
    const s=await state();expect(s.referenceTime).toBe(s.time);expect(s.gltfTimes).toEqual([s.time,s.time]);
    return readComparisonBitmap(page);
  };
  const start=await seek(0), a=await seek(.1),b=await seek(.4);
  await testInfo.attach('motion-evidence.json',{body:JSON.stringify({model,preview:initial.preview,binding:initial.binding,execution:initial.execution,sample:await state()}),contentType:'application/json'});
  for(const half of [0,1]) {
    expect(comparisonHalf(a,half).equals(comparisonHalf(b,half))).toBe(false);
    expect(comparisonHalf(start,half).equals(comparisonHalf(b,half))).toBe(false);
  }
  await page.locator('#comparison-restart').click();
  expect((await readComparisonBitmap(page)).equals(start)).toBe(true);
  await page.locator('#comparison-loop').check();
  await page.locator('#comparison-play').evaluate(b=>(b as HTMLButtonElement).click());
  await expect.poll(async()=>(await state()).time,{timeout:30000}).toBeGreaterThan(.1);
  await page.locator('#comparison-play').evaluate(b=>(b as HTMLButtonElement).click());
  const paused=await state(),pixels=await readComparisonBitmap(page);
  await page.waitForTimeout(250);expect((await state()).time).toBe(paused.time);
  expect((await readComparisonBitmap(page)).equals(pixels)).toBe(true);
  await page.locator('#comparison-loop').uncheck();await seek(9.9);
  await page.locator('#comparison-play').evaluate(b=>(b as HTMLButtonElement).click());
  await expect.poll(async()=>(await state()).time,{timeout:30000}).toBe(10);
  expect((await state()).playing).toBe(false);
  await page.locator('#comparison-loop').check();await seek(9.9);await page.locator('#comparison-play').click();
  await expect.poll(async()=>(await state()).time,{timeout:30000}).toBeLessThan(9);
  await page.locator('#comparison-play').click();
  const looped=await state();expect(looped.gltfTimes).toEqual([looped.time,looped.time]);
  await seek(.4);await page.locator('#material').selectOption('pbr');
  const pbr=await readComparisonBitmap(page);await seek(.1);
  expect(comparisonHalf(await readComparisonBitmap(page),1).equals(comparisonHalf(pbr,1))).toBe(false);
  await page.locator('#comparison-motion').selectOption('rest');
  if(model==='uka')await expect(page.locator('#expression')).toBeEnabled();
  await page.locator('#material').selectOption('toon');
  const restored=PNG.sync.read(await readComparisonBitmap(page)),restPNG=PNG.sync.read(rest);
  // Rest/core node roundoff can affect a few edge samples. VMD Restart above is bit-exact.
  for(const half of [0,1]) {
    let changed=0;
    for(let y=0;y<restored.height;y++)for(let x=half*restored.width/2;x<(half+1)*restored.width/2;x++) {
      const i=(y*restored.width+x)*4;
      if(restored.data[i]!==restPNG.data[i] || restored.data[i+1]!==restPNG.data[i+1] || restored.data[i+2]!==restPNG.data[i+2])changed++;
    }
    expect(changed).toBeLessThan(16);
  }
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  for(const id of ['comparison-motion','comparison-play','comparison-restart','comparison-time','comparison-loop']) {
    const box=(await page.locator(`#${id}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
  }
  await page.locator('#comparison-motion').selectOption('sample');await page.locator('#comparison-play').click();
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  const suspended=await state();expect(suspended.playing).toBe(false);
  await page.waitForTimeout(100);expect((await state()).time).toBe(suspended.time);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  expect((await state()).playing).toBe(false);
  await page.locator('#comparison-play').click();
  await page.locator('#demo-model').selectOption(model==='uka'?'gene':'uka');
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  const next=await state();expect(next.model).not.toBe(model);expect(next.playing).toBe(false);expect(next.time).toBe(0);
  await expect(page.locator('#viewport canvas')).toHaveCount(1);
  expect(errors).toEqual([]);expect(ammo).toEqual([]);
});

for(const failure of ['missing','corrupt','unmatched'])test(`VMD ${failure}: fail closed and retry`,async({page})=>{
  if(failure==='unmatched')await page.route('**/uka/motion.json',async route=>{
    const response=await route.fetch();const metadata=await response.json();metadata.morphs=[];
    await route.fulfill({response,json:metadata});
  });
  else await page.route('**/uka/motion/04_littlesmile.vmd',route=>route.fulfill({status:failure==='missing'?404:200,body:'invalid VMD'}));
  await page.goto(preview);
  await expect(page.locator('#gene-status')).toContainText(failure==='missing'?'VMD unavailable':failure==='corrupt'?'hash/size mismatch':'no useful bound',{timeout:90000});
  await expect(page.locator('#comparison-play')).toBeDisabled();await expect(page.locator('#viewport canvas')).toHaveCount(0);
  await page.unrouteAll();await page.locator('#demo-retry').click();
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await page.locator('#comparison-motion').selectOption('sample');await expect(page.locator('#comparison-play')).toBeEnabled();
});
