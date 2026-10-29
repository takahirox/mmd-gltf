import { diagnosticError, MMDDiagnosticError, type Diagnostic } from '../packages/mmd-diagnostics';
import { solverDiagnostics } from '../packages/mmd-solver';
import type { PhysicsTimeline } from '../packages/three-mmd-physics/world';
import { evaluateIK } from '../packages/mmd-vmd';
import {
  Extension,
  type Document,
  type Buffer,
  type Node,
  type Animation,
  type WriterContext,
} from '@gltf-transform/core';
import { evaluateTrack, evaluateMotion, slerp, type MotionBinding, type MotionTrack } from '../packages/mmd-vmd';
import { EXTENSION_NAME, validatePayload, type VMDPayload } from '../packages/mmd-vmd/payload';
import type { Quat } from '../packages/mmd-vpd';
import { reduceMorphs, evaluateWeight } from '../packages/mmd-morph';
export interface SamplingOptions {
  translationTolerance?: number;
  rotationTolerance?: number;
  maxSamples?: number;
  /** Maximum width of the explicitly approximate LINEAR IK switch seam. */
  controlTimeTolerance?: number;
}
export function orientationError(a: Quat, b: Quat) {
  const dot = Math.abs(a.reduce((n, v, i) => n + v * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b)));
  return 2 * Math.acos(Math.min(1, dot));
}
export class VMDWriter extends Extension {
  static EXTENSION_NAME = EXTENSION_NAME;
  readonly extensionName = EXTENSION_NAME;
  records = new Map<Animation, { motion: MotionBinding; nodes: Node[]; weights: { node: Node; sampler: number }[]; diagnostics: Diagnostic[] }>();
  read(): this {
    throw new Error('VMDWriter is converter-only');
  }
  write(context: WriterContext): this {
    for (const [animation, { motion, nodes, weights, diagnostics }] of this.records) {
      const payload: VMDPayload = {
        version: motion.source || diagnostics.length || motion.solver?.version===3 ? 6 : motion.morphModel ? 5 : motion.solver?.version === 2 ? 4 : motion.solver ? 3 : weights.length ? 2 : 1,
        rest: motion.rest.map((b) => ({
          node: context.nodeIndexMap.get(nodes[b.index])!,
          translation: b.translation,
          rotation: b.rotation,
        })),
        tracks: motion.tracks.map((t) => ({
          node: context.nodeIndexMap.get(nodes[t.index])!,
          keys: structuredClone(t.keys),
        })),
      };
      if(payload.version===6) {
        payload.source=motion.source;
        payload.diagnostics=structuredClone(diagnostics);
        payload.owned=animation.listChannels().map(c=>({node:context.nodeIndexMap.get(c.getTargetNode()!)!,path:c.getTargetPath() as 'translation'|'rotation'|'weights'}));
        payload.morphs=(motion.morphs??[]).map(g=>({...structuredClone(g),node:context.nodeIndexMap.get(weights[0]?.node ?? nodes[0])!}));
      }
      if(motion.morphModel) payload.controls={model:structuredClone(motion.morphModel),nodes:motion.rest.map(b=>({index:b.index,node:context.nodeIndexMap.get(nodes[b.index])!})),tracks:structuredClone(motion.morphs?.[0]?.tracks??[])};
      if (motion.solver) {
        payload.solver=structuredClone(motion.solver);
        payload.solver.bones.forEach(b=>{b.node=context.nodeIndexMap.get(nodes[b.index])!;});
        payload.ik=structuredClone(motion.ik??[]);payload.visibility=structuredClone(motion.visibility??[]);
      }
      if (weights.length) payload.weights = weights.map(w => ({ node: context.nodeIndexMap.get(w.node)!, sampler: w.sampler }));
      validatePayload(payload, context.jsonDoc.json.nodes!.length);
      const def = context.jsonDoc.json.animations![context.animationIndexMap.get(animation)!];
      def.extensions = { ...def.extensions, [EXTENSION_NAME]: payload };
    }
    return this;
  }
}
/** Finite adaptive probes, not a continuous error certificate. Includes FLOAT quantization. */
export function sampleTrack(
  track: MotionTrack,
  options: SamplingOptions = {},
  budget = { remaining: 200_000 },
  evaluator: (time:number) => ReturnType<typeof evaluateTrack> = time=>evaluateTrack(track,time),
  seeds?: number[],
  seams: ReadonlySet<number> = new Set(),
) {
  const translationTolerance = options.translationTolerance ?? 2e-6,
    rotationTolerance = options.rotationTolerance ?? 2e-5,
    maxSamples = options.maxSamples ?? 200_000;
  if (
    !Number.isFinite(translationTolerance) ||
    translationTolerance <= 0 ||
    !Number.isFinite(rotationTolerance) ||
    rotationTolerance <= 0 ||
    !Number.isInteger(maxSamples) ||
    maxSamples < 1 ||
    maxSamples > 200_000
  )
    throw new Error('VMD: invalid fallback sampling limits (maximum 200000 samples)');
  const at = (time: number) => {
    const v = evaluator(time);
    return {
      time,
      translation: v.translation.map(Math.fround),
      rotation: v.rotation.map(Math.fround) as Quat,
    };
  };
  type Sample = ReturnType<typeof at>;
  const samples: Sample[] = [];
  const add = (s: Sample) => {
    if (samples.length >= maxSamples || --budget.remaining < 0)
      diagnosticError('fallback-limit','sample-budget','VMD','excessive fallback sampling; accuracy cannot be met within sample budget');
    if (samples.length && s.time <= samples.at(-1)!.time)
      diagnosticError('fallback-limit','float-timestamps','VMD','strictly increasing FLOAT timestamps cannot be represented');
    samples.push(s);
  };
  const fits = (a: Sample, b: Sample, time: number) => {
    const exact = evaluator(time),
      t = b.time === a.time ? 0 : Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
    const translation = a.translation.map((v, i) => v + (b.translation[i] - v) * t),
      rotation = slerp(a.rotation, b.rotation, t);
    return (
      Math.hypot(...translation.map((v, i) => v - exact.translation[i])) <= translationTolerance &&
      orientationError(rotation, exact.rotation) <= rotationTolerance
    );
  };
  const split = (a: Sample, b: Sample, depth: number) => {
    if(seams.has(b.time) && a.time===previousFloat(b.time)) { add(b); return; }
    if ([0, 0.25, 0.5, 0.75, 1].every((t) => fits(a, b, a.time + (b.time - a.time) * t))) {
      add(b);
      return;
    }
    const middle = Math.fround((a.time + b.time) / 2);
    if (depth >= 24 || middle <= a.time || middle >= b.time)
      diagnosticError('fallback-limit','float-accuracy',`VMD track ${track.index}`,`requested fallback accuracy cannot be represented with strictly increasing FLOAT timestamps in [${a.time}, ${b.time}]`);
    const m = at(middle);
    split(a, m, depth + 1);
    split(m, b, depth + 1);
  };
  const times = seeds ?? [...new Set([0, ...track.keys.map((k) => k.frame / 30)])];
  let previous = -1;
  for (const time of times) {
    const f = Math.fround(time);
    if (!Number.isFinite(f) || f <= previous)
      diagnosticError('fallback-limit','float-timestamps','VMD','source keys cannot have strictly increasing FLOAT timestamps');
    previous = f;
    const sample = at(f);
    if (!fits(sample, sample, time))
      diagnosticError('fallback-limit','float-accuracy','VMD','requested fallback accuracy cannot represent a source key in FLOAT');
    if (samples.length) split(samples.at(-1)!, sample, 0);
    else add(sample);
  }
  return samples;
}
export function addVMDAnimation(
  doc: Document,
  buffer: Buffer,
  motion: MotionBinding,
  nodes: Node[],
  options: SamplingOptions = {},
  meshNode?: Node,
  physics?: PhysicsTimeline,
) {
  if(physics){
    const max=options.maxSamples??200_000;
    if(!Number.isInteger(max)||max<1||max>200_000||[options.translationTolerance??2e-6,options.rotationTolerance??2e-5].some(v=>!Number.isFinite(v)||v<=0))throw new Error('MMD_physics: invalid fallback sampling options');
  }
  const executionDiagnostics: Diagnostic[] = motion.solver ? solverDiagnostics(motion.solver) : [];
  const diagnostics: Diagnostic[] = [...(motion.diagnostics??[]),...executionDiagnostics];
  // Malformed options still fail, independently of transport fallback recovery.
  const max=options.maxSamples??200_000;
  if(!Number.isInteger(max)||max<1||max>200_000 || [options.translationTolerance??2e-6,options.rotationTolerance??2e-5,options.controlTimeTolerance??1e-6].some(v=>!Number.isFinite(v)||v<=0)) throw new Error('VMD: invalid fallback sampling limits');
  if (physics) try { physics.preflight(motion.duration); }
  catch(error) { if(!(error instanceof MMDDiagnosticError))throw error;diagnostics.push(error.diagnostic,{category:'fallback-limit',code:'physics-fallback-unavailable',path:'VMD',message:'core fallback omits physics execution because replay exceeded its budget; physics and exact motion remain retained'});physics=undefined; }
  if(executionDiagnostics.length) diagnostics.push({category:'fallback-limit',code:'unexecuted-solver-or-physics',path:'VMD',message:'core fallback uses bone/morph animation without unsupported solver/physics execution'});
  const fallbackMotion=executionDiagnostics.length ? {...motion,solver:undefined} : motion;
  const animation = doc
    .createAnimation(motion.morphs?.length ? 'VMD bone and morph motion' : 'VMD bone motion')
    .setExtras({
      vmd: {
        unmatched: motion.unmatched,
        unmatchedMorphs: motion.unmatchedMorphs,
        omitted: motion.omitted,
        profile: 'continuous-curve-v1',
        fallback: physics ? 'Physics tick LINEAR TRS; live physics holds last full tick; between-tick interpolation is approximate' : 'Approximate LINEAR TRS, adaptive quarter probes; core LINEAR weights; no continuous error proof',
        sampling: {
          translationTolerance: physics ? null : options.translationTolerance ?? 2e-6,
          rotationTolerance: physics ? null : options.rotationTolerance ?? 2e-5,
          physicsFixedStep: physics?.profile.fixedStep,
          maxSamples: options.maxSamples ?? 200000,
        },
      },
    });
  const budget = { remaining: options.maxSamples ?? 200_000 };
  let count = 0;
  const seams=new Set<number>();
  const times=new Set([0,motion.duration,...motion.tracks.flatMap(t=>t.keys.map(k=>k.frame/30)),...(motion.morphs??[]).flatMap(g=>g.tracks.flatMap(t=>t.keys.map(k=>k.frame/30)))]);
  if(motion.solver) for(const t of motion.ik??[]) for(const k of t.keys) {
    const time=k.frame/30;
    if(time===0)continue;
    const width=time-previousFloat(time),limit=options.controlTimeTolerance??1e-6;
    if(Math.fround(time)!==time||width>limit) {
      diagnostics.push({category:'fallback-limit',code:'control-float-seam',path:`VMD IK frame ${k.frame}`,message:'switch accuracy cannot be represented in FLOAT within controlTimeTolerance'});
      times.add(time);continue;
    }
    times.add(previousFloat(time));times.add(time);seams.add(time);
  }
  if(physics){physics.preflight(motion.duration);for(let i=0;i<=Math.floor(motion.duration/physics.profile.fixedStep+1e-9);i++)times.add(i*physics.profile.fixedStep);}
  let seeds=[...times].sort((a,b)=>a-b);
  if (physics) {
    // Source keys and ticks can differ as doubles yet share a FLOAT timestamp.
    // Preserve both sides of control seams, and retain source evaluation times:
    // evaluating at a rounded timestamp can select the preceding physics tick.
    const canonical = new Map<number, number>();
    const required = [...seams].flatMap(time => [previousFloat(time), time]);
    for (const time of [...required, ...seeds]) {
      const stamp = Math.fround(time);
      if (!canonical.has(stamp)) canonical.set(stamp, time);
    }
    seeds = [...canonical.values()].sort((a,b)=>a-b);
  }
  const affected=new Set([...motion.tracks.map(t=>t.index),...(motion.morphModel?.morphs.flatMap(m=>(m.bone??[]).map(e=>e.index))??[])]);
  // Solver-free local TRS depends only on its raw track and referenced offsets.
  // Avoid retaining whole unused skeletons at each adaptive probe time.
  const samplingMotion=fallbackMotion.morphModel && !fallbackMotion.solver ? {...fallbackMotion,rest:motion.rest.filter(b=>affected.has(b.index))} : fallbackMotion;
  let evaluationWork=0;
  const poseWork=Math.max(1,samplingMotion.rest.length)*(1+(samplingMotion.solver?.bones.reduce((n,b)=>n+(b.ik ? b.ik.iterations*b.ik.links.length : 0),0)??0));
  const cache=new Map<number,ReturnType<typeof evaluateMotion>>();
  const resolved=(time:number)=>{if(!cache.has(time)){if((evaluationWork+=poseWork)>20_000_000)diagnosticError('fallback-limit','fallback-evaluation-budget','VMD','fallback solver evaluation budget exceeded; retained curves unaffected');if(cache.size*Math.max(1,samplingMotion.rest.length)>1_000_000)cache.clear();cache.set(time,physics ? physics.seek(time,t=>evaluateMotion(motion,t,undefined,true),t=>evaluateIK(motion,t)) : evaluateMotion(samplingMotion,time));}return cache.get(time)!;};
  const tracks=motion.solver || motion.morphModel ? motion.rest.filter(b=>motion.solver || affected.has(b.index)).map(b=>({index:b.index,keys:motion.tracks.find(t=>t.index===b.index)?.keys??[]})) : [...motion.tracks];
  if(!tracks.length && !(motion.morphs??[]).some(g=>g.tracks.length) && motion.rest.length) tracks.push({index:motion.rest[0].index,keys:[]});
  for (const track of tracks) {
    let samples;
    try { samples = physics ? seeds.map(time=>{if(--budget.remaining<0)diagnosticError('fallback-limit','sample-budget','MMD_physics','fallback sample budget exceeded');const at=resolved(time).find(b=>b.index===track.index)!;return {time:Math.fround(time),translation:at.translation,rotation:at.rotation};}) : motion.solver || motion.morphModel ? sampleTrack(track,options,budget,time=>resolved(time).find(b=>b.index===track.index)!,seeds,seams) : sampleTrack(track, options, budget, track.keys.length ? undefined : time=>resolved(time).find(b=>b.index===track.index)!, track.keys.length ? undefined : [0]);
    } catch(error) {
      if(!(error instanceof MMDDiagnosticError) || !['fallback-limit','resource-exhaustion','unsupported-capability'].includes(error.diagnostic.category)) throw error;
      diagnostics.push(error.diagnostic);
      if(physics)diagnostics.push({category:'fallback-limit',code:'physics-fallback-reduced',path:'VMD',message:'reduced core samples use solver/bone motion without physics; simulation transport remains retained'});
      // A bounded uniform approximation retains endpoints where FLOAT permits.
      // Exact curves and original VMD remain independent of this optional fallback.
      const available=Math.max(1,Math.min(256,options.maxSamples??200_000,Math.max(1,budget.remaining),Math.max(1,Math.floor(20_000_000/poseWork))));
      const duration=motion.duration;
      const coarse=[...new Set(Array.from({length:available},(_,i)=>Math.fround(available===1 ? 0 : duration*i/(available-1))))];
      samples=coarse.map(time=>{
        const value=evaluateMotion(error.diagnostic.code==='fallback-evaluation-budget' ? {...fallbackMotion,solver:undefined} : fallbackMotion,time).find(b=>b.index===track.index)!;
        return {time,translation:value.translation,rotation:value.rotation};
      });
      budget.remaining=Math.max(0,budget.remaining-samples.length);
    }
    if(samples.some((v,i)=>!Number.isFinite(v.time)||i>0&&v.time<=samples[i-1].time))throw new Error("VMD: fallback FLOAT timestamps must increase strictly");
    count += samples.length;
    const input = doc
      .createAccessor('VMD seconds')
      .setBuffer(buffer)
      .setType('SCALAR')
      .setArray(new Float32Array(samples.map((s) => s.time)));
    for (const path of ['translation', 'rotation'] as const) {
      const values = samples.flatMap((s) => s[path]);
      const output = doc
        .createAccessor(`VMD ${path}`)
        .setBuffer(buffer)
        .setType(path === 'translation' ? 'VEC3' : 'VEC4')
        .setArray(new Float32Array(values));
      const sampler = doc
        .createAnimationSampler()
        .setInterpolation('LINEAR')
        .setInput(input)
        .setOutput(output);
      animation
        .addSampler(sampler)
        .addChannel(
          doc
            .createAnimationChannel()
            .setTargetNode(nodes[track.index])
            .setTargetPath(path)
            .setSampler(sampler),
        );
    }
  }
  const weights: { node: Node; sampler: number }[] = [];
  for (const group of motion.morphs ?? []) {
    const targetCount=motion.morphModel ? motion.morphModel.morphs.filter(m=>m.target!==null).length : group.count;
    if(!targetCount)continue;
    if (!meshNode) throw new Error('VMD: missing morph mesh node');
    let times = [...new Set([0, ...group.tracks.flatMap(t => t.keys.map(k => k.frame / 30))])].sort((a,b) => a-b);
    const weightBudget=Math.max(1,Math.min(options.maxSamples??200_000,Math.floor(1_000_000/Math.max(1,targetCount))));
    if(times.length>weightBudget || times.some((v,i)=>i>0&&Math.fround(v)<=Math.fround(times[i-1]))) {
      diagnostics.push({category:'fallback-limit',code:'weight-sampling',path:'VMD',message:'core weight samples reduced to fit FLOAT timestamps/output budget; exact source weights retained'});
      times=[...new Set(Array.from({length:Math.min(weightBudget,256)},(_,i)=>Math.fround(weightBudget===1 ? 0 : motion.duration*i/(Math.min(weightBudget,256)-1))))];
    }
    const stamps = times.map(Math.fround);
    count += times.length;
    const values = times.flatMap(time => {
      const row = new Array(group.count).fill(0);
      for (const track of group.tracks) row[track.index] = evaluateWeight(track, time);
      return motion.morphModel ? reduceMorphs(motion.morphModel,row).targets : row;
    });
    const array = new Float32Array(values);
    if (!array.every(Number.isFinite)) throw new Error('VMD: unsupported FLOAT weight numeric range');
    const input = doc.createAccessor('VMD weight seconds').setBuffer(buffer).setType('SCALAR').setArray(new Float32Array(stamps));
    const output = doc.createAccessor('VMD weights (key-major)').setBuffer(buffer).setType('SCALAR').setArray(array);
    const sampler = doc.createAnimationSampler().setInterpolation('LINEAR').setInput(input).setOutput(output);
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(meshNode).setTargetPath('weights').setSampler(sampler));
    weights.push({ node: meshNode, sampler: animation.listSamplers().indexOf(sampler) });
  }
  const extras=animation.getExtras() as any;extras.vmd.diagnostics=diagnostics;animation.setExtras(extras);
  doc.createExtension(VMDWriter).records.set(animation, { motion, nodes, weights, diagnostics });
  return count;
}

function previousFloat(value:number) {
  if(value<=0 || Math.fround(value)!==value) return NaN;
  const array=new Float32Array([value]),bits=new Uint32Array(array.buffer);bits[0]--;return array[0];
}
