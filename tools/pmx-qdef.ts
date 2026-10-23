import { Extension, type Accessor, type Primitive, type WriterContext, type Document, type Buffer } from '@gltf-transform/core';
import { EXTENSION_NAME } from '../packages/three-mmd-qdef/payload';
import type { PMXModel } from './pmx-to-gltf';
export function createQDEFSelector(doc: Document, buffer: Buffer, model: PMXModel) {
  return model.vertices.some(v=>v.type===4) ? doc.createAccessor('QDEF selection').setBuffer(buffer).setType('SCALAR').setArray(new Uint8Array(model.vertices.map(v=>v.type===4?1:0))) : null;
}
export class QDEFWriter extends Extension {
  static EXTENSION_NAME = EXTENSION_NAME;
  readonly extensionName = EXTENSION_NAME;
  records = new Map<Primitive, Accessor>();
  read(): this { throw new Error('QDEFWriter is converter-only'); }
  write(context: WriterContext): this {
    for (const mesh of this.document.getRoot().listMeshes()) {
      const definition = context.jsonDoc.json.meshes![context.meshIndexMap.get(mesh)!];
      mesh.listPrimitives().forEach((primitive,i)=>{
        const selector = this.records.get(primitive); if (!selector) return;
        definition.primitives[i].extensions = { ...definition.primitives[i].extensions, [EXTENSION_NAME]: {selector:context.accessorIndexMap.get(selector)!} };
      });
    }
    return this;
  }
}
