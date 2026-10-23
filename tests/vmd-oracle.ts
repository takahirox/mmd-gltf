/** Independent scalar oracle. Fixture authoring parameters are restated deliberately.
 * Polynomial Newton inversion, axis-angle rotations and scalar hierarchy/skin sums;
 * no production evaluator, quaternion slerp, joint matrix, inverse bind or fallback sample. */
import { restWorld, rigScale, type RigCase } from './vpd-oracle';
export type MotionCase = 'a' | 'b';
const cp = [
  [20, 5, 100, 120],
  [50, 100, 90, 10],
  [10, 110, 110, 30],
  [35, 0, 90, 127],
];
export function weight(axis: number, u: number) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const [a, b, c, d] = cp[axis].map((v) => v / 127);
  // Horner polynomial and bounded Newton; different formulation from production bisection.
  const A = 1 + 3 * a - 3 * c,
    B = 3 * c - 6 * a,
    C = 3 * a;
  let s = u;
  for (let i = 0; i < 40; i++) {
    const error = ((A * s + B) * s + C) * s - u,
      derivative = (3 * A * s + 2 * B) * s + C;
    if (Math.abs(error) < 1e-15) break;
    s = Math.max(0, Math.min(1, s - error / derivative));
  }
  return ((1 + 3 * b - 3 * d) * s + 3 * d - 6 * b) * s * s + 3 * b * s;
}
function definition(motion: MotionCase, index: number) {
  if (motion === 'a') {
    if (index === 1)
      return {
        axis: 0,
        frames: [6, 7, 30],
        translations: [
          [0, 0, 0],
          [0.1, -0.1, 0.05],
          [0.25, -0.125, 0.5],
        ],
        angles: [0, 0.2, 0.9],
      };
    if (index === 0)
      return {
        axis: 1,
        frames: [0, 30],
        translations: [
          [0.1, 0, 0],
          [-0.125, 0.25, -0.1],
        ],
        angles: [0.1, -0.7],
      };
    if (index === 259)
      return {
        axis: 2,
        frames: [3, 30],
        translations: [
          [0, 0.1, 0],
          [0.125, -0.2, 0.25],
        ],
        angles: [-0.2, 0.6],
      };
  } else {
    if (index === 1)
      return {
        axis: 2,
        frames: [4, 20, 40],
        translations: [
          [-0.125, 0.1, 0.2],
          [0.2, 0, -0.1],
          [-0.25, 0.25, 0],
        ],
        angles: [0.25, -0.8, 0.4],
      };
    if (index === 2)
      return {
        axis: 1,
        frames: [0, 40],
        translations: [
          [0, 0, 0],
          [0.25, -0.125, 0.125],
        ],
        angles: [-0.1, 0.7],
      };
    if (index === 259)
      return {
        axis: 0,
        frames: [8, 40],
        translations: [
          [0.1, 0, 0],
          [-0.125, 0.1, 0.25],
        ],
        angles: [0.3, -0.6],
      };
  }
  return undefined;
}
export function scalarSample(motion: MotionCase, index: number, time: number) {
  const d = definition(motion, index);
  if (!d) return { axis: 0, angle: 0, translation: [0, 0, 0] };
  const frames = d.frames,
    frame = Math.max(frames[0], Math.min(frames.at(-1)!, time * 30));
  let hi = frames.findIndex((f) => f >= frame);
  if (hi < 0) hi = frames.length - 1;
  const lo = Math.max(0, hi - 1);
  const u = hi === lo ? 0 : (frame - frames[lo]) / (frames[hi] - frames[lo]);
  const angle = d.angles[lo] + (d.angles[hi] - d.angles[lo]) * weight(3, u);
  return {
    axis: d.axis,
    angle: angle * (d.axis === 2 ? 1 : -1),
    translation: d.translations[lo].map(
      (v, i) => (v + (d.translations[hi][i] - v) * weight(i, u)) * (i === 2 ? -1 : 1),
    ),
  };
}
export function parent(rig: RigCase, index: number) {
  return index === 0 ? 1 : index === 259 ? (rig === 'box' ? 0 : 2) : index === 1 || index === 2 ? -1 : 2;
}
export function scalarLocal(rig: RigCase, motion: MotionCase, index: number, time: number) {
  const p = parent(rig, index),
    b = restWorld(rig, index),
    base = p < 0 ? [0, 0, 0] : restWorld(rig, p),
    s = scalarSample(motion, index, time);
  const q = [0, 0, 0, Math.cos(s.angle / 2)];
  q[s.axis] = Math.sin(s.angle / 2);
  return { translation: b.map((v, i) => v - base[i] + s.translation[i] * rigScale[rig]), rotation: q };
}
function rotate(p: number[], axis: number, angle: number) {
  const a = (axis + 1) % 3,
    b = (axis + 2) % 3,
    result = [...p],
    c = Math.cos(angle),
    s = Math.sin(angle);
  result[a] = p[a] * c - p[b] * s;
  result[b] = p[a] * s + p[b] * c;
  return result;
}
function transform(rig: RigCase, motion: MotionCase, index: number, time: number, point: number[]): number[] {
  const s = scalarSample(motion, index, time),
    local = scalarLocal(rig, motion, index, time),
    r = rotate(point, s.axis, s.angle).map((v, i) => v + local.translation[i]),
    p = parent(rig, index);
  return p === -1 ? r : transform(rig, motion, p, time, r);
}
const influences = [
  [[259, 1]],
  [
    [0, 0.25],
    [2, 0.75],
  ],
  [
    [0, 0.1],
    [1, 0.2],
    [2, 0.3],
    [259, 0.4],
  ],
  [
    [259, 0.75],
    [2, 0.25],
  ],
];
export function scalarPosition(
  rig: RigCase,
  motion: MotionCase,
  vertex: number,
  time: number,
  point: number[],
) {
  const out = [0, 0, 0];
  for (const [index, w] of influences[vertex % 4]) {
    const rest = restWorld(rig, index),
      p = transform(
        rig,
        motion,
        index,
        time,
        point.map((v, i) => v - rest[i]),
      );
    p.forEach((v, i) => {
      out[i] += v * w;
    });
  }
  return out;
}
function direction(rig: RigCase, motion: MotionCase, index: number, time: number, point: number[]): number[] {
  const s = scalarSample(motion, index, time),
    r = rotate(point, s.axis, s.angle),
    p = parent(rig, index);
  return p === -1 ? r : direction(rig, motion, p, time, r);
}
export function scalarNormal(
  rig: RigCase,
  motion: MotionCase,
  vertex: number,
  time: number,
  normal: number[],
  hull: boolean,
) {
  const columns = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const [index, w] of influences[vertex % 4])
    for (let axis = 0; axis < 3; axis++)
      direction(rig, motion, index, time, [
        axis === 0 ? 1 : 0,
        axis === 1 ? 1 : 0,
        axis === 2 ? 1 : 0,
      ]).forEach((v, i) => {
        columns[axis][i] += v * w;
      });
  let transform = columns;
  if (hull) {
    const cross = (a: number[], b: number[]) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const [a, b, c] = columns,
      co = [cross(b, c), cross(c, a), cross(a, b)],
      det = a.reduce((n, v, i) => n + v * co[0][i], 0);
    transform = co.map((col) => col.map((v) => v / det));
  }
  return normal.map((_, i) => transform.reduce((n, col, axis) => n + col[i] * normal[axis], 0));
}
