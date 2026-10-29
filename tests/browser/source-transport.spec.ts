import { test, expect } from '@playwright/test';
import { convertModel, parsePMX } from '../../tools/pmx-to-gltf';
import { solverPMX, solverVMD } from '../../tools/synthetic-solver';

test('browser retains unsupported source and exact VMD while ordinary channels remain playable',async({page})=>{
  const model=parsePMX(solverPMX('box'));model.bones[0].flag=0x2000;model.bones[0].key=29;
  const r=await convertModel(model,'.',{mode:'bdef',solver:'pre-physics-v1',vmd:solverVMD('a'),vmdSampling:{maxSamples:1}});
  const out=await r.io.writeJSON(r.document),json=out.json as any;
  for(const b of json.buffers)b.uri='data:application/octet-stream;base64,'+Buffer.from(out.resources[b.uri]).toString('base64');
  const node=json.nodes.length;json.nodes.push({name:'unrelated'});json.scenes[0].nodes.push(node);
  const channel=structuredClone(json.animations[0].channels.find((c:any)=>c.target.path==='translation'));channel.target.node=node;json.animations[0].channels.push(channel);
  await page.route('**/source-transport-check.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Source transport test</title>'}));
  await page.goto('http://127.0.0.1:43179/mmd-gltf/source-transport-check.html');
  const result=await page.evaluate(async({json,moduleURL})=>{
    const module=await import(/* @vite-ignore */ moduleURL);
    return module.runSourceTransportBrowser(json);
  },{json,moduleURL:'/mmd-gltf/@fs'+process.cwd()+'/tests/source-transport-browser.ts'});
  expect(result.category).toBe('unsupported-capability');expect(result.version).toBe(3);expect(result.externalParent).toBe(29);
  expect(result.ordinaryTracks).toEqual(['unrelated.position']);expect(result.sourceBytes).toBe(Buffer.from(solverVMD('a')).toString('base64'));
  expect(result.diagnostics.some((d:any)=>d.code==='unresolved-external-parent')).toBe(true);
});
