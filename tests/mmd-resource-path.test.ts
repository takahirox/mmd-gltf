import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AddOperation, DataTexture, LoadingManager, MultiplyOperation, Texture } from 'three';
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

test('encoded literal-percent filenames remain escaped without reinterpreting their UTF-8', () => {
  for (const name of ['%25FF.png', '100%25ab.png', '%2525FF.png', '%25literal.png', '%25FF%2520name.png']) {
    assert.equal(resolve('/uka/', `tex/${name}`), `/uka/tex/${name}`);
    assert.equal(resolve('/uka/', `tex\\${name}`), `/uka/tex/${name}`);
  }
});

test('unsafe resource names fail before fetching, including encoded traversal', () => {
  for (const path of ['', '.', '..\\hair.png', 'tex\\..\\..\\hair.png', '../hair.png', 'tex/%2e%2e/%2e%2e/hair.png', '%252e%252e/hair.png', 'tex/%2f..%2fimage.png', 'tex/%5c..%5cimage.png', 'tex/%255cimage.png', 'C:\\tex\\hair.png', '\\\\host\\share.png', 'tex/bad%zz.png', 'tex/\u0000hair.png', 'tex/\nhair.png'])
    assert.throws(() => resolve('/uka/', path), /Unsafe relative texture path/, path);
  for (const path of ['tex/%FF.png', 'tex/%ab.png', 'tex/%25FF%252fescape.png', 'tex/%25FF%255cescape.png', 'tex/%25FF%2500.png', '%25252e%25252e/hair.png'])
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

test('absolute TGA URL decoder uses pathname while handlers, cache and requests retain query/fragment', () => {
  const manager = new LoadingManager(), builder = createMMDLoader(manager).meshBuilder.materialBuilder;
  const imagePaths: string[] = [], tgaPaths: string[] = [], handlerPaths: string[] = [];
  builder.textureLoader.load = path => { imagePaths.push(path); return new Texture(); };
  builder._getTGALoader().load = path => { tgaPaths.push(path); return new DataTexture(); };
  manager.getHandler = path => { handlerPaths.push(path); return null; };
  const textures = {};
  for (const url of ['https://example.com/tex/sphere.tga?v=1', 'https://example.com/tex/sphere.TGA?v=2#image']) {
    const texture = builder._loadTexture(url, textures);
    assert.equal(builder._loadTexture(url, textures), texture);
    assert.ok(texture instanceof DataTexture);
  }
  assert.deepEqual(tgaPaths, ['https://example.com/tex/sphere.tga?v=1', 'https://example.com/tex/sphere.TGA?v=2#image']);
  const pngURL = 'https://example.com/tex/base.png?name=.tga';
  builder._loadTexture(pngURL, textures);
  assert.deepEqual(imagePaths, [pngURL]);
  assert.deepEqual(handlerPaths, [...tgaPaths, pngURL]);
  const custom = new Texture();
  manager.getHandler = () => ({ load: () => custom }) as unknown as ReturnType<typeof manager.getHandler>;
  assert.equal(builder._loadTexture('https://example.com/custom.tga?v=1', textures), custom);
  assert.equal(builder.manager, manager);
});

test('PMD escaped sphere extensions keep the base map, sphere operation and original names', () => {
  const bytes = readFileSync('tests/fixtures/bdef.pmx');
  const data = new Parser().parsePmx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
  const loader = createMMDLoader(), builder = loader.meshBuilder.materialBuilder.setResourcePath('/uka/');
  const geometry = loader.meshBuilder.geometryBuilder.build(data);
  for (const [extension, operation] of [['sph', MultiplyOperation], ['spa', AddOperation]] as const) {
    const base = extension === 'spa' ? 'base%2Aname.png' : 'base.png';
    const names = [`tex\\sphere.${extension}`, `tex\\sphere.%73${extension.slice(1)}`];
    const pmd = { ...data, metadata: { ...data.metadata, format: 'pmd', materialCount: 2 },
      materials: names.map(sphere => ({ ...data.materials[0], fileName: `tex\\${base}*${sphere}`, toonIndex: -1, edgeFlag: 1 })),
      toonTextures: [] };
    const before = structuredClone(pmd), paths: string[] = [];
    builder.textureLoader.load = path => { paths.push(path); return new Texture(); };
    const materials = builder.build(pmd, geometry);
    assert.deepEqual(paths.filter(path => !path.startsWith('data:')), [`/uka/tex/${base.replace('%2A', '*')}`, `/uka/tex/sphere.${extension}`]);
    assert.ok(materials[0].map);
    assert.ok(materials[0].matcap);
    assert.notEqual(materials[0].map, materials[0].matcap);
    assert.equal(materials[0].map, materials[1].map);
    assert.equal(materials[0].matcap, materials[1].matcap);
    for (let i = 0; i < materials.length; i++) {
      assert.equal(materials[i].matcapCombine, operation);
      assert.equal(materials[i].userData.MMD.sourceFileName, pmd.materials[i].fileName);
    }
    assert.deepEqual(pmd, before);
  }
});

test('PMD sphere roles use URL pathnames while requests, handlers and cache retain queries/fragments', () => {
  const bytes = readFileSync('tests/fixtures/bdef.pmx');
  const data = new Parser().parsePmx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
  const manager = new LoadingManager(), loader = createMMDLoader(manager);
  const builder = loader.meshBuilder.materialBuilder.setResourcePath('/uka/');
  const geometry = loader.meshBuilder.geometryBuilder.build(data);
  const loadTexture = builder._loadTexture;
  for (const [extension, operation] of [['sph', MultiplyOperation], ['spa', AddOperation]] as const) {
    // A misleading base query suffix must not turn the base into a sphere map.
    const base = `https://example.com/base.png?name=.${extension}`;
    const spheres = [`https://example.com/sphere.${extension}?v=1`,
      `https://example.com/sphere.${extension.toUpperCase()}#image`,
      `//example.com/sphere.${extension}?v=2#image`];
    const names = [...spheres, spheres[0]];
    const pmd = { ...data, metadata: { ...data.metadata, format: 'pmd', materialCount: names.length },
      materials: names.map(sphere => ({ ...data.materials[0], fileName: `${base}*${sphere}`, toonIndex: 0, edgeFlag: 1 })),
      toonTextures: [{ fileName: 'tex\\custom/toon.png' }] };
    const before = structuredClone(pmd), paths: string[] = [], handlers: string[] = [];
    const loaded = new Map<string, Texture>();
    builder.textureLoader.load = path => { const texture = new Texture<HTMLImageElement>(); paths.push(path); loaded.set(path, texture); return texture; };
    manager.getHandler = path => { handlers.push(path); return null; };
    const materials = builder.build(pmd, geometry);
    assert.deepEqual(paths, [base, spheres[0], '/uka/tex/custom/toon.png', ...spheres.slice(1)]);
    assert.deepEqual(handlers, paths);
    for (let i = 0; i < materials.length; i++) {
      assert.equal(materials[i].map, loaded.get(base));
      assert.equal(materials[i].matcap, loaded.get(names[i]));
      assert.equal(materials[i].matcapCombine, operation);
      assert.equal(materials[i].userData.MMD.sourceFileName, pmd.materials[i].fileName);
    }
    assert.deepEqual(pmd, before);
    assert.equal(builder._loadTexture, loadTexture);
    manager.getHandler = () => { throw new Error('handler failure'); };
    assert.throws(() => builder.build(pmd, geometry), /handler failure/);
    assert.equal(builder._loadTexture, loadTexture);
    assert.equal(builder.manager, manager);
    assert.equal(builder.resourcePath, '/uka/');
  }
});
