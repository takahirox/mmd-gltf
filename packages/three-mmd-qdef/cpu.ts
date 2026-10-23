import { Matrix4, Quaternion, Vector3, type SkinnedMesh } from 'three';
import { assertRigid } from '../three-mmd-sdef/cpu';
/** Project rigid-dq-v1 profile; XYZW Hamilton quaternions. See the extension
 * draft for deterministic signs, exact ties and the near-degenerate limit. */
export function canonicalQuaternion(matrix: Matrix4) {
  const q = new Quaternion().setFromRotationMatrix(matrix).normalize();
  const first = [q.w, q.x, q.y, q.z].find(x => Math.abs(x) > 1e-6) ?? 1;
  if (first < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  return q;
}
export function evaluateQDEF(position: Vector3, normal: Vector3, matrices: Matrix4[], weights: number[]) {
  if (matrices.length !== weights.length || weights.length < 1 || weights.length > 4 || weights.some(w => !Number.isFinite(w) || w < 0) || Math.abs(weights.reduce((a,b)=>a+b,0)-1) > 1e-6) throw new Error('MMD_skinning_qdef: one to four nonnegative unit-sum weights required');
  const active = weights.findIndex(w => w > 0);
  if (active < 0) throw new Error('MMD_skinning_qdef: active influence required');
  const real = new Quaternion(0,0,0,0), dual = new Quaternion(0,0,0,0);
  const reference = canonicalQuaternion(matrices[active]);
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] === 0) continue;
    try { assertRigid(matrices[i], `QDEF slot ${i}`); } catch (error) { throw new Error(`MMD_skinning_qdef: ${String(error)}`); }
    const q = canonicalQuaternion(matrices[i]), e = matrices[i].elements;
    const d = new Quaternion(e[12], e[13], e[14], 0).multiply(q);
    const w = weights[i] * (reference.dot(q) < -1e-6 ? -1 : 1);
    real.set(real.x+w*q.x,real.y+w*q.y,real.z+w*q.z,real.w+w*q.w);
    dual.set(dual.x+w*d.x*0.5,dual.y+w*d.y*0.5,dual.z+w*d.z*0.5,dual.w+w*d.w*0.5);
  }
  const length = real.length();
  if (length <= 1e-8) return { position: position.clone().applyMatrix4(matrices[active]), normal: normal.clone().applyQuaternion(reference) };
  real.set(real.x/length,real.y/length,real.z/length,real.w/length);
  dual.set(dual.x/length,dual.y/length,dual.z/length,dual.w/length);
  const study = real.dot(dual);
  dual.set(dual.x-real.x*study,dual.y-real.y*study,dual.z-real.z*study,dual.w-real.w*study);
  const translation = dual.multiply(real.clone().conjugate());
  return { position: position.clone().applyQuaternion(real).add(new Vector3(translation.x,translation.y,translation.z).multiplyScalar(2)), normal: normal.clone().applyQuaternion(real) };
}
export function applyQDEF(mesh: SkinnedMesh, index: number, position: Vector3, normal?: Vector3) {
  const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  const values = Array.from({length:4},(_,i)=>weights.getComponent(index,i));
  const matrices = values.map((w,i)=>w === 0 ? new Matrix4() : mesh.bindMatrixInverse.clone().multiply(mesh.skeleton.bones[joints.getComponent(index,i)].matrixWorld).multiply(mesh.skeleton.boneInverses[joints.getComponent(index,i)]).multiply(mesh.bindMatrix));
  const result = evaluateQDEF(position, normal ?? new Vector3(), matrices, values);
  position.copy(result.position); if (normal) normal.copy(result.normal); return position;
}
