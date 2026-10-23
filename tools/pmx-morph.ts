import { createHash } from 'node:crypto';
import type { Document, Buffer, Mesh, Node } from '@gltf-transform/core';
import { validateMorphModel, type MorphModel } from '../packages/mmd-morph';
import type { PMXModel } from './pmx-to-gltf';

export interface PMXMorph {
  name: string; englishName: string; type: number; elementCount: number;
  elements: { index: number; position?: number[] }[];
}
export function createMorphTargets(doc: Document, buffer: Buffer, mesh: Mesh, node: Node,
  model: PMXModel, scale: number, modelId?: string) {
  const metadata: MorphModel = {
    version: 1,
    modelId: modelId ?? createHash('sha256').update(JSON.stringify({ model, scale })).digest('hex'),
    morphs: [],
  };
  const targets = [];
  for (const [index, m] of model.morphs.entries()) {
    if (!m || !Array.isArray(m.elements) || m.elementCount !== m.elements.length)
      throw new Error(`Morph ${index}: malformed records/count`);
    const target = m.type === 1 ? targets.length : null;
    metadata.morphs.push({ index, name: m.name, englishName: m.englishName, type: m.type, target });
    if (m.type !== 1) continue;
    const values = new Array(model.vertices.length * 3).fill(0);
    for (const e of m.elements) {
      if (!e || !Number.isInteger(e.index) || e.index < 0 || e.index >= model.vertices.length ||
          !Array.isArray(e.position) || e.position.length !== 3 || !e.position.every(Number.isFinite))
        throw new Error(`Morph ${index}: invalid vertex reference or position delta`);
      // Pinned parsePmx(..., true) already reflects Z. Scale the additive delta once.
      e.position.forEach((v, axis) => { values[e.index * 3 + axis] += v * scale; });
    }
    const array = new Float32Array(values);
    if (!values.every(Number.isFinite) || !array.every(Number.isFinite))
      throw new Error(`Morph ${index}: unsupported FLOAT delta numeric range`);
    targets.push(doc.createPrimitiveTarget(`PMX morph ${index}`).setAttribute('POSITION',
      doc.createAccessor(`PMX morph ${index} delta`).setBuffer(buffer).setType('VEC3').setArray(array)));
  }
  validateMorphModel(metadata);
  node.setExtras({ ...node.getExtras(), pmxMorph: { ...metadata, morphs: metadata.morphs.map(m => ({ ...m })) } });
  if (targets.length) {
    mesh.setWeights(targets.map(() => 0));
    // Unique display names avoid GLTFLoader dictionary loss; original names live in metadata.
    mesh.setExtras({ targetNames: metadata.morphs.filter(m => m.target !== null).map(m => `${m.index}: ${m.name}`) });
  }
  return { metadata, targets };
}
