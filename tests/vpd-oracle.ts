/** Independent scalar oracle for the authored fixtures. No production pose code,
 * joint matrices, inverse binds, or emitted influence attributes are used. */
export type RigCase = 'box' | 'wedge';
export type PoseCase = 'rest' | 'a' | 'b';
export const rigScale = { box: 0.2, wedge: 0.125 };
export const mappings = { a: { '2': 0, '3': 259 }, b: { '0': 259 } };
const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
const subtract = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
export function restWorld(rig: RigCase, index: number) {
  const p = index === 1 ? [1, 0, -2] : index === 0 ? [1, 1, -2] : index === 259 ? (rig === 'box' ? [1, 2, -2] : [0.5, 1.5, -2.5]) : [-1, 0, -1];
  return p.map(v => v * rigScale[rig]);
}
function parent(rig: RigCase, index: number) { return index === 0 ? 1 : index === 259 ? (rig === 'box' ? 0 : 2) : index === 1 || index === 2 ? -1 : 2; }
function offset(pose: PoseCase, index: number) {
  if (pose === 'a') return index === 1 ? [0.25, -0.125, -0.5] : index === 2 ? [-0.125, 0.25, 0.25] : index === 0 ? [0.125, 0, -0.25] : index === 259 ? [0, 0.125, 0.125] : [0, 0, 0];
  if (pose === 'b') return index === 1 ? [-0.125, 0.25, 0.25] : index === 2 ? [0.25, -0.125, -0.125] : index === 259 ? [-0.25, 0, -0.25] : [0, 0, 0];
  return [0, 0, 0];
}
export function rotate(pose: PoseCase, index: number, [x, y, z]: number[]) {
  if (pose === 'a') {
    if (index === 1) return [x, z, -y]; // reflected source +X quarter turn
    if (index === 0) return [-z, y, x]; // reflected source +Y quarter turn
    if (index === 259) return [-y, x, z];
  }
  if (pose === 'b') {
    if (index === 1) return [y, -x, z];
    if (index === 2) return [-z, y, x];
    if (index === 259) return [x, -z, y];
  }
  return [x, y, z];
}
export function localPrediction(rig: RigCase, pose: PoseCase, index: number) {
  const p = parent(rig, index);
  return add(subtract(restWorld(rig, index), p === -1 ? [0, 0, 0] : restWorld(rig, p)), offset(pose, index).map(v => v * rigScale[rig]));
}
function transform(rig: RigCase, pose: PoseCase, index: number, point: number[], normal: boolean): number[] {
  const rotated = rotate(pose, index, point);
  const local = normal ? rotated : add(rotated, localPrediction(rig, pose, index));
  const p = parent(rig, index);
  return p === -1 ? local : transform(rig, pose, p, local, normal);
}
const patterns = [ [[259, 1]], [[0, 0.25], [2, 0.75]], [[0, 0.1], [1, 0.2], [2, 0.3], [259, 0.4]], [[259, 0.75], [2, 0.25]] ];
export function vpdPrediction(rig: RigCase, pose: PoseCase, p: number[], n: number[], vertex: number, hull: boolean) {
  const influences = patterns[vertex % 4], position = [0, 0, 0];
  const columns = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [joint, weight] of influences) {
    transform(rig, pose, joint, subtract(p, restWorld(rig, joint)), false).forEach((v, axis) => { position[axis] += weight * v; });
    for (let axis = 0; axis < 3; axis++) transform(rig, pose, joint, [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0], true).forEach((v, row) => { columns[axis][row] += weight * v; });
  }
  const [a, b, c] = columns;
  let normal: number[];
  if (hull) {
    const cross = (x: number[], y: number[]) => [x[1]*y[2]-x[2]*y[1], x[2]*y[0]-x[0]*y[2], x[0]*y[1]-x[1]*y[0]];
    const co = [cross(b, c), cross(c, a), cross(a, b)];
    const determinant = a.reduce((sum, v, i) => sum + v * co[0][i], 0);
    if (Math.abs(determinant) < 1e-8) throw new Error('Authored oracle is singular');
    normal = n.map((_, row) => co.reduce((sum, col, axis) => sum + col[row] * n[axis], 0) / determinant);
  } else normal = n.map((_, row) => columns.reduce((sum, col, axis) => sum + col[row] * n[axis], 0));
  return { p: position, n: normal };
}
