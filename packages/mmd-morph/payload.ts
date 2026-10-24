import { validateMorphModel, controlCount, validWeight, type MorphModel } from './index';
export const EXTENSION_NAME = 'MMD_morphs';
export interface MorphPayload {
  version: 1;
  model: MorphModel;
  nodes: {index:number;node:number}[];
  meshes?: number[];
  /** Snapshot of independent controls. Loading never executes this snapshot again. */
  weights: number[];
  raw?: import('../mmd-vpd').RestBone[];
}
export function validateMorphPayload(p: MorphPayload, nodeCount=Infinity) {
  const fail=()=>{throw new Error('MMD_morphs: invalid contract, node reference or control snapshot');};
  if(!p || p.version!==1 || Object.keys(p).some(k=>!['version','model','nodes','meshes','weights','raw'].includes(k))) fail();
  validateMorphModel(p.model);
  if(p.model.version!==3 || !Array.isArray(p.nodes) || p.nodes.length!==p.model.bones!.length ||
      !Array.isArray(p.weights) || p.weights.length!==controlCount(p.model) || !Array.from(p.weights).every(validWeight)) fail();
  if(p.raw!==undefined) {
    const copy=structuredClone(p.model);copy.bones=p.raw;validateMorphModel(copy);
    if(morphIdentity([...p.raw].sort((a,b)=>a.index-b.index).map(b=>[b.index,b.name,b.parentIndex,b.scale]))!==morphIdentity([...p.model.bones!].sort((a,b)=>a.index-b.index).map(b=>[b.index,b.name,b.parentIndex,b.scale]))) fail();
  }
  const ids=new Set<number>(),nodes=new Set<number>();
  for(const b of p.nodes) {
    if(!b || Object.keys(b).some(k=>!['index','node'].includes(k)) || !p.model.bones!.some(r=>r.index===b.index) ||
        ids.has(b.index) || nodes.has(b.node) || !Number.isInteger(b.node) || b.node<0 || b.node>=nodeCount) fail();
    ids.add(b.index);nodes.add(b.node);
  }
  if(p.meshes!==undefined && (!Array.isArray(p.meshes) || p.meshes.length>65536 || new Set(p.meshes).size!==p.meshes.length || p.meshes.some(n=>!Number.isInteger(n)||n<0||n>=nodeCount||nodes.has(n))))fail();
  if(p.model.morphs.some(m=>m.target!==null) && !p.meshes?.length) fail();
}
/** Canonical equality for overlapping metadata; property order is insignificant. */
export function morphIdentity(value: unknown): string {
  return JSON.stringify(value,(_key,v)=>v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v);
}
