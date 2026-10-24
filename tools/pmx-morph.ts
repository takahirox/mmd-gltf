import { createHash } from 'node:crypto';
import type { Document, Buffer, Mesh, Node } from '@gltf-transform/core';
import { validateMorphModel, groupIssues, type MorphModel } from '../packages/mmd-morph';
import type { PMXModel } from './pmx-to-gltf';

export interface PMXMorph {
  name: string; englishName: string; type: number; elementCount: number;
  elements: { index: number; position?: number[]; ratio?: number }[];
}
export function createMorphTargets(doc: Document, buffer: Buffer, mesh: Mesh, node: Node,
  model: PMXModel, scale: number, modelId?: string) {
  if (!Array.isArray(model.morphs) || model.morphs.length > 65536 ||
      (model.metadata.morphCount !== undefined && model.metadata.morphCount !== model.morphs.length))
    throw new Error('Morph: malformed source table/count (limit 65536)');
  const metadata: MorphModel = {
    version: 2,
    modelId: modelId ?? createHash('sha256').update(JSON.stringify({ model, scale })).digest('hex'),
    morphs: Array.from(model.morphs, (m, index) => {
      if (!m || !Array.isArray(m.elements) || m.elementCount !== m.elements.length)
        throw new Error(`Morph ${index}: malformed records/count`);
      return { index, name: m.name, englishName: m.englishName, type: m.type, target: null,
        ...(m.type === 0 ? { group: m.elements.map(e => ({ index: e?.index, rate: e?.ratio as number })) } : {}) };
    }),
  };
  // Validate all source identities/references before inspecting dependencies or mutating doc.
  // Assign temporary legal layout/diagnostics only after the reference pass below.
  let entries = 0;
  for (const m of metadata.morphs) if (m.type === 0) {
    entries += m.group!.length;
    for (const e of m.group!) if (!e || !Number.isInteger(e.index) || e.index < 0 || e.index >= metadata.morphs.length ||
        !Number.isFinite(e.rate) || !Number.isFinite(Math.fround(e.rate)))
      throw new Error(`Morph ${m.index}: invalid group reference or FLOAT rate`);
  }
  if (entries > 1000000) throw new Error('Morph: group entry limit (1000000) exceeded');
  const order = metadata.morphs.filter(m => m.type === 1);
  for (const m of metadata.morphs) if (m.type === 0) {
    m.unsupported = groupIssues(metadata.morphs, m.index);
    if (!m.unsupported.length) order.push(m);
  }
  order.forEach((m, target) => { m.target = target; });
  validateMorphModel(metadata);
  const deltas = new Map<number, number[]>();
  for (const m of order) {
    const values = new Array(model.vertices.length * 3).fill(0);
    if (m.type === 1) for (const e of model.morphs[m.index].elements) {
      if (!e || !Number.isInteger(e.index) || e.index < 0 || e.index >= model.vertices.length ||
          !Array.isArray(e.position) || e.position.length !== 3 || !Array.from(e.position).every(Number.isFinite))
        throw new Error(`Morph ${m.index}: invalid vertex reference or position delta`);
      // Pinned parsers already reflect Z. Scale each source delta once.
      e.position.forEach((v, axis) => { values[e.index * 3 + axis] += v * scale; });
    }
    else for (const e of m.group!) {
      const child = deltas.get(e.index)!;
      for (let i = 0; i < values.length; i++) values[i] += e.rate * child[i];
    }
    if (!values.every(Number.isFinite) || !new Float32Array(values).every(Number.isFinite))
      throw new Error(`Morph ${m.index}: unsupported FLOAT delta numeric range`);
    deltas.set(m.index, values);
  }
  const targets = order.map(m => doc.createPrimitiveTarget(`PMX morph ${m.index}`).setAttribute('POSITION',
    doc.createAccessor(`PMX morph ${m.index} delta`).setBuffer(buffer).setType('VEC3')
      .setArray(new Float32Array(deltas.get(m.index)!))));
  node.setExtras({ ...node.getExtras(), pmxMorph: { ...metadata, morphs: metadata.morphs.map(m => ({ ...m })) } });
  if (targets.length) {
    mesh.setWeights(targets.map(() => 0));
    // Unique display names avoid GLTFLoader dictionary loss; original names live in metadata.
    mesh.setExtras({ targetNames: order.map(m => `${m.index}: ${m.name}`) });
  }
  return { metadata, targets };
}
