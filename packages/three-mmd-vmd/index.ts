import { AnimationClip, type Object3D, type Mesh } from 'three';
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import {
  bindMotion,
  evaluateMotion,
  evaluateMorphs,
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
  let hasIdentity = false, hasTargets = false;
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
    const time = Math.max(0, Math.min(this.duration, seconds)),
      pose = evaluateMotion(this.motion, time);
    // Resolve and validate before claiming ownership or mutating transforms.
    if (
      pose.some((b) =>
        [...b.translation, ...b.rotation].some(
          (v) => !Number.isFinite(v) || !Number.isFinite(Math.fround(v)),
        ),
      )
    )
      throw new Error('VMD: unsupported evaluated numeric range');
    const write = this.prepare(pose, evaluateMorphs(this.motion, time));
    claimMotion(this.root!, this, () => {
      this.active = false;
    });
    write();
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
    const write = this.prepare(structuredClone(this.motion.rest), weights);
    claimMotion(this.root!, this, () => { this.active = false; });
    write();
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
    const originals = new Map<number, string>();
    for (const animation of json.animations ?? []) {
      const payload = animation.extensions?.[EXTENSION_NAME];
      if (payload === undefined) continue;
      validatePayload(payload, json.nodes?.length ?? 0);
      const expected = new Set(
        payload.tracks.flatMap((t) => [`${t.node}:translation`, `${t.node}:rotation`]),
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
        node.traverse((n: Object3D) => { if ((n as Mesh).isMesh) meshes.push(n as Mesh); });
        if (!meshes.length || meshes.some(m => m.morphTargetInfluences?.length !== count)) throw new Error(`${EXTENSION_NAME}: inconsistent loaded morph primitives`);
        weightMeshes.set(w.node, meshes);
        morphs.push({ node: w.node, count, tracks });
      }
      const motion = payloadMotion(p, morphs),
        nodes = new Map<number, Object3D>();
      for (const b of motion.rest) {
        const node = (await this.parser.getDependency('node', b.index)) as Object3D;
        if (!result.scene.getObjectById(node.id))
          throw new Error(`${EXTENSION_NAME}: node outside default scene`);
        nodes.set(b.index, node);
      }
      result.animations[animationIndex].duration = motion.duration;
      players.push(
        new VMDPlayer(result.scene, motion, (pose, weights) => {
          for (const w of weights) if (weightMeshes.get(w.node)!.some(m => m.morphTargetInfluences?.length !== w.values.length))
            throw new Error(`${EXTENSION_NAME}: changed morph target count`);
          return () => {
            for (const w of weights) for (const mesh of weightMeshes.get(w.node)!) mesh.morphTargetInfluences!.splice(0, w.values.length, ...w.values);
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
