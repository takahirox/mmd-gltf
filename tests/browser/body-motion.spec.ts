import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { test, expect } from '@playwright/test';
import { readComparisonBitmap, comparisonHalf } from './comparison-bitmap';
const preview=`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;
type Pose = {bones:Record<string,{local:number[];rotation:number[];world:number[]}>;vertices:number[][]};
const difference=(a:number[],b:number[])=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));

for(const model of ['uka','gene'])test(`${model}: both official body clips deform both skins on the shared clock`,async({page},testInfo)=>{
  test.setTimeout(420000);
  const errors:string[]=[],ammo:string[]=[],requests:string[]=[];
  page.on('request',r=>requests.push(r.url()));
  const loadStarted=performance.now();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/ammo|bullet/i.test(r.url()))ammo.push(r.url());});
  await page.setViewportSize({width:1200,height:1000});
  await page.goto(`${preview}?demo=${model}`);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  const state=()=>page.evaluate(()=>(window as any).mmdExample);
  const poses=()=>page.evaluate(()=>((window as any).readMMDComparisonPose() as Pose[]));
  const rest=await poses();
  const metadataByMotion=new Map(await Promise.all(['sample','02_laugh','22_apology'].map(async id=>[id,JSON.parse(await readFile(`public/${model==='uka'?'uka':'gene-light'}/${id==='sample'?'motion':`motion-${id}`}.json`,'utf8'))] as const)));
  const seek=async(time:number)=>{
    // Native range sanitization handles non-terminating frame/30 values;
    // Playwright fill rejects some valid frame positions as a step mismatch.
    await page.locator('#comparison-time').evaluate((element,time)=>{
      (element as HTMLInputElement).valueAsNumber=time;
      element.dispatchEvent(new Event('input',{bubbles:true}));
    },time);
    const s=await state();
    const weights=(await resource()).weights as number[][];
    for(const target of metadataByMotion.get(s.motion).preview)for(const converted of weights.slice(1))expect(Math.abs(weights[0][target.sourceIndex]-converted[target.target])).toBeLessThan(1e-6);
    expect(s.time).toBeCloseTo(time,12);expect(s.referenceTime).toBe(s.time);expect(s.gltfTimes).toEqual([s.time,s.time]);
    return poses();
  };
  // Warm the independently loaded PBR instance before measuring clip-only GPU costs.
  await page.locator('#material').selectOption('pbr');await readComparisonBitmap(page);
  await page.locator('#material').selectOption('toon');await readComparisonBitmap(page);
  await page.locator('#comparison-motion').evaluate(e=>e.addEventListener('change',()=>{const started=performance.now();queueMicrotask(()=>{(window as any).motionSwitchMilliseconds=performance.now()-started;});},{capture:true}));
  const loadMilliseconds=performance.now()-loadStarted;
  const initialRequests=requests.splice(0);
  const initialNetwork=await page.evaluate(()=>performance.getEntriesByType('resource').map(entry=>{const e=entry as PerformanceResourceTiming;return {url:e.name,transferBytes:e.transferSize,encodedBytes:e.encodedBodySize};}));
  const resource=()=>page.evaluate(()=>(window as any).readMMDComparisonResources());
  const before=await resource(),switches=[];
  await page.locator('#comparison-motion').selectOption('sample');
  await seek(.5);await page.locator('#comparison-motion').selectOption('rest');
  for(const clip of ['02_laugh','22_apology']) {
    const started=performance.now();
    const preserved={cameras:(await state()).cameras,material:await page.locator('#material').inputValue(),outline:await page.locator('#outlines').inputValue()};
    await page.evaluate(()=>{(window as any).previousCapture=(window as any).captureMMDComparisonCanvas;});
    await page.locator('#comparison-motion').selectOption(clip);
    await expect.poll(async()=>({motion:(await state())?.motion,ready:await page.locator('#comparison-motion').isEnabled()}),{timeout:90000}).toEqual({motion:clip,ready:true});
    expect(await page.evaluate(async()=>{
      const previous=(window as any).previousCapture;delete (window as any).previousCapture;
      try {await previous();return 'still active';}catch(e){return (e as Error).message;}
    })).toBe('still active');
    await expect(page.locator('#viewport canvas')).toHaveCount(1);
    switches.push({clip,roundTripMilliseconds:performance.now()-started,actionMilliseconds:await page.evaluate(()=>(window as any).motionSwitchMilliseconds)});
    expect((await resource()).roots).toEqual(before.roots);
    expect((await state()).time).toBe(0);expect((await state()).playing).toBe(false);
    const initial=await state();
    expect(initial.cameras).toEqual(preserved.cameras);
    expect(await page.locator('#material').inputValue()).toBe(preserved.material);
    expect(await page.locator('#outlines').inputValue()).toBe(preserved.outline);
    expect(initial.execution).toEqual({ik:model==='uka',sleeveIK:model==='uka',grant:false,physics:false,helper:false,fallbackMixer:false});
    expect(initial.binding.changingBones).toContain('上半身');expect(initial.binding.changingBones).toContain('左腕');
    const targets=model==='uka'?7:10;
    expect(initial.preview.targets.flat().every((n:number)=>n===targets)).toBe(true);
    if(model==='uka' && clip==='22_apology')await expect(page.locator('#comparison-binding')).toContainText('2 active morphs omitted');
    const zero=await readComparisonBitmap(page);
    const times=clip==='02_laugh'?[.5,4]:[.5,50/30];
    const a=await seek(times[0]),pixelsA=await readComparisonBitmap(page);
    const b=await seek(times[1]),pixelsB=await readComparisonBitmap(page);
    for(let pane=0;pane<3;pane++) {
      expect(difference(a[pane].vertices.flat(),b[pane].vertices.flat())).toBeGreaterThan(.01);
      expect(difference(rest[pane].vertices.flat(),a[pane].vertices.flat())).toBeGreaterThan(.01);
      expect(difference(rest[pane].vertices.flat(),b[pane].vertices.flat())).toBeGreaterThan(.01);
      expect(difference(a[pane].bones['上半身'].rotation,b[pane].bones['上半身'].rotation)).toBeGreaterThan(.005);
      expect(difference(rest[pane].bones['左腕'].rotation,a[pane].bones['左腕'].rotation)).toBeGreaterThan(.05);
      expect(difference(a[pane].bones['左手首'].world,b[pane].bones['左手首'].world)).toBeGreaterThan(.01);
    }
    // The reference loader uses a 15-iteration approximate Bezier inverse,
    // including at key boundaries; the retained player uses a finer inverse.
    const errors={local:0,world:0,rotation:0};
    for(const pose of [a,b])for(const name of ['上半身','上半身2','頭','左肩','左腕','左ひじ','左手首','右肩','右腕','右ひじ','右手首',...(model==='uka'?['左腕袖','左ひじ袖','左手首袖','右腕袖','右ひじ袖','右手首袖']:[])])for(const pane of [1,2]) {
      for(const field of ['local','world'] as const)errors[field]=Math.max(errors[field],difference(pose[0].bones[name][field],pose[pane].bones[name][field]));
      const q=pose[0].bones[name].rotation,r=pose[pane].bones[name].rotation;
      const dot=q.reduce((n,v,i)=>n+v*r[i],0)/Math.hypot(...q)/Math.hypot(...r);
      errors.rotation=Math.max(errors.rotation,2*Math.acos(Math.min(1,Math.abs(dot))));
    }
    await testInfo.attach(`${model}-${clip}-bone-errors.json`,{body:JSON.stringify(errors),contentType:'application/json'});
    expect(errors.local).toBeLessThan(1e-5); // metres
    expect(errors.world).toBeLessThan(.002); // two millimetres
    expect(errors.rotation).toBeLessThan(.002); // radians (~0.115 degrees)
    for(const half of [0,1]) {
      expect(comparisonHalf(pixelsA,half).equals(comparisonHalf(pixelsB,half))).toBe(false);
      const first=PNG.sync.read(pixelsA), second=PNG.sync.read(pixelsB);
      let changed=0;
      for(let y=Math.floor(first.height*.35);y<first.height*.9;y++)
        for(let x=half*first.width/2;x<(half+1)*first.width/2;x++) {
          const i=(y*first.width+x)*4;
          if(Math.abs(first.data[i]-second.data[i])+Math.abs(first.data[i+1]-second.data[i+1])+Math.abs(first.data[i+2]-second.data[i+2])>10)changed++;
        }
      expect(changed).toBeGreaterThan(300);
    }
    const backward=await seek(times[0]);
    for(const pane of [0,1,2]) {
      expect(difference(backward[pane].vertices.flat(),a[pane].vertices.flat())).toBeLessThan(1e-7);
      for(const name of Object.keys(a[pane].bones))for(const field of ['local','world','rotation'] as const)
        expect(difference(backward[pane].bones[name][field],a[pane].bones[name][field])).toBeLessThan(1e-7);
    }
    await page.locator('#comparison-restart').click();expect((await readComparisonBitmap(page)).equals(zero)).toBe(true);
    await page.locator('#comparison-play').click();
    await expect.poll(async()=>(await state()).time).toBeGreaterThan(.05);
    await page.locator('#comparison-play').click();
    const paused=await poses(), pausedTime=(await state()).time;
    await page.waitForTimeout(150);expect(await poses()).toEqual(paused);expect((await state()).time).toBe(pausedTime);
    await page.locator('#comparison-loop').check();await seek(9.9);await page.locator('#comparison-play').click();
    await expect.poll(async()=>(await state()).time,{timeout:30000}).toBeLessThan(9);
    await page.locator('#comparison-play').click();
    await page.locator('#comparison-loop').uncheck();await seek(9.9);await page.locator('#comparison-play').click();
    await expect.poll(async()=>(await state()).playing,{timeout:30000}).toBe(false);expect((await state()).time).toBe(10);
    await page.locator('#material').selectOption('pbr');await seek(times[0]);const pbr=await readComparisonBitmap(page);
    await seek(times[1]);expect(comparisonHalf(await readComparisonBitmap(page),1).equals(comparisonHalf(pbr,1))).toBe(false);
    await testInfo.attach(`${model}-${clip}-pose.json`,{body:JSON.stringify({times,initial,a,b}),contentType:'application/json'});
    await testInfo.attach(`${model}-${clip}.png`,{body:pixelsB,contentType:'image/png'});
    await page.locator('#comparison-motion').selectOption('rest');
    const restored=await poses();
    for(const pane of [0,1,2]) {
      expect(difference(restored[pane].vertices.flat(),rest[pane].vertices.flat())).toBeLessThan(2e-6);
      for(const name of Object.keys(rest[pane].bones))for(const field of ['local','world','rotation'] as const)expect(difference(restored[pane].bones[name][field],rest[pane].bones[name][field])).toBeLessThan(2e-6);
    }
  }
  const after=await resource();
  await testInfo.attach('motion-lifecycle.json',{body:JSON.stringify({before,after,loadMilliseconds,initialRequests,initialNetwork,switches,requests}),contentType:'application/json'});
  expect(after.memory).toEqual(before.memory);expect(after.weights).toEqual(before.weights);expect(requests).toEqual([]);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#comparison-motion').selectOption('02_laugh');
  await expect.poll(async()=>(await state())?.motion,{timeout:90000}).toBe('02_laugh');
  await expect(page.locator('#comparison-motion')).toBeEnabled({timeout:90000});
  await seek(4);await readComparisonBitmap(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  for(const id of ['comparison-motion','comparison-play','comparison-restart','comparison-time','comparison-loop']) {
    const box=(await page.locator(`#${id}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
  }
  await page.locator('#comparison-motion').selectOption('sample');
  await expect(page.locator('#comparison-motion')).toBeEnabled({timeout:90000});
  await expect.poll(async()=>(await state())?.motion,{timeout:90000}).toBe('sample');
  expect((await state()).preview.targets.flat().every((n:number)=>n=== (model==='uka'?7:10))).toBe(true);
  await page.locator('#demo-model').selectOption(model==='uka'?'gene':'uka');
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  expect((await state()).motion).toBe('rest');expect((await state()).time).toBe(0);
  await expect(page.locator('#viewport canvas')).toHaveCount(1);
  expect(errors).toEqual([]);expect(ammo).toEqual([]);
});

for(const failure of ['missing','corrupt','binding','retained'])test(`body selection ${failure}: fails preload and retries the character`,async({page})=>{
  test.setTimeout(180000);
  if(failure==='binding')await page.route('**/uka/motion-22_apology.json',async route=>{
    const response=await route.fetch(), metadata=await response.json();metadata.morphs=[];
    await route.fulfill({response,json:metadata});
  });
  else if(failure==='retained')await page.route('**/uka/model.gltf',async route=>{
    const response=await route.fetch(),json=await response.json();
    json.animations.find((a:any)=>a.name==='22_apology').extensions.MMD_animation_vmd.source=json.animations.find((a:any)=>a.name==='02_laugh').extensions.MMD_animation_vmd.source;
    await route.fulfill({response,json});
  });
  else await page.route('**/uka/motion/22_apology.vmd',route=>route.fulfill({status:failure==='missing'?404:200,body:'invalid VMD'}));
  await page.goto(preview);
  await expect(page.locator('#gene-status')).toContainText(failure==='missing'?'VMD unavailable':failure==='corrupt'?'hash/size mismatch':failure==='binding'?'no useful bound':'retained source differs',{timeout:90000});
  await expect(page.locator('#viewport canvas')).toHaveCount(0);await expect(page.locator('#comparison-play')).toBeDisabled();
  await page.unrouteAll();await page.locator('#demo-retry').click();
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await page.locator('#comparison-motion').selectOption('22_apology');
  await expect(page.locator('#comparison-motion')).toHaveValue('22_apology');await expect(page.locator('#comparison-play')).toBeEnabled();
});
