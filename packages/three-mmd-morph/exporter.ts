import type { Object3D } from 'three';
import type { GLTFWriter } from 'three/addons/exporters/GLTFExporter.js';
import { morphState } from './state';
import { EXTENSION_NAME, validateMorphPayload, type MorphPayload } from '../mmd-morph/payload';
interface Writer {nodeMap:Map<Object3D,number>;extensionsUsed:Record<string,boolean>;json:any}
export class MMDMorphExporterPlugin {
  readonly name=EXTENSION_NAME;
  constructor(private writer:GLTFWriter) {}
  afterParse(input:Object3D|Object3D[]) {
    const w=this.writer as unknown as Writer,seen=new Set<object>();
    for(const root of Array.isArray(input)?input:[input]) root.traverse(n=>{
      const s=morphState(n);if(!s || seen.has(s))return;seen.add(s);
      if(w.json.extensions?.[EXTENSION_NAME])throw new Error('MMD_morphs: export one model per asset');
      const meshes:number[]=[];
      root.traverse(n=>{if((n as import('three').Mesh).isMesh && w.nodeMap.has(n))meshes.push(w.nodeMap.get(n)!);});
      const payload:MorphPayload={version:1,model:structuredClone(s.model),nodes:[...s.nodes].map(([index,n])=>({index,node:w.nodeMap.get(n)!})),
        weights:[...s.controls],raw:structuredClone(s.raw),meshes};
      validateMorphPayload(payload,w.json.nodes?.length??0);
      for(const {node,index} of payload.nodes) {
        const def=w.json.nodes[node],n=s.nodes.get(index)!;
        delete def.matrix;def.translation=n.position.toArray();def.rotation=n.quaternion.toArray();def.scale=n.scale.toArray();
      }
      w.json.extensions={...w.json.extensions,[EXTENSION_NAME]:payload};w.extensionsUsed[EXTENSION_NAME]=true;
    });
  }
}
