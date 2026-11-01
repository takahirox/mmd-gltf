import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, release } from 'node:os';
const base=`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || 'chrome',headless:true,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const rows:object[]=[];
try {
  for(const model of ['uka','gene']) {
    const context=await browser.newContext({viewport:{width:1200,height:1000}});
    try {
      for(const cache of ['cold','warm']) {
        const page=await context.newPage(),cdp=await context.newCDPSession(page);
        let timeDomain='threadTicks';
        try {await cdp.send('Performance.enable',{timeDomain:'threadTicks'});}
        catch {timeDomain='timeTicks';await cdp.send('Performance.enable');}
        const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
        const memory=async()=>{await cdp.send('HeapProfiler.collectGarbage');return cdp.send('Runtime.getHeapUsage');};
        const resources=()=>page.evaluate(()=>(window as any).readMMDComparisonResources());
        const errors:string[]=[];let backendRequests=0;
        page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/ammo.js'))backendRequests++;});
        const before=await metrics(),start=performance.now();
        await page.goto(`${base}?demo=${model}`);
        await page.locator('#gene-status').filter({hasText:'Ready'}).waitFor({timeout:90000});
        await page.evaluate(()=>(window as any).captureMMDComparisonCanvas());
        const readyMS=performance.now()-start,after=await metrics();
        const off={resources:await resources(),heap:await memory(),backendRequests};
        if(off.resources.physics.native || backendRequests)throw new Error('Default Off allocated/requested physics');
        const row:Record<string,unknown>={model,cache,timeDomain,readyMS,
          loadCPUSeconds:{thread:after.ThreadTime-before.ThreadTime,tasks:after.TaskDuration-before.TaskDuration},off};
        if(cache==='cold') {
          await page.locator('#comparison-motion').selectOption('02_laugh');
          await page.locator('#comparison-time').evaluate(e=>{(e as HTMLInputElement).valueAsNumber=.5;e.dispatchEvent(new Event('input'));});
          const a=await metrics();
          await page.locator('#comparison-physics').check();
          await page.waitForFunction(()=>['on','error'].includes((window as any).mmdExample.execution.physicsState),{},{timeout:90000});
          if(await page.evaluate(()=>(window as any).mmdExample.execution.physicsState)!=='on')throw new Error(await page.locator('#comparison-physics-status').innerText());
          const b=await metrics();
          row.on={resources:await resources(),heap:await memory(),backendRequests,
            CPUSeconds:{thread:b.ThreadTime-a.ThreadTime,tasks:b.TaskDuration-a.TaskDuration}};
          await page.locator('#comparison-physics').uncheck();
          row.afterOff={resources:await resources(),heap:await memory(),backendRequests};
          if((await resources()).physics.native)throw new Error('Off retained native handles');
        }
        row.errors=errors;rows.push(row);
        await cdp.detach();await page.close();
      }
    } finally {await context.close();}
  }
  await mkdir('.cache',{recursive:true});
  await writeFile('.cache/public-physics-resources.json',JSON.stringify({environment:{platform:process.platform,release:release(),cpu:cpus()[0]?.model,browser:browser.version(),renderer:'ANGLE SwiftShader, WebGL2; desktop, not Android'},rows},null,2)+'\n');
  console.log('Saved .cache/public-physics-resources.json (cold/warm default Off, eligible On, teardown, CPU thread ticks and CDP heaps).');
} finally {await browser.close();}
