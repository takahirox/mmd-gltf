import type { Document, Buffer, Scene, Node, vec3 } from '@gltf-transform/core';
import { createHash } from 'node:crypto';
import type { PoseModel, RestBone } from '../packages/mmd-vpd';
import type { PMXModel } from './pmx-to-gltf';

/** Four float32 source weights accumulate at most a few ulps of roundoff near one. */
export const BDEF_WEIGHT_TOLERANCE = 1e-6;

export function createBDEFSkin(doc: Document, buffer: Buffer, scene: Scene, meshNode: Node,
  model: PMXModel, scale: number, warnings: string[], allowSDEF = false) {
  const { bones, vertices } = model;
  if (!bones.length || bones.length > 65536) throw new Error('BDEF requires 1..65536 bones (core unsigned-short joint indices)');
  const unsupported = new Map<string, number[]>();
  vertices.forEach((v, i) => {
    if (![0, 1, 2, ...(allowSDEF ? [3] : [])].includes(v.type!)) {
      const mode = v.type === 3 ? 'SDEF (3)' : v.type === 4 ? 'QDEF (4)' : `unknown (${v.type})`;
      if (!unsupported.has(mode)) unsupported.set(mode, []);
      unsupported.get(mode)!.push(i);
    }
  });
  if (unsupported.size) throw new Error(`${allowSDEF ? 'SDEF' : 'BDEF'} mode rejects unsupported skinning: ${[...unsupported].map(([mode, indices]) => `${mode}: ${indices.length} vertices [${indices.slice(0, 32).join(', ')}${indices.length > 32 ? ', …' : ''}]`).join('; ')}`);

  const positions = bones.map((bone, i) => {
    if (bone.position.length !== 3 || !bone.position.every(Number.isFinite)) throw new Error(`Bone ${i}: non-finite or invalid position`);
    const p = bone.parentIndex;
    if (!Number.isInteger(p) || p < -1 || p >= bones.length) throw new Error(`Bone ${i}: invalid parent ${p}`);
    const position = bone.position.map(v => v * scale);
    if (!position.every(v => Number.isFinite(v) && Number.isFinite(Math.fround(v)))) throw new Error(`Bone ${i}: unsupported numeric range`);
    return position as vec3;
  });
  // Iterative parent walk avoids call-stack limits on long but valid chains.
  const visited = new Uint8Array(bones.length);
  bones.forEach((_, i) => {
    let cursor = i;
    const path: number[] = [];
    while (cursor !== -1 && visited[cursor] !== 2) {
      if (visited[cursor] === 1) throw new Error(`Bone ${cursor}: parent cycle`);
      visited[cursor] = 1; path.push(cursor); cursor = bones[cursor].parentIndex;
    }
    path.forEach(index => { visited[index] = 2; });
  });
  const modelId = createHash('sha256').update(JSON.stringify({ model, scale })).digest('hex');
  const root = doc.createNode('PMX skeleton').setExtras({ mmdPose: { version: 1, modelId, metersPerPMXUnit: scale, boneCount: bones.length } });
  const rest: RestBone[] = [];
  scene.addChild(root);
  const nodes = bones.map((bone, i) => {
    const parent = bone.parentIndex < 0 ? [0, 0, 0] : positions[bone.parentIndex];
    const translation = positions[i].map((v, axis) => v - parent[axis]) as vec3;
    if (!translation.every(v => Number.isFinite(v) && Number.isFinite(Math.fround(v)))) throw new Error(`Bone ${i}: unsupported relative position range`);
    rest.push({ index: i, name: bone.name, parentIndex: bone.parentIndex, translation, rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    return doc.createNode(bone.name).setTranslation(translation).setExtras({
      pmxBone: { index: i, name: bone.name, englishName: bone.englishName },
      pmxRest: { ...rest[i], modelId, metersPerPMXUnit: scale },
    });
  });
  const skin = doc.createSkin(allowSDEF ? 'PMX mixed BDEF/SDEF' : 'PMX BDEF').setSkeleton(root);
  const inverseBinds: number[] = [];
  bones.forEach((bone, i) => {
    (bone.parentIndex < 0 ? root : nodes[bone.parentIndex]).addChild(nodes[i]);
    skin.addJoint(nodes[i]);
    const [x, y, z] = positions[i];
    inverseBinds.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1);
  });
  skin.setInverseBindMatrices(doc.createAccessor('PMX inverse binds').setBuffer(buffer).setType('MAT4').setArray(new Float32Array(inverseBinds)));
  meshNode.setSkin(skin);

  const joints = new Uint16Array(vertices.length * 4), weights = new Float32Array(vertices.length * 4);
  const adjusted: number[] = [];
  vertices.forEach((vertex, i) => {
    const count = [1, 2, 4, 2][vertex.type!];
    const indices = vertex.skinIndices, values = vertex.skinWeights;
    if (!indices || !values || indices.length !== count || values.length !== count) throw new Error(`Vertex ${i}: malformed BDEF influences`);
    if (vertex.type === 3) {
      // Retain both ordered joint slots even at endpoint weights. A duplicate
      // pair is one rigid transform for every weight, so combine its weights
      // without changing either joint index to satisfy core glTF influences.
      if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= bones.length)) throw new Error(`Vertex ${i}: invalid ordered SDEF bone`);
      if (values.some(w => !Number.isFinite(w) || w < 0 || w > 1) || Math.abs(values[0] + values[1] - 1) > BDEF_WEIGHT_TOLERANCE) throw new Error(`Vertex ${i}: invalid SDEF weights`);
      const total = values[0] + values[1];
      joints.set(indices, i * 4);
      weights.set(indices[0] === indices[1] ? [1, 0] : values.map(w => w / total), i * 4);
      return;
    }
    const merged = new Map<number, number>();
    values.forEach((weight, j) => {
      if (!Number.isFinite(weight) || weight < 0) throw new Error(`Vertex ${i}: negative/non-finite weight`);
      if (weight === 0) return; // inactive -1 references are legal; canonical padding uses joint 0.
      const index = indices[j];
      if (!Number.isInteger(index) || index < 0 || index >= bones.length) throw new Error(`Vertex ${i}: invalid active bone ${index}`);
      merged.set(index, (merged.get(index) ?? 0) + weight);
    });
    const total = values.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total) || total <= 0) throw new Error(`Vertex ${i}: zero/non-finite weight total`);
    if (Math.abs(total - 1) > BDEF_WEIGHT_TOLERANCE) throw new Error(`Vertex ${i}: materially non-unit BDEF weight sum ${total} (tolerance ${BDEF_WEIGHT_TOLERANCE})`);
    if (total !== 1) adjusted.push(i);
    let j = 0;
    for (const [index, weight] of merged) {
      joints[i * 4 + j] = index; weights[i * 4 + j] = weight / total; j++;
    }
  });
  if (adjusted.length) warnings.push(`Normalized roundoff-sized BDEF weight sums (tolerance ${BDEF_WEIGHT_TOLERANCE}) at ${adjusted.length} vertices [${adjusted.slice(0, 32).join(', ')}${adjusted.length > 32 ? ', …' : ''}].`);
  return {
    poseModel: { version: 1, modelId, metersPerPMXUnit: scale, bones: rest } as PoseModel, nodes,
    joints: doc.createAccessor('PMX joints').setBuffer(buffer).setType('VEC4').setArray(joints),
    weights: doc.createAccessor('PMX weights').setBuffer(buffer).setType('VEC4').setArray(weights),
  };
}
