import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

export async function motionMetadata(model:string, motion='sample') {
  return JSON.parse(await readFile(`public/${model==='uka'?'uka':'gene-light'}/${motion==='sample'?'motion':`motion-${motion}`}.json`,'utf8'));
}

export async function expectMotionDuration(page:Page, metadata:{duration:number}, time=0) {
  const state=await page.evaluate(()=>(window as any).mmdExample);
  expect(state.duration).toBe(metadata.duration);
  expect(state.reference.duration).toBe(metadata.duration);
  expect(state.gltf.durations).toEqual([metadata.duration,metadata.duration]);
  expect(state.time).toBe(time);expect(state.referenceTime).toBe(time);expect(state.gltfTimes).toEqual([time,time]);
  await expect(page.locator('#comparison-time')).toHaveAttribute('max',String(metadata.duration));
  await expect(page.locator('#comparison-time-label')).toHaveText(`${time.toFixed(2)} / ${metadata.duration.toFixed(2)} s`);
}
