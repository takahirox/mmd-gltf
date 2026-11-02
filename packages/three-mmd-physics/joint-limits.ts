import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Frame, PhysicsProfile } from '../mmd-physics';

const frame=(f:Frame)=>new Matrix4().compose(new Vector3(...f.translation),new Quaternion(...f.rotation),new Vector3(1,1,1));
const bounded=(v:number)=>Math.max(-Math.PI,Math.min(Math.PI,v));

/** Measure the final native frames, including locked-cluster writeback.
 * Bullet's matrixToEulerXYZ uses negative intrinsic ZYX angles. Inverted
 * source limits describe free axes, not malformed or clamped constraints. */
export function jointAngularErrors(profile:PhysicsProfile,bodies:ReadonlyMap<number,ArrayLike<number>>) {
  return profile.joints.map(j=>{
    const a=new Matrix4().fromArray(bodies.get(j.bodyA)!).multiply(frame(j.frameA));
    const b=new Matrix4().fromArray(bodies.get(j.bodyB)!).multiply(frame(j.frameB));
    const relative=a.invert().multiply(b);
    if(relative.elements.some(v=>!Number.isFinite(v)))return {index:j.index,angular:Infinity};
    const e=new Euler().setFromRotationMatrix(relative,'ZYX');
    const angular=Math.max(0,...[-e.x,-e.y,-e.z].map((v,k)=>j.angularLower[k]>j.angularUpper[k]?0:
      Math.max(bounded(j.angularLower[k])-v,v-bounded(j.angularUpper[k]),0)));
    return {index:j.index,angular};
  });
}
