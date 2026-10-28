import { expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
/** Capture the actual two-pane render callback without repeated CSS-compositor work. */
export async function readComparisonBitmap(page:Page) {
  const actual=await page.evaluate(()=>(window as any).captureMMDComparisonCanvas());
  expect(actual.frame).toBeGreaterThan(0);
  const bytes=Buffer.from(actual.png.split(',')[1],'base64'),png=PNG.sync.read(bytes);
  const size=await page.locator('#viewport canvas').evaluate(element=>({width:(element as HTMLCanvasElement).width,height:(element as HTMLCanvasElement).height}));
  expect({width:png.width,height:png.height}).toEqual(size);
  return bytes;
}
/** Compare pane pixels independently; labels and controls are checked through the DOM. */
export function comparisonHalf(bytes:Buffer,half:number) {
  const png=PNG.sync.read(bytes),width=Math.floor(png.width/2),out=Buffer.alloc(width*png.height*4);
  for(let y=0;y<png.height;y++)png.data.copy(out,y*width*4,(y*png.width+half*width)*4,(y*png.width+(half+1)*width)*4);
  return out;
}
