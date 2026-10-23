import type { Vec3, Quat, RestBone } from '../mmd-vpd';
import type { Motion, MotionKey } from './index';
export const EXTENSION_NAME = 'MMD_animation_vmd';
export interface VMDPayload {
  version: 1;
  rest: { node: number; translation: Vec3; rotation: Quat }[];
  tracks: { node: number; keys: MotionKey[] }[];
}
const vector = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every((x) => Number.isFinite(x) && Number.isFinite(Math.fround(x)));
const rotation = (v: unknown) => vector(v, 4) && Math.abs(Math.hypot(...v) - 1) <= 1e-5;
const properties = (o: object, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));
export function validatePayload(value: unknown, nodeCount = Infinity): asserts value is VMDPayload {
  const fail = () => {
    throw new Error(`${EXTENSION_NAME}: invalid payload, node reference, key order, numeric range or curve`);
  };
  if (!value || typeof value !== 'object') fail();
  const p = value as VMDPayload;
  if (
    !properties(p, ['version', 'rest', 'tracks']) ||
    p.version !== 1 ||
    !Array.isArray(p.rest) ||
    !p.rest.length ||
    p.rest.length > 65536 ||
    !Array.isArray(p.tracks) ||
    !p.tracks.length ||
    p.tracks.length > 65536
  )
    fail();
  const nodes = new Set<number>(),
    targets = new Set<number>();
  for (const b of p.rest) {
    if (
      !b ||
      !properties(b, ['node', 'translation', 'rotation']) ||
      !Number.isInteger(b.node) ||
      b.node < 0 ||
      b.node >= nodeCount ||
      nodes.has(b.node) ||
      !vector(b.translation, 3) ||
      !rotation(b.rotation)
    )
      fail();
    nodes.add(b.node);
  }
  let total = 0;
  for (const t of p.tracks) {
    if (
      !t ||
      !properties(t, ['node', 'keys']) ||
      !nodes.has(t.node) ||
      targets.has(t.node) ||
      !Array.isArray(t.keys) ||
      !t.keys.length ||
      (total += t.keys.length) > 1_000_000
    )
      fail();
    targets.add(t.node);
    for (let i = 0; i < t.keys.length; i++) {
      const k = t.keys[i];
      if (
        !k ||
        !properties(k, ['frame', 'translation', 'rotation', 'curves']) ||
        !Number.isInteger(k.frame) ||
        k.frame < 0 ||
        k.frame > 0xffffffff ||
        (i > 0 && k.frame <= t.keys[i - 1].frame) ||
        !vector(k.translation, 3) ||
        !rotation(k.rotation) ||
        !Array.isArray(k.curves) ||
        k.curves.length !== 4 ||
        k.curves.some((c) => !vector(c, 4) || c.some((v) => !Number.isInteger(v) || v < 0 || v > 127))
      )
        fail();
    }
  }
}
export function payloadMotion(payload: VMDPayload): Motion {
  validatePayload(payload);
  const rest: RestBone[] = payload.rest.map((b) => ({
    index: b.node,
    name: '',
    parentIndex: -1,
    translation: [...b.translation],
    rotation: [...b.rotation],
    scale: [1, 1, 1],
  }));
  return {
    rest,
    tracks: payload.tracks.map((t) => ({ index: t.node, keys: structuredClone(t.keys) })),
    duration: Math.max(...payload.tracks.map((t) => t.keys.at(-1)!.frame / 30)),
  };
}
