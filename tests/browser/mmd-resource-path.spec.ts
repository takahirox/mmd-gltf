import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

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
    const loaded = names.map(name => builder._loadTexture(name, textures));
    const toon = builder._loadTexture('toon01.bmp', textures, { isDefaultToonTexture: true, isToonTexture: true });
    const absolute = builder._loadTexture(`${location.origin}/mmd-gltf/resource-path-fixtures/absolute.png`, textures);
    const data = builder._loadTexture(dataURL, textures);
    await Promise.all([...new Set([...loaded, toon, absolute, data])].map(texture => new Promise<void>((resolve, reject) => {
      texture.readyCallbacks!.push(() => resolve()); texture.errorCallbacks!.push(reject);
    })));
    const rejected: string[] = [];
    for (const name of ['..\\escape.png', 'tex/../../escape.png', '%252e%252e/escape.png', 'tex/%5cescape.png']) {
      try { builder._loadTexture(name, textures); } catch (error) { rejected.push(String(error)); }
    }
    return { handlers, rejected, dimensions: loaded.map(t => { const image = t.image as HTMLImageElement; return [image.width, image.height]; }),
      shared: loaded[0] === loaded[1] && loaded[1] === loaded[2] && loaded[3] === loaded[4], names };
  }, `data:image/png;base64,${imageBytes.toString('base64')}`);
  expect(result.shared).toBe(true);
  expect(result.dimensions).toEqual(Array(5).fill([1, 1]));
  expect(result.rejected).toHaveLength(4);
  expect(result.names[0]).toBe('tex\\hair_s01.png');
  expect(result.handlers.slice(0, 2)).toEqual(['/mmd-gltf/resource-path-fixtures/tex/hair_s01.png', '/mmd-gltf/resource-path-fixtures/tex/%E6%97%A5%E6%9C%AC%20%E8%AA%9E.png']);
  expect(requests.map(url => new URL(url).pathname).sort()).toEqual([
    '/mmd-gltf/resource-path-fixtures/absolute.png',
    '/mmd-gltf/resource-path-fixtures/tex/%E6%97%A5%E6%9C%AC%20%E8%AA%9E.png',
    '/mmd-gltf/resource-path-fixtures/tex/hair_s01.png',
  ]);
  expect(responses).toEqual([200, 200, 200]);
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
