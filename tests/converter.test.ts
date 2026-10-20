import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { validateBytes } from 'gltf-validator';
import { fetchGene } from '../tools/fetch-gene';
import { convertModel, convertPMX, parsePMX } from '../tools/pmx-to-gltf';
import { validatePayload, EXTENSION_NAME } from '../packages/three-mmd-toon/payload';
import manifest from '../tools/gene-light-manifest.json';

export function glbJSON(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
}
test('pinned Gene conversion is deterministic, valid, attributed and has complete independent fallback', async () => {
  const directory = await fetchGene();
  const pmx = parsePMX(await readFile(`${directory}/Gene_light.pmx`));
  const one = await convertModel(pmx, directory);
  const two = await convertModel(pmx, directory);
  const first = await one.io.writeBinary(one.document), second = await two.io.writeBinary(two.document);
  assert.deepEqual(first, second, 'repeated conversion must be byte-identical');
  const json = glbJSON(first);
  const report = await validateBytes(first, { maxIssues: 1000 });
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
  console.log('Gene GLB:', first.length, 'bytes;', createHash('sha256').update(first).digest('hex'), '; validator:', report.validatorVersion,
    '; notices:', [...new Set(report.issues.messages.map((m: any) => m.code))]);
  assert.ok(json.extensionsUsed.includes(EXTENSION_NAME));
  assert.ok(!json.extensionsRequired?.includes(EXTENSION_NAME));
  assert.equal(json.materials.length, 13);
  assert.equal(json.images.length, 10);
  assert.equal(json.meshes[0].primitives.length, 13);
  const read = await new NodeIO().readBinary(first); // unsupported extension ignored; core fallback still usable
  const primitives = read.getRoot().listMeshes()[0].listPrimitives();
  let triangles = 0;
  for (const primitive of primitives) {
    const position = primitive.getAttribute('POSITION')!, normal = primitive.getAttribute('NORMAL')!, uv = primitive.getAttribute('TEXCOORD_0')!;
    assert.equal(position.getCount(), 28646);
    assert.equal(uv.getCount(), position.getCount());
    assert.equal(normal.getCount(), position.getCount());
    for (const value of position.getArray()!) assert.ok(Number.isFinite(value));
    for (const value of uv.getArray()!) assert.ok(Number.isFinite(value)); // PMX repeat UVs may be outside [0,1]
    for (const value of primitive.getIndices()!.getArray()!) assert.ok(value >= 0 && value < position.getCount());
    triangles += primitive.getIndices()!.getCount() / 3;
  }
  assert.equal(triangles, 47106);
  for (const [i, m] of json.materials.entries()) {
    const ext = m.extensions[EXTENSION_NAME]; validatePayload(ext);
    assert.deepEqual(ext.diffuseFactor, pmx.materials[i].diffuse);
    assert.deepEqual(ext.ambientFactor, pmx.materials[i].ambient);
    assert.deepEqual(ext.specularFactor, pmx.materials[i].specular);
    assert.equal(ext.shininessFactor, pmx.materials[i].shininess);
    assert.equal(m.pbrMetallicRoughness.metallicFactor ?? 1, 0);
    assert.ok(m.pbrMetallicRoughness.baseColorTexture);
    assert.equal(ext.baseTexture!.index, m.pbrMetallicRoughness.baseColorTexture.index, 'share source texture bytes');
    assert.equal(m.doubleSided ?? false, !!(pmx.materials[i].flag & 1));
  }
  assert.notDeepEqual(json.materials[12].extensions[EXTENSION_NAME].diffuseFactor, json.materials[12].pbrMetallicRoughness.baseColorFactor);
  const sourceBytes = await readFile(`${directory}/Gene_light.pmx`);
  const original = new (await import('mmd-parser')).Parser().parsePmx(sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength) as ArrayBuffer, false);
  assert.equal(pmx.vertices[0].position[2], -original.vertices[0].position[2]);
  assert.deepEqual(pmx.faces[0].indices, [...original.faces[0].indices].reverse());
  const deployed = await readFile('public/gene-light/model.glb');
  const deployedJSON = glbJSON(deployed);
  assert.equal((await validateBytes(deployed)).issues.numErrors, 0, 'deployed derivative GLB is valid');
  const conversionRecord = JSON.parse(await readFile('public/gene-light/conversion.json', 'utf8'));
  assert.equal(conversionRecord.bytes, deployed.length);
  assert.equal(conversionRecord.sha256, createHash('sha256').update(deployed).digest('hex'));
  const deployedCore = await new NodeIO().readBinary(deployed);
  for (const texture of deployedCore.getRoot().listTextures()) {
    const expected = manifest.files.find((f) => f.path === texture.getName());
    assert.ok(expected, 'image must come from the source allowlist');
    assert.equal(createHash('sha256').update(texture.getImage()!).digest('hex'), expected.sha256);
  }
  assert.equal(deployedJSON.extras.sourceManifest.commit, manifest.commit);
  assert.match(deployedJSON.extras.attribution, /Nagoya Institute of Technology/);
  for (const name of ['README.md', 'README.ja.md']) assert.deepEqual(await readFile(`public/gene-light/${name}`), await readFile(`${directory}/${name}`));
});

test('generic PMX material conversion preserves all supported sphere/toon modes and UV1', async () => {
  const directory = await fetchGene();
  const source = parsePMX(await readFile(`${directory}/Gene_light.pmx`));
  const model = structuredClone(source);
  model.vertices = source.vertices.slice(0, 3).map((v) => ({ ...v, auvs: [[0.2, 0.7, 0.3, 0.4]] }));
  model.faces = Array.from({ length: 5 }, () => ({ indices: [0, 1, 2] }));
  model.materials = Array.from({ length: 5 }, (_, i) => ({ ...source.materials[0], faceCount: 1, envFlag: i % 4, envTextureIndex: 1, toonFlag: i === 4 ? 0 : 1, toonIndex: i === 4 ? 2 : i === 0 ? 0 : 9 }));
  const { io, document } = await convertModel(model, directory);
  const bytes = await io.writeBinary(document), json = glbJSON(bytes);
  assert.equal((await validateBytes(bytes)).issues.numErrors, 0);
  assert.equal(json.images.length, 3, 'no built-in shared toon images embedded');
  for (let i = 0; i < 5; i++) {
    const ext = json.materials[i].extensions[EXTENSION_NAME]; validatePayload(ext);
    assert.equal(ext.sphereMode, ['none', 'multiply', 'add', 'subTexture'][i % 4]);
    assert.ok(ext.sphereTexture);
    if (i === 4) {
      assert.ok(ext.toonTexture);
      const sampler = json.samplers[json.textures[ext.toonTexture.index].sampler];
      assert.equal(sampler.wrapT, 33071, 'toon endpoints must not repeat across the seam');
      assert.equal(sampler.minFilter, 9729);
    }
    else assert.equal(ext.sharedToonIndex, i === 0 ? 0 : 9);
  }
  assert.ok(json.meshes[0].primitives[3].attributes.TEXCOORD_1 !== undefined);
  model.vertices[0].auvs = [];
  await assert.rejects(convertModel(model, directory), /Additional UV1/);
});

test('CLI output supports unpacked glTF resources and rejects invalid geometry/inputs', async () => {
  const directory = await fetchGene(), temporary = await mkdtemp(join(tmpdir(), 'mmd-gltf-test-'));
  try {
    const target = join(temporary, 'model.gltf');
    await convertPMX(`${directory}/Gene_light.pmx`, target);
    const core = await new NodeIO().read(target);
    assert.equal(core.getRoot().listMeshes()[0].listPrimitives().length, 13);
    const pmx = parsePMX(await readFile(`${directory}/Gene_light.pmx`));
    await assert.rejects(convertModel(pmx, directory, -1), /scale/);
    pmx.faces[0].indices[0] = pmx.vertices.length;
    await assert.rejects(convertModel(pmx, directory), /indices/);
    pmx.materials[0].textureIndex = 100;
    await assert.rejects(convertModel(pmx, directory), /texture index/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
