import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Frame, PhysicsProfile } from '../packages/mmd-physics';
const frame=(f:Frame)=>new Matrix4().compose(new Vector3(...f.translation),new Quaternion(...f.rotation),new Vector3(1,1,1));
/** Measure actual native joint frames, independently of the runtime stabilizer.
 * Bullet matrixToEulerXYZ is the negative intrinsic ZYX decomposition. */
export function jointViolations(profile:PhysicsProfile,bodies:Record<number,ArrayLike<number>>) {
  return profile.joints.map(j=>{
    const a=new Matrix4().fromArray(bodies[j.bodyA]).multiply(frame(j.frameA));
    const b=new Matrix4().fromArray(bodies[j.bodyB]).multiply(frame(j.frameB));
    const relative=a.invert().multiply(b),euler=new Euler().setFromRotationMatrix(relative,'ZYX');
    const violation=(values:number[],lower:number[],upper:number[])=>Math.max(0,...values.map((v,k)=>lower[k]>upper[k]?0:Math.max(lower[k]-v,v-upper[k],0)));
    const linear=violation(new Vector3().setFromMatrixPosition(relative).toArray(),j.linearLower,j.linearUpper);
    const angle=[-euler.x,-euler.y,-euler.z],bounded=(v:number)=>Math.max(-Math.PI,Math.min(Math.PI,v));
    const angular=Math.max(0,...angle.map((v,k)=>j.angularLower[k]>j.angularUpper[k]?0:Math.max(bounded(j.angularLower[k])-v,v-bounded(j.angularUpper[k]),0)));
    return {index:j.index,linear,angular};
  });
}
/** Small single-body chains resolve to float precision. Gene's closed cloak
 * network (51..67) joins separately animated shoulder/torso anchors and retains
 * finite linear strain. Never grant that tolerance to the locked counterweights
 * (68..76), which caused the original 0.46 m / 0.77 rad regression. */
export function jointBounds(model:string,index:number) {
  if(model.startsWith('gene') && index>=68 && index<=76)return {linear:2e-5,angular:2e-5};
  return {linear:model.startsWith('gene') && index>=51 && index<=67?.03:2e-4,angular:.005};
}
