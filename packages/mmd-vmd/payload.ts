import { validateSolver, type SolverProfile } from '../mmd-solver';
import type { IKTrack } from './index';
import type { Vec3, Quat, RestBone } from '../mmd-vpd';
import type { Motion, MotionKey } from './index';
export const EXTENSION_NAME = 'MMD_animation_vmd';
export interface VMDPayload {
  version: 1 | 2 | 3;
  solver?: SolverProfile;
  ik?: IKTrack[];
  visibility?: {frame:number;visible:number;raw:number[]}[];
  rest: { node: number; translation: Vec3; rotation: Quat }[];
  tracks: { node: number; keys: MotionKey[] }[];
  /** Reuse the complete corresponding core LINEAR weight sampler. */
  weights?: { node: number; sampler: number }[];
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
    !properties(p, ['version', 'rest', 'tracks', 'weights', 'solver', 'ik', 'visibility']) ||
    ![1, 2, 3].includes(p.version) ||
    !Array.isArray(p.rest) ||
    (p.version === 1 && !p.rest.length) ||
    p.rest.length > 65536 ||
    !Array.isArray(p.tracks) ||
    (p.version === 1 && !p.tracks.length) ||
    p.tracks.length > 65536
  )
    fail();
  if (p.version !== 3 && (p.solver !== undefined || p.ik !== undefined || p.visibility !== undefined)) fail();
  if (p.version === 3) {
    validateSolver(p.solver,nodeCount);
    const seen=new Set<number>();
    if(!Array.isArray(p.ik) || p.ik.length>65536 || !Array.isArray(p.visibility) || p.visibility.length>1_000_000) fail();
    let controls=0;
    for(const t of p.ik!) {
      if(!t || !properties(t,['index','keys']) || !p.solver!.bones.some(b=>b.index===t.index && b.ik) || seen.has(t.index) || !Array.isArray(t.keys) || !t.keys.length || (controls+=t.keys.length)>1_000_000)fail();
      seen.add(t.index);
      t.keys.forEach((k,i)=>{if(!k || !properties(k,['frame','enabled']) || !Number.isInteger(k.frame)||k.frame<0||k.frame>0xffffffff||typeof k.enabled!=='boolean'||i>0&&k.frame<=t.keys[i-1].frame)fail();});
    }
    p.visibility!.forEach((d,i)=>{if(!d || !properties(d,['frame','visible','raw']) || !Number.isInteger(d.frame)||d.frame<0||d.frame>0xffffffff||![0,1].includes(d.visible)||i>0&&d.frame<=p.visibility![i-1].frame||!Array.isArray(d.raw)||d.raw.some(v=>!Number.isInteger(v)||v<0||v>255))fail();});
  }
  if (p.version === 1 && p.weights !== undefined) fail();
  if (p.version === 2 || p.version === 3 && p.weights !== undefined) {
    if (!Array.isArray(p.weights) || !p.weights.length || p.weights.length > 65536) fail();
    const seen = new Set<number>();
    for (const w of p.weights!) {
      if (!w || !properties(w, ['node', 'sampler']) || !Number.isInteger(w.node) || w.node < 0 ||
          w.node >= nodeCount || seen.has(w.node) || !Number.isInteger(w.sampler) || w.sampler < 0) fail();
      seen.add(w.node);
    }
  }
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
  if(p.solver && (p.solver.bones.length!==p.rest.length || p.solver.bones.some(b=>{const r=p.rest.find(r=>r.node===b.node);return !r || JSON.stringify([r.translation,r.rotation])!==JSON.stringify([b.translation,b.rotation]);})))fail();
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
export function payloadMotion(payload: VMDPayload, morphs: Motion['morphs'] = []): Motion {
  validatePayload(payload);
  if ((payload.weights?.length ?? 0) !== morphs.length ||
      payload.weights?.some(w => !morphs.some(g => g.node === w.node)))
    throw new Error(`${EXTENSION_NAME}: resolved core weight samplers required`);
  const id = (node:number) => payload.solver?.bones.find(b=>b.node===node)?.index ?? node;
  const rest: RestBone[] = payload.rest.map((b) => ({
    index: id(b.node),
    name: '',
    parentIndex: payload.solver?.bones.find(v=>v.node===b.node)?.parentIndex ?? -1,
    translation: [...b.translation],
    rotation: [...b.rotation],
    scale: [1, 1, 1],
  }));
  return {
    solver: payload.solver, ik: payload.ik, visibility: payload.visibility,
    rest,
    tracks: payload.tracks.map((t) => ({ index: id(t.node), keys: structuredClone(t.keys) })),
    morphs,
    duration: Math.max(0, ...(payload.ik??[]).map(t=>t.keys.at(-1)!.frame/30), ...(payload.visibility??[]).map(d=>d.frame/30), ...payload.tracks.map((t) => t.keys.at(-1)!.frame / 30),
      ...morphs.flatMap(g => g.tracks.map(t => t.keys.at(-1)!.frame / 30))),
  };
}
