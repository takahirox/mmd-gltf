import { orbitComparison } from './comparison-camera';
import { readComparisonBitmap, comparisonHalf } from './comparison-bitmap';
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
test.use({ contextOptions: { reducedMotion: 'reduce' } });
const preview=`http://127.0.0.1:${process.env.MMD_PREVIEW_PORT || 43180}/mmd-gltf/`;

test('pinned Uka cold/warm loads decode direct PMX images at canonical request URLs', async ({ page, browser }, info) => {
  const requests: { path: string; type: string }[] = [], responses: { path: string; status: number }[] = [];
  page.on('request', r => { if (r.url().includes('/uka/tex/')) requests.push({ path: new URL(r.url()).pathname, type: r.resourceType() }); });
  page.on('response', r => { if (r.url().includes('/uka/tex/')) responses.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  for (const cache of ['cold', 'warm']) {
    requests.length = 0; responses.length = 0;
    if (cache === 'cold') await page.goto(preview); else await page.reload();
    await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
    await expect(page.locator('#pmx-status')).toContainText('Ready');
    await expect(page.locator('#gltf-status')).toContainText('Ready');
    const hair = '/mmd-gltf/uka/tex/hair_s01.png';
    // ImageLoader requests distinguish the direct PMX pane from glTF's fetches.
    expect(requests).toContainEqual({ path: hair, type: 'image' });
    expect(responses).toContainEqual({ path: hair, status: 200 });
    expect(requests.length).toBeGreaterThanOrEqual(9);
    for (const { path } of requests) expect(path).not.toMatch(/\\|%5c|\/\//i);
    for (const response of responses) expect(response.status).toBe(200);
    const textures = await page.evaluate(() => (window as any).readMMDComparisonResources().referenceTextures);
    const hairImage = textures.find((texture: { sourceName: string }) => texture.sourceName === 'tex\\hair_s01.png');
    expect(hairImage).toBeDefined();
    expect(hairImage.width).toBeGreaterThan(0);
    expect(hairImage.height).toBeGreaterThan(0);
    await info.attach(`uka-textures-${cache}.json`, { contentType: 'application/json',
      body: JSON.stringify({ browser: browser.version(), cache, requests, responses, hairImage }) });
  }
});

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
  await expect(page.locator('footer > p.method-note')).toHaveCount(0);
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
  await page.locator('#outlines').uncheck();expect((await capture()).equals(on)).toBe(false);
  const withoutOutline=await capture();
  for(const i of [0,1])expect(comparisonHalf(withoutOutline,i).equals(outlined[i])).toBe(false);
  await page.locator('#outlines').check();expect((await capture()).equals(on)).toBe(true);
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

for (const failure of ['missing', 'corrupt', 'request', 'unsafe path'] as const)
test(`${failure} Uka texture fails visibly and retry recovers`, async ({ page }) => {
  const route = failure === 'unsafe path' ? '**/uka/MS_Uka.pmx' : '**/uka/tex/face.png';
  if (failure === 'unsafe path') {
    // Keep the PMX binary layout intact while introducing an unsafe local name.
    const bytes = Buffer.from(readFileSync('public/uka/MS_Uka.pmx'));
    const original = 'tex\\hair_s01.png';
    const offset = bytes.indexOf(Buffer.from(original, 'utf16le'));
    expect(offset).toBeGreaterThan(0);
    const unsafe = '..\\' + 'x'.repeat(original.length - 7) + '.png';
    expect(unsafe.length).toBe(original.length);
    bytes.set(Buffer.from(unsafe, 'utf16le'), offset);
    await page.route(route, r => r.fulfill({ contentType: 'application/octet-stream', body: bytes }));
  } else {
    await page.route(route, r => failure === 'request' ? r.abort('failed') : r.fulfill({
      status: failure === 'missing' ? 404 : 200, contentType: 'image/png', body: 'invalid test image',
    }));
  }
  await page.goto(preview);
  await expect(page.locator('#gene-status')).toContainText('Could not load/render the comparison', { timeout: 90000 });
  await expect(page.locator('#gene-status')).toContainText(failure === 'unsafe path'
    ? 'Unsafe relative texture path' : 'PMX resource failed:');
  await expect(page.locator('#viewport canvas')).toHaveCount(0);
  for (const id of ['expression', 'material', 'outlines', 'comparison-camera-reset']) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await expect(page.locator('#demo-retry')).toBeVisible();
  await expect(page.locator('#about-demo')).not.toHaveAttribute('open');
  await page.unroute(route);
  await page.locator('#demo-retry').click();
  await expect(page.locator('#gene-status')).toContainText('Ready', { timeout: 90000 });
  await expect(page.locator('#pmx-status')).toContainText('Ready');
  await expect(page.locator('#gltf-status')).toContainText('Ready');
});
