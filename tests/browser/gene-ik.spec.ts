import { test, expect } from '@playwright/test';
import { Quaternion } from 'three';
import { PNG } from 'pngjs';
import { readComparisonBitmap, comparisonHalf } from './comparison-bitmap';
const preview=`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;
type Pose={bones:Record<string,{index:number;rotation:number[];world:number[];local:number[]}>;vertices:number[][]};
const difference=(a:number[],b:number[])=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
const pixelCounts=(a:Buffer,b:Buffer)=>{
  const first=PNG.sync.read(a),second=PNG.sync.read(b),counts=[0,0];
  for(let y=0;y<first.height;y++)for(let x=0;x<first.width;x++) {
    const i=(y*first.width+x)*4;
    if(first.data[i]!==second.data[i] || first.data[i+1]!==second.data[i+1] || first.data[i+2]!==second.data[i+2])counts[x<first.width/2?0:1]++;
  }
  return counts;
};

test('Gene six-chain ordered grant/IK: three independent skins, original motions, pixels, raw restoration and lifecycle',async({page},testInfo)=>{
  test.setTimeout(300000);
  const requests:string[]=[],errors:string[]=[];
  page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1200,height:1000});
  await page.goto(`${preview}?demo=gene`);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('#comparison-ik')).toBeEnabled();await expect(page.locator('#comparison-ik')).toBeChecked();
  const poses=()=>page.evaluate(()=>(window as any).readMMDComparisonPose() as Pose[]);
  const state=()=>page.evaluate(()=>(window as any).mmdExample);
  const resources=()=>page.evaluate(()=>(window as any).readMMDComparisonResources());
  const seek=async(time:number)=>{
    await page.locator('#comparison-time').evaluate((e,t)=>{(e as HTMLInputElement).valueAsNumber=t;e.dispatchEvent(new Event('input',{bubbles:true}));},time);
    const s=await state();expect(s.gltfTimes).toEqual([s.time,s.time]);expect(s.referenceTime).toBe(s.time);
    return poses();
  };
  await page.locator('#material').selectOption('pbr');await readComparisonBitmap(page);
  await page.locator('#material').selectOption('toon');await readComparisonBitmap(page);
  const before=await resources();requests.splice(0);
  const evidence=[];
  for(const [clip,time] of [['sample',.5],['02_laugh',4],['22_apology',50/30]] as const) {
    await page.locator('#comparison-motion').selectOption(clip);await seek(time);
    await page.locator('#comparison-ik').uncheck();const raw=await poses();
    const off=await state();expect(off.execution).toMatchObject({ik:false,grant:false,ikState:'off',physics:false});
    for(const chain of off.execution.chains)expect(chain).toMatchObject({executed:[],appliedGrants:[],disabledByMotion:[]});
    const rawPixels=await readComparisonBitmap(page);
    await page.locator('#comparison-ik').check();const solved=await poses(),on=await state();
    const toonPixels=await readComparisonBitmap(page);
    for(const chain of on.execution.chains) {
      expect(chain.executed).toEqual([38,178,86,87,97,98]);expect(chain.disabledByMotion).toEqual([]);expect(chain.appliedGrants).toEqual([35]);
      expect(chain.order.map((s:any)=>[s.kind,s.index,s.layer])).toEqual([['grant',35,0],['ik',38,0],['ik',178,0],['ik',86,1],['ik',87,1],['ik',97,1],['ik',98,1]]);
    }
    const measurements=solved.map((p,i)=>{
      const expected=new Quaternion().fromArray(raw[i].bones['右肩連'].rotation).normalize().multiply(new Quaternion().fromArray(raw[i].bones['右肩'].rotation).normalize()).normalize();
      const appended=new Quaternion().fromArray(p.bones['右肩連'].rotation).normalize();
      expect(appended.angleTo(expected)).toBeLessThan(1e-6);
      const grantRadians=appended.angleTo(new Quaternion().fromArray(raw[i].bones['右肩連'].rotation).normalize());
      const linkRadians=new Quaternion().fromArray(p.bones['右腕xca'].rotation).normalize().angleTo(new Quaternion().fromArray(raw[i].bones['右腕xca'].rotation).normalize());
      const effectorDelta=Math.hypot(...p.bones['右腕xcb'].world.map((v,k)=>v-raw[i].bones['右腕xcb'].world[k]));
      let worldError=0;
      for(const c of on.execution.chains[i].controllers)for(const index of [c.index,c.effector,...c.links.map((l:any)=>l.index)]) {
        const b=Object.values(p.bones).find(b=>b.index===index)!;
        const ref=Object.values(solved[0].bones).find(b=>b.index===index)!;
        worldError=Math.max(worldError,difference(b.world,ref.world));
      }
      expect(worldError).toBeLessThan(.002);
      return {pane:['PMX','Toon','PBR'][i],grantRadians,linkRadians,effectorDelta,worldError,
        raw35:raw[i].bones['右肩連'],solved35:p.bones['右肩連']};
    });
    for(const half of [0,1])expect(comparisonHalf(rawPixels,half).equals(comparisonHalf(toonPixels,half))).toBe(false);
    await seek(.1);expect(await seek(time)).toEqual(solved);expect(await seek(time)).toEqual(solved);
    await page.locator('#material').selectOption('pbr');const pbrOn=await readComparisonBitmap(page);
    await page.locator('#comparison-ik').uncheck();const restored=await poses();
    for(const pane of [0,1,2])for(const name of Object.keys(raw[pane].bones))for(const field of ['rotation','local','world'] as const)
      expect(difference(restored[pane].bones[name][field],raw[pane].bones[name][field])).toBeLessThan(1e-7);
    const pbrOff=await readComparisonBitmap(page);
    for(const half of [0,1])expect(comparisonHalf(pbrOn,half).equals(comparisonHalf(pbrOff,half))).toBe(false);
    await page.locator('#comparison-ik').check();await page.locator('#material').selectOption('toon');
    expect(await poses()).toEqual(solved);
    const pixels={toon:pixelCounts(rawPixels,toonPixels),pbr:pixelCounts(pbrOff,pbrOn)};
    for(const n of [...pixels.toon,...pixels.pbr])expect(n).toBeGreaterThan(0);
    evidence.push({clip,time,measurements,pixels,execution:on.execution});
    await testInfo.attach(`${clip}-on.png`,{body:toonPixels,contentType:'image/png'});
    await testInfo.attach(`${clip}-off.png`,{body:rawPixels,contentType:'image/png'});
  }
  expect(evidence.some(e=>e.measurements.every(m=>m.grantRadians>.01))).toBe(true);
  // A -> B -> A with IK On, then Rest and model round trips.
  await page.locator('#comparison-motion').selectOption('02_laugh');const a=await seek(4);
  await page.locator('#comparison-motion').selectOption('22_apology');await seek(1);
  await page.locator('#comparison-motion').selectOption('02_laugh');expect(await seek(4)).toEqual(a);
  const after=await resources();expect(after.roots).toEqual(before.roots);expect(after.memory).toEqual(before.memory);expect(requests).toEqual([]);
  await page.locator('#comparison-motion').selectOption('rest');await page.locator('#comparison-ik').uncheck();const rest=await poses();
  await page.locator('#comparison-ik').check();await page.locator('#comparison-ik').uncheck();expect(await poses()).toEqual(rest);
  await page.locator('#demo-model').selectOption('uka');await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await page.locator('#demo-model').selectOption('gene');await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await page.locator('#comparison-motion').selectOption('02_laugh');expect(await seek(4)).toEqual(a);
  expect(errors).toEqual([]);expect(requests.filter(r=>/ammo|bullet/i.test(r))).toEqual([]);
  await testInfo.attach('gene-ordered-ik.json',{body:JSON.stringify(evidence),contentType:'application/json'});
});

// Valid source transport may carry an unexecutable graph. Decline the complete
// public IK set while keeping raw animation and the rest of the viewer usable.
for(const invalid of [false,true])test(`PMX/glTF ${invalid?'missing grant source':'grant mismatch'} disables complete public IK set`,async({page})=>{
  await page.route('**/uka/model.gltf',async route=>{
    const response=await route.fetch(),json=await response.json();
    const source=json.extras.sourceSolvers.find((b:any)=>b.index===57);
    source.flags|=0x100;source.grant={isLocal:false,affectRotation:true,affectPosition:false,parentIndex:invalid?9999:50,ratio:1};
    await route.fulfill({response,json});
  });
  await page.goto(preview);await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await expect(page.locator('#comparison-ik')).toBeDisabled();await expect(page.locator('#comparison-ik')).not.toBeChecked();
  await expect(page.locator('#comparison-ik')).toHaveAttribute('title',/mismatch/);
  await page.locator('#comparison-motion').selectOption('02_laugh');
  const execution=await page.evaluate(()=>(window as any).mmdExample.execution);
  expect(execution.ikState).toBe('unavailable');for(const c of execution.chains)expect(c.executed).toEqual([]);
  if(invalid)expect(execution.chains[1].controllers.some((c:any)=>c.reasons.some((r:string)=>r.includes('missing grant source')))).toBe(true);
});
