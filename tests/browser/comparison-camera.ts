import { type Page, expect } from '@playwright/test';
/** Reproducible real OrbitControls gestures under the reduced-motion preference.
 * No application camera setters or test-specific runtime controls. */
export async function orbitComparison(page:Page, quarterTurns=1) {
  expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const rect=(await page.locator('#viewport canvas').boundingBox())!;
  const before=await page.evaluate(()=>(window as any).mmdExample.cameras[0]);
  const start=rect.x+rect.width*.5, y=rect.y+rect.height*.5;
  await page.mouse.move(start,y);await page.mouse.down();
  await page.mouse.move(start-rect.height*quarterTurns/4,y,{steps:12});await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>(window as any).mmdExample.cameras[0])).not.toEqual(before);
  const cameras=await page.evaluate(()=>(window as any).mmdExample.cameras);
  expect(cameras[0]).toEqual(cameras[1]);
}
