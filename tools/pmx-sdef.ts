import { Extension, type Accessor, type Buffer, type Document, type Primitive, type WriterContext } from '@gltf-transform/core';
import type { PMXModel } from './pmx-to-gltf';
import { EXTENSION_NAME, type SDEFPayload } from '../packages/three-mmd-sdef/payload';

export type SDEFAttributes = Record<keyof SDEFPayload, Accessor>;
export function createSDEFAttributes(doc: Document, buffer: Buffer, model: PMXModel, scale: number): SDEFAttributes | null {
  if (!model.vertices.some(v => v.type === 3)) return null;
  const vectors = (field: 'skinC' | 'skinR0' | 'skinR1') => new Float32Array(model.vertices.flatMap((v, i) => {
    if (v.type !== 3) return [0, 0, 0];
    const value = v[field];
    if (!value || value.length !== 3 || !value.every(x => Number.isFinite(x) && Number.isFinite(Math.fround(x * scale)))) throw new Error(`Vertex ${i}: invalid SDEF ${field} vector/FLOAT range`);
    // Pinned parser already reflected Z; metric scaling happens here only.
    return value.map(x => x * scale);
  }));
  return {
    selector: doc.createAccessor('SDEF selection').setBuffer(buffer).setType('SCALAR').setArray(new Uint8Array(model.vertices.map(v => v.type === 3 ? 1 : 0))),
    c: doc.createAccessor('SDEF C').setBuffer(buffer).setType('VEC3').setArray(vectors('skinC')),
    r0: doc.createAccessor('SDEF R0').setBuffer(buffer).setType('VEC3').setArray(vectors('skinR0')),
    r1: doc.createAccessor('SDEF R1').setBuffer(buffer).setType('VEC3').setArray(vectors('skinR1')),
  };
}
/** Accessor references are resolved by the writer, never stored as stale JSON indices. */
export class SDEFWriter extends Extension {
  static EXTENSION_NAME = EXTENSION_NAME;
  readonly extensionName = EXTENSION_NAME;
  records = new Map<Primitive, SDEFAttributes>();
  read(): this { throw new Error('SDEFWriter is converter-only'); }
  write(context: WriterContext): this {
    for (const mesh of this.document.getRoot().listMeshes()) {
      const def = context.jsonDoc.json.meshes![context.meshIndexMap.get(mesh)!];
      mesh.listPrimitives().forEach((primitive, i) => {
        const attributes = this.records.get(primitive);
        if (!attributes) return;
        def.primitives[i].extensions = { ...def.primitives[i].extensions, [EXTENSION_NAME]: Object.fromEntries(Object.entries(attributes).map(([key, a]) => [key, context.accessorIndexMap.get(a)!])) };
      });
    }
    return this;
  }
}
