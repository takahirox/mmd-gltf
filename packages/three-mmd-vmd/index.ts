import { retainedMorph, ensureMorphLoaded, MMDMorphPlugin } from '../three-mmd-morph/plugin';
import { retainRawMorphPose } from '../three-mmd-morph/state';
import { morphIdentity } from '../mmd-morph/payload';
import { getPhysicsSession } from '../three-mmd-physics/registry';
import { MMDSolverPlugin } from '../three-mmd-solver';
import { solvePose, type SolverProfile } from '../mmd-solver';
import { AnimationClip, type Object3D, type Mesh } from 'three';
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import {
  bindMotion,
  evaluateMotion,
  evaluateRawMotion,
  evaluateMorphs,
  evaluateIK,
  type VMD,
  type Motion,
  type MotionBinding,
  type VMDBindingOptions,
} from '../mmd-vmd';
import { EXTENSION_NAME, validatePayload, payloadMotion } from '../mmd-vmd/payload';
import { getVPDModel, prepareResolvedPose, type VPDRig } from '../three-mmd-vpd';
import { claimMotion, releaseMotion } from '../three-mmd-vpd/ownership';
import { createMorphRig, getMorphModel, prepareMorphWeights, refreshDeformation, type MorphRig } from '../three-mmd-morph';
import { validWeight } from '../mmd-morph';
import type { RestBone } from '../mmd-vpd';
export { parseVMD } from '../mmd-vmd';
export { EXTENSION_NAME } from '../mmd-vmd/payload';
export type { VMD, VMDBindingOptions } from '../mmd-vmd';
export interface BoundVMD {
  readonly duration: number;
  readonly unmatched: readonly string[];
  readonly unmatchedMorphs: readonly string[];
  readonly omitted: MotionBinding['omitted'];
}
const bound = new WeakMap<BoundVMD, { rig: VPDRig; motion: MotionBinding; morph?: MorphRig }>();
export function bindVMD(rig: VPDRig, vmd: VMD, options: VMDBindingOptions = {}): BoundVMD {
  const model = getVPDModel(rig);
  let hasIdentity = !!retainedMorph(rig.root), hasTargets = false;
  rig.root.traverse(n => {
    hasIdentity ||= Object.hasOwn(n.userData, 'pmxMorph');
    hasTargets ||= !!(n as Mesh).morphTargetInfluences?.length;
  });
  // Pre-v2 bone-only converter assets had no morph metadata. Never infer target identity.
  if (!hasIdentity && hasTargets) throw new Error('VMD: missing exact morph identity metadata');
  const morphRig = hasIdentity ? createMorphRig(rig.root) : undefined;
  const morph = morphRig ? getMorphModel(morphRig) : undefined;
  if (morph && model.modelId !== morph.modelId) throw new Error('VMD: bone/morph metadata belongs to different models');
  const motion = bindMotion(model, vmd, options, morph);
  const result = Object.freeze({
    duration: motion.duration,
    unmatched: Object.freeze([...motion.unmatched]),
    unmatchedMorphs: Object.freeze([...motion.unmatchedMorphs]),
    omitted: Object.freeze({ ...motion.omitted }),
  });
  bound.set(result, { rig, motion, morph: morphRig });
  return result;
}
/** One owner per model instance. VPD apply/reset automatically pauses and releases VMD. */
export class VMDPlayer {
  private disposed = false;
  private active = false;
  private current = 0;
  private ikOverrides = new Map<number,boolean>();
  private sampledTime(time:number) { const p=this.root ? getPhysicsSession(this.root) : undefined;return p?.enabled ? Math.floor(time/p.timeline.profile.fixedStep+1e-9)*p.timeline.profile.fixedStep : time; }
  get ikStates() { const values=evaluateIK(this.motion,this.sampledTime(this.current)); this.motion.solver?.bones.filter(b=>b.ik).forEach(b=>{if(!values.has(b.index))values.set(b.index,true);});this.ikOverrides.forEach((v,k)=>values.set(k,v));return Object.fromEntries(values); }
  setIKEnabled(index:number, enabled:boolean | undefined) {
    this.check();
    if(!this.motion.solver?.bones.some(b=>b.index===index && b.ik) || enabled!==undefined && typeof enabled!=='boolean')throw new Error('VMD IK: invalid controller override');
    const previous=new Map(this.ikOverrides);
    if(enabled===undefined)this.ikOverrides.delete(index);else this.ikOverrides.set(index,enabled);
    try { this.seek(this.current); } catch(error) { this.ikOverrides=previous;throw error; }
    return this;
  }
  loop = false;
  readonly duration: number;
  constructor(
    private root: Object3D | undefined,
    private motion: Motion,
    private prepare: (pose: RestBone[], weights: ReturnType<typeof evaluateMorphs>) => () => void,
  ) {
    this.motion = structuredClone(motion);
    this.duration = motion.duration;
  }
  get playing() {
    return this.active;
  }
  get time() {
    return this.current;
  }
  private check() {
    if (this.disposed) throw new Error('VMD: disposed player');
  }
  seek(seconds: number) {
    this.check();
    if (!Number.isFinite(seconds)) throw new Error('VMD: seek time must be finite');
    const time = Math.max(0, Math.min(this.duration, seconds));
    const weights=evaluateMorphs(this.motion,this.sampledTime(time));
    // Read-only writer preparation catches changed layouts before native history is replaced.
    this.prepare(this.motion.rest,weights);
    const physics = getPhysicsSession(this.root!),
      controls=(t:number)=>{const values=evaluateIK(this.motion,t);this.ikOverrides.forEach((v,k)=>values.set(k,v));return values;},
      pose = physics ? physics.motion(time,t=>evaluateMotion(this.motion,t,this.ikOverrides,true),controls) : evaluateMotion(this.motion, time, this.ikOverrides);
    // Resolve and validate before claiming ownership or mutating transforms.
    if (
      pose.some((b) =>
        [...b.translation, ...b.rotation].some(
          (v) => !Number.isFinite(v) || !Number.isFinite(Math.fround(v)),
        ),
      )
    )
      throw new Error('VMD: unsupported evaluated numeric range');
    const write = this.prepare(pose, weights);
    claimMotion(this.root!, this, () => {
      this.active = false;
    });
    write();
    retainRawMorphPose(this.root!,evaluateRawMotion(this.motion,this.sampledTime(time)));
    this.current = time;
    return this;
  }
  play() {
    this.check();
    this.seek(this.current);
    this.active = true;
    return this;
  }
  pause() {
    this.check();
    this.active = false;
    return this;
  }
  update(deltaSeconds: number) {
    this.check();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
      throw new Error('VMD: update delta must be finite and nonnegative');
    getPhysicsSession(this.root!)?.timeline.validateDelta(deltaSeconds);
    if (!this.active) return this;
    const next = this.current + deltaSeconds;
    if (!Number.isFinite(next)) throw new Error('VMD: unsupported playback time range');
    this.seek(this.loop && this.duration > 0 ? next % this.duration : Math.min(next, this.duration));
    if (!this.loop && next >= this.duration) this.active = false;
    return this;
  }
  stop() {
    this.check();
    const weights = (this.motion.morphs ?? []).map(g => ({ node: g.node, values: new Array(g.count).fill(0) }));
    this.prepare(this.motion.rest,weights);
    const physics=getPhysicsSession(this.root!);
    const write = this.prepare(physics ? physics.pose(this.motion.rest) : solvePose(this.motion.solver, this.motion.rest), weights);
    claimMotion(this.root!, this, () => { this.active = false; });
    write();
    retainRawMorphPose(this.root!,this.motion.rest);
    this.active = false;
    this.current = 0;
    releaseMotion(this.root!, this);
    return this;
  }
  reset() {
    return this.stop();
  }
  dispose() {
    if (this.disposed) return;
    this.active = false;
    releaseMotion(this.root!, this);
    this.disposed = true;
    this.root = undefined;
    this.prepare = () => () => {};
    this.ikOverrides.clear();
    this.motion = { rest: [], tracks: [], duration: 0 };
  }
}
export function createVMDPlayer(rig: VPDRig, binding: BoundVMD) {
  const b = bound.get(binding);
  if (!b || b.rig !== rig) throw new Error('VMD: binding belongs to a different model instance');
  return new VMDPlayer(rig.root, b.motion, (pose, weights) => {
    const writePose = prepareResolvedPose(rig, pose);
    const writeWeights = b.morph ? prepareMorphWeights(b.morph, weights[0]?.values ?? []) : () => {};
    return () => { writeWeights(); writePose(); refreshDeformation(rig.root); };
  });
}
const loaded = new WeakMap<GLTF, readonly VMDPlayer[]>();
export function getVMDPlayers(gltf: GLTF): readonly VMDPlayer[] {
  return loaded.get(gltf) ?? [];
}
/** Optional retained curves replace their complete matching fallback animation. No private Three.js patches. */
export class MMDVMDPlugin implements GLTFLoaderPlugin {
  readonly name = EXTENSION_NAME;
  constructor(private parser: GLTFParser) {}
  beforeRoot() {
    const json = this.parser.json;
    new MMDMorphPlugin(this.parser).beforeRoot();
    const originals = new Map<number, string>();
    for (const animation of json.animations ?? []) {
      const payload = animation.extensions?.[EXTENSION_NAME];
      if (payload === undefined) continue;
      validatePayload(payload, json.nodes?.length ?? 0);
      if(payload.controls && (!json.extensions?.MMD_morphs || morphIdentity(payload.controls.model)!==morphIdentity(json.extensions.MMD_morphs.model) ||
          morphIdentity(payload.controls.nodes)!==morphIdentity(json.extensions.MMD_morphs.nodes)))throw new Error('MMD_animation_vmd: controls differ from root MMD_morphs');
      if(payload.controls) {
        const expectedMeshes=payload.controls.model.morphs.some(m=>m.target!==null)?json.extensions.MMD_morphs.meshes??[]:[];
        if(morphIdentity([...(payload.weights??[]).map(w=>w.node)].sort((a,b)=>a-b))!==morphIdentity([...expectedMeshes].sort((a:number,b:number)=>a-b)))throw new Error('MMD_animation_vmd: fallback weights differ from morph mesh references');
      }
      if (payload.solver) new MMDSolverPlugin(this.parser).beforeRoot();
      if (payload.solver && (!json.extensions?.MMD_skeleton_solver || solverIdentity(payload.solver)!==solverIdentity(json.extensions.MMD_skeleton_solver))) throw new Error(`${EXTENSION_NAME}: solver differs from root contract`);
      const expected = new Set(
        (payload.solver ? payload.solver.bones.map(b=>({node:b.node!})) : payload.controls ? payload.rest.filter(r=>payload.tracks.some(t=>t.node===r.node) || payload.controls!.model.morphs.some(m=>m.bone?.some(b=>payload.controls!.nodes.find(n=>n.index===b.index)?.node===r.node))) : payload.tracks).flatMap((t) => [`${t.node}:translation`, `${t.node}:rotation`]),
      );
      for (const w of payload.weights ?? []) {
        expected.add(`${w.node}:weights`);
        const channel = animation.channels?.find((c: any) => c.target?.node === w.node && c.target.path === 'weights');
        if (!channel || channel.sampler !== w.sampler) throw new Error(`${EXTENSION_NAME}: mismatched weight sampler reference`);
        const sampler = animation.samplers?.[w.sampler], node = json.nodes[w.node], mesh = json.meshes?.[node.mesh];
        const count = mesh?.primitives?.[0]?.targets?.length;
        const input = json.accessors?.[sampler?.input], output = json.accessors?.[sampler?.output];
        if (!count || mesh.primitives.some((p: any) => p.targets?.length !== count || p.targets.some((t: any) => t.POSITION === undefined)) ||
            sampler.interpolation !== 'LINEAR' || !Number.isInteger(sampler.input) || !Number.isInteger(sampler.output) ||
            input?.type !== 'SCALAR' || input.componentType !== 5126 || (input.normalized !== undefined && input.normalized !== false) ||
            output?.type !== 'SCALAR' || output.componentType !== 5126 || (output.normalized !== undefined && output.normalized !== false) ||
            !Number.isSafeInteger(input.count) || input.count < 1 || !Number.isSafeInteger(output.count) ||
            output.count !== input.count * count || output.count > 1_000_000)
          throw new Error(`${EXTENSION_NAME}: invalid core LINEAR weight sampler/layout`);
      }
      for (const channel of animation.channels ?? []) {
        const key = `${channel.target?.node}:${channel.target?.path}`;
        if (!expected.delete(key))
          throw new Error(`${EXTENSION_NAME}: fallback must contain exactly the corresponding TRS/weight channels`);
      }
      if (expected.size) throw new Error(`${EXTENSION_NAME}: missing corresponding fallback channels`);
      for (const rest of payload.rest) {
        const encoded = JSON.stringify([rest.translation, rest.rotation]);
        if (originals.has(rest.node) && originals.get(rest.node) !== encoded)
          throw new Error(`${EXTENSION_NAME}: inconsistent original rest across animations`);
        originals.set(rest.node, encoded);
        const def = json.nodes[rest.node];
        if (def.matrix || (def.scale ?? [1, 1, 1]).some((v: number) => v !== 1))
          throw new Error(`${EXTENSION_NAME}: unit-scale TRS joints required`);
      }
    }
    return null;
  }
  loadAnimation(index: number) {
    const def = this.parser.json.animations[index],
      payload = def.extensions?.[EXTENSION_NAME];
    if (payload === undefined) return null;
    // Returning a clip with no fallback tracks makes double-driving impossible via result.animations.
    return Promise.resolve(new AnimationClip(def.name ?? 'VMD', -1, []));
  }
  async afterRoot(result: GLTF) {
    await ensureMorphLoaded(this.parser,result);
    const players: VMDPlayer[] = [];
    for (const [animationIndex, def] of (this.parser.json.animations ?? []).entries()) {
      const p = def.extensions?.[EXTENSION_NAME];
      if (p === undefined) continue;
      const morphs: NonNullable<Motion['morphs']> = [], weightMeshes = new Map<number, Mesh[]>();
      for (const w of p.weights ?? []) {
        const sampler = def.samplers[w.sampler];
        const [input, output, node] = await Promise.all([
          this.parser.getDependency('accessor', sampler.input),
          this.parser.getDependency('accessor', sampler.output),
          this.parser.getDependency('node', w.node),
        ]);
        if (!result.scene.getObjectById(node.id)) throw new Error(`${EXTENSION_NAME}: weight node outside default scene`);
        const count = this.parser.json.meshes[this.parser.json.nodes[w.node].mesh].primitives[0].targets.length;
        const tracks = Array.from({ length: count }, (_, index) => ({ index, keys: [] as {frame:number;weight:number}[] }));
        let last = -1;
        for (let i = 0; i < input.count; i++) {
          const time = input.getX(i);
          if (!Number.isFinite(time) || time < 0 || time <= last) throw new Error(`${EXTENSION_NAME}: invalid weight timestamp`);
          last = time;
          for (let j = 0; j < count; j++) {
            const weight = output.getX(i * count + j);
            if (!validWeight(weight)) throw new Error(`${EXTENSION_NAME}: invalid weight value`);
            tracks[j].keys.push({ frame: time * 30, weight });
          }
        }
        const meshes: Mesh[] = [];
        const collect = (n: Object3D) => {
          // A multi-primitive node is a group; its glTF child nodes are separate targets,
          // including instances of the same mesh definition. Stop at those boundaries.
          if (n !== node && this.parser.associations.get(n)?.nodes !== undefined) return;
          if ((n as Mesh).isMesh) meshes.push(n as Mesh);
          n.children.forEach(collect);
        };
        collect(node);
        if (!meshes.length || meshes.some(m => m.morphTargetInfluences?.length !== count)) throw new Error(`${EXTENSION_NAME}: inconsistent loaded morph primitives`);
        weightMeshes.set(w.node, meshes);
        morphs.push({ node: w.node, count, tracks });
      }
      const motion = payloadMotion(p, morphs),
        nodes = new Map<number, Object3D>();
      for (const b of motion.rest) {
        const node = (await this.parser.getDependency('node', motion.solver?.bones.find(v=>v.index===b.index)?.node ?? p.controls?.nodes.find((v:any)=>v.index===b.index)?.node ?? b.index)) as Object3D;
        if (!result.scene.getObjectById(node.id))
          throw new Error(`${EXTENSION_NAME}: node outside default scene`);
        nodes.set(b.index, node);
      }
      result.animations[animationIndex].duration = motion.duration;
      const controlRig=p.controls ? createMorphRig(result.scene) : undefined;
      players.push(
        new VMDPlayer(result.scene, motion, (pose, weights) => {
          const writeControls=controlRig ? prepareMorphWeights(controlRig,weights[0]?.values??[]) : undefined;
          for (const w of controlRig ? [] : weights) if (weightMeshes.get(w.node)!.some(m => m.morphTargetInfluences?.length !== w.values.length))
            throw new Error(`${EXTENSION_NAME}: changed morph target count`);
          return () => {
            writeControls?.();
            for (const w of controlRig ? [] : weights) for (const mesh of weightMeshes.get(w.node)!) mesh.morphTargetInfluences!.splice(0, w.values.length, ...w.values);
            for (const b of pose) {
              const node = nodes.get(b.index)!;
              node.position.fromArray(b.translation);
              node.quaternion.fromArray(b.rotation);
              node.scale.fromArray(b.scale);
              node.updateMatrix();
            }
            refreshDeformation(result.scene);
          };
        }),
      );
    }
    loaded.set(result, Object.freeze(players));
  }
}

/** JSON property order and bone table order do not change solver identities. */
function solverIdentity(profile: SolverProfile) {
  return JSON.stringify({...profile,bones:[...profile.bones].sort((a,b)=>a.index-b.index)}, (_key,value)=>
    value && typeof value==='object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))) : value);
}
