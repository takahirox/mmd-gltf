import { motionMetadata, expectMotionDuration } from './motion-duration';
import { PNG } from 'pngjs';
import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { readComparisonBitmap, comparisonHalf } from './comparison-bitmap';
const preview=`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;
type PaneBounds = {x:number;y:number;width:number;height:number};
function panePixels(bytes:Buffer,bounds:PaneBounds) {
  const png=PNG.sync.read(bytes),pane=new PNG({width:bounds.width,height:bounds.height});
  PNG.bitblt(png,pane,bounds.x,bounds.y,bounds.width,bounds.height,0,0);
  return pane.data;
}

for(const model of ['uka','gene'])test(`${model}: all three ten-second timelines include visible terminal motion on desktop and mobile`,async({page},testInfo)=>{
  test.setTimeout(300000);
  const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
  await page.setViewportSize({width:1200,height:1000});
  await page.goto(`${preview}?demo=${model}`);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  const roots=await page.evaluate(()=>(window as any).readMMDComparisonResources().roots);
  requests.splice(0);
  for(const width of [1200,390]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    for(const motion of ['sample','02_laugh','22_apology']) {
      await page.locator('#comparison-motion').selectOption(motion);
      const metadata=await motionMetadata(model,motion);
      expect(metadata.duration).toBe(10);await expectMotionDuration(page,metadata);
      await expect(page.locator('#comparison-duration-details')).toContainText('10.00 s from the original VMD (last frame 300; 30 frames/s)');
      const pixels=[];
      for(const time of [9.5,299/30,10]) {
        await page.locator('#comparison-time').evaluate((e,t)=>{
          (e as HTMLInputElement).valueAsNumber=t;e.dispatchEvent(new Event('input',{bubbles:true}));
        },time);
        const state=await page.evaluate(()=>(window as any).mmdExample);
        await expectMotionDuration(page,metadata,state.time);
        expect(state.time).toBeCloseTo(time,12);
        pixels.push(await readComparisonBitmap(page));
      }
      const bounds=await page.evaluate(()=>{
        const viewport=document.querySelector<HTMLElement>('#viewport')!;
        const canvas=viewport.querySelector('canvas')!;
        const container=viewport.getBoundingClientRect();
        const scaleX=canvas.width/viewport.clientWidth,scaleY=canvas.height/viewport.clientHeight;
        return ['pmx','gltf'].map(id=>{
          const rect=document.querySelector(`#${id}-pane`)!.getBoundingClientRect();
          // Match the renderer's DOM-derived scissor rectangles. WebGL's Y
          // origin is at the bottom; PNG rows start at the top.
          const x=Math.max(0,Math.ceil((rect.left-container.left)*scaleX));
          const y=Math.max(0,Math.ceil(canvas.height-(rect.bottom-container.top)*scaleY));
          const right=Math.min(canvas.width,Math.floor((rect.right-container.left)*scaleX));
          const bottom=Math.min(canvas.height,Math.floor(canvas.height-(rect.top-container.top)*scaleY));
          return {x,y,width:right-x,height:bottom-y};
        });
      });
      // Independent raster proof: even the final frame changes both panes.
      // A repeated final morph value or an invisible-only key cannot pass this.
      for(const pane of bounds) {
        expect(pane.width).toBeGreaterThan(0);expect(pane.height).toBeGreaterThan(0);
        for(const earlier of pixels.slice(0,2))
          expect(panePixels(earlier,pane).equals(panePixels(pixels[2],pane))).toBe(false);
      }
      // Negative controls: freeze either entire rendered pane while preserving
      // terminal movement in the other. A left/right split of stacked mobile
      // panes would incorrectly report movement in both and fail these checks.
      for(const frozenPane of bounds) {
        const earlier=PNG.sync.read(pixels[1]),frozen=PNG.sync.read(pixels[2]);
        PNG.bitblt(earlier,frozen,frozenPane.x,frozenPane.y,frozenPane.width,frozenPane.height,frozenPane.x,frozenPane.y);
        const endpoint=PNG.sync.write(frozen);
        for(const pane of bounds)
          expect(panePixels(pixels[1],pane).equals(panePixels(endpoint,pane))).toBe(pane===frozenPane);
      }
      const endpoint=testInfo.outputPath(`${model}-${motion}-${width}-endpoint.png`);
      await page.screenshot({path:endpoint});
      await testInfo.attach('endpoint.png',{path:endpoint,contentType:'image/png'});
      const beforeEnd=testInfo.outputPath(`${model}-${motion}-${width}-before-end.png`);
      await writeFile(beforeEnd,pixels[1]);
      await testInfo.attach('before-end.png',{path:beforeEnd,contentType:'image/png'});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      const box=(await page.locator('#comparison-time').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    }
  }
  expect(await page.evaluate(()=>(window as any).readMMDComparisonResources().roots)).toEqual(roots);
  expect(requests.filter(url=>/ammo|bullet|\.(pmx|png|glb|gltf|vmd)(?:\?|$)/i.test(url))).toEqual([]);
});

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
  expect(initial.execution).toMatchObject({ik:true,ikState:'on',grant:model==='gene',physics:false,helper:false,fallbackMixer:false});
  expect(initial.execution.chains.map((s:any)=>s.executed.length)).toEqual(model==='uka'?[10,10,10]:[6,6,6]);
  await expect(page.locator('#comparison-ik')).toBeEnabled();
  await expect(page.locator('#comparison-ik')).toBeChecked();
  if(model==='gene')for(const chain of initial.execution.chains) {
    expect(chain).toMatchObject({supported:6,unsupported:0,available:true,appliedGrants:[35]});
    expect(chain.order.map((s:any)=>[s.kind,s.index])).toEqual([['grant',35],...chain.controllers.map((c:any)=>['ik',c.index])]);
  }
  expect(initial.binding.boneTracks).toBe(model==='uka'?301:212);
  expect(initial.binding.activeMorphs.length).toBeGreaterThanOrEqual(3);
  expect(initial.preview.targets.flat().every((n:number)=>n<=10)).toBe(true);
  await expect(page.locator('#comparison-play')).toBeDisabled();
  await page.locator('#comparison-motion').selectOption('sample');
  const metadata=await motionMetadata(model);
  await expectMotionDuration(page,metadata);
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
  await page.locator('#comparison-loop').uncheck();await seek(Math.max(0,metadata.duration-.1));
  await page.locator('#comparison-play').evaluate(b=>(b as HTMLButtonElement).click());
  await expect.poll(async()=>(await state()).time,{timeout:30000}).toBe(metadata.duration);
  expect((await state()).playing).toBe(false);
  await page.locator('#comparison-loop').check();await seek(Math.max(0,metadata.duration-.1));await page.locator('#comparison-play').click();
  await expect.poll(async()=>(await state()).time,{timeout:30000}).toBeLessThan(metadata.duration/2);
  await page.locator('#comparison-play').click();
  const looped=await state();expect(looped.gltfTimes).toEqual([looped.time,looped.time]);
  await seek(.4);await page.locator('#material').selectOption('pbr');
  const pbr=await readComparisonBitmap(page);await seek(.1);
  expect(comparisonHalf(await readComparisonBitmap(page),1).equals(comparisonHalf(pbr,1))).toBe(false);
  await page.locator('#comparison-motion').selectOption('rest');
  await expect(page.locator('#comparison-time-label')).toHaveText('Rest / manual');
  await expect(page.locator('#comparison-time')).toHaveAttribute('max','0');
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

for(const failure of ['missing','corrupt','unmatched','duration'])test(`VMD ${failure}: fail closed and retry`,async({page})=>{
  if(failure==='unmatched' || failure==='duration')await page.route('**/uka/motion.json',async route=>{
    const response=await route.fetch();const metadata=await response.json();if(failure==='duration')metadata.duration+=1;else metadata.morphs=[];
    await route.fulfill({response,json:metadata});
  });
  else await page.route('**/uka/motion/04_littlesmile.vmd',route=>route.fulfill({status:failure==='missing'?404:200,body:'invalid VMD'}));
  await page.goto(preview);
  await expect(page.locator('#gene-status')).toContainText(failure==='missing'?'VMD unavailable':failure==='corrupt'?'hash/size mismatch':failure==='duration'?'metadata duration differs':'no useful bound',{timeout:90000});
  await expect(page.locator('#comparison-play')).toBeDisabled();await expect(page.locator('#viewport canvas')).toHaveCount(0);
  await page.unrouteAll();await page.locator('#demo-retry').click();
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await page.locator('#comparison-motion').selectOption('sample');await expect(page.locator('#comparison-play')).toBeEnabled();
});

// This case uses source-generated VMDs, not altered duration fields: pinned bytes,
// hash/size, retained payload identity and player duration all still validate.
test('source durations: fractional endpoint, short/zero clips, loop and rapid handoff',async({page},testInfo)=>{
  test.setTimeout(300000);
  const {publicDurationFixture}=await import('./duration-fixture');
  const fixture=await publicDurationFixture();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let release!:()=>void;
  const loading=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/uka/**',async route=>{
    const path=new URL(route.request().url()).pathname.split('/uka/')[1];
    const body=fixture.files.get(path);
    if(!body)return route.continue();
    if(path==='motion.json')await loading;
    await route.fulfill({body,contentType:path.endsWith('.json')?'application/json':'application/octet-stream'});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto(preview);
  await expect(page.locator('#comparison-time-label')).toHaveText('Loading…');
  await expect(page.locator('#comparison-time')).toHaveAttribute('max','0');
  for(const id of ['comparison-time','comparison-play','comparison-restart','comparison-loop'])await expect(page.locator(`#${id}`)).toBeDisabled();
  release();
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await expect(page.locator('#comparison-time-label')).toHaveText('Rest / manual');
  const state=()=>page.evaluate(()=>(window as any).mmdExample);
  const roots=await page.evaluate(()=>(window as any).readMMDComparisonResources().roots);
  const seek=async(time:number)=>{
    await page.locator('#comparison-time').evaluate((element,time)=>{
      const input=element as HTMLInputElement;input.valueAsNumber=time;input.dispatchEvent(new Event('input',{bubbles:true}));
    },time);
  };
  const clickPlay=()=>page.locator('#comparison-play').evaluate(e=>(e as HTMLButtonElement).click());
  const [long,short,zero]=fixture.metadata;
  await page.locator('#comparison-motion').selectOption('sample');
  await expectMotionDuration(page,long);
  await page.locator('#comparison-time').press('End');
  await expectMotionDuration(page,long,long.duration);
  expect(await page.locator('#comparison-time').evaluate(e=>(e as HTMLInputElement).validity.stepMismatch)).toBe(false);
  const finalPose=await page.evaluate(()=>(window as any).readMMDComparisonPose());
  await seek(long.duration+1);await expectMotionDuration(page,long,long.duration);
  await seek(-1);await expectMotionDuration(page,long);
  await seek(long.duration-.1);await clickPlay();
  await expect.poll(async()=>(await state()).playing,{timeout:30000}).toBe(false);
  await expectMotionDuration(page,long,long.duration);
  expect(await page.evaluate(()=>(window as any).readMMDComparisonPose())).toEqual(finalPose);
  await page.locator('#comparison-restart').click();await expectMotionDuration(page,long);
  await clickPlay();await expect.poll(async()=>(await state()).time).toBeGreaterThan(0);
  await clickPlay();const paused=(await state()).time;
  await page.waitForTimeout(150);await expectMotionDuration(page,long,paused);
  await page.locator('#comparison-loop').check();await seek(long.duration-.1);await clickPlay();
  await expect.poll(async()=>(await state()).time,{timeout:30000}).toBeLessThan(long.duration/2);
  expect((await state()).playing).toBe(true);
  await page.locator('#comparison-restart').evaluate(e=>(e as HTMLButtonElement).click());
  expect((await state()).playing).toBe(true);
  await clickPlay();
  // Longer → shorter → longer, with Loop retained and the old clock near its end.
  await seek(long.duration-1/30);
  for(const [id,metadata] of [['02_laugh',short],['sample',long],['02_laugh',short],['sample',long]] as const) {
    await page.locator('#comparison-motion').selectOption(id);await expectMotionDuration(page,metadata);
    expect((await state()).playing).toBe(false);await expect(page.locator('#comparison-loop')).toBeChecked();
  }
  await page.locator('#comparison-motion').selectOption('02_laugh');await expectMotionDuration(page,short);
  await seek(short.duration);await expectMotionDuration(page,short,short.duration);
  await page.locator('#comparison-loop').uncheck();await page.locator('#comparison-restart').click();await clickPlay();
  await expect.poll(async()=>(await state()).playing).toBe(false);await expectMotionDuration(page,short,short.duration);
  await page.locator('#comparison-loop').check();await clickPlay();
  await page.waitForTimeout(150);expect((await state()).playing).toBe(true);expect((await state()).time).toBeLessThan(short.duration);
  await page.locator('#comparison-motion').selectOption('22_apology');await expectMotionDuration(page,zero);
  await expect(page.locator('#comparison-play')).toBeDisabled();
  await page.waitForTimeout(100);expect((await state()).playing).toBe(false);
  await page.locator('#comparison-motion').selectOption('rest');
  await expect(page.locator('#comparison-time-label')).toHaveText('Rest / manual');
  expect((await state()).duration).toBe(0);expect((await state()).time).toBe(0);
  expect(await page.evaluate(()=>(window as any).readMMDComparisonResources().roots)).toEqual(roots);
  await expect(page.locator('#viewport canvas')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  const slider=(await page.locator('#comparison-time').boundingBox())!;
  expect(slider.width).toBeGreaterThan(80);expect(slider.x+slider.width).toBeLessThanOrEqual(390);
  await testInfo.attach('duration-evidence.json',{body:JSON.stringify({metadata:fixture.metadata.map(m=>({animation:m.animation,duration:m.duration,sha256:m.sha256,bytes:m.bytes})),state:await state()}),contentType:'application/json'});
  expect(errors).toEqual([]);
});
