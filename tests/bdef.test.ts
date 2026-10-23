import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Matrix4, Vector3 } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { validateBytes, validateString } from 'gltf-validator';
import { convertModel, convertPMX, parsePMX } from '../tools/pmx-to-gltf';
import { syntheticPMX } from '../tools/synthetic-bdef';

const fixture = () => readFile('tests/fixtures/bdef.pmx');
const epsilon = 2e-6; // FLOAT weights and inverse binds; sub-meter fixture, 260 joints, no accumulated rest rotations.
function near(a: number[], b: number[]) {
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < epsilon, `${a} != ${b}`));
}
// Independent analytic oracle: a 90-degree Z rotation about bone 0, root 1's
// Y translation, bone 259's rotated local X translation, and root 2's X shift.
function expected(position: number[], indices: number[], weights: number[]) {
  const [x, y, z] = position;
  const output = [0, 0, 0];
  weights.forEach((w, j) => {
    if (!w) return;
    const index = indices[j];
    const p = index === 0 || index === 259 ? [1 - y, x + 0.25 + (index === 259 ? 0.25 : 0), z]
      : index === 1 ? [x, y + 0.25, z] : [x - 0.125, y, z];
    p.forEach((value, axis) => { output[axis] += value * w; });
  });
  return output;
}

test('binary BDEF fixture preserves hierarchy, identity, bind pose and analytic deformation through GLB/glTF', async () => {
  const source = await fixture();
  assert.deepEqual(source, syntheticPMX(), 'committed binary matches attributed generator');
  const model = parsePMX(source);
  assert.equal(model.bones.length, 260);
  assert.deepEqual(model.bones[0].position, [1, 1, -2], 'parser reflects bone Z exactly once');
  assert.deepEqual(model.vertices[0].position, [0, 0, -1]);
  const one = await convertModel(model, '.', { mode: 'bdef', scale: 0.5 });
  const two = await convertModel(model, '.', { mode: 'bdef', scale: 0.5 });
  const bytes = await one.io.writeBinary(one.document);
  assert.deepEqual(bytes, await two.io.writeBinary(two.document));
  const validation = await validateBytes(bytes);
  assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues.messages));
  const directory = await mkdtemp(join(tmpdir(), 'mmd-bdef-'));
  try {
    await convertPMX('tests/fixtures/bdef.pmx', join(directory, 'model.gltf'), { mode: 'bdef', scale: 0.5 });
    const gltfValidation = await validateString(await readFile(join(directory, 'model.gltf'), 'utf8'), {
      externalResourceFunction: (uri: string) => readFile(join(directory, uri)),
    });
    assert.equal(gltfValidation.issues.numErrors, 0, JSON.stringify(gltfValidation.issues.messages));
    for (const doc of [await new NodeIO().readBinary(bytes), await new NodeIO().read(join(directory, 'model.gltf'))]) {
      const skin = doc.getRoot().listSkins()[0], bones = skin.listJoints();
      assert.equal(bones.length, 260);
      assert.equal(bones[0].getParentNode(), bones[1]);
      assert.equal(bones[259].getParentNode(), bones[0]);
      assert.equal(bones[1].getParentNode(), skin.getSkeleton());
      assert.equal(bones[2].getParentNode(), skin.getSkeleton());
      for (let i = 0; i < 260; i++) {
        assert.deepEqual(bones[i].getExtras().pmxBone, { index: i, name: model.bones[i].name, englishName: model.bones[i].englishName });
        near(bones[i].getWorldTranslation(), model.bones[i].position.map(v => v * 0.5));
        assert.deepEqual(bones[i].getRotation(), [0, 0, 0, 1]);
      }
      const primitives = doc.getRoot().listMeshes()[0].listPrimitives();
      assert.equal(primitives.length, 2);
      for (const primitive of primitives) {
        const joints = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
        assert.equal(joints.getType(), 'VEC4'); assert.equal(weights.getType(), 'VEC4');
        assert.equal(joints.getComponentType(), 5123); assert.equal(weights.getComponentType(), 5126);
        assert.equal(joints.getCount(), 24);
        assert.deepEqual(joints.getElement(3, []), [259, 2, 0, 0]);
        assert.deepEqual(weights.getElement(3, []), [0.75, 0.25, 0, 0]);
      }
      const primitive = primitives[0], positions = primitive.getAttribute('POSITION')!;
      const deform = (i: number) => {
        const output = new Vector3();
        const joints = primitive.getAttribute('JOINTS_0')!.getElement(i, []);
        primitive.getAttribute('WEIGHTS_0')!.getElement(i, []).forEach((weight, j) => {
          const transform = new Matrix4().fromArray(bones[joints[j]].getWorldMatrix())
            .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(joints[j], [])));
          output.addScaledVector(new Vector3().fromArray(positions.getElement(i, [])).applyMatrix4(transform), weight);
        });
        return output.toArray();
      };
      for (let i = 0; i < 24; i++) near(deform(i), model.vertices[i].position.map(v => v * 0.5));
      bones[0].setRotation([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
      bones[1].setTranslation([0.5, 0.25, -1]);
      bones[2].setTranslation([-0.625, 0, -0.5]);
      bones[259].setTranslation([0.25, 0.5, 0]);
      for (let i = 0; i < 24; i++) {
        const v = model.vertices[i];
        near(deform(i), expected(v.position.map(x => x * 0.5), v.skinIndices!, v.skinWeights!));
      }
    }
    const cli = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/pmx-to-gltf.ts', 'tests/fixtures/bdef.pmx', join(directory, 'cli.glb'), '--mode', 'bdef', '--scale', '0.5'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(await readFile(join(directory, 'cli.glb')), Buffer.from(bytes));
  } finally { await rm(directory, { recursive: true, force: true }); }
  const deployed = await readFile('public/bdef/model.glb');
  const record = JSON.parse(await readFile('public/bdef/conversion.json', 'utf8'));
  assert.equal((await validateBytes(deployed)).issues.numErrors, 0);
  assert.deepEqual(await readFile('public/bdef/source.pmx'), source);
  assert.equal(record.source.sha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(record.sha256, createHash('sha256').update(deployed).digest('hex'));
  assert.equal(record.bytes, deployed.length);
  assert.equal(record.mode, 'bdef');
  assert.match(record.attribution, /Original synthetic/);
  console.log(`BDEF: 24 vertices × rest/deformed × GLB/glTF, 260 joints; absolute tolerance ${epsilon}; validator zero errors; deterministic bytes.`);
});

test('BDEF validation rejects unsupported modes, malformed hierarchy, active references and abnormal weights', async () => {
  const source = parsePMX(await fixture());
  const reject = async (change: (m: typeof source) => void, pattern: RegExp) => {
    const m = structuredClone(source); change(m);
    await assert.rejects(convertModel(m, '.', { mode: 'bdef' }), pattern);
  };
  for (const mode of ['sdef', 'qdef'] as const) assert.deepEqual(await readFile(`tests/fixtures/${mode}.pmx`), syntheticPMX(mode));
  const sdef = parsePMX(await readFile('tests/fixtures/sdef.pmx'));
  await assert.rejects(convertModel(sdef, '.', { mode: 'bdef' }), /SDEF.*24 vertices \[0, 1/);
  assert.throws(() => parsePMX(syntheticPMX('qdef')), /mmd-parser 1.1.4 rejects binary PMX 2.1.*QDEF/);
  const qdefIn20 = syntheticPMX('qdef'); qdefIn20.writeFloatLE(2, 4);
  assert.throws(() => parsePMX(qdefIn20), /mmd-parser 1.1.4 cannot parse QDEF.*No vertex index/i);
  await reject(m => { m.vertices[0].type = 4; }, /QDEF.*vertices \[0\]/);
  await reject(m => { m.vertices[0].type = 9; }, /unknown \(9\)/);
  await reject(m => { m.bones[0].parentIndex = 260; }, /Bone 0: invalid parent/);
  await reject(m => { m.bones[0].parentIndex = -2; }, /invalid parent/);
  await reject(m => { m.bones[0].parentIndex = 0; }, /parent cycle/);
  await reject(m => { m.bones[1].parentIndex = 259; }, /parent cycle/);
  await reject(m => { m.bones[0].position[0] = NaN; }, /Bone 0: non-finite/);
  await reject(m => { m.bones[0].position[0] = 1e100; }, /numeric range/);
  await reject(m => { m.bones = []; }, /1..65536 bones/);
  await reject(m => { m.vertices[0].skinIndices = [-1]; }, /Vertex 0: invalid active bone/);
  await reject(m => { m.vertices[0].skinIndices = [260]; }, /invalid active bone/);
  await reject(m => { m.vertices[0].skinIndices = [1.5]; }, /invalid active bone/);
  await reject(m => { m.vertices[0].skinWeights = [NaN]; }, /negative\/non-finite/);
  await reject(m => { m.vertices[0].skinWeights = [-1]; }, /negative\/non-finite/);
  await reject(m => { m.vertices[0].skinWeights = [0]; }, /zero\/non-finite weight total/);
  await reject(m => { m.vertices[2].skinWeights = [0.2, 0.2, 0.2, 0.2]; }, /materially non-unit/);
  await reject(m => { m.vertices[0].skinWeights = []; }, /malformed BDEF/);
  await reject(m => { m.vertices[0].position[0] = Infinity; }, /Non-finite positions/);
  const rounded = structuredClone(source);
  rounded.vertices[2].skinWeights = [0.1, 0.2, 0.3, 0.4000001];
  const adjusted = await convertModel(rounded, '.', { mode: 'bdef' });
  assert.match(adjusted.warnings.join('\n'), /Normalized roundoff-sized.*vertices \[2/);
  assert.equal((await validateBytes(await adjusted.io.writeBinary(adjusted.document))).issues.numErrors, 0);
  for (const m of [source, sdef]) {
    const { document, warnings } = await convertModel(m, '.');
    assert.equal(document.getRoot().listSkins().length, 0);
    assert.match(warnings[0], /Static base pose only.*260 bones/);
  }
});
