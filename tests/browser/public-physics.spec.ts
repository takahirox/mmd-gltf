import { writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { jointBounds, jointViolations } from '../physics-joints';
import { PNG } from 'pngjs';
import { test, expect } from '@playwright/test';
import { comparisonHalf, readComparisonBitmap } from './comparison-bitmap';
const preview=`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;
for(const model of ['uka','gene'])test(`${model}: independent real physics, synchronized controls and native lifetime`,async({page},testInfo)=>{
  test.setTimeout(600000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let requests=0,models=0,assets=0;
  page.on('request',r=>{if(r.url().endsWith('/ammo.js'))requests++;if(/\.(pmx|glb|gltf|bin|png|jpe?g|bmp|tga|vmd)([?#]|$)/i.test(r.url()))assets++;if(/\.(pmx|glb|gltf)(\?|$)/.test(r.url()))models++;});
  await page.setViewportSize({width:1200,height:1000});
  await page.goto(`${preview}?demo=${model}`);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  const state=()=>page.evaluate(()=>(window as any).mmdExample);
  const pose=()=>page.evaluate(()=>(window as any).readMMDComparisonPose());
  const resources=()=>page.evaluate(()=>(window as any).readMMDComparisonResources());
  await expect(page.locator('#comparison-physics')).toBeEnabled();
  await expect(page.locator('#comparison-physics')).not.toBeChecked();
  expect(requests).toBe(0);expect((await resources()).physics.native).toBe(0);
  const initial=await resources(),fetches=models,assetFetches=assets;
  const seek=async(t:number)=>{
    await page.locator('#comparison-time').evaluate((e,t)=>{(e as HTMLInputElement).valueAsNumber=t;e.dispatchEvent(new Event('input',{bubbles:true}));},t);
    await expect.poll(async()=>(await state()).time,{timeout:90000}).toBe(t);
    await expect.poll(async()=>(await state()).execution.physicsState,{timeout:90000}).not.toBe('simulating');
  };
  const evidence:any[]=[];
  for(const motion of ['02_laugh','22_apology']) {
    await page.locator('#comparison-motion').selectOption(motion);
    if(model==='gene' && motion==='22_apology')await page.locator('#comparison-ik').uncheck();
    await seek(.5);
    const off=await pose(),pixelsOff=await readComparisonBitmap(page),time=(await state()).time;
    await page.locator('#comparison-physics').check();
    await expect.poll(async()=>(await state()).execution.physicsState,{timeout:90000}).toBe('on');
    expect((await state()).time).toBe(time);
    const on=await pose(),pixelsOn=await readComparisonBitmap(page);
    for(const half of [0,1])expect(comparisonHalf(pixelsOn,half).equals(comparisonHalf(pixelsOff,half))).toBe(false);
    const dynamic=Object.keys(on[0].bones).filter(name=>on[0].bones[name].rotation.some((v:number,k:number)=>Math.abs(v-off[0].bones[name].rotation[k])>1e-3));
    expect(dynamic.length).toBeGreaterThan(10);
    let maxPosition=0,maxRotation=0;
    for(const other of on.slice(1))for(const name of dynamic) {
      const a=on[0].bones[name],b=other.bones[name];
      maxPosition=Math.max(maxPosition,...a.world.map((v:number,k:number)=>Math.abs(v-b.world[k])));
      const dot=Math.abs(a.rotation.reduce((sum:number,v:number,k:number)=>sum+v*b.rotation[k],0));
      maxRotation=Math.max(maxRotation,2*Math.acos(Math.min(1,dot)));
    }
    const native=await page.evaluate(()=>(window as any).readMMDComparisonPhysics());
    const physicsDriven=native.binding.physics.bodies.filter((b:any)=>b.mode!==0 && b.bone!==-1).filter((body:any)=>{
      const name=native.binding.solver.bones.find((b:any)=>b.index===body.bone).name;
      return on[0].bones[name].rotation.some((v:number,k:number)=>Math.abs(v-off[0].bones[name].rotation[k])>1e-3);
    });
    expect(physicsDriven.length).toBeGreaterThan(10);
    let maxBodyDifference=0;
    for(const bodies of native.bodies.slice(1))for(const [key,values] of Object.entries(native.bodies[0]))
      maxBodyDifference=Math.max(maxBodyDifference,...(values as number[]).map((v,k)=>Math.abs(v-bodies[key][k])));
    const constraints:ReturnType<typeof jointViolations>[]=native.bodies.map((bodies:any)=>jointViolations(native.binding.physics,bodies));
    for(const [pane,errors] of constraints.entries())for(const error of errors) {
      const bounds=jointBounds(model,error.index);
      expect(error.linear,`${model} ${motion} pane ${pane} joint ${error.index} linear`).toBeLessThan(bounds.linear);
      expect(error.angular,`${model} ${motion} pane ${pane} joint ${error.index} angular`).toBeLessThan(bounds.angular);
    }
    const maxLinearViolation=Math.max(...constraints.flat().map(e=>e.linear));
    const maxAngularViolation=Math.max(...constraints.flat().map(e=>e.angular));
    expect(maxBodyDifference).toBeLessThan(1e-5);
    const pngOff=PNG.sync.read(pixelsOff),pngOn=PNG.sync.read(pixelsOn),pixelChanges=[0,0];
    for(let y=0;y<pngOn.height;y++)for(let x=0;x<pngOn.width;x++) {
      const at=(y*pngOn.width+x)*4;
      if([0,1,2].some(c=>Math.abs(pngOn.data[at+c]-pngOff.data[at+c])>2))pixelChanges[x<pngOn.width/2?0:1]++;
    }
    pixelChanges.forEach(count=>expect(count).toBeGreaterThan(100));
    for(const [label,pixels] of [['off',pixelsOff],['on',pixelsOn]] as const) {
      const path=testInfo.outputPath(`${model}-${motion}-${label}.png`);
      await writeFile(path,pixels);await testInfo.attach(`${model}-${motion}-${label}.png`,{path,contentType:'image/png'});
    }
    evidence.push({motion,frame:15,physicsDriven:physicsDriven.length,pixelChanges,maxBodyDifference,maxLinearViolation,maxAngularViolation,constraints,dynamic:dynamic.length,maxPosition,maxRotation,execution:(await state()).execution,resources:await resources()});
    expect(maxPosition).toBeLessThan(.015);expect(maxRotation).toBeLessThan(.1);
    const created=(await state()).execution.physicsStats.worldsCreated;
    await seek(.6);expect((await state()).execution.physicsStats.worldsCreated).toBe(created);
    // Frame-15 success alone missed Gene Apology's later cloak strain. Measure
    // every native joint in all three worlds around the reported frame 60.
    for(const time of [1.5,2,2.5]) {
      await seek(time);
      expect((await state()).execution.physicsState).toBe('on');
      expect((await state()).execution.physicsStats.worldsCreated).toBe(created);
      expect((await state()).execution.physicsStats.tick).toBe(time*120);
      const later=await page.evaluate(()=>(window as any).readMMDComparisonPhysics());
      const constraints:ReturnType<typeof jointViolations>[]=later.bodies.map((bodies:any)=>jointViolations(later.binding.physics,bodies));
      for(const [pane,errors] of constraints.entries())for(const error of errors) {
        const bounds=jointBounds(model,error.index);
        expect(error.linear,`${model} ${motion} frame ${time*30} pane ${pane} joint ${error.index} linear`).toBeLessThan(bounds.linear);
        expect(error.angular,`${model} ${motion} frame ${time*30} pane ${pane} joint ${error.index} angular`).toBeLessThan(bounds.angular);
      }
      evidence.push({motion,frame:time*30,constraints,execution:(await state()).execution});
    }
    await seek(.2);await seek(.5);expect(await pose()).toEqual(on);
    await page.locator('#comparison-ik').uncheck();
    await expect.poll(async()=>(await state()).execution.ik).toBe(false);
    expect((await state()).execution.physics).toBe(true);
    await expect.poll(async()=>(await state()).execution.physicsState,{timeout:90000}).toBe('on');
    const withoutIK=await page.evaluate(()=>(window as any).readMMDComparisonPhysics());
    for(const bodies of withoutIK.bodies)for(const error of jointViolations(withoutIK.binding.physics,bodies)) {
      expect(error.linear,`IK Off joint ${error.index} linear`).toBeLessThan(jointBounds(model,error.index).linear);
      expect(error.angular,`IK Off joint ${error.index} angular`).toBeLessThan(jointBounds(model,error.index).angular);
    }
    await page.locator('#comparison-ik').check();
    await expect.poll(async()=>(await state()).execution.ik).toBe(true);
    if(model==='gene' && motion==='22_apology') {
      await expect(page.locator('#comparison-physics')).toBeDisabled();
      await expect(page.locator('#comparison-physics')).not.toBeChecked();
      expect((await resources()).physics.native).toBe(0);
      await page.locator('#comparison-ik').uncheck();
      await expect(page.locator('#comparison-physics')).toBeEnabled();
      await page.locator('#comparison-physics').check();
    }
    await expect.poll(async()=>(await state()).execution.physicsState,{timeout:90000}).toBe('on');
    await page.locator('#material').selectOption('pbr');await readComparisonBitmap(page);
    await page.locator('#material').selectOption('toon');
    await page.locator('#comparison-physics').uncheck();
    expect((await resources()).physics.native).toBe(0);expect(await pose()).toEqual(off);
  }
  expect(requests).toBe(1);expect(models).toBe(fetches);expect(assets).toBe(assetFetches);
  expect((await resources()).roots).toEqual(initial.roots);
  for(let i=0;i<3;i++) {
    await page.locator('#comparison-physics').check();await expect.poll(async()=>(await state()).execution.physicsState).toBe('on');
    await page.locator('#comparison-physics').uncheck();expect((await resources()).physics.native).toBe(0);
  }
  await page.locator('#comparison-physics').check();await expect.poll(async()=>(await state()).execution.physicsState).toBe('on');
  await page.locator('#comparison-restart').click();await expect.poll(async()=>(await state()).time).toBe(0);
  expect((await state()).playing).toBe(false);
  await page.locator('#comparison-play').click();
  await expect.poll(async()=>(await state()).time,{timeout:30000}).toBeGreaterThan(.1);
  await page.locator('#comparison-play').click();
  await expect.poll(async()=>(await state()).execution.physicsState).toBe('on');
  const paused=(await state()).time;await page.waitForTimeout(150);expect((await state()).time).toBe(paused);
  await seek(.5);const a=await pose();
  await page.locator('#comparison-motion').selectOption('02_laugh');await seek(.5);
  await page.locator('#comparison-motion').selectOption('22_apology');await seek(.5);expect(await pose()).toEqual(a);
  await page.locator('#outlines').selectOption('off');await readComparisonBitmap(page);
  await page.locator('#outlines').selectOption('on');
  const cameras=(await state()).cameras;
  const canvas=page.locator('#viewport canvas'),box=(await canvas.boundingBox())!;
  await page.mouse.move(box.x+box.width/3,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/3+40,box.y+box.height/2+20,{steps:5});await page.mouse.up();
  await expect.poll(async()=>JSON.stringify((await state()).cameras)).not.toBe(JSON.stringify(cameras));
  await page.locator('#comparison-loop').check();await seek(9.9);
  const resets=(await state()).execution.physicsStats.resets;
  await page.locator('#comparison-play').click();
  await expect.poll(async()=>(await state()).execution.physicsStats.resets,{timeout:60000}).toBeGreaterThan(resets);
  await page.locator('#comparison-play').click();await seek(.5);expect(await pose()).toEqual(a);
  await page.locator('#comparison-motion').selectOption('rest');
  await expect.poll(async()=>(await state()).execution.physicsState).toBe('on');
  expect((await state()).time).toBe(0);await expect(page.locator('#comparison-play')).toBeDisabled();
  if(model==='uka')await page.locator('#expression').selectOption('blink');
  await page.locator('#comparison-physics').uncheck();expect((await resources()).physics.native).toBe(0);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  for(const id of ['comparison-ik','comparison-physics']) {const b=(await page.locator(`#${id}`).boundingBox())!;expect(b.x+b.width).toBeLessThanOrEqual(390);}
  expect(requests).toBe(1);expect(models).toBe(fetches);expect(assets).toBe(assetFetches);
  const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
  const memoryAfterGC=await resources();await cdp.detach();
  await testInfo.attach('real-physics-evidence.json',{body:JSON.stringify({model,browser:page.context().browser()?.version(),memoryAfterGC,evidence,errors,requests,models,assets,finalResources:await resources()}),contentType:'application/json'});
  await page.locator('#comparison-physics').check();await expect.poll(async()=>(await state()).execution.physicsState).toBe('on');
  await page.locator('#demo-model').selectOption(model==='uka'?'gene':'uka');
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  expect((await resources()).physics.native).toBe(0);await expect(page.locator('#comparison-physics')).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('Gene Apology gates Physics for the full clip with IK On and restores availability on control transitions',async({page})=>{
  test.setTimeout(180000);
  let backendRequests=0,modelRequests=0;
  page.on('request',r=>{if(r.url().endsWith('/ammo.js'))backendRequests++;if(/\.(pmx|glb|gltf)(\?|$)/.test(r.url()))modelRequests++;});
  await page.goto(`${preview}?demo=gene`);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  const state=()=>page.evaluate(()=>(window as any).mmdExample);
  const resources=()=>page.evaluate(()=>(window as any).readMMDComparisonResources());
  const pose=()=>page.evaluate(()=>(window as any).readMMDComparisonPose());
  const initial=await resources(),fetches=modelRequests;
  await page.locator('#comparison-motion').selectOption('22_apology');
  await expect(page.locator('#comparison-ik')).toBeChecked();
  const physics=page.locator('#comparison-physics');
  const unavailable=async()=>{
    await expect(physics).toBeDisabled();await expect(physics).not.toBeChecked();
    await expect(page.locator('#comparison-physics-status')).toContainText('Gene Apology with IK On exceeds joint accuracy limits');
    await expect(page.locator('#comparison-physics-status')).toContainText('Turn IK Off or choose another motion');
    expect((await state()).execution.physicsState).toBe('unavailable');
    expect((await state()).execution.physics).toBe(false);
    expect((await resources()).physics.native).toBe(0);
  };
  await unavailable();
  const seek=async(time:number)=>{
    const requested=await page.locator('#comparison-time').evaluate((e,t)=>{
      const input=e as HTMLInputElement;input.valueAsNumber=t;
      const accepted=input.valueAsNumber;input.dispatchEvent(new Event('input',{bubbles:true}));return accepted;
    },time);
    await expect.poll(async()=>(await state()).time,{timeout:60000}).toBe(requested);
    return requested;
  };
  // The combination is unavailable at every authored frame, not only at known
  // failing poses. Include forward/backward seeks and the endpoint before Ammo.
  for(let frame=0;frame<=300;frame++) {
    await seek(frame/30);
    await expect(physics).toBeDisabled();
  }
  for(const frame of [54,51,50,48,0]) {await seek(frame/30);await unavailable();}
  expect(backendRequests).toBe(0);
  await seek(1.5);
  await page.locator('#comparison-play').click();
  await expect.poll(async()=>(await state()).time).toBeGreaterThan(1.9);
  await page.locator('#comparison-play').click();await unavailable();
  await page.locator('#comparison-restart').click();expect((await state()).time).toBe(0);
  await page.locator('#comparison-loop').check();await seek(9.9);
  await page.locator('#comparison-play').click();
  await expect.poll(async()=>(await state()).time).toBeLessThan(1);
  await page.locator('#comparison-play').click();await unavailable();
  await seek(.5);const raw=await pose();
  await page.locator('#comparison-ik').uncheck();
  await expect(physics).toBeEnabled();await expect(physics).not.toBeChecked();
  await expect(page.locator('#comparison-physics-status')).toBeEmpty();
  await physics.check();
  await expect.poll(async()=>(await state()).execution.physicsState,{timeout:60000}).toBe('on');
  await page.locator('#comparison-ik').check();await unavailable();
  expect(await pose()).toEqual(raw);
  await page.locator('#comparison-motion').selectOption('02_laugh');
  await expect(physics).toBeEnabled();await expect(physics).not.toBeChecked();
  await physics.check();
  await expect.poll(async()=>(await state()).execution.physicsState,{timeout:60000}).toBe('on');
  await page.locator('#comparison-motion').selectOption('22_apology');await unavailable();
  await page.locator('#comparison-motion').selectOption('rest');
  await expect(physics).toBeEnabled();await expect(physics).not.toBeChecked();
  expect(backendRequests).toBe(1);expect(modelRequests).toBe(fetches);
  expect((await resources()).roots).toEqual(initial.roots);
});

for(const failure of ['missing','corrupt'])test(`public physics backend ${failure}: recover Off, retry, and unload`,async({page})=>{
  let requests=0;page.on('request',r=>{if(r.url().endsWith('/ammo.js'))requests++;});
  await page.route('**/runtime/ammo.js',route=>route.fulfill({status:failure==='missing'?404:200,contentType:'text/javascript',body:'globalThis.badAmmoExecuted=true;'}));
  await page.goto(`${preview}?demo=gene`);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await page.locator('#comparison-motion').selectOption('02_laugh');
  await page.locator('#comparison-physics').check();
  await expect(page.locator('#comparison-physics-status')).toContainText('Physics off:',{timeout:20000});
  await expect(page.locator('#comparison-physics')).not.toBeChecked();
  expect(await page.evaluate(()=>(window as any).badAmmoExecuted)).toBeUndefined();
  expect(await page.evaluate(()=>(window as any).readMMDComparisonResources().physics.native)).toBe(0);
  await page.locator('#comparison-play').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).mmdExample.time)).toBeGreaterThan(0);
  await page.locator('#comparison-play').click();
  await page.unroute('**/runtime/ammo.js');
  await page.locator('#comparison-physics').check();
  await expect.poll(()=>page.evaluate(()=>(window as any).mmdExample.execution.physicsState),{timeout:30000}).toBe('on');
  expect(requests).toBe(2);
  expect(await page.evaluate(()=>{
    const read=(window as any).readMMDComparisonResources;
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));
    return read().physics.native;
  })).toBe(0);
  await expect(page.locator('#viewport canvas')).toHaveCount(0);
});

test('pending backend enable can be cancelled without stale worlds or checked state',async({page})=>{
  let release!:()=>void;
  const held=new Promise<void>(resolve=>release=resolve);
  await page.route('**/runtime/ammo.js',async route=>{await held;await route.continue();});
  await page.goto(`${preview}?demo=gene`);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await page.locator('#comparison-physics').check();
  await expect(page.locator('#comparison-physics-status')).toContainText('Loading');
  await page.locator('#comparison-motion').selectOption('22_apology');
  await expect(page.locator('#comparison-physics')).not.toBeChecked();
  await expect(page.locator('#comparison-physics')).toBeDisabled();
  release();
  await expect.poll(()=>page.evaluate(()=>(window as any).mmdExample.execution.physicsState)).toBe('unavailable');
  expect(await page.evaluate(()=>(window as any).readMMDComparisonResources().physics.native)).toBe(0);
  await page.locator('#comparison-motion').selectOption('02_laugh');
  await expect.poll(()=>page.evaluate(()=>(window as any).mmdExample.execution.physicsState)).toBe('off');
  expect(await page.evaluate(()=>(window as any).readMMDComparisonResources().physics.native)).toBe(0);
  await page.locator('#comparison-physics').check();
  await expect.poll(()=>page.evaluate(()=>(window as any).mmdExample.execution.physicsState),{timeout:30000}).toBe('on');
});

for(const model of ['uka','gene'])test(`${model}: PBR cloth and hair pixels respond to physics in both clips`,async({page},testInfo)=>{
  await page.setViewportSize({width:1200,height:1000});
  await page.goto(`${preview}?demo=${model}`);
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await page.locator('#material').selectOption('pbr');
  const evidence=[];
  for(const motion of ['02_laugh','22_apology']) {
    await page.locator('#comparison-motion').selectOption(motion);
    if(model==='gene' && motion==='22_apology')await page.locator('#comparison-ik').uncheck();
    await page.locator('#comparison-time').evaluate(e=>{(e as HTMLInputElement).valueAsNumber=.5;e.dispatchEvent(new Event('input'));});
    const off=await page.evaluate(()=>(window as any).readMMDComparisonPose()),pixelsOff=await readComparisonBitmap(page);
    await page.locator('#comparison-physics').check();
    await expect.poll(()=>page.evaluate(()=>(window as any).mmdExample.execution.physicsState),{timeout:90000}).toBe('on');
    const on=await page.evaluate(()=>(window as any).readMMDComparisonPose()),pixelsOn=await readComparisonBitmap(page);
    const source=await page.evaluate(()=>(window as any).readMMDComparisonPhysics().binding);
    const changed=source.physics.bodies.filter((b:any)=>b.mode!==0 && b.bone!==-1).map((b:any)=>source.solver.bones[b.bone].name).filter((name:string)=>{
      const a=on[2].bones[name].rotation,b=off[2].bones[name].rotation;
      const dot=Math.abs(a.reduce((sum:number,v:number,k:number)=>sum+v*b[k],0))/Math.hypot(...a)/Math.hypot(...b);
      return 2*Math.acos(Math.min(1,dot))>1e-3;
    });
    expect(changed.length).toBeGreaterThan(10);
    const cameraState=await page.evaluate(()=>(window as any).mmdExample.cameras[1]);
    const camera=new PerspectiveCamera(cameraState[7],cameraState[6],.01,100);
    camera.position.fromArray(cameraState);camera.lookAt(new Vector3().fromArray(cameraState,3));camera.updateMatrixWorld(true);
    const a=PNG.sync.read(pixelsOff),b=PNG.sync.read(pixelsOn),region=new Set<number>();
    for(const name of changed) {
      const projected=new Vector3().fromArray(on[2].bones[name].world).project(camera);
      const x=Math.round(b.width/2+(projected.x*.5+.5)*b.width/2),y=Math.round((.5-projected.y*.5)*b.height);
      for(let dy=-20;dy<=20;dy++)for(let dx=-20;dx<=20;dx++) {
        const px=x+dx,py=y+dy;
        if(px>=b.width/2 && px<b.width && py>=0 && py<b.height)region.add((py*b.width+px)*4);
      }
    }
    let changedPixels=0;
    for(const index of region)if([0,1,2].some(c=>Math.abs(a.data[index+c]-b.data[index+c])>2))changedPixels++;
    expect(changedPixels).toBeGreaterThan(100);
    evidence.push({motion,frame:15,physicsDriven:changed.length,regionPixels:region.size,changedPixels});
    for(const [label,pixels] of [['off',pixelsOff],['on',pixelsOn]] as const) {
      const path=testInfo.outputPath(`${model}-${motion}-pbr-${label}.png`);
      await writeFile(path,pixels);await testInfo.attach(`${model}-${motion}-pbr-${label}.png`,{path,contentType:'image/png'});
    }
    await page.locator('#comparison-physics').uncheck();
    expect(await page.evaluate(()=>(window as any).readMMDComparisonResources().physics.native)).toBe(0);
  }
  await testInfo.attach('pbr-physics-evidence.json',{body:JSON.stringify({model,evidence}),contentType:'application/json'});
});
