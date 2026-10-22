import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { validateBytes, validateString } from 'gltf-validator';
import { validatePayload, EXTENSION_NAME, EDGE_ATTRIBUTE } from '../packages/three-mmd-outline/payload';
import { validateAsset, decodeAccessor } from '../packages/three-mmd-outline/validation';
import schema from '../extensions/MMD_materials_outline/tests/schema.json';
import assets from '../extensions/MMD_materials_outline/tests/assets.json';
import { convertModel, type PMXModel } from '../tools/pmx-to-gltf';
function glbJSON(bytes: Uint8Array) { return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true)))); }
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';

test('outline runtime schema matches the independent draft corpus', () => {
  for (const c of schema.valid) assert.doesNotThrow(() => validatePayload(c.value), c.name);
  for (const c of schema.invalid) assert.throws(() => validatePayload(c.value), Error, c.name);
  for (const raw of schema.invalidNumericJSON) assert.throws(() => validatePayload(JSON.parse(raw)));
});
function parser(json: any) {
  return { json, getDependency: async (type: string, index: number) => {
    assert.equal(type, 'buffer');
    const bytes = Buffer.from(json.buffers[index].uri.split(',')[1], 'base64');
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } } as GLTFParser;
}
test('runtime raw validation accepts/rejects all independent asset and sparse fixtures', async () => {
  for (const c of assets) {
    const json = JSON.parse(await readFile(`extensions/MMD_materials_outline/examples/${c.asset}`, 'utf8'));
    for (const change of c.changes as any[]) {
      const owner = change.path.slice(0, -1).reduce((o: any, k: string) => o[k], json);
      if (change.remove) delete owner[change.path.at(-1)]; else owner[change.path.at(-1)] = change.value;
    }
    if (c.edgeValues) {
      const bytes = Buffer.from(json.buffers[0].uri.split(',')[1], 'base64');
      c.edgeValues.forEach((x, i) => bytes.writeFloatLE(Number(x), 72 + i * 4));
      json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
    }
    const p = parser(json);
    if (c.expectedError) await assert.rejects(validateAsset(p), new RegExp(c.expectedError), c.name);
    else {
      await validateAsset(p);
      if (c.expectedScales) {
        const index = json.meshes[0].primitives[0].attributes[EDGE_ATTRIBUTE];
        const values = index === undefined ? [1, 1, 1] : await decodeAccessor(p, index, 'SCALAR');
        assert.deepEqual(values, c.expectedScales, c.name);
      }
    }
  }
});
function model(scales: (number | undefined)[]): PMXModel {
  const material = { name: 'edge', diffuse: [1, 1, 1, 1], ambient: [0, 0, 0], specular: [0, 0, 0], shininess: 0,
    flag: 16, textureIndex: -1, envTextureIndex: -1, envFlag: 0, toonFlag: 0, toonIndex: -1, faceCount: 1 };
  return { metadata: { modelName: 'synthetic', comment: '', englishComment: '' },
    vertices: scales.map((edgeRatio, i) => ({ edgeRatio, position: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]][i], normal: [0, 0, 1], uv: [0, 0], auvs: [] })),
    faces: [{ indices: [0, 1, 2] }, { indices: [0, 1, 2] }, { indices: [0, 1, 2] }],
    materials: [{ ...material, flag: 0 }, material, { ...material, name: 'signed size', edgeSize: -2, edgeColor: [2, -1, 0.5, 0.5] }],
    textures: [], bones: [], morphs: [], rigidBodies: [], constraints: [] };
}
test('converter preserves flags, defaults, shared signed/zero scales and independent declarations in GLB and glTF', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'mmd-outline-'));
  try {
    for (const scales of [[undefined, 1, 1], [0, -2, 3], [0, 0, 0]]) {
      const { document, io } = await convertModel(model(scales), temporary);
      const bytes = await io.writeBinary(document), json = glbJSON(bytes);
      assert.equal((await validateBytes(bytes)).issues.numErrors, 0);
      assert.deepEqual(json.extensionsUsed.sort(), ['MMD_materials_outline', 'MMD_materials_toon']);
      assert.ok(!json.extensionsRequired?.length);
      assert.equal(json.materials[0].extensions.MMD_materials_outline, undefined);
      assert.deepEqual(json.materials[1].extensions.MMD_materials_outline, { colorFactor: [0, 0, 0, 1], sizeFactor: 1 });
      assert.deepEqual(json.materials[2].extensions.MMD_materials_outline, { colorFactor: [2, -1, 0.5, 0.5], sizeFactor: -2 });
      const primitives = json.meshes[0].primitives;
      assert.equal(primitives.length, 3);
      assert.equal(primitives[0].attributes[EDGE_ATTRIBUTE], undefined);
      assert.equal(primitives[1].attributes.POSITION, primitives[2].attributes.POSITION);
      assert.equal(primitives[1].attributes[EDGE_ATTRIBUTE], primitives[2].attributes[EDGE_ATTRIBUTE]);
      const unpacked = join(temporary, 'model.gltf');
      await io.write(unpacked, document);
      const unpackedJSON = JSON.parse(await readFile(unpacked, 'utf8'));
      const report = await validateString(JSON.stringify(unpackedJSON), { externalResourceFunction: async (uri: string) => new Uint8Array(await readFile(join(temporary, uri))) });
      assert.equal(report.issues.numErrors, 0);
      for (const core of [await new NodeIO().readBinary(bytes), await new NodeIO().read(unpacked)]) {
        const primitive = core.getRoot().listMeshes()[0].listPrimitives()[1];
        const accessor = primitive.getAttribute(EDGE_ATTRIBUTE);
        if (scales.every(x => (x ?? 1) === 1)) assert.equal(accessor, null);
        else {
          assert.equal(accessor!.getType(), 'SCALAR'); assert.equal(accessor!.getComponentType(), 5126);
          assert.deepEqual([...accessor!.getArray()!], scales);
        }
      }
    }
    await assert.rejects(convertModel(model([0, Infinity, 1]), temporary), /Non-finite/);
    await assert.rejects(convertModel(model([0, 1e100, 1]), temporary), /numeric range/);
    const disabled = model([1, 1, 1]); disabled.materials.forEach(m => { m.flag = 0; });
    const { io, document } = await convertModel(disabled, temporary);
    assert.ok(!glbJSON(await io.writeBinary(document)).extensionsUsed.includes(EXTENSION_NAME));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('final material groups map independently and scene metadata has an explicit disposal path', async () => {
  const { MMDOutlinePlugin, getOutlineRecords } = await import('../packages/three-mmd-outline');
  const { Mesh, BufferGeometry, MeshStandardMaterial, Group } = await import('three');
  const materials = [new MeshStandardMaterial(), new MeshStandardMaterial()];
  const mesh = new Mesh(new BufferGeometry(), materials), scene = new Group(); scene.add(mesh);
  const json = { materials: [
    { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0] }, extensions: { MMD_materials_outline: { sizeFactor: -2 } } },
    { extensions: { MMD_materials_outline: { sizeFactor: 3 } } },
  ], meshes: [{ primitives: [{ material: 0 }] }] };
  const p = { json, associations: new Map<any, any>([[mesh, { meshes: 0, primitives: 0 }], [materials[0], { materials: 0 }], [materials[1], { materials: 1 }]]) } as GLTFParser;
  const plugin = new MMDOutlinePlugin(p);
  await plugin.afterRoot({ scenes: [scene] } as any);
  const records = getOutlineRecords(mesh);
  assert.deepEqual(records.map(r => r.payload.sizeFactor), [-2, 3]);
  assert.deepEqual(records.map(r => r.materialIndex), [0, 1]);
  assert.equal(records[0].getDiffuseAlpha(materials[0]), 0, 'OPAQUE preserves source factor zero');
  materials[0].userData.mmdBaseFactorAlpha = 0.2;
  assert.equal(records[0].getDiffuseAlpha(materials[0]), 0.2, 'live factor updates');
  plugin.dispose();
  assert.equal(getOutlineRecords(mesh).length, 0);
  assert.equal(materials[0].userData.mmdBaseFactorAlpha, undefined);
});

test('other active material models require an explicit live finite alpha integration', async () => {
  const { MMDOutlinePlugin, getOutlineRecords } = await import('../packages/three-mmd-outline');
  const { Mesh, BufferGeometry, MeshBasicMaterial, Group } = await import('three');
  const material = new MeshBasicMaterial(), mesh = new Mesh(new BufferGeometry(), material), scene = new Group(); scene.add(mesh);
  const json = { materials: [{ extensions: { MMD_materials_outline: {} } }], meshes: [{ primitives: [{ material: 0 }] }] };
  const p = { json, associations: new Map<any, any>([[mesh, { meshes: 0, primitives: 0 }]]) } as GLTFParser;
  await assert.rejects(new MMDOutlinePlugin(p).afterRoot({ scenes: [scene] } as any), /unsupported material-alpha integration/);
  let factor = 0.5;
  const plugin = new MMDOutlinePlugin(p, { getDiffuseAlpha: () => factor });
  await plugin.afterRoot({ scenes: [scene] } as any);
  assert.equal(getOutlineRecords(mesh)[0].getDiffuseAlpha(material), 0.5);
  factor = 0;
  assert.equal(getOutlineRecords(mesh)[0].getDiffuseAlpha(material), 0);
  plugin.dispose();
  factor = NaN;
  await assert.rejects(plugin.afterRoot({ scenes: [scene] } as any), /finite/);
});
