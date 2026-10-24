/** Independent decimal fixture predictions. No production group compiler or evaluator. */
import { scalarPosition, type MotionCase } from './vmd-oracle';
import { rigScale, type RigCase } from './vpd-oracle';
export function groupWeights(motion: MotionCase, time: number) {
  const f=Math.max(0,Math.min(motion==='a'?30:45,time*30)), mid=motion==='a'?15:20, end=motion==='a'?30:45;
  const lerp=(v:number[])=> f<=mid ? v[0]+(v[1]-v[0])*f/mid : v[1]+(v[2]-v[1])*(f-mid)/(end-mid);
  return motion==='a' ? [lerp([0,0.3,0.3]),0,0,0,lerp([0.8,0.8,-0.4]),lerp([0,0.2,-0.1]),0,0] :
    [lerp([-0.2,0.6,0.1]),0,0,0,lerp([1.2,-0.5,0.4]),lerp([0.3,0,0.7]),0,0];
}
export function groupPoint(rig:RigCase,motion:MotionCase,vertex:number,time:number,point:number[]) {
  const w=groupWeights(motion,time), a=w[0]+0.5*w[4]+0.5*w[5], b=-0.5*w[5], s=rigScale[rig];
  return [point[0]+s*(0.25*a-0.1*b),point[1]+s*((vertex%4>0?0.3:0.1)*a+0.15*b),point[2]-s*(0.2*a+(vertex%2?-0.3:0.1)*b)];
}
export function groupPosition(rig:RigCase,motion:MotionCase,vertex:number,time:number,point:number[]) {
  return scalarPosition(rig,motion,vertex,time,groupPoint(rig,motion,vertex,time,point));
}
