import { BufferAttribute, type Mesh, type Object3D } from 'three';
import type { GLTFWriter } from 'three/addons/exporters/GLTFExporter.js';
import { EXTENSION_NAME, QDEF_ATTRIBUTE } from './payload';
interface R186Writer { processAccessor(a: BufferAttribute): number; extensionsUsed: Record<string, boolean> }
export class MMDQDEFExporterPlugin {
  readonly name = EXTENSION_NAME;
  private writer: R186Writer;
  constructor(writer: GLTFWriter) { this.writer = writer as unknown as R186Writer; }
  writeMesh(mesh: Mesh, definition: any) {
    const source = mesh.geometry.getAttribute(QDEF_ATTRIBUTE); if (!source) return;
    const selector = this.writer.processAccessor(new BufferAttribute(new Uint8Array(Array.from({length:source.count},(_,i)=>source.getX(i))),1));
    for (const p of definition.primitives) {
      delete p.attributes._MMDQDEFSELECTION;
      p.extensions = { ...p.extensions, [EXTENSION_NAME]: { selector } };
    }
    this.writer.extensionsUsed[EXTENSION_NAME] = true;
  }
  writeNode(_object: Object3D, definition: any) { if (definition.extensions) delete definition.extensions[EXTENSION_NAME]; }
}
