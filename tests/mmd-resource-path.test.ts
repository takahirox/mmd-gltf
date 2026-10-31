import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DataTexture, LoadingManager, Texture } from 'three';
import { Parser } from 'mmd-parser';
import { MMDLoader } from '@takahirox/three-mmd/loaders/MMDLoader.js';
import { createMMDLoader } from '../examples/mmd-loader-compat';
import { resolveMMDResourcePath as resolve } from '../packages/mmd-resource-path';

test('upstream patch ships the same resolver used by the temporary shim', () => {
  const patch = readFileSync('patches/three-mmd-loader-resource-path.patch', 'utf8');
  const helper = patch.split('+++ b/src/loaders/MMDResourcePath.ts\n')[1].split('diff --git')[0];
  const source = helper.split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n') + '\n';
  assert.equal(source, readFileSync('packages/mmd-resource-path.ts', 'utf8'));
});

test('portable resource names, safe relative segments and URL encoding', () => {
  for (const path of ['tex\\hair_s01.png', 'tex/hair_s01.png', 'tex\\/hair_s01.png', './tex//part/../hair_s01.png', 'tex/%2e/hair_s01.png'])
    assert.equal(resolve('/mmd-gltf/uka/', path), '/mmd-gltf/uka/tex/hair_s01.png');
  assert.equal(resolve('https://example.com/models/uka///', 'tex\\hair_s01.png'), 'https://example.com/models/uka/tex/hair_s01.png');
  assert.equal(resolve('/models/uka', 'tex\\日本 語😀.png'), '/models/uka/tex/%E6%97%A5%E6%9C%AC%20%E8%AA%9E%F0%9F%98%80.png');
  assert.equal(resolve('/uka/', 'tex/a%20b%23c.png'), '/uka/tex/a%20b%23c.png');
  assert.equal(resolve('/uka/', 'tex/a b#c?.png'), '/uka/tex/a%20b%23c%3F.png');
  assert.equal(resolve(undefined, 'tex\\a.png'), 'tex/a.png');
  for (const url of ['https://example.com/日本%20語.png?q=1#x', '//example.com/a.png', '/textures/a.png', 'file:///tmp/a.png', 'custom-texture://host/image', 'data:image/png;base64,AAAA', 'data:image/svg+xml,<svg>\\</svg>', 'blob:https://example.com/id'])
    assert.equal(resolve('/uka/', url), url);
});

test('unsafe resource names fail before fetching, including encoded traversal', () => {
  for (const path of ['', '.', '..\\hair.png', 'tex\\..\\..\\hair.png', '../hair.png', 'tex/%2e%2e/%2e%2e/hair.png', '%252e%252e/hair.png', 'tex/%2f..%2fimage.png', 'tex/%5c..%5cimage.png', 'tex/%255cimage.png', 'C:\\tex\\hair.png', '\\\\host\\share.png', 'tex/bad%zz.png', 'tex/\u0000hair.png', 'tex/\nhair.png'])
    assert.throws(() => resolve('/uka/', path), /Unsafe relative texture path/, path);
});

test('cache/handler lookup, TGA selection, default toon and failure callbacks use resolved paths', () => {
  const manager = new LoadingManager(), loader = createMMDLoader(manager);
  const builder = loader.meshBuilder.materialBuilder.setResourcePath('/uka/');
  const paths: string[] = [], handlers: string[] = [];
  let fail: ((error: unknown) => void) | undefined;
  builder.textureLoader.load = (path, _loaded, _progress, onError) => { paths.push(path); fail = onError; return new Texture(); };
  manager.getHandler = path => { handlers.push(path); return null; };
  const textures = {};
  const first = builder._loadTexture('tex\\hair.png', textures);
  assert.equal(builder._loadTexture('./tex/hair.png', textures), first);
  assert.deepEqual(paths, ['/uka/tex/hair.png']);
  assert.deepEqual(handlers, paths);
  const failures: unknown[] = [];
  builder._loadTexture('tex/hair.png', textures, {}, undefined, error => failures.push(error));
  const error = new Error('image decode failed'); fail!(error);
  assert.equal(failures[0], error);
  builder._loadTexture('tex\\hair.png', textures, {}, undefined, error => failures.push(error));
  assert.match(String(failures[1]), /\/uka\/tex\/hair.png/);
  builder._loadTexture('toon01.bmp', textures, { isDefaultToonTexture: true });
  assert.match(paths.at(-1)!, /^data:image\/png;base64,/);
  const tgaPaths: string[] = [];
  builder._getTGALoader().load = path => { paths.push(path); tgaPaths.push(path); return new DataTexture(); };
  builder._loadTexture('tex\\sphere.TGA', textures);
  assert.equal(paths.at(-1), '/uka/tex/sphere.TGA');
  builder._loadTexture('tex\\alternate.TGA/.', textures);
  assert.equal(paths.at(-1), '/uka/tex/alternate.TGA');
  assert.deepEqual(tgaPaths, ['/uka/tex/sphere.TGA', '/uka/tex/alternate.TGA']);
  const count = paths.length;
  assert.throws(() => builder._loadTexture('..\\escape.png', textures), /Unsafe/);
  assert.equal(paths.length, count);
  manager.getHandler = () => { throw new Error('handler failure'); };
  assert.throws(() => builder._loadTexture('tex/uncached.png', textures), /handler failure/);
  assert.equal(builder.resourcePath, '/uka/');
  assert.notEqual(new MMDLoader().meshBuilder.materialBuilder._loadTexture, builder._loadTexture);
});

test('PMX base, sphere/subtexture and custom toon share resolution while preserving source names', () => {
  for (const envFlag of [1, 2, 3]) {
    const bytes = readFileSync('tests/fixtures/bdef.pmx');
    const data = new Parser().parsePmx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
    data.textures = ['tex\\hair.png', 'tex/./sphere.png', 'tex\\custom/toon.png'];
    for (const material of data.materials) Object.assign(material, { textureIndex: 0, envTextureIndex: 1, envFlag, toonFlag: 0, toonIndex: 2 });
    const before = structuredClone(data), loader = createMMDLoader(), paths: string[] = [];
    loader.meshBuilder.materialBuilder.textureLoader.load = path => { paths.push(path); return new Texture(); };
    const mesh = loader.meshBuilder.build(data, '/uka/');
    assert.deepEqual(paths, ['/uka/tex/hair.png', '/uka/tex/sphere.png', '/uka/tex/custom/toon.png']);
    assert.equal(mesh.material[0].userData.MMD.mapFileName, 'tex\\hair.png');
    assert.equal(mesh.material[0].userData.MMD.matcapFileName, 'tex/./sphere.png');
    assert.deepEqual(data.textures, before.textures);
    assert.deepEqual(data.materials, before.materials);
    assert.deepEqual(bytes, readFileSync('tests/fixtures/bdef.pmx'));
    // PMD's base*sphere and custom toon use the same MaterialBuilder entry point.
    const pmd = { ...data, metadata: { ...data.metadata, format: 'pmd' },
      materials: data.materials.map((m: typeof data.materials[number]) => ({ ...m, fileName: 'tex\\hair.png*tex\\sphere.sph', toonIndex: 0, edgeFlag: 1 })),
      toonTextures: [{ fileName: 'tex\\custom/toon.png' }] };
    paths.length = 0;
    loader.meshBuilder.materialBuilder.build(pmd as unknown as Parameters<typeof loader.meshBuilder.materialBuilder.build>[0], mesh.geometry);
    assert.deepEqual(paths, ['/uka/tex/hair.png', '/uka/tex/sphere.sph', '/uka/tex/custom/toon.png']);
  }
});
