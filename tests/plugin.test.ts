import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataTexture, SRGBColorSpace, NoColorSpace, LinearFilter, ClampToEdgeWrapping } from 'three';
import { MMDToonPlugin, encodedTextureView } from '../packages/three-mmd-toon';
import { validatePayload, sharedToonName } from '../packages/three-mmd-toon/payload';
import schemaCases from '../extensions/MMD_materials_toon/tests/schema.json';
import assets from '../extensions/MMD_materials_toon/tests/assets.json';
import { readFile } from 'node:fs/promises';
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';

function parser(json: any, texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)) {
  return { json, getDependency: async () => texture, associations: new Map() } as unknown as GLTFParser;
}
test('runtime payload validation matches the independent schema corpus', () => {
  for (const c of schemaCases.valid) assert.doesNotThrow(() => validatePayload(c.value), c.name);
  for (const c of schemaCases.invalid) assert.throws(() => validatePayload(c.value), Error, c.name);
  for (const raw of schemaCases.invalidNumericJSON) assert.throws(() => validatePayload(JSON.parse(raw)));
  for (let i = 0; i < 10; i++) assert.equal(sharedToonName(i), `toon${String(i + 1).padStart(2, '0')}.bmp`);
});
test('plugin enforces existing whole-asset fixtures before shader construction', async () => {
  for (const c of assets) {
    const json = JSON.parse(await readFile(`extensions/MMD_materials_toon/examples/${c.asset}`, 'utf8'));
    for (const change of c.changes) {
      const owner = change.path.slice(0, -1).reduce((o: any, key) => o[key], json); owner[change.path.at(-1)!] = change.value;
    }
    const plugin = new MMDToonPlugin(parser(json));
    if (c.expectedError) assert.throws(() => plugin.beforeRoot(), new RegExp(c.expectedError));
    else assert.doesNotThrow(() => plugin.beforeRoot());
  }
});
test('sRGB PBR textures retain their interpretation while MMD views use encoded components', () => {
  const original = new DataTexture(new Uint8Array([128, 64, 255, 128]), 1, 1);
  original.colorSpace = SRGBColorSpace;
  const view = encodedTextureView(original);
  assert.equal(original.colorSpace, SRGBColorSpace);
  assert.equal(view.colorSpace, NoColorSpace);
  assert.notEqual(view.source, original.source, 'independent GPU upload interpretation');
  assert.equal(view.image, original.image, 'reuse image bytes');
  assert.equal(view.flipY, false);
  const shared = encodedTextureView(original, true);
  assert.equal(shared.wrapS, ClampToEdgeWrapping); assert.equal(shared.wrapT, ClampToEdgeWrapping);
  assert.equal(shared.magFilter, LinearFilter); assert.equal(shared.minFilter, LinearFilter); assert.equal(shared.generateMipmaps, false);
});
test('plugin reports missing shared resources, resource failures, malformed payloads and handles common state', async () => {
  const definition = { materials: [{ extensions: { MMD_materials_toon: { sharedToonIndex: 9 } } }] };
  await assert.rejects(new MMDToonPlugin(parser(definition)).loadMaterial(0)!, /toon10.bmp/);
  const broken = new MMDToonPlugin(parser(definition), { resolveSharedToon: async () => { throw new Error('download failed'); } });
  await assert.rejects(broken.loadMaterial(0)!, /download failed/);
  const p = parser({ materials: [{ alphaMode: 'MASK', alphaCutoff: 0.25, doubleSided: true, extensions: { MMD_materials_toon: {} } }] });
  const material = await new MMDToonPlugin(p).loadMaterial(0)!;
  assert.equal(material.transparent, false); assert.equal(material.side, 2); assert.ok(material.fragmentNode);
  const missing = parser({ materials: [{ extensions: { MMD_materials_toon: { baseTexture: { index: 0 } } } }], textures: [{ source: 0 }], images: [{}] });
  missing.getDependency = async () => { throw new Error('image unavailable'); };
  await assert.rejects(new MMDToonPlugin(missing).loadMaterial(0)!, /image unavailable/);
});
