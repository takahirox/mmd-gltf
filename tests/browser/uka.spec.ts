import { orbitComparison } from './comparison-camera';
import { readComparisonBitmap, comparisonHalf } from './comparison-bitmap';
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
test.use({ contextOptions: { reducedMotion: 'reduce' } });
const preview=`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;

function occupied(bytes: Buffer, half: number) {
  const png=PNG.sync.read(bytes); let count=0;
  for(let y=90;y<png.height-50;y++) for(let x=half*png.width/2+10;x<(half+1)*png.width/2-10;x++) {
    const i=(y*png.width+x)*4;
    if(Math.abs(png.data[i]-208)+Math.abs(png.data[i+1]-208)+Math.abs(png.data[i+2]-208)>30) count++;
  }
  return count;
}

test('default Uka: real PMX/converter glTF, visible expressions, Toon/PBR, Outline and shared camera',async({page},info)=>{
  await page.setViewportSize({width:1200,height:1000});
  const errors:string[]=[],assets=new Set<string>();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);if(r.url().includes('/uka/'))assets.add(new URL(r.url()).pathname);});
  page.on('requestfailed',r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  await page.goto(preview);
  await expect(page.locator('#demo-model')).toHaveValue('uka');
  await expect(page.locator('#viewport h2')).toHaveText(['MMD','glTF']);
  await expect(page.locator('#uka-features p, footer > p.method-note')).toHaveCount(0);
  await expect(page.locator('#about-demo')).not.toHaveAttribute('open');
  await expect(page.locator('#about-demo > p').first()).toBeHidden();
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await page.waitForFunction(()=>(window as any).mmdExample?.frames>3);
  await expect(page.locator('#expression')).toBeEnabled();
  await expect(page.locator('#expression option')).toHaveText(['Rest · A pose','Blink · まばたき','Smile · 笑い']);
  const state=()=>page.evaluate(()=>(window as any).mmdExample);
  expect(await state()).toMatchObject({model:'uka',meshes:13,reference:{loader:'MMDLoader',materials:13,scale:.08}});
  const s=await state(); expect(s.cameras[0]).toEqual(s.cameras[1]);
  for(const edge of ['min','max'])for(let axis=0;axis<3;axis++)expect(s.reference.bounds[edge][axis]).toBeCloseTo(s.gltf.bounds[edge][axis],5);
  for(const path of ['MS_Uka.pmx','model.gltf','model.bin','tex/face.png','tex/hair_s01.png'])expect(assets.has(`/mmd-gltf/uka/${path}`)).toBe(true);
  const capture=async()=>{await page.waitForTimeout(150);return readComparisonBitmap(page);};
  const rest=await capture();for(const half of [0,1])expect(occupied(rest,half)).toBeGreaterThan(5000);
  for(const expression of ['blink','smile']) {
    await page.locator('#expression').selectOption(expression);
    await expect.poll(async()=>(await state()).expression).toBe(expression);
    const posed=await capture();expect(posed.equals(rest)).toBe(false);
    // Require visible deformation independently in both panes, not merely changed text.
    const png=PNG.sync.read(posed),base=PNG.sync.read(rest);
    for(const half of [0,1]) {
      let changes=0;
      for(let y=90;y<png.height-50;y++)for(let x=half*png.width/2;x<(half+1)*png.width/2;x++) {
        const i=(y*png.width+x)*4;
        if(png.data[i]!==base.data[i]||png.data[i+1]!==base.data[i+1]||png.data[i+2]!==base.data[i+2])changes++;
      }
      expect(changes).toBeGreaterThan(50);
    }
  }
  const smilePath=info.outputPath('uka-smile.png');
  await writeFile(smilePath,await capture());
  await info.attach('uka-smile.png',{path:smilePath,contentType:'image/png'});
  const toon=comparisonHalf(await readComparisonBitmap(page),1);
  await page.locator('#material').selectOption('pbr');await expect(page.locator('#gene-status')).toContainText('PBR fallback');
  expect((comparisonHalf(await readComparisonBitmap(page),1)).equals(toon)).toBe(false);
  const on=await capture();
  const outlined=[comparisonHalf(on,0),comparisonHalf(on,1)];
  await page.locator('#outlines').selectOption('off');expect((await capture()).equals(on)).toBe(false);
  const withoutOutline=await capture();
  for(const i of [0,1])expect(comparisonHalf(withoutOutline,i).equals(outlined[i])).toBe(false);
  await page.locator('#outlines').selectOption('on');expect((await capture()).equals(on)).toBe(true);
  await page.locator('#expression').selectOption('rest');await page.locator('#material').selectOption('toon');
  expect((await capture()).equals(rest)).toBe(true);
  await orbitComparison(page);expect((await capture()).equals(rest)).toBe(false);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  const left=(await page.locator('#pmx-pane').boundingBox())!,right=(await page.locator('#gltf-pane').boundingBox())!;
  expect(left.width).toBe(right.width);expect(left.height).toBe(right.height);
  expect(left.x).toBe(right.x);expect(right.y).toBeGreaterThanOrEqual(left.y+left.height);
  for(const id of ['expression','material','outlines','comparison-ik'])await expect(page.locator(`#${id}`)).toBeEnabled();
  await page.locator('#demo-model').selectOption('gene');
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await expect(page.locator('#demo-model')).toBeEnabled({timeout:90000});
  expect((await state()).model).toBe('gene');
  await expect(page.locator('#viewport h2')).toHaveText(['MMD','glTF']);
  await expect(page.locator('#uka-features')).toBeHidden();await expect(page.locator('#viewport canvas')).toHaveCount(1);
  await page.locator('#demo-model').selectOption('uka');
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
  await expect(page.locator('#expression')).toBeEnabled();await expect(page.locator('#viewport canvas')).toHaveCount(1);
  await expect(page.locator('#viewport h2')).toHaveText(['MMD','glTF']);
  expect(errors).toEqual([]);
});

test('missing Uka texture fails visibly and retry recovers',async({page})=>{
  await page.route('**/uka/tex/face.png',r=>r.fulfill({status:404,body:'missing test image'}));
  await page.goto(preview);
  await expect(page.locator('#gene-status')).toContainText('Could not load/render the comparison',{timeout:90000});
  await expect(page.locator('#viewport canvas')).toHaveCount(0);
  await page.unroute('**/uka/tex/face.png');await page.locator('#demo-retry').click();
  await expect(page.locator('#gene-status')).toContainText('Ready',{timeout:90000});
});
