import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { comparisonHalf } from '../tests/browser/comparison-bitmap';

// Read-only browser investigation. Defaults write outside tracked evidence;
// pass an output directory to retain a particular deployment observation.
const url=process.argv[2]??'https://takahirox.github.io/mmd-gltf/';
const output=process.argv[3]??'.cache/deployed-timeline';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHROMIUM_CHANNEL||'chrome',headless:true,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const observations:unknown[]=[];
const evidence={url,checkedAt:new Date().toISOString(),browser:browser.version(),observations};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
try {
  for(const model of ['uka','gene']) {
    const context=await browser.newContext({viewport:{width:1200,height:1000}}),page=await context.newPage();
    const cdp=await context.newCDPSession(page);
    await cdp.send('Network.enable');await cdp.send('Network.clearBrowserCache');
    let cacheHits=0;cdp.on('Network.requestServedFromCache',()=>cacheHits++);
    for(const pass of ['cold','warm']) {
      cacheHits=0;
      const bundles:Promise<{url:string;sha256?:string;error?:string}>[]=[];
      const listener=(response:import('@playwright/test').Response)=>{
        if(response.ok() && /\/assets\/.*\.js$/.test(response.url()))bundles.push(response.body().then(
          bytes=>({url:response.url(),sha256:hash(bytes)}),error=>({url:response.url(),error:String(error)})));
      };
      page.on('response',listener);
      await page.goto(`${url}?demo=${model}`,{timeout:120000});
      await page.locator('#gene-status').filter({hasText:'Ready'}).waitFor({timeout:180000});
      page.off('response',listener);
      const loadedBundles=await Promise.all(bundles);
      for(const bundle of loadedBundles)assert.ok(!bundle.error,bundle.error);
      for(const motion of ['sample','02_laugh','22_apology']) {
        await page.locator('#comparison-motion').selectOption(motion);
        const metadata=await page.evaluate(async({model,motion})=>await (await fetch(`${model==='uka'?'uka':'gene-light'}/${motion==='sample'?'motion':`motion-${motion}`}.json`)).json(),{model,motion});
        const samples=[];
        for(const time of [9,9.9,10]) {
          await page.locator('#comparison-time').evaluate((element,time)=>{
            (element as HTMLInputElement).valueAsNumber=time;element.dispatchEvent(new Event('input',{bubbles:true}));
          },time);
          const capture=await page.evaluate(()=>(window as any).captureMMDComparisonCanvas());
          const png=Buffer.from(capture.png.split(',')[1],'base64');
          samples.push({time,halves:[0,1].map(half=>hash(comparisonHalf(png,half)))});
        }
        const state=await page.evaluate(()=>{
          const info=(window as any).mmdExample;
          return {max:document.querySelector<HTMLInputElement>('#comparison-time')!.max,
            label:document.querySelector<HTMLOutputElement>('#comparison-time-label')!.value,
            duration:info.duration,referenceDuration:info.reference.duration,gltfDurations:info.gltf.durations,
            time:info.time,referenceTime:info.referenceTime,gltfTimes:info.gltfTimes};
        });
        assert.equal(metadata.duration,10);assert.equal(state.max,'10');assert.equal(state.label,'10.00 / 10.00 s');
        assert.deepEqual([state.duration,state.referenceDuration,...state.gltfDurations],[10,10,10,10]);
        assert.deepEqual([state.time,state.referenceTime,...state.gltfTimes],[10,10,10,10]);
        for(const sample of samples.slice(0,2))for(const half of [0,1])assert.notEqual(sample.halves[half],samples[2].halves[half]);
        const screenshot=`${model}-${motion}-${pass}.png`;await page.screenshot({path:`${output}/${screenshot}`});
        observations.push({model,motion,pass,metadata:{duration:metadata.duration,sha256:metadata.sha256,path:metadata.path},state,samples,screenshot,bundles:loadedBundles,cacheHits});
        await writeFile(`${output}/deployed.json`,JSON.stringify(evidence,null,2)+'\n');
        console.log(model,motion,pass,state.max,state.label);
      }
    }
    await context.close();
  }
} finally {await browser.close();}
