import { Matrix4, Quaternion, Vector3, type SkinnedMesh } from 'three';

/** Rigid means a proper orthonormal rotation plus finite translation. Never silently
 * strip joint scale/shear: that would invent an unsupported SDEF deformation. */
export function assertRigid(m: Matrix4, context = 'palette') {
  const e = m.elements, x = new Vector3().setFromMatrixColumn(m, 0), y = new Vector3().setFromMatrixColumn(m, 1), z = new Vector3().setFromMatrixColumn(m, 2);
  if (e.some(v => !Number.isFinite(v)) || Math.max(Math.abs(x.lengthSq() - 1), Math.abs(y.lengthSq() - 1), Math.abs(z.lengthSq() - 1), Math.abs(x.dot(y)), Math.abs(y.dot(z)), Math.abs(z.dot(x)), Math.abs(m.determinant() - 1), Math.abs(e[3]), Math.abs(e[7]), Math.abs(e[11]), Math.abs(e[15] - 1)) > 2e-5)
    throw new Error(`MMD_skinning_sdef: ${context}: scale/shear/reflection or non-finite transform unsupported; rigid transforms required`);
}
export function evaluateSDEF(p: Vector3, n: Vector3, c: Vector3, r0: Vector3, r1: Vector3, m0: Matrix4, m1: Matrix4, w0: number) {
  const w1 = 1 - w0, rw = r0.clone().multiplyScalar(w0).addScaledVector(r1, w1);
  const a = c.clone().addScaledVector(r0.clone().sub(rw), 0.5).applyMatrix4(m0);
  const b = c.clone().addScaledVector(r1.clone().sub(rw), 0.5).applyMatrix4(m1);
  const q = new Quaternion().setFromRotationMatrix(m0).slerp(new Quaternion().setFromRotationMatrix(m1), w1).normalize();
  return { position: p.clone().sub(c).applyQuaternion(q).addScaledVector(a, w0).addScaledVector(b, w1), normal: n.clone().applyQuaternion(q) };
}
export function validateSDEFTransforms(mesh: SkinnedMesh) {
  assertRigid(mesh.bindMatrix, 'bindMatrix');
  // Remove common scene placement before rigidity checks; scene scale is allowed.
  const inverse = mesh.bindMatrixInverse;
  mesh.skeleton.bones.forEach((bone, i) => assertRigid(inverse.clone().multiply(bone.matrixWorld).multiply(mesh.skeleton.boneInverses[i]).multiply(mesh.bindMatrix), `joint ${i}`));
}
/** Input is the already morphed local position. Return local coordinates just like
 * SkinnedMesh.applyBoneTransform, so getVertexPosition and bounds share this path. */
export function applySDEF(mesh: SkinnedMesh, index: number, position: Vector3, normal?: Vector3) {
  const g = mesh.geometry, joints = g.getAttribute('skinIndex'), weights = g.getAttribute('skinWeight');
  const local = mesh.bindMatrixInverse;
  const matrices = [joints.getX(index), joints.getY(index)].map(i => local.clone().multiply(mesh.skeleton.bones[i].matrixWorld).multiply(mesh.skeleton.boneInverses[i]).multiply(mesh.bindMatrix));
  matrices.forEach((m, i) => assertRigid(m, `vertex ${index} slot ${i}`));
  const c = new Vector3().fromBufferAttribute(g.getAttribute('mmdSdefC'), index);
  const r0 = new Vector3().fromBufferAttribute(g.getAttribute('mmdSdefR0'), index), r1 = new Vector3().fromBufferAttribute(g.getAttribute('mmdSdefR1'), index);
  const result = evaluateSDEF(position, normal ?? new Vector3(), c, r0, r1, matrices[0], matrices[1], weights.getX(index));
  position.copy(result.position);
  if (normal) normal.copy(result.normal);
  return position;
}
