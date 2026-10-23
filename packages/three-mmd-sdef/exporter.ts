import { BufferAttribute, type Object3D, type Mesh } from 'three';
import { EXTENSION_NAME, attributes, fields } from './payload';
import type { GLTFWriter } from 'three/addons/exporters/GLTFExporter.js';
interface R186Writer { processAccessor(a: BufferAttribute): number; extensionsUsed: Record<string, boolean> }

/** GLTFExporter adapter for r186. Resolve newly written accessors instead of copying
 * loader userData.gltfExtensions indices from the original document. */
export class MMDSDEFExporterPlugin {
  readonly name = EXTENSION_NAME;
  private writer: R186Writer;
  constructor(writer: GLTFWriter) { this.writer = writer as unknown as R186Writer; }
  writeMesh(mesh: Mesh, definition: any) {
    if (!mesh.geometry.hasAttribute(attributes[0])) return;
    const payload: Record<string, number> = {};
    attributes.forEach((name, i) => {
      const source = mesh.geometry.getAttribute(name), size = i === 0 ? 1 : 3;
      const values = i === 0 ? new Uint8Array(source.count) : new Float32Array(source.count * size);
      for (let v = 0; v < source.count; v++) for (let c = 0; c < size; c++) values[v * size + c] = source.getComponent(v, c);
      payload[fields[i]] = this.writer.processAccessor(new BufferAttribute(values, size));
    });
    for (const p of definition.primitives) {
      // Internal integration attributes are serialized solely by this extension.
      for (const k of Object.keys(p.attributes)) if (k.startsWith('_MMDSDEF') || k === '_MMDSKINNINGTYPE') delete p.attributes[k];
      p.extensions = { ...p.extensions, [EXTENSION_NAME]: payload };
    }
    this.writer.extensionsUsed[EXTENSION_NAME] = true;
  }
  writeNode(_object: Object3D, definition: any) {
    // GLTFLoader may preserve unknown primitive payloads on object userData.
    // Only the primitive adapter above may create SDEF accessor references.
    if (definition.extensions) delete definition.extensions[EXTENSION_NAME];
  }
}
