/** Independent authored-fixture oracle. Joint transforms come from scalar VPD/VMD
 * authoring predictions, never runtime bones, emitted geometry or SDEF evaluators.
 * Center correction is expanded into the pair's difference, rather than CR0/CR1. */
import { Matrix4, Matrix3, Quaternion, Vector3 } from 'three';
import { localPrediction, rotate, restWorld, rigScale, type RigCase } from './vpd-oracle';
import { scalarLocal, parent, type MotionCase } from './vmd-oracle';
import { morphPoint } from './morph-oracle';
export type SDEFState = 'rest' | 'pose-a' | 'pose-b' | 'a' | 'b';
export function sourceVertex(rig: RigCase, index: number) {
  const faces = [
    [[0,0,1],[0,2,1],[2,2,1],[2,0,1]], [[2,0,3],[2,2,3],[0,2,3],[0,0,3]],
    [[0,0,3],[0,2,3],[0,2,1],[0,0,1]], [[2,0,1],[2,2,1],[2,2,3],[2,0,3]],
    [[0,2,1],[0,2,3],[2,2,3],[2,2,1]], [[0,0,3],[0,0,1],[2,0,1],[2,0,3]],
  ];
  const normals = [[0,0,-1],[0,0,1],[-1,0,0],[1,0,0],[0,1,0],[0,-1,0]];
  const f = Math.floor(index / 4), p = [...faces[f][index % 4]], n = [...normals[f]];
  if (rig === 'wedge') { p[0] = p[0] * 0.75 + p[1] * 0.2; n[1] -= n[0] * 0.2 / 0.75; n[0] /= 0.75; }
  p[2] *= -1; n[2] *= -1;
  return { position: new Vector3(...p.map(v => v * rigScale[rig]) as [number,number,number]), normal: new Vector3(...n as [number,number,number]).normalize() };
}
export function oraclePalette(rig: RigCase, state: SDEFState, index: number, time: number): Matrix4 {
  const posed = state.startsWith('pose-'), pose = posed ? state.slice(-1) as 'a'|'b' : 'rest';
  let local: Matrix4;
  if (posed || state === 'rest') {
    const columns = [[1,0,0],[0,1,0],[0,0,1]].map(v => rotate(pose, index, v));
    local = new Matrix4().makeBasis(...columns.map(v => new Vector3(...v as [number,number,number])) as [Vector3,Vector3,Vector3]);
    local.setPosition(new Vector3(...localPrediction(rig, pose, index) as [number,number,number]));
  } else {
    const s = scalarLocal(rig, state as MotionCase, index, time);
    local = new Matrix4().compose(new Vector3(...s.translation as [number,number,number]), new Quaternion(...s.rotation as [number,number,number,number]), new Vector3(1,1,1));
  }
  const p = parent(rig, index);
  const world = p < 0 ? local : oracleWorld(rig, state, p, time).multiply(local);
  return world.multiply(new Matrix4().makeTranslation(...restWorld(rig, index).map(x => -x) as [number,number,number]));
}
function oracleWorld(rig: RigCase, state: SDEFState, index: number, time: number) {
  return oraclePalette(rig, state, index, time).multiply(new Matrix4().makeTranslation(...restWorld(rig,index) as [number,number,number]));
}
export function sdefPrediction(rig: RigCase, state: SDEFState, index: number, time = 0, approximation = false) {
  let { position: p, normal: n } = sourceVertex(rig,index);
  if (state === 'a' || state === 'b') p.fromArray(morphPoint(rig,state,index,time,p.toArray()));
  const a = oraclePalette(rig,state,259,time), b = oraclePalette(rig,state,2,time);
  const slot = index % 4, w = slot === 1 ? 0.25 : slot === 2 ? 0 : 1;
  if (slot === 0 || approximation) return { p: p.clone().applyMatrix4(a).multiplyScalar(w).addScaledVector(p.clone().applyMatrix4(b),1-w), n: n.clone().applyMatrix3(new Matrix3().setFromMatrix4(a)).multiplyScalar(w).addScaledVector(n.clone().applyMatrix3(new Matrix3().setFromMatrix4(b)),1-w).normalize() };
  const scale = rigScale[rig], zero = index < 4;
  const c = new Vector3(...(zero ? [0,0,0] : [0.5,1,-2]).map(x => x * scale) as [number,number,number]);
  const d = new Vector3(...(zero ? [0,0,0] : [0.5,-0.5,1]).map(x => x * scale) as [number,number,number]);
  const qa = new Quaternion().setFromRotationMatrix(a), qb = new Quaternion().setFromRotationMatrix(b);
  // Explicit trig interpolation, including closest sign and identical limit.
  if (qa.dot(qb) < 0) qb.set(-qb.x,-qb.y,-qb.z,-qb.w);
  const angle = Math.acos(Math.min(1,qa.dot(qb))), t = 1-w;
  const ca = angle < 1e-8 ? 1-t : Math.sin((1-t)*angle)/Math.sin(angle), cb = angle < 1e-8 ? t : Math.sin(t*angle)/Math.sin(angle);
  const q = new Quaternion(qa.x*ca+qb.x*cb,qa.y*ca+qb.y*cb,qa.z*ca+qb.z*cb,qa.w*ca+qb.w*cb).normalize();
  const correction = d.clone().applyMatrix3(new Matrix3().setFromMatrix4(a)).sub(d.clone().applyMatrix3(new Matrix3().setFromMatrix4(b))).multiplyScalar(w*(1-w)/2);
  return { p: p.sub(c).applyQuaternion(q).addScaledVector(c.clone().applyMatrix4(a),w).addScaledVector(c.clone().applyMatrix4(b),1-w).add(correction), n: n.applyQuaternion(q).normalize() };
}
