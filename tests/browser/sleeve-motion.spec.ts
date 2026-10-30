import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { readComparisonBitmap } from './comparison-bitmap';
const preview=`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;
const delta=(a:number[],b:number[])=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
const pairs=[['左腕袖IK','左ひじ袖'],['左手袖IK','左手首袖'],['左手首袖IK','左手袖先'],['右腕袖IK','右ひじ袖'],['右手袖IK','右手首袖'],['右手首袖IK','右手袖先']];
test('real Uka: sleeve-only A/B restores follow in both independent skins without changing authored arms',async({page},testInfo)=>{
  test.setTimeout(300000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  // Real asset/player mapping must survive animation-array reordering in both instances.
  await page.route('**/uka/model.gltf',async route=>{const response=await route.fetch();const json=await response.json();json.animations.reverse();await route.fulfill({response,json});});
  await page.setViewportSize({width:1000,height:800});await page.goto(preview);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  const poses=()=>page.evaluate(()=>(window as any).readMMDComparisonPose());
  const seek=async(time:number)=>page.locator('#comparison-time').evaluate((e,time)=>{(e as HTMLInputElement).valueAsNumber=time;e.dispatchEvent(new Event('input',{bubbles:true}));},time);
  const samples=[];
  for(const [clip,frame] of [['02_laugh',120],['22_apology',50]] as const) {
    await page.locator('#comparison-motion').selectOption(clip);await seek(frame/30);
    await page.locator('#comparison-sleeves').uncheck();const raw=await poses();
    const views:Record<string,Buffer>={};
    for(const view of ['front','side']) {await page.locator('#viewpoint').selectOption(view);views[`${view}-raw`]=await readComparisonBitmap(page);}
    await page.locator('#comparison-sleeves').check();const corrected=await poses();
    for(let pane=0;pane<3;pane++) {
      const gaps=(pose:any)=>pairs.map(([a,b])=>Math.hypot(...pose.bones[a].world.map((v:number,k:number)=>v-pose.bones[b].world[k])));
      expect(Math.max(...gaps(raw[pane]))).toBeGreaterThan(.4);
      expect(Math.max(...gaps(corrected[pane]))).toBeLessThan(.00002);
      for(const name of ['左肩','左腕','左ひじ','左手首','右肩','右腕','右ひじ','右手首','左腕捩','右腕捩'])
        expect(corrected[pane].bones[name]).toEqual(raw[pane].bones[name]);
      expect(delta(raw[pane].vertices.flat(),corrected[pane].vertices.flat())).toBeGreaterThan(.01);
    }
    for(const name of pairs.flat())for(const pane of [1,2])expect(delta(corrected[0].bones[name].world,corrected[pane].bones[name].world)).toBeLessThan(.002);
    await seek(.5);await seek(frame/30);const repeated=await poses();
    for(let pane=0;pane<3;pane++)expect(delta(corrected[pane].vertices.flat(),repeated[pane].vertices.flat())).toBeLessThan(1e-7);
    for(const view of ['front','side']) {await page.locator('#viewpoint').selectOption(view);views[`${view}-sleeve-ik`]=await readComparisonBitmap(page);}
    for(const [name,body] of Object.entries(views)) {
      const path=testInfo.outputPath(`${clip}-${name}.png`);await writeFile(path,body);await testInfo.attach(`${clip}-${name}`,{path,contentType:'image/png'});
      // Opt-in refresh keeps checked-in evidence tied to deliberate acceptance runs.
      if(process.env.UPDATE_SLEEVE_EVIDENCE==='1'){await mkdir('docs/images/uka-sleeves',{recursive:true});await writeFile(`docs/images/uka-sleeves/${clip}-${name}.png`,body);}
    }
    samples.push({clip,frame,raw,corrected});
  }
  await testInfo.attach('sleeve-ab.json',{body:JSON.stringify(samples),contentType:'application/json'});
  expect(errors).toEqual([]);
});
