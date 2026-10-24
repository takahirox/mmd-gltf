import type { RestBone, Vec3, Quat } from '../mmd-vpd';
/** Exact PMX source identity, independent of a loader's name dictionary. */
export interface MorphIdentity {
  index: number;
  name: string;
  englishName: string;
  type: number;
  target: number | null;
  /** v3 scalar control slot, independent of geometry target. */
  control?: number | null;
  bone?: { index: number; translation: Vec3; rotation: Quat }[];
  /** Version 2 and later; ordered source entries, including duplicates and zero rates. */
  group?: { index: number; rate: number }[];
  unsupported?: { index: number; type: number; reason: string }[];
}
export interface MorphModel {
  version: 1 | 2 | 3;
  modelId: string;
  morphs: MorphIdentity[];
  bones?: RestBone[];
  metersPerPMXUnit?: number;
}
export interface WeightTrack { index: number; keys: { frame: number; weight: number }[] }
/** Common bounded playback profile, including the existing Outline renderer. */
export const MORPH_WEIGHT_LIMIT = 1e4;
export function validWeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MORPH_WEIGHT_LIMIT;
}
/** A group is executable only when every immediate dependency is a supported vertex/bone morph.
 * Graph inspection is diagnostic only: it never evaluates nested group deltas. */
export function groupIssues(morphs: MorphIdentity[], index: number, bones = false, budget = {remaining:1_000_000}) {
  const reaches = (start: number) => {
    const pending = [start], seen = new Set<number>();
    while (pending.length) {
      if(--budget.remaining<0)throw new Error('Morph: dependency inspection work limit (1000000) exceeded');
      const next = pending.pop()!;
      if (next === index) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      if (morphs[next].type === 0) for (const e of morphs[next].group!) pending.push(e.index);
    }
    return false;
  };
  return morphs[index].group!.filter(e => morphs[e.index].type !== 1 && !(bones && morphs[e.index].type === 2)).map(e => ({
    index: e.index, type: morphs[e.index].type,
    reason: e.index === index ? 'self dependency' : morphs[e.index].type !== 0 ? 'unsupported child family' :
      reaches(e.index) ? 'cyclic group dependency' : 'nested group dependency',
  }));
}
export function validateMorphModel(model: MorphModel) {
  if (!model || ![1, 2, 3].includes(model.version) || typeof model.modelId !== 'string' || !model.modelId ||
      !Array.isArray(model.morphs) || model.morphs.length > 65536)
    throw new Error('Morph: missing or invalid model identity');
  if (model.version === 3) {
    if(Object.keys(model).some(k=>!['version','modelId','morphs','bones','metersPerPMXUnit'].includes(k)))throw new Error('Morph: unexpected model property');
    if (!Number.isFinite(model.metersPerPMXUnit) || model.metersPerPMXUnit!<=0)throw new Error('Morph: invalid source translation scale');
    if (!Array.isArray(model.bones) || model.bones.length > 65536) throw new Error('Morph: missing bones');
    const indices = new Set<number>();
    for (const b of model.bones) {
      if (!b || Object.keys(b).some(k=>!['index','name','parentIndex','translation','rotation','scale'].includes(k)) || !Number.isInteger(b.index) || b.index < 0 || indices.has(b.index) ||
          typeof b.name !== 'string' || !Number.isInteger(b.parentIndex) ||
          !finiteVector(b.translation, 3) || !finiteVector(b.rotation, 4) ||
          Math.abs(Math.hypot(...b.rotation)-1)>1e-5 || !finiteVector(b.scale,3) || b.scale.some(v=>v!==1))
        throw new Error('Morph: invalid bone rest');
      indices.add(b.index);
    }
    const parents = new Map(model.bones.map(b=>[b.index,b.parentIndex]));
    const done = new Set<number>();
    for (const b of model.bones) {
      let i=b.index; const path=new Set<number>();
      while(i!==-1 && !done.has(i)) {
        if(!indices.has(i) || path.has(i)) throw new Error('Morph: invalid bone hierarchy');
        path.add(i); i=parents.get(i)!;
      }
      path.forEach(i=>done.add(i));
    }
  } else if (model.bones !== undefined || model.metersPerPMXUnit !== undefined) throw new Error('Morph: unexpected bones');
  const boneIndices=new Set(model.bones?.map(b=>b.index));
  let entries = 0;
  Array.from(model.morphs).forEach((m, index) => {
    if (!m || m.index !== index || typeof m.name !== 'string' || typeof m.englishName !== 'string' ||
        !Number.isInteger(m.type) || m.type < 0 || m.type > 10)
      throw new Error(`Morph ${index}: inconsistent source index/type metadata`);
    if(model.version===3 && Object.keys(m).some(k=>!['index','name','englishName','type','target','control','bone','group','unsupported'].includes(k)))throw new Error(`Morph ${index}: unexpected property`);
    if (model.version === 3 && m.type === 2) {
      if (!Array.isArray(m.bone)) throw new Error(`Morph ${index}: missing bone offsets`);
      entries += m.bone.length;
      for (const e of m.bone) if (!e || Object.keys(e).some(k=>!['index','translation','rotation'].includes(k)) || !boneIndices.has(e.index) ||
          !finiteVector(e.translation,3) || !finiteVector(e.rotation,4) ||
          Math.abs(Math.hypot(...e.rotation)-1)>1e-5)
        throw new Error(`Morph ${index}: invalid bone offset/reference/quaternion`);
    } else if (m.bone !== undefined) throw new Error(`Morph ${index}: unexpected bone offsets`);
    if (model.version < 3 && m.control !== undefined) throw new Error(`Morph ${index}: unexpected control`);
    if (model.version >= 2 && m.type === 0) {
      if (!Array.isArray(m.group)) throw new Error(`Morph ${index}: missing group references`);
      entries += m.group.length;
      for (const e of m.group) if (!e || !Number.isInteger(e.index) || e.index < 0 || e.index >= model.morphs.length ||
          typeof e.rate !== 'number' || !Number.isFinite(e.rate) || !Number.isFinite(Math.fround(e.rate)))
        throw new Error(`Morph ${index}: invalid group reference or FLOAT rate`);
    } else if (m.group !== undefined || m.unsupported !== undefined)
      throw new Error(`Morph ${index}: unexpected group metadata`);
  });
  if (entries > 1000000) throw new Error('Morph: group entry limit (1000000) exceeded');
  // Keep existing vertex target indices stable; append supported groups in source order.
  const budget={remaining:1_000_000}, groups:MorphIdentity[]=[];
  const ordered = model.morphs.filter(m => m.type === 1);
  for (const m of model.morphs) if (model.version >= 2 && m.type === 0) {
    const issues = groupIssues(model.morphs, m.index, model.version === 3,budget);
    if (!Array.isArray(m.unsupported) || m.unsupported.length !== issues.length ||
        Array.from(m.unsupported).some((e, i) => !e || e.index !== issues[i].index || e.type !== issues[i].type || e.reason !== issues[i].reason))
      throw new Error(`Morph ${m.index}: inconsistent group dependency diagnostics`);
    if (!issues.length && (model.version < 3 || (!m.group!.length || m.group!.some(e => model.morphs[e.index].type === 1)))) groups.push(m);
  }
  const legacy=(m:MorphIdentity)=>m.group!.every(e=>model.morphs[e.index].type===1);
  ordered.push(...groups.filter(legacy),...groups.filter(m=>!legacy(m)));
  const targets = new Map(ordered.map((m, i) => [m.index, i]));
  for (const m of model.morphs) if (m.target !== (targets.get(m.index) ?? null))
    throw new Error(`Morph ${m.index}: inconsistent source index/type/target metadata`);
  if (model.version === 3) {
    const controls = [...ordered, ...model.morphs.filter(m=>m.type===2 || m.type===0 && !m.unsupported!.length && m.target===null)];
    const slots = new Map(controls.map((m,i)=>[m.index,i]));
    for (const m of model.morphs) if(m.control!==(slots.get(m.index)??null)) throw new Error(`Morph ${m.index}: inconsistent control identity`);
  }
}
/** Independent additive scalars: no normalization, clamping or bone Bezier fields. */
export function evaluateWeight(track: WeightTrack, seconds: number) {
  if (!Number.isFinite(seconds)) throw new Error('Morph: time must be finite');
  const keys = track.keys, frame = seconds * 30;
  if (frame <= keys[0].frame) return keys[0].weight;
  if (frame >= keys.at(-1)!.frame) return keys.at(-1)!.weight;
  let lo = 0, hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (hi + lo) >> 1;
    if (keys[mid].frame <= frame) lo = mid; else hi = mid;
  }
  const a = keys[lo], b = keys[hi], u = (frame - a.frame) / (b.frame - a.frame);
  return a.weight + (b.weight - a.weight) * u;
}

function finiteVector(v: unknown, n: number): v is number[] {
  return Array.isArray(v) && v.length===n && Array.from(v).every(x=>typeof x==='number' && Number.isFinite(x) && Number.isFinite(Math.fround(x)));
}
export const controlIndex = (m: MorphIdentity) => m.control === undefined ? m.target : m.control;
export const controlCount = (m: MorphModel) => m.morphs.filter(m=>controlIndex(m)!==null).length;
/** Independent controls reduce to child scalars in group source/entry order.
 * Compiled vertex groups keep their own target, so vertex children are never expanded twice. */
export function reduceMorphs(model: MorphModel, weights: readonly number[]) {
  if (!Array.isArray(weights) || weights.length!==controlCount(model) || !Array.from(weights).every(validWeight))
    throw new Error('Morph: invalid control count or weight range');
  const targets = new Array(model.morphs.filter(m=>m.target!==null).length).fill(0);
  const bones = new Map<number,number>();
  for (const m of model.morphs) {
    const c=controlIndex(m); if(c===null) continue;
    const w=weights[c];
    if(m.target!==null) targets[m.target]=w;
    if(m.type===2) bones.set(m.index,w);
  }
  for(const m of model.morphs) if(m.type===0 && controlIndex(m)!==null && model.version===3) {
    const w=weights[controlIndex(m)!];
    for(const e of m.group!) if(model.morphs[e.index].type===2) bones.set(e.index,(bones.get(e.index)??0)+w*e.rate);
  }
  if([...targets,...bones.values()].some(v=>!validWeight(v))) throw new Error('Morph: reduced contribution exceeds weight limit');
  return {targets,bones};
}
/** Project policy: shortest identity axis-angle power (canonical sign at pi),
 * then postmultiply in source morph order and source offset order. */
export function applyBoneMorphs(model: MorphModel, weights: readonly number[], raw: RestBone[]): RestBone[] {
  const {bones}=reduceMorphs(model,weights), result=structuredClone(raw), byIndex=new Map(result.map(b=>[b.index,b]));
  for(const m of model.morphs) if(m.type===2 && model.version===3) {
    const w=bones.get(m.index)??0;
    for(const e of m.bone!) {
      const b=byIndex.get(e.index); if(!b) throw new Error('Morph: missing raw bone');
      b.translation=b.translation.map((v,i)=>v+w*e.translation[i]) as Vec3;
      let q=e.rotation, sign=q[3]<0 || q[3]===0 && (q.find(v=>v!==0)??1)<0 ? -1 : 1;
      q=q.map(v=>v*sign) as Quat;
      const n=Math.hypot(q[0],q[1],q[2]), a=Math.atan2(n,q[3])*w;
      const d:Quat=n<1e-15 ? [0,0,0,1] : [q[0]/n*Math.sin(a),q[1]/n*Math.sin(a),q[2]/n*Math.sin(a),Math.cos(a)];
      const [x,y,z,t]=b.rotation,[u,v,s,r]=d;
      const product=[x*r+t*u+y*s-z*v,y*r+t*v+z*u-x*s,z*r+t*s+x*v-y*u,t*r-x*u-y*v-z*s];
      const length=Math.hypot(...product); b.rotation=product.map(v=>v/length) as Quat;
      if(!finiteVector(b.translation,3) || !finiteVector(b.rotation,4)) throw new Error('Morph: unsupported resolved numeric range');
    }
  }
  return result;
}
