import { Box3, Sphere, Vector3, BufferGeometry, Mesh, type Object3D, type SkinnedMesh } from 'three';
import { validateMorphModel, validWeight, type MorphModel } from '../mmd-morph';
import { releaseMotion } from '../three-mmd-vpd/ownership';
export interface MorphRig { readonly root: Object3D; readonly modelId: string }
const rigs = new WeakMap<MorphRig, { model: MorphModel; meshes: Mesh[]; count: number }>();
const privateGeometry = new WeakSet<Mesh>();
/** Every material primitive shares one exact source target order. Static models work too. */
export function createMorphRig(root: Object3D): MorphRig {
  const containers: Object3D[] = [];
  root.traverse(n => { if (n.userData.pmxMorph) containers.push(n); });
  if (containers.length !== 1) throw new Error('Morph: expected one model-scoped pmxMorph identity');
  const container = containers[0], model = structuredClone(container.userData.pmxMorph) as MorphModel;
  validateMorphModel(model);
  const count = model.morphs.filter(m => m.target !== null).length, meshes: Mesh[] = [];
  container.traverse(n => { if ((n as Mesh).isMesh) meshes.push(n as Mesh); });
  if (!meshes.length) throw new Error('Morph: missing model primitives');
  for (const mesh of meshes) {
    const attrs = mesh.geometry.morphAttributes.position ?? [];
    if (attrs.length !== count || (count && (!mesh.geometry.morphTargetsRelative || mesh.morphTargetInfluences?.length !== count)) ||
        attrs.some(a => a.count !== mesh.geometry.getAttribute('position').count))
      throw new Error('Morph: inconsistent primitive target count/layout');
  }
  const rig = Object.freeze({ root, modelId: model.modelId });
  rigs.set(rig, { model, meshes, count }); return rig;
}
function state(rig: MorphRig) {
  const s = rigs.get(rig); if (!s) throw new Error('Morph: invalid rig handle'); return s;
}
export function getMorphModel(rig: MorphRig): MorphModel { return structuredClone(state(rig).model); }
export function getMorphWeights(rig: MorphRig): number[] {
  const s = state(rig); return s.count ? [...s.meshes[0].morphTargetInfluences!] : [];
}
export function refreshDeformation(root: Object3D) {
  root.updateMatrixWorld(true);
  root.traverse(n => {
    const mesh = n as SkinnedMesh;
    if (!mesh.isMesh) return;
    if (mesh.isSkinnedMesh) { mesh.skeleton.update(); mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
    else if (mesh.morphTargetInfluences?.length) {
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
  if (!Array.isArray(values) || values.length !== s.count ||
      s.meshes.some(m => s.count && m.morphTargetInfluences?.length !== s.count))
    throw new Error('Morph: invalid weight count or FLOAT numeric range');
  const copy: number[] = [];
  for (let i = 0; i < s.count; i++) {
    if (!validWeight(values[i])) throw new Error('Morph: invalid weight count or FLOAT numeric range');
    copy.push(values[i]);
  }
  return () => { for (const mesh of s.meshes) if (s.count) mesh.morphTargetInfluences!.splice(0, s.count, ...copy); };
}
export function applyMorphWeights(rig: MorphRig, values: readonly number[]) {
  const write = prepareMorphWeights(rig, values);
  releaseMotion(rig.root); write(); refreshDeformation(rig.root);
}
export function resetMorphWeights(rig: MorphRig) { applyMorphWeights(rig, new Array(state(rig).count).fill(0)); }
