import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

test('PMD sphere URL queries/fragments preserve material roles and actual request URLs', async ({ page }) => {
  const png = new PNG({ width: 1, height: 1 }); png.data.fill(255);
  const requests: string[] = [], statuses: number[] = [];
  await page.route('**/resource-path-harness.html', r => r.fulfill({ contentType: 'text/html', body: '<title>PMD sphere test</title>' }));
  await page.route('**/resource-path-fixtures/**', r => r.fulfill({ contentType: 'image/png', body: PNG.sync.write(png) }));
  page.on('request', r => { if (r.url().includes('/resource-path-fixtures/')) requests.push(r.url()); });
  page.on('response', r => { if (r.url().includes('/resource-path-fixtures/')) statuses.push(r.status()); });
  await page.goto('resource-path-harness.html');
  const result = await page.evaluate(async bytes => {
    const modulePath = '/mmd-gltf/mmd-loader-compat.ts';
    const { createMMDLoader } = await import(modulePath) as typeof import('../../examples/mmd-loader-compat');
    const loader = createMMDLoader();
    const data = loader._getParser().parsePmx(new Uint8Array(bytes).buffer, true);
    const builder = loader.meshBuilder.materialBuilder.setResourcePath('/mmd-gltf/resource-path-fixtures/');
    const base = `${location.origin}/mmd-gltf/resource-path-fixtures/base.png?name=.sph`;
    const spheres = ['sphere.sph?v=1#multiply', 'sphere.sph?v=2#multiply', 'sphere.SPA#add']
      .map(name => `${location.origin}/mmd-gltf/resource-path-fixtures/${name}`);
    const names = [...spheres, spheres[0]];
    const sourceNames = names.map(sphere => `${base}*${sphere}`);
    const pmd = { ...data, metadata: { ...data.metadata, format: 'pmd', materialCount: names.length },
      materials: sourceNames.map(fileName => ({ ...data.materials[0], fileName, toonIndex: -1, edgeFlag: 1 })),
      toonTextures: [] };
    const handlers: string[] = [];
    builder.manager.getHandler = url => { handlers.push(url); return null; };
    const geometry = loader.meshBuilder.geometryBuilder.build(data);
    const group = geometry.groups[0];
    geometry.clearGroups();
    names.forEach((_, i) => geometry.addGroup(group.start, group.count, i));
    const materials = builder.build(pmd, geometry);
    const textures = [...new Set(materials.flatMap(m => [m.map!, m.matcap!]))] as ReturnType<typeof builder._loadTexture>[];
    await Promise.all(textures.map(texture => new Promise<void>((resolve, reject) => {
      texture.readyCallbacks!.push(() => resolve()); texture.errorCallbacks!.push(reject);
    })));
    return { base, spheres, sourceNames, handlers,
      materials: materials.map(m => ({ base: (m.map!.image as HTMLImageElement).src,
        sphere: (m.matcap!.image as HTMLImageElement).src, operation: m.matcapCombine,
        original: m.userData.MMD.sourceFileName })),
      cached: materials[0].matcap === materials[3].matcap && materials.every(m => m.map === materials[0].map),
      dimensions: textures.map(t => { const image = t.image as HTMLImageElement; return [image.naturalWidth, image.naturalHeight]; }),
      unchanged: pmd.materials.every((m: { fileName: string }, i: number) => m.fileName === sourceNames[i]) };
  }, Array.from(readFileSync('tests/fixtures/bdef.pmx')));
  expect(result.cached).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.dimensions).toEqual(Array(4).fill([1, 1]));
  expect(result.materials).toEqual([...result.spheres, result.spheres[0]].map((sphere, i) => ({
    base: result.base, sphere, operation: i === 2 ? 2 : 0, original: result.sourceNames[i],
  })));
  expect(result.handlers.filter(url => !url.startsWith('data:'))).toEqual([result.base, ...result.spheres]);
  // Fragments remain in loader/cache URLs but are never sent in HTTP requests.
  expect(requests.sort()).toEqual([result.base, ...result.spheres].map(url => url.split('#')[0]).sort());
  expect(statuses).toEqual(Array(4).fill(200));
});

test('absolute TGA URLs retain queries in requests and decode using the pathname', async ({ page }) => {
  // One top-origin, uncompressed 24-bit TGA pixel (BGR).
  const tga = Buffer.alloc(21);
  tga[2] = 2; tga[12] = 1; tga[14] = 1; tga[16] = 24; tga[17] = 32;
  tga.set([0x33, 0x66, 0xcc], 18);
  const requests: string[] = [];
  await page.route('**/resource-path-harness.html', r => r.fulfill({ contentType: 'text/html', body: '<title>TGA test</title>' }));
  await page.route('**/resource-path-fixtures/*.tga?*', r => r.fulfill({ contentType: 'image/x-tga', body: tga }));
  page.on('request', r => { if (r.url().includes('/resource-path-fixtures/')) requests.push(r.url()); });
  await page.goto('resource-path-harness.html');
  const result = await page.evaluate(async () => {
    const modulePath = '/mmd-gltf/mmd-loader-compat.ts';
    const { createMMDLoader } = await import(modulePath) as typeof import('../../examples/mmd-loader-compat');
    const builder = createMMDLoader().meshBuilder.materialBuilder;
    const textures = {}, handlers: string[] = [];
    builder.manager.getHandler = url => { handlers.push(url); return null; };
    const urls = [1, 2].map(v => `${location.origin}/mmd-gltf/resource-path-fixtures/sphere.tga?v=${v}#texture`);
    const loaded = urls.map(url => builder._loadTexture(url, textures));
    const cached = builder._loadTexture(urls[0], textures) === loaded[0];
    await Promise.all(loaded.map(texture => new Promise<void>((resolve, reject) => {
      texture.readyCallbacks!.push(() => resolve()); texture.errorCallbacks!.push(reject);
    })));
    return { cached, handlers, urls, images: loaded.map(texture => {
      const image = texture.image as { width: number; height: number; data: Uint8Array };
      return { width: image.width, height: image.height, pixels: Array.from(image.data) };
    }) };
  });
  expect(result.cached).toBe(true);
  expect(result.handlers).toEqual(result.urls);
  expect(requests.sort()).toEqual(result.urls.map(url => url.split('#')[0]).sort());
  expect(result.images).toEqual(Array(2).fill({ width: 1, height: 1, pixels: [0xcc, 0x66, 0x33, 255] }));
});

test('direct MMDLoader requests canonical texture URLs before handler/cache lookup', async ({ page }) => {
  const requests: string[] = [], responses: number[] = [];
  const png = new PNG({ width: 1, height: 1 }); png.data.fill(255);
  const imageBytes = PNG.sync.write(png);
  await page.route('**/resource-path-harness.html', r => r.fulfill({ contentType: 'text/html', body: '<title>Resource path test</title>' }));
  await page.route('**/resource-path-fixtures/**', r => r.fulfill({ contentType: 'image/png', body: imageBytes }));
  page.on('request', r => { if (r.url().includes('/resource-path-fixtures/')) requests.push(r.url()); });
  page.on('response', r => { if (r.url().includes('/resource-path-fixtures/')) responses.push(r.status()); });
  await page.goto('resource-path-harness.html');
  const result = await page.evaluate(async dataURL => {
    const modulePath = '/mmd-gltf/mmd-loader-compat.ts';
    const { createMMDLoader } = await import(modulePath) as typeof import('../../examples/mmd-loader-compat');
    const builder = createMMDLoader().meshBuilder.materialBuilder.setResourcePath('/mmd-gltf/resource-path-fixtures/');
    const handlers: string[] = [], textures = {};
    builder.manager.getHandler = (url: string) => { handlers.push(url); return null; };
    const names = ['tex\\hair_s01.png', './tex/hair_s01.png', 'tex\\part/../hair_s01.png', 'tex\\日本 語.png', 'tex/%E6%97%A5%E6%9C%AC%20%E8%AA%9E.png'];
    names.push('tex/%25FF.png', 'tex/100%25ab.png', 'tex/%2525FF.png', './tex\\%25FF.png', 'tex\\100%25ab.png');
    const loaded = names.map(name => builder._loadTexture(name, textures));
    const toon = builder._loadTexture('toon01.bmp', textures, { isDefaultToonTexture: true, isToonTexture: true });
    const absolute = builder._loadTexture(`${location.origin}/mmd-gltf/resource-path-fixtures/absolute.png`, textures);
    const data = builder._loadTexture(dataURL, textures);
    await Promise.all([...new Set([...loaded, toon, absolute, data])].map(texture => new Promise<void>((resolve, reject) => {
      texture.readyCallbacks!.push(() => resolve()); texture.errorCallbacks!.push(reject);
    })));
    const rejected: string[] = [];
    for (const name of ['..\\escape.png', 'tex/../../escape.png', '%252e%252e/escape.png', 'tex/%5cescape.png',
      'tex/%25FF%252fescape.png', 'tex/%25FF%255cescape.png', 'tex/%25FF%2500.png', '%25252e%25252e/escape.png']) {
      try { builder._loadTexture(name, textures); } catch (error) { rejected.push(String(error)); }
    }
    return { handlers, rejected, dimensions: loaded.map(t => { const image = t.image as HTMLImageElement; return [image.width, image.height]; }),
      shared: loaded[0] === loaded[1] && loaded[1] === loaded[2] && loaded[3] === loaded[4]
        && loaded[5] === loaded[8] && loaded[6] === loaded[9], names };
  }, `data:image/png;base64,${imageBytes.toString('base64')}`);
  expect(result.shared).toBe(true);
  expect(result.dimensions).toEqual(Array(result.names.length).fill([1, 1]));
  expect(result.rejected).toHaveLength(8);
  expect(result.names[0]).toBe('tex\\hair_s01.png');
  expect(result.handlers.slice(0, 2)).toEqual(['/mmd-gltf/resource-path-fixtures/tex/hair_s01.png', '/mmd-gltf/resource-path-fixtures/tex/%E6%97%A5%E6%9C%AC%20%E8%AA%9E.png']);
  expect(result.handlers.slice(2, 5)).toEqual([
    '/mmd-gltf/resource-path-fixtures/tex/%25FF.png',
    '/mmd-gltf/resource-path-fixtures/tex/100%25ab.png',
    '/mmd-gltf/resource-path-fixtures/tex/%2525FF.png',
  ]);
  expect(requests.map(url => new URL(url).pathname).sort()).toEqual([
    '/mmd-gltf/resource-path-fixtures/absolute.png',
    '/mmd-gltf/resource-path-fixtures/tex/%E6%97%A5%E6%9C%AC%20%E8%AA%9E.png',
    '/mmd-gltf/resource-path-fixtures/tex/%25FF.png',
    '/mmd-gltf/resource-path-fixtures/tex/100%25ab.png',
    '/mmd-gltf/resource-path-fixtures/tex/%2525FF.png',
    '/mmd-gltf/resource-path-fixtures/tex/hair_s01.png',
  ].sort());
  expect(responses).toEqual(Array(6).fill(200));
});

for (const status of [404, 200]) test(`canonical request failure retains diagnostics for HTTP ${status}${status === 200 ? ' with corrupt image' : ''}`, async ({ page }) => {
  await page.route('**/resource-path-harness.html', r => r.fulfill({ contentType: 'text/html', body: '<title>Image failure</title>' }));
  await page.route('**/resource-path-fixtures/**', r => r.fulfill({ status, contentType: 'image/png', body: 'invalid image bytes' }));
  await page.goto('resource-path-harness.html');
  const response = page.waitForResponse(r => r.url().endsWith('/tex/failed.png'));
  const failure = await page.evaluate(async () => {
    const modulePath = '/mmd-gltf/mmd-loader-compat.ts';
    const { createMMDLoader } = await import(modulePath) as typeof import('../../examples/mmd-loader-compat');
    const builder = createMMDLoader().meshBuilder.materialBuilder.setResourcePath('/mmd-gltf/resource-path-fixtures/');
    return new Promise<string>(resolve => {
      builder.manager.onError = resolve;
      builder._loadTexture('tex\\failed.png', {});
    });
  });
  expect(failure).toBe('/mmd-gltf/resource-path-fixtures/tex/failed.png');
  expect((await response).status()).toBe(status);
});

test('browser request errors report the canonical resource URL', async ({ page }) => {
  await page.route('**/resource-path-harness.html', r => r.fulfill({ contentType: 'text/html', body: '<title>Request failure</title>' }));
  await page.route('**/resource-path-fixtures/**', r => r.abort('failed'));
  await page.goto('resource-path-harness.html');
  const requestFailed = page.waitForEvent('requestfailed', r => r.url().endsWith('/tex/failed.png'));
  const diagnostic = await page.evaluate(async () => {
    const modulePath = '/mmd-gltf/mmd-loader-compat.ts';
    const { createMMDLoader } = await import(modulePath) as typeof import('../../examples/mmd-loader-compat');
    const builder = createMMDLoader().meshBuilder.materialBuilder.setResourcePath('/mmd-gltf/resource-path-fixtures/');
    return new Promise<string>(resolve => {
      builder.manager.onError = resolve;
      builder._loadTexture('tex\\failed.png', {});
    });
  });
  const request = await requestFailed;
  expect(new URL(request.url()).pathname).toBe(diagnostic);
  expect(request.failure()?.errorText).toContain('ERR_FAILED');
});
