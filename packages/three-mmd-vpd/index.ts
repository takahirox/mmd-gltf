import { resolveRawPose as rawPhysicsPose } from '../mmd-vpd';
import { getPhysicsSession } from '../three-mmd-physics/registry';
import { getSolverModel } from '../three-mmd-solver';
import { validateSolver } from '../mmd-solver';
export { MMDVPDExporterPlugin } from './exporter';
import { releaseMotion } from './ownership';
import { Matrix4, Quaternion, Vector3, type Object3D, type SkinnedMesh } from 'three';
import { bindPose, resolvePose, validatePoseModel, type PoseModel, type RestBone, type VPD, type BindingOptions, type PoseBinding } from '../mmd-vpd';
export { parseVPD, VPD_QUATERNION_TOLERANCE } from '../mmd-vpd';
export type { VPD, VPDEncoding, BindingOptions } from '../mmd-vpd';

export interface VPDRig { readonly root: Object3D; readonly modelId: string }
export interface BoundVPD { readonly unmatched: readonly string[]; readonly appliedRecords: number }
interface RigState { model: PoseModel; nodes: Map<number, Object3D>; meshes: SkinnedMesh[] }
const rigs = new WeakMap<VPDRig, RigState>();
const bindings = new WeakMap<BoundVPD, { rig: VPDRig; pose: PoseBinding }>();
/** Recover original rest from converter metadata, including when current nodes are posed. */
export function createVPDRig(root: Object3D): VPDRig {
  const containers: Object3D[] = [];
  root.traverse(node => { if (node.userData.mmdPose) containers.push(node); });
  const retained = getSolverModel(root);
  if (!containers.length && retained) {
    const model: PoseModel = { version: 1, modelId: 'MMD_skeleton_solver', metersPerPMXUnit: 1, bones: retained.profile.bones.map(({node,layer,flags,append,ik,...bone}) => structuredClone(bone)), solver: retained.profile };
    const meshes = validateSkins(root, retained.nodes, model.bones, false);
    const rig = Object.freeze({root,modelId:model.modelId}); rigs.set(rig,{model,nodes:retained.nodes,meshes}); return rig;
  }
  if (containers.length !== 1) throw new Error('VPD: expected one model-scoped mmdPose baseline; missing metadata or multiple rigs');
  const container = containers[0], metadata = container.userData.mmdPose;
  const nodes = new Map<number, Object3D>(), bones: RestBone[] = [], meshes: SkinnedMesh[] = [];
  container.traverse(node => {
    if (node === container) return;
    const identity = node.userData.pmxBone, rest = node.userData.pmxRest;
    if (!identity || !rest || rest.modelId !== metadata.modelId || rest.metersPerPMXUnit !== metadata.metersPerPMXUnit || rest.index !== identity.index || rest.name !== identity.name) throw new Error('VPD: missing or inconsistent exact bone identity/baseline metadata');
    const parentIndex = node.parent === container ? -1 : node.parent?.userData.pmxBone?.index;
    if (parentIndex !== rest.parentIndex || nodes.has(identity.index)) throw new Error('VPD: inconsistent parent or duplicate PMX index metadata');
    nodes.set(identity.index, node); bones.push(structuredClone(rest));
  });
  if (bones.length !== metadata.boneCount) throw new Error('VPD: inconsistent baseline bone count');
  const model: PoseModel = { version: metadata.version, modelId: metadata.modelId, metersPerPMXUnit: metadata.metersPerPMXUnit, bones };
  if (container.userData.mmdSolver) { validateSolver(container.userData.mmdSolver); model.solver = structuredClone(container.userData.mmdSolver); }
  if (retained) {
    // Converter extras omit glTF node references; all other solver data must agree.
    const identity = (profile: NonNullable<PoseModel['solver']>) => JSON.stringify(
      { ...profile, bones: [...profile.bones].sort((a,b) => a.index-b.index) },
      (key,value) => key === 'node' ? undefined : value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))) : value,
    );
    if (model.solver && identity(model.solver) !== identity(retained.profile) ||
        [...nodes].some(([index,node]) => retained.nodes.get(index) !== node))
      throw new Error('VPD: solver metadata differs from root contract');
    model.solver = retained.profile;
  }
  validatePoseModel(model);
  meshes.push(...validateSkins(root, nodes, bones, true));
  const rig = Object.freeze({ root, modelId: model.modelId });
  rigs.set(rig, { model, nodes, meshes }); return rig;
}
function state(rig: VPDRig) { const s = rigs.get(rig); if (!s) throw new Error('VPD: invalid rig handle; call createVPDRig'); return s; }
export function bindVPD(rig: VPDRig, pose: VPD, options: BindingOptions = {}): BoundVPD {
  const binding = bindPose(state(rig).model, pose, options);
  const result = Object.freeze({ unmatched: Object.freeze([...binding.unmatched]), appliedRecords: binding.assignments.length });
  bindings.set(result, { rig, pose: binding }); return result;
}
/** Snapshot of validated ORIGINAL rest metadata; current transforms are never captured. */
export function getVPDModel(rig: VPDRig): PoseModel { return structuredClone(state(rig).model); }
/** Shared validated local-pose writer for resolved VPD/VMD output. */
export function prepareResolvedPose(rig: VPDRig, resolved: RestBone[]) {
  const s = state(rig);
  if (
    resolved.length !== s.model.bones.length ||
    new Set(resolved.map(b => b.index)).size !== resolved.length ||
    resolved.some(b =>
      !s.nodes.has(b.index) || b.translation.length !== 3 || b.rotation.length !== 4 ||
      b.scale.length !== 3 || b.scale.some(v => v !== 1) ||
      Math.abs(Math.hypot(...b.rotation) - 1) > 1e-5 ||
      [...b.translation, ...b.rotation, ...b.scale].some(v => !Number.isFinite(v) || !Number.isFinite(Math.fround(v)))
    )
  ) throw new Error('VPD/VMD: invalid resolved pose');
  return () => {
    // All validation and resolution finishes before the first mutation.
    for (const b of resolved) {
      const node = s.nodes.get(b.index)!;
      node.position.fromArray(b.translation); node.quaternion.fromArray(b.rotation); node.scale.fromArray(b.scale); node.updateMatrix();
    }
    rig.root.updateMatrixWorld(true);
    s.meshes.forEach(mesh => { mesh.skeleton.update(); mesh.computeBoundingBox(); mesh.computeBoundingSphere(); });
  };
}
export function applyResolvedPose(rig: VPDRig, resolved: RestBone[], motion = false) {
  const write = prepareResolvedPose(rig, resolved);
  if (!motion) releaseMotion(rig.root);
  write();
}
export function applyVPD(rig: VPDRig, binding: BoundVPD) {
  const bound = bindings.get(binding);
  if (!bound || bound.rig !== rig) throw new Error('VPD: binding belongs to a different model instance; bind again for this rig');
  const physics=getPhysicsSession(rig.root);
  applyResolvedPose(rig, physics ? physics.pose(rawPhysicsPose(state(rig).model,bound.pose)) : resolvePose(state(rig).model, bound.pose));
}
export function resetVPD(rig: VPDRig) { const physics=getPhysicsSession(rig.root); applyResolvedPose(rig, physics ? physics.pose(rawPhysicsPose(state(rig).model)) : resolvePose(state(rig).model)); }

function validateSkins(root: Object3D, nodes: Map<number,Object3D>, bones: RestBone[], requireSkin: boolean): SkinnedMesh[] {
  // Validate original inverse binds against ORIGINAL rest, not posed/dirty transforms.
  const world = new Map<number, Matrix4>(), remaining = [...bones];
  while (remaining.length) {
    let progress = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const b = remaining[i];
      if (b.parentIndex !== -1 && !world.has(b.parentIndex)) continue;
      const matrix = new Matrix4().compose(new Vector3(...b.translation), new Quaternion(...b.rotation), new Vector3(...b.scale));
      if (b.parentIndex !== -1) matrix.premultiply(world.get(b.parentIndex)!);
      world.set(b.index, matrix); remaining.splice(i, 1); progress = true;
    }
    if (!progress) throw new Error('VPD: cyclic rest hierarchy');
  }
  const indices = new Map([...nodes].map(([index,node])=>[node,index]));
  const meshes: SkinnedMesh[] = [];
  root.traverse(node => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    if (mesh.skeleton.bones.some(b => !indices.has(b))) throw new Error('VPD: skin references a different model or missing source identity');
    mesh.skeleton.bones.forEach((bone, i) => {
      const inverse = mesh.skeleton.boneInverses[i];
      const expected = world.get(indices.get(bone)!)!.clone().invert();
      if (!inverse || inverse.elements.some((v, j) => !Number.isFinite(v) || Math.abs(v - expected.elements[j]) > 2e-6 * Math.max(1, Math.abs(expected.elements[j])))) throw new Error('VPD: inverse binds inconsistent with original baseline metadata');
    });
    meshes.push(mesh);
  });
  if (requireSkin && !meshes.length) throw new Error('VPD: no converter-produced BDEF skin in model scope');
  return meshes;
}
