/** Independent fixture predictions. Decimal authoring parameters, scalar interpolation,
 * additive offsets BEFORE the existing scalar BDEF prediction. No production evaluator. */
import { scalarPosition, type MotionCase } from './vmd-oracle';
import { rigScale, type RigCase } from './vpd-oracle';
export function morphWeights(motion: MotionCase, seconds: number) {
  const f = seconds * 30;
  const linear = (frames: number[], weights: number[]) => {
    if (f <= frames[0]) return weights[0];
    if (f >= frames.at(-1)!) return weights.at(-1)!;
    const hi = frames.findIndex(v => v >= f), lo = hi - 1;
    return (weights[lo] * (frames[hi] - f) + weights[hi] * (f - frames[lo])) / (frames[hi] - frames[lo]);
  };
  return motion === 'a' ? [linear([6,15,30],[0,0.9,1.3]),0.65,0,0,0] :
    [linear([3,20,45],[0.7,1.2,-0.2]),linear([0,40],[0.4,0.9]),0,0,0];
}
export function morphPoint(rig: RigCase, motion: MotionCase, vertex: number, time: number, point: number[]) {
  const [a,b] = morphWeights(motion,time), s = rigScale[rig];
  return [point[0] + s * (0.25*a - 0.1*b),
    point[1] + s * ((vertex % 4 > 0 ? 0.3 : 0.1)*a + 0.15*b),
    point[2] - s * (0.2*a + (vertex % 2 ? -0.3 : 0.1)*b)];
}
export function morphPosition(rig: RigCase, motion: MotionCase, vertex: number, time: number, point: number[]) {
  return scalarPosition(rig,motion,vertex,time,morphPoint(rig,motion,vertex,time,point));
}
