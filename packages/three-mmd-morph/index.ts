import { getPhysicsSession } from '../three-mmd-physics/registry';
import { solvePose } from '../mmd-solver';
import { getSolverModel } from '../three-mmd-solver';
import { morphState, registerMorphState } from './state';
import { retainedMorph } from './plugin';
export { MMDMorphPlugin } from './plugin';
export { MMDMorphExporterPlugin } from './exporter';
import { Box3, Sphere, Vector3, BufferGeometry, Mesh, type Object3D, type SkinnedMesh } from 'three';
import { applyBoneMorphs, controlCount, reduceMorphs, validateMorphModel, validWeight, type MorphModel } from '../mmd-morph';
import { releaseMotion } from '../three-mmd-vpd/ownership';
export interface MorphRig { readonly root: Object3D; readonly modelId: string }
const rigs = new WeakMap<MorphRig, { model: MorphModel; meshes: Mesh[]; count: number }>();
const privateGeometry = new WeakSet<Mesh>();
/** Every material primitive shares one exact source target order. Static models work too. */
export function createMorphRig(root: Object3D): MorphRig {
  const containers: Object3D[] = [];
  root.traverse(n => { if (n.userData.pmxMorph) containers.push(n); });
  const retained=retainedMorph(root);
  if (containers.length !== 1 && !retained) throw new Error('Morph: expected one model-scoped pmxMorph identity');
  const container = containers[0] ?? root, model = structuredClone(retained?.model ?? container.userData.pmxMorph) as MorphModel;
  validateMorphModel(model);
  const count = model.morphs.filter(m => m.target !== null).length, meshes: Mesh[] = [];
  if(retained)meshes.push(...(morphState(root)?.meshes??[]));
  else container.traverse(n => { if ((n as Mesh).isMesh) meshes.push(n as Mesh); });
  if (!meshes.length && count) throw new Error('Morph: missing model primitives');
  for (const mesh of meshes) {
    const attrs = mesh.geometry.morphAttributes.position ?? [];
    if (attrs.length !== count || (count && (!mesh.geometry.morphTargetsRelative || mesh.morphTargetInfluences?.length !== count)) ||
        attrs.some(a => a.count !== mesh.geometry.getAttribute('position').count))
      throw new Error('Morph: inconsistent primitive target count/layout');
  }
  if(model.version===3 && !morphState(root)) {
    const nodes=new Map<number,Object3D>();
    let search=root;while(search.parent && !search.userData.mmdPose)search=search.parent;
    search.traverse(n=>{if(n.userData.pmxRest?.modelId===model.modelId)nodes.set(n.userData.pmxRest.index,n);});
    if(nodes.size!==model.bones!.length || model.bones!.some(b=>!nodes.has(b.index))) throw new Error('Morph: missing exact bone nodes; load MMDMorphPlugin for standalone contracts');
    let solver=getSolverModel(root)?.profile;
    search.traverse(n=>{if(n.userData.mmdSolver)solver=structuredClone(n.userData.mmdSolver);});
    let raw=model.bones!;
    search.traverse(n=>{if(n.userData.mmdRawPose)raw=n.userData.mmdRawPose;});
    registerMorphState(root,{model,meshes,controls:new Array(controlCount(model)).fill(0),nodes,raw:structuredClone(raw),solver});
  }
  const rig = Object.freeze({ root, modelId: model.modelId });
  rigs.set(rig, { model, meshes, count }); return rig;
}
function state(rig: MorphRig) {
  const s = rigs.get(rig); if (!s) throw new Error('Morph: invalid rig handle'); return s;
}
export function getMorphModel(rig: MorphRig): MorphModel { return structuredClone(state(rig).model); }
export function getMorphWeights(rig: MorphRig): number[] {
  const s = state(rig); return s.model.version===3 ? [...morphState(rig.root)!.controls] : s.count ? [...s.meshes[0].morphTargetInfluences!] : [];
}
/** Set updateBounds=false only when the caller manages bounds/culling itself. */
export function refreshDeformation(root: Object3D, updateBounds = true) {
  root.updateMatrixWorld(true);
  root.traverse(n => {
    const mesh = n as SkinnedMesh;
    if (!mesh.isMesh) return;
    if (mesh.isSkinnedMesh) { mesh.skeleton.update(); if (updateBounds) { mesh.computeBoundingBox(); mesh.computeBoundingSphere(); } }
    else if (updateBounds && mesh.morphTargetInfluences?.length) {
      // Static instances may share geometry; bounds for arbitrary signed weights must not leak.
      if (!privateGeometry.has(mesh)) {
        // Bounds are mutable per instance; the potentially large target buffers stay shared and immutable.
        const source = mesh.geometry, geometry = new BufferGeometry();
        geometry.name = source.name;
        geometry.index = source.index;
        geometry.attributes = { ...source.attributes };
        geometry.morphAttributes = { ...source.morphAttributes };
        geometry.morphTargetsRelative = source.morphTargetsRelative;
        geometry.groups = source.groups.map(g => ({ ...g }));
        geometry.drawRange = { ...source.drawRange };
        geometry.userData = { ...source.userData };
        mesh.geometry = geometry;
        privateGeometry.add(mesh);
      }
      const box = new Box3(), point = new Vector3();
      for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) box.expandByPoint(mesh.getVertexPosition(i, point));
      mesh.geometry.boundingBox = box;
      mesh.geometry.boundingSphere = box.getBoundingSphere(new Sphere());
    }
  });
}
/** Preparation is read-only, allowing combined writers to validate before claiming ownership. */
export function prepareMorphWeights(rig: MorphRig, values: readonly number[]) {
  const s = state(rig);
  if (!Array.isArray(values) || values.length !== controlCount(s.model) ||
      s.meshes.some(m => (m.morphTargetInfluences?.length ?? 0) !== s.count))
    throw new Error('Morph: invalid weight count or FLOAT numeric range');
  const copy: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (!validWeight(values[i])) throw new Error('Morph: invalid weight count or FLOAT numeric range');
    copy.push(values[i]);
  }
  const targets=reduceMorphs(s.model,copy).targets;
  return () => {
    if(s.model.version===3) morphState(rig.root)!.controls=[...copy];
    for (const mesh of s.meshes) if (s.count) mesh.morphTargetInfluences!.splice(0, s.count, ...targets);
  };
}
export function applyMorphWeights(rig: MorphRig, values: readonly number[]) {
  const write = prepareMorphWeights(rig, values);
  const s=morphState(rig.root),physics=getPhysicsSession(rig.root);
  const input=s ? applyBoneMorphs(s.model,values,s.raw) : undefined;
  const pose=input ? physics ? physics.pose(input) : solvePose(s!.solver,input) : undefined;
  releaseMotion(rig.root); write();
  if(s && pose) for(const b of pose) {const n=s.nodes.get(b.index)!;n.position.fromArray(b.translation);n.quaternion.fromArray(b.rotation);n.updateMatrix();}
  refreshDeformation(rig.root);
}
export function resetMorphWeights(rig: MorphRig) { applyMorphWeights(rig, new Array(controlCount(state(rig).model)).fill(0)); }
