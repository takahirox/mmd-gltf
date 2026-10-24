import type { Object3D } from 'three';
import { motionScope } from '../three-mmd-vpd/ownership';
import type { RestBone } from '../mmd-vpd';
import type { SolverProfile } from '../mmd-solver';
import { applyBoneMorphs, type MorphModel } from '../mmd-morph';
export interface MorphState {
  model:MorphModel; controls:number[]; raw:RestBone[];
  nodes:Map<number,Object3D>; solver?:SolverProfile;
}
const states=new WeakMap<Object3D,MorphState>();
export function morphState(root:Object3D) { return states.get(motionScope(root)); }
export function registerMorphState(root:Object3D,state:MorphState) {
  const key=motionScope(root), previous=states.get(key);
  if(previous)return previous;
  states.set(key,state);return state;
}
export function retainRawMorphPose(root:Object3D,raw:RestBone[]) {
  const s=morphState(root); if(s)s.raw=raw.map(({index,name,parentIndex,translation,rotation,scale})=>({index,name,parentIndex,translation:[...translation],rotation:[...rotation],scale:[...scale]}));
}
export function composeMorphPose(root:Object3D,raw:RestBone[]) {
  const s=morphState(root);return s ? applyBoneMorphs(s.model,s.controls,raw) : raw;
}
