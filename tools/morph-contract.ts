import { Extension, type Node, type WriterContext } from '@gltf-transform/core';
import { EXTENSION_NAME, validateMorphPayload, type MorphPayload } from '../packages/mmd-morph/payload';
import { controlCount, type MorphModel } from '../packages/mmd-morph';
export class MorphWriter extends Extension {
  static EXTENSION_NAME=EXTENSION_NAME;
  readonly extensionName=EXTENSION_NAME;
  record?: {model:MorphModel;nodes:Node[];mesh:Node;raw?:import('../packages/mmd-vpd').RestBone[]};
  read():this { throw new Error('MorphWriter is converter-only'); }
  write(context:WriterContext):this {
    if(!this.record)return this;
    const {model,nodes,mesh,raw}=this.record;
    const payload:MorphPayload={version:1,model:structuredClone(model),...(raw?{raw:structuredClone(raw)}:{}),nodes:model.bones!.map(b=>({index:b.index,node:context.nodeIndexMap.get(nodes[b.index])!})),
      meshes:[context.nodeIndexMap.get(mesh)!],weights:new Array(controlCount(model)).fill(0)};
    validateMorphPayload(payload,context.jsonDoc.json.nodes!.length);
    context.jsonDoc.json.extensions={...context.jsonDoc.json.extensions,[EXTENSION_NAME]:payload};
    return this;
  }
}
