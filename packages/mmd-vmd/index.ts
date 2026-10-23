import { validatePoseModel, type PoseModel, type RestBone, type Vec3, type Quat } from '../mmd-vpd';
import { byteName, validateBone, omittedRecords, type VMD } from './reader';
import { validateMorphModel, validWeight, evaluateWeight, type MorphModel, type WeightTrack } from '../mmd-morph';
export * from './reader';
export type Curve = [number, number, number, number]; // x1,y1,x2,y2 in 0..127
export interface MotionKey {
  frame: number;
  translation: Vec3;
  rotation: Quat;
  curves: [Curve, Curve, Curve, Curve];
}
export interface MotionTrack {
  index: number;
  keys: MotionKey[];
}
export interface Motion {
  rest: RestBone[];
  tracks: MotionTrack[];
  duration: number;
  morphs?: { node: number; count: number; tracks: WeightTrack[] }[];
}
export interface MotionBinding extends Motion {
  modelId: string;
  unmatched: string[];
  unmatchedMorphs: string[];
  omitted: ReturnType<typeof omittedRecords>;
}
export interface VMDBindingOptions {
  /** Hex byte-name key (not decoded name or record ordinal) to source PMX index. */
  mapping?: Record<string, number>;
  unmatched?: 'error' | 'ignore';
  morphMapping?: Record<string, number>;
  morphUnmatched?: 'error' | 'ignore';
}
const supported = (values: number[]) =>
  values.every((v) => Number.isFinite(v) && Number.isFinite(Math.fround(v)));
export function multiply(a: Quat, b: Quat): Quat {
  const [x, y, z, w] = a,
    [u, v, s, t] = b;
  return [
    x * t + w * u + y * s - z * v,
    y * t + w * v + z * u - x * s,
    z * t + w * s + x * v - y * u,
    w * t - x * u - y * v,
  ];
}
export function bindMotion(model: PoseModel, vmd: VMD, options: VMDBindingOptions = {}, morphModel?: MorphModel): MotionBinding {
  validatePoseModel(model);
  if (!vmd || !Array.isArray(vmd.bones)) throw new Error('VMD: missing bone records');
  if (options.unmatched !== undefined && !['error', 'ignore'].includes(options.unmatched))
    throw new Error('VMD: unmatched policy must be error or ignore');
  if (
    options.mapping !== undefined &&
    (!options.mapping || Array.isArray(options.mapping) || typeof options.mapping !== 'object')
  )
    throw new Error('VMD: mapping must be a byte-key to source-index object');
  const grouped = new Map<string, typeof vmd.bones>();
  for (const record of vmd.bones) {
    validateBone(record);
    if (!record.name) throw new Error('VMD: missing fixed-width byte name');
    const name = byteName(record.name.raw);
    if (
      name.raw.length !== 15 ||
      name.key !== record.name.key ||
      name.text !== record.name.text ||
      name.terminated !== record.name.terminated
    )
      throw new Error('VMD: inconsistent fixed-width byte name');
    if (!grouped.has(name.key)) grouped.set(name.key, []);
    grouped.get(name.key)!.push(record);
  }
  const mapping = options.mapping ?? {};
  for (const key of Object.keys(mapping))
    if (!grouped.has(key)) throw new Error(`VMD: invalid mapping byte-key ${key}`);
  const tracks: MotionTrack[] = [],
    unmatched: string[] = [],
    targets = new Set<number>();
  for (const [key, records] of grouped) {
    const name = records[0].name,
      explicit = Object.hasOwn(mapping, key);
    if (!explicit && (!name.terminated || name.text === null))
      throw new Error(`VMD track ${key}: full-width/truncated or undecodable name requires explicit mapping`);
    const matches = explicit
      ? model.bones.filter((b) => b.index === mapping[key])
      : model.bones.filter((b) => b.name === name.text);
    if (explicit && (!Number.isInteger(mapping[key]) || matches.length !== 1))
      throw new Error(`VMD: invalid mapped source index for ${key}`);
    if (matches.length > 1)
      throw new Error(`VMD track ${key}: ambiguous PMX name; explicit mapping required`);
    if (!matches.length) {
      unmatched.push(key);
      continue;
    }
    const rest = matches[0];
    if (targets.has(rest.index)) throw new Error(`VMD: repeated target source index ${rest.index}`);
    targets.add(rest.index);
    const sorted = [...records].sort((a, b) => a.frame - b.frame);
    const keys = sorted.map((r, i): MotionKey => {
      if (i && r.frame === sorted[i - 1].frame)
        throw new Error(`VMD: duplicate frame ${r.frame} in bound track ${key}`);
      const translation = rest.translation.map(
        (v, j) => v + r.translation[j] * model.metersPerPMXUnit * (j === 2 ? -1 : 1),
      ) as Vec3;
      if (!supported(translation)) throw new Error('VMD: unsupported translation numeric range');
      const length = Math.hypot(...r.rotation),
        [x, y, z, w] = r.rotation.map((v) => v / length);
      const curves = [0, 1, 2, 3].map((j) => [
        r.interpolation[j],
        r.interpolation[j + 4],
        r.interpolation[j + 8],
        r.interpolation[j + 12],
      ]) as MotionKey['curves'];
      return { frame: r.frame, translation, rotation: multiply(rest.rotation, [-x, -y, z, w]), curves };
    });
    tracks.push({ index: rest.index, keys });
  }
  if (unmatched.length && options.unmatched !== 'ignore')
    throw new Error(
      `VMD: unmatched byte-name tracks ${unmatched.join(', ')}; unmatched: ignore is explicit partial playback`,
    );
  tracks.sort((a, b) => a.index - b.index);
  const weights = bindMorphMotion(morphModel ?? { version: 1, modelId: model.modelId, morphs: [] }, vmd, options);
  return {
    modelId: model.modelId,
    rest: structuredClone(model.bones),
    tracks,
    duration: Math.max(weights.duration, ...tracks.map((t) => t.keys.at(-1)!.frame / 30)),
    unmatched,
    unmatchedMorphs: weights.unmatched,
    morphs: weights.count ? [{ node: 0, count: weights.count, tracks: weights.tracks }] : [],
    omitted: { ...omittedRecords(vmd), morphs: weights.omitted },
  };
}
/** Morph mappings are source PMX indices, never bone indices or target dictionary names. */
export function bindMorphMotion(model: MorphModel, vmd: VMD, options: VMDBindingOptions = {}) {
  validateMorphModel(model);
  if (!Array.isArray(vmd.morphs)) throw new Error('VMD: missing morph records');
  if (options.morphUnmatched !== undefined && !['error', 'ignore'].includes(options.morphUnmatched))
    throw new Error('VMD: morph unmatched policy must be error or ignore');
  if (options.morphMapping !== undefined && (!options.morphMapping || Array.isArray(options.morphMapping) || typeof options.morphMapping !== 'object'))
    throw new Error('VMD: invalid morph mapping');
  const mapping = options.morphMapping ?? {};
  const groups = new Map<string, VMD['morphs']>();
  for (const r of vmd.morphs) {
    if (!r || !r.name) throw new Error('VMD: invalid morph record');
    const name = byteName(r.name.raw);
    if (name.raw.length !== 15 || name.key !== r.name.key || name.text !== r.name.text || name.terminated !== r.name.terminated)
      throw new Error('VMD: inconsistent morph byte name');
    if (!Number.isInteger(r.frame) || r.frame < 0 || r.frame > 0xffffffff || !validWeight(r.weight))
      throw new Error('VMD: unsupported morph frame/weight numeric range');
    if (!groups.has(name.key)) groups.set(name.key, []);
    groups.get(name.key)!.push(r);
  }
  for (const key of Object.keys(mapping)) if (!groups.has(key)) throw new Error(`VMD: invalid morph mapping byte-key ${key}`);
  const tracks: WeightTrack[] = [], unmatched: string[] = [], targets = new Set<number>();
  let omitted = 0;
  for (const [key, records] of groups) {
    const name = records[0].name, explicit = Object.hasOwn(mapping, key);
    if (!explicit && (!name.terminated || name.text === null))
      throw new Error(`VMD morph ${key}: full-width/truncated or undecodable name requires explicit mapping`);
    const matches = explicit ? model.morphs.filter(m => m.index === mapping[key]) : model.morphs.filter(m => m.name === name.text);
    if (explicit && (!Number.isInteger(mapping[key]) || matches.length !== 1)) throw new Error(`VMD: invalid mapped morph source index ${key}`);
    if (matches.length > 1) throw new Error(`VMD morph ${key}: ambiguous PMX name; explicit mapping required`);
    if (!matches.length || matches[0].target === null) {
      unmatched.push(key); omitted += records.length;
      if (options.morphUnmatched !== 'ignore') throw new Error(`VMD: unmatched or unsupported morph ${key}; morphUnmatched: ignore is explicit partial playback`);
      continue;
    }
    const index = matches[0].target!;
    if (targets.has(index)) throw new Error(`VMD: repeated morph target source index ${matches[0].index}`);
    targets.add(index);
    const sorted = [...records].sort((a,b) => a.frame - b.frame);
    tracks.push({ index, keys: sorted.map((r,i) => {
      if (i && r.frame === sorted[i-1].frame) throw new Error(`VMD: duplicate morph frame ${r.frame}`);
      return { frame: r.frame, weight: r.weight };
    }) });
  }
  tracks.sort((a,b) => a.index - b.index);
  return { tracks, unmatched, omitted, count: model.morphs.filter(m => m.target !== null).length,
    duration: Math.max(0, ...tracks.map(t => t.keys.at(-1)!.frame / 30)) };
}
export function evaluateMorphs(motion: Motion, seconds: number) {
  if (!Number.isFinite(seconds)) throw new Error('VMD: time must be finite');
  return (motion.morphs ?? []).map(group => {
    const values = new Array(group.count).fill(0);
    for (const track of group.tracks) values[track.index] = evaluateWeight(track, seconds);
    if (!values.every(validWeight)) throw new Error('VMD: unsupported evaluated weight numeric range');
    return { node: group.node, values };
  });
}
/** Bisection in time coordinate; destination-key curves apply to every positive interval. */
export function bezier(curve: Curve, time: number) {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  const [x1, y1, x2, y2] = curve.map((v) => v / 127);
  const cubic = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0,
    high = 1;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (cubic(middle, x1, x2) < time) low = middle;
    else high = middle;
  }
  return cubic((low + high) / 2, y1, y2);
}
function normalize(q: Quat): Quat {
  const length = Math.hypot(...q);
  return q.map((v) => v / length) as Quat;
}
export function slerp(a: Quat, b: Quat, t: number): Quat {
  a = normalize(a);
  b = normalize(b);
  let dot = a.reduce((sum, v, i) => sum + v * b[i], 0),
    sign = 1;
  if (dot < 0) {
    dot = -dot;
    sign = -1;
  }
  dot = Math.min(1, dot);
  let wa = 1 - t,
    wb = t;
  if (dot < 0.999999) {
    const theta = Math.acos(dot),
      sin = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / sin;
    wb = Math.sin(t * theta) / sin;
  }
  const q = a.map((v, i) => v * wa + b[i] * wb * sign) as Quat,
    norm = Math.hypot(...q);
  return q.map((v) => v / norm) as Quat;
}
export function evaluateTrack(track: MotionTrack, seconds: number): { translation: Vec3; rotation: Quat } {
  if (!Number.isFinite(seconds)) throw new Error('VMD: evaluation time must be finite');
  const keys = track.keys,
    frame = seconds * 30;
  if (frame <= keys[0].frame)
    return { translation: [...keys[0].translation], rotation: normalize(keys[0].rotation) };
  if (frame >= keys.at(-1)!.frame)
    return { translation: [...keys.at(-1)!.translation], rotation: normalize(keys.at(-1)!.rotation) };
  let low = 0,
    high = keys.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (keys[middle].frame <= frame) low = middle;
    else high = middle;
  }
  const a = keys[low],
    b = keys[high],
    u = (frame - a.frame) / (b.frame - a.frame);
  return {
    translation: a.translation.map((v, i) => v + (b.translation[i] - v) * bezier(b.curves[i], u)) as Vec3,
    rotation: slerp(a.rotation, b.rotation, bezier(b.curves[3], u)),
  };
}
export function evaluateMotion(motion: Motion, seconds: number): RestBone[] {
  if (!Number.isFinite(seconds)) throw new Error('VMD: seek time must be finite');
  const values = new Map(motion.tracks.map((t) => [t.index, evaluateTrack(t, seconds)]));
  return motion.rest.map((b) => ({ ...structuredClone(b), ...values.get(b.index) }));
}
