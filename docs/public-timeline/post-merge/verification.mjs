import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

const url='https://takahirox.github.io/mmd-gltf/';
const output='docs/public-timeline/post-merge';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const evidence={url,checkedAt:new Date().toISOString(),browser:browser.version(),observations:[]};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try {
  for(const model of ['uka','gene']) {
    const context=await browser.newContext({viewport:{width:1200,height:1000}});
    const page=await context.newPage();
    const cdp=await context.newCDPSession(page);
    await cdp.send('Network.enable');await cdp.send('Network.clearBrowserCache');
    let cacheHits=0;cdp.on('Network.requestServedFromCache',()=>cacheHits++);
    const resources=[];page.on('request',r=>resources.push(r.url()));
    const bundles=new Map();const pending=[];
    page.on('response',r=>{if(r.ok() && /\/assets\/.*\.js$/.test(r.url()))pending.push(r.body().then(b=>bundles.set(r.url(),hash(b))));});
    const state=()=>page.evaluate(()=>{
      const i=window.mmdExample;
      return {model:i.model,motion:i.motion,duration:i.duration,time:i.time,playing:i.playing,
        referenceDuration:i.reference.duration,referenceTime:i.referenceTime,gltfDurations:i.gltf.durations,gltfTimes:i.gltfTimes,
        max:document.querySelector('#comparison-time').max,label:document.querySelector('#comparison-time-label').value,
        provenance:document.querySelector('#comparison-duration-details').textContent,
        status:['gene','pmx','gltf'].map(id=>document.querySelector(`#${id}-status`).textContent)};
    });
    const synchronized=s=>{
      assert.deepEqual([s.referenceTime,...s.gltfTimes],[s.time,s.time,s.time]);
      assert.deepEqual([s.duration,s.referenceDuration,...s.gltfDurations],[10,10,10,10]);
    };
    const seek=async time=>{
      await page.locator('#comparison-time').evaluate((e,t)=>{e.valueAsNumber=t;e.dispatchEvent(new Event('input',{bubbles:true}));},time);
      const s=await state();assert.ok(Math.abs(s.time-time)<1e-10);synchronized(s);return s;
    };
    const click=selector=>page.locator(selector).evaluate(e=>e.click());
    for(const pass of ['cold','warm','mobile']) {
      cacheHits=0;
      await page.setViewportSize({width:pass==='mobile'?390:1200,height:pass==='mobile'?844:1000});
      if(pass!=='mobile')await page.goto(`${url}?demo=${model}`,{timeout:120000});
      await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:180000});
      const resourceStart=resources.length;
      for(const motion of ['sample','02_laugh','22_apology']) {
        await page.locator('#comparison-motion').selectOption(motion);
        await page.locator('#comparison-loop').uncheck();
        const metadata=await page.evaluate(async({model,motion})=>await(await fetch(`${model==='uka'?'uka':'gene-light'}/${motion==='sample'?'motion':`motion-${motion}`}.json`)).json(),{model,motion});
        assert.equal(metadata.duration,10);
        const samples=[];
        for(const time of [299/30,10]) {
          await seek(time);
          const capture=await page.evaluate(()=>window.captureMMDComparisonCanvas());
          const bounds=await page.evaluate(()=>{
            const viewport=document.querySelector('#viewport'),canvas=viewport.querySelector('canvas'),container=viewport.getBoundingClientRect();
            const sx=canvas.width/viewport.clientWidth,sy=canvas.height/viewport.clientHeight;
            return ['pmx','gltf'].map(id=>{
              const r=document.querySelector(`#${id}-pane`).getBoundingClientRect();
              const x=Math.max(0,Math.ceil((r.left-container.left)*sx)),y=Math.max(0,Math.ceil(canvas.height-(r.bottom-container.top)*sy));
              return {x,y,width:Math.min(canvas.width,Math.floor((r.right-container.left)*sx))-x,height:Math.min(canvas.height,Math.floor(canvas.height-(r.top-container.top)*sy))-y};
            });
          });
          const png=PNG.sync.read(Buffer.from(capture.png.split(',')[1],'base64'));
          samples.push({time,panes:bounds.map(b=>{
            assert.ok(b.width>0 && b.height>0);
            const crop=new PNG({width:b.width,height:b.height});PNG.bitblt(png,crop,b.x,b.y,b.width,b.height,0,0);return {bounds:b,sha256:hash(crop.data)};
          })});
        }
        for(const pane of [0,1])assert.notEqual(samples[0].panes[pane].sha256,samples[1].panes[pane].sha256);
        const endpoint=await state();synchronized(endpoint);assert.equal(endpoint.max,'10');assert.equal(endpoint.label,'10.00 / 10.00 s');
        assert.match(endpoint.provenance,/10\.00 s from the original VMD \(last frame 300; 30 frames\/s\)/);
        for(const status of endpoint.status)assert.match(status,/Ready/);
        const screenshot=`${model}-${motion}-${pass}.png`;await page.screenshot({path:`${output}/${screenshot}`});
        await seek(9.9);await click('#comparison-play');
        await expect.poll(async()=>(await state()).time,{timeout:30000}).toBe(10);
        const held=await state();assert.equal(held.playing,false);synchronized(held);
        await page.waitForTimeout(150);assert.equal((await state()).time,10);
        await click('#comparison-restart');assert.equal((await state()).time,0);
        await page.locator('#comparison-loop').check();await seek(9.9);await click('#comparison-play');
        await expect.poll(async()=>(await state()).time,{timeout:30000}).toBeLessThan(5);
        await click('#comparison-play');const looped=await state();assert.equal(looped.playing,false);synchronized(looped);
        await page.waitForTimeout(150);assert.equal((await state()).time,looped.time);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),pass==='mobile'?390:1200);
        const slider=await page.locator('#comparison-time').boundingBox();assert.ok(slider.x>=0 && slider.x+slider.width<=(pass==='mobile'?390:1200));
        evidence.observations.push({model,motion,pass,viewport:page.viewportSize(),metadata:{duration:metadata.duration,path:metadata.path,sha256:metadata.sha256},endpoint,samples,screenshot,cacheHits,transport:{held,looped,restartTime:0,pauseStable:true,finalPoseHeld:true}});
        await writeFile(`${output}/browser.json`,JSON.stringify(evidence,null,2)+'\n');
        console.log(model,motion,pass,'passed');
      }
      assert.deepEqual(resources.slice(resourceStart).filter(u=>/ammo|bullet|\.(pmx|png|glb|gltf|vmd)(?:\?|$)/i.test(u)),[]);
      if(pass==='warm')assert.ok(cacheHits>0,'warm reload must serve assets from cache');
    }
    await Promise.all(pending);evidence[`${model}Bundles`]=Object.fromEntries(bundles);
    await context.close();
  }
} finally {await browser.close();await writeFile(`${output}/browser.json`,JSON.stringify(evidence,null,2)+'\n');}
