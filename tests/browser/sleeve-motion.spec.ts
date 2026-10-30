import { orbitComparison } from './comparison-camera';
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { readComparisonBitmap, comparisonHalf } from './comparison-bitmap';
test.use({ contextOptions: { reducedMotion: 'reduce' } });
const preview=`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;
const delta=(a:number[],b:number[])=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
const pairs=[['左腕袖IK','左ひじ袖'],['左手袖IK','左手首袖'],['左手首袖IK','左手袖先'],['右腕袖IK','右ひじ袖'],['右手袖IK','右手首袖'],['右手首袖IK','右手袖先']];
test('real Uka: full IK A/B restores follow in both independent skins without changing authored arms',async({page},testInfo)=>{
  test.setTimeout(300000);
  const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  // Real asset/player mapping must survive animation-array reordering in both instances.
  await page.route('**/uka/model.gltf',async route=>{const response=await route.fetch();const json=await response.json();json.animations.reverse();await route.fulfill({response,json});});
  await page.setViewportSize({width:1000,height:800});await page.goto(preview);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  const poses=()=>page.evaluate(()=>(window as any).readMMDComparisonPose());
  const seek=async(time:number)=>page.locator('#comparison-time').evaluate((e,time)=>{(e as HTMLInputElement).valueAsNumber=time;e.dispatchEvent(new Event('input',{bubbles:true}));},time);
  const samples=[];
  const state=()=>page.evaluate(()=>(window as any).mmdExample);
  await expect(page.locator('#viewpoint')).toHaveCount(0);
  await expect(page.locator('#comparison-sleeves')).toHaveCount(0);
  await expect(page.locator('#comparison-ik')).toBeChecked();
  const initial=await state();
  expect(initial.execution.chains[0].controllers.map((c:any)=>c.index)).toEqual([8,9,15,16,61,62,63,95,96,97]);
  for(const chain of initial.execution.chains) {
    expect(chain.controllers).toEqual(initial.execution.chains[0].controllers);
    expect(chain).toMatchObject({supported:10,unsupported:0,available:true});
  }
  const roots=await page.evaluate(()=>(window as any).readMMDComparisonResources().roots);
  requests.length=0;
  for(const [clip,frame] of [['02_laugh',120],['22_apology',50]] as const) {
    await page.locator('#comparison-motion').selectOption(clip);await seek(frame/30);
    await page.locator('#comparison-ik').uncheck();const raw=await poses();
    const views:Record<string,Buffer>={};
    for(const view of ['front','side']) {if(view==='side')await orbitComparison(page);views[`${view}-raw`]=await readComparisonBitmap(page);}
    await orbitComparison(page,-1);
    await page.locator('#comparison-ik').check();const corrected=await poses();
    for(const chain of (await state()).execution.chains)expect(chain.executed).toEqual([8,9,15,16,61,62,63,95,96,97]);
    for(let pane=0;pane<3;pane++) {
      const gaps=(pose:any)=>pairs.map(([a,b])=>Math.hypot(...pose.bones[a].world.map((v:number,k:number)=>v-pose.bones[b].world[k])));
      expect(Math.max(...gaps(raw[pane]))).toBeGreaterThan(.4);
      expect(Math.max(...gaps(corrected[pane]))).toBeLessThan(.00002);
      for(const name of ['左肩','左腕','左ひじ','左手首','右肩','右腕','右ひじ','右手首','左腕捩','右腕捩'])
        expect(corrected[pane].bones[name]).toEqual(raw[pane].bones[name]);
      expect(['左足','左ひざ','右足','右ひざ'].some(name=>delta(raw[pane].bones[name].rotation,corrected[pane].bones[name].rotation)>1e-6)).toBe(true);
      expect(delta(raw[pane].vertices.flat(),corrected[pane].vertices.flat())).toBeGreaterThan(.01);
    }
    for(const name of [...pairs.flat(),'左足ＩＫ','左つま先ＩＫ','右足ＩＫ','右つま先ＩＫ','左足','左ひざ','左足首','右足','右ひざ','右足首'])for(const pane of [1,2])expect(delta(corrected[0].bones[name].world,corrected[pane].bones[name].world)).toBeLessThan(.002);
    await seek(.5);await seek(frame/30);const repeated=await poses();
    for(let pane=0;pane<3;pane++)expect(delta(corrected[pane].vertices.flat(),repeated[pane].vertices.flat())).toBeLessThan(1e-7);
    for(const view of ['front','side']) {if(view==='side')await orbitComparison(page);views[`${view}-all-ik`]=await readComparisonBitmap(page);}
    for(const view of ['front','side'])for(const half of [0,1])
      expect(comparisonHalf(views[`${view}-raw`],half).equals(comparisonHalf(views[`${view}-all-ik`],half))).toBe(false);
    await page.locator('#material').selectOption('pbr');
    const pbrOn=await readComparisonBitmap(page);
    const pbrPose=await poses();expect(pbrPose).toEqual(repeated);
    await page.locator('#comparison-ik').uncheck();
    for(const chain of (await state()).execution.chains)expect(chain.executed).toEqual([]);
    const pbrOff=await readComparisonBitmap(page);
    for(const half of [0,1])expect(comparisonHalf(pbrOn,half).equals(comparisonHalf(pbrOff,half))).toBe(false);
    views['side-pbr-all-ik']=pbrOn;views['side-pbr-raw']=pbrOff;
    const restored=await poses();
    for(let pane=0;pane<3;pane++)for(const name of Object.keys(raw[pane].bones)) {
      expect(delta(raw[pane].bones[name].rotation,restored[pane].bones[name].rotation)).toBeLessThan(1e-12);
      expect(delta(raw[pane].bones[name].world,restored[pane].bones[name].world)).toBeLessThan(1e-12);
    }
    await seek(.5);const offPose=await poses();await seek(.5);expect(await poses()).toEqual(offPose);
    await seek(frame/30);const offAgain=await poses();
    for(let pane=0;pane<3;pane++)expect(delta(offAgain[pane].vertices.flat(),raw[pane].vertices.flat())).toBeLessThan(1e-7);
    await page.locator('#comparison-ik').check();
    await page.locator('#material').selectOption('toon');
    for(const [name,body] of Object.entries(views)) {
      const path=testInfo.outputPath(`${clip}-${name}.png`);await writeFile(path,body);await testInfo.attach(`${clip}-${name}`,{path,contentType:'image/png'});
    }
    await orbitComparison(page,-1);
    samples.push({clip,frame,raw,corrected});
  }
  await testInfo.attach('sleeve-ab.json',{body:JSON.stringify(samples),contentType:'application/json'});
  // A playing toggle uses the same clock and never replaces a renderer/model.
  await page.locator('#comparison-play').click();await page.locator('#comparison-ik').uncheck();
  expect((await state()).execution.ik).toBe(false);
  await page.locator('#comparison-ik').check();await page.locator('#comparison-play').click();
  for(const clip of ['sample','02_laugh','22_apology','rest']) {
    await page.locator('#comparison-motion').selectOption(clip);
    for(const chain of (await state()).execution.chains)expect(chain.executed.length).toBe(10);
    if(clip!=='rest') {
      for(const time of [0,10,.5,0])await seek(time);
      const a=await poses();await seek(0);expect(await poses()).toEqual(a);
    }
  }
  expect(await page.evaluate(()=>(window as any).readMMDComparisonResources().roots)).toEqual(roots);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
