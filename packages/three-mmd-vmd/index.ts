import { AnimationClip, type Object3D, type SkinnedMesh } from 'three';
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import {
  bindMotion,
  evaluateMotion,
  type VMD,
  type Motion,
  type MotionBinding,
  type VMDBindingOptions,
} from '../mmd-vmd';
import { EXTENSION_NAME, validatePayload, payloadMotion } from '../mmd-vmd/payload';
import { getVPDModel, applyResolvedPose, type VPDRig } from '../three-mmd-vpd';
import { claimMotion, releaseMotion } from '../three-mmd-vpd/ownership';
import type { RestBone } from '../mmd-vpd';
export { parseVMD } from '../mmd-vmd';
export { EXTENSION_NAME } from '../mmd-vmd/payload';
export type { VMD, VMDBindingOptions } from '../mmd-vmd';
export interface BoundVMD {
  readonly duration: number;
  readonly unmatched: readonly string[];
  readonly omitted: MotionBinding['omitted'];
}
const bound = new WeakMap<BoundVMD, { rig: VPDRig; motion: MotionBinding }>();
export function bindVMD(rig: VPDRig, vmd: VMD, options: VMDBindingOptions = {}): BoundVMD {
  const motion = bindMotion(getVPDModel(rig), vmd, options);
  const result = Object.freeze({
    duration: motion.duration,
    unmatched: Object.freeze([...motion.unmatched]),
    omitted: Object.freeze({ ...motion.omitted }),
  });
  bound.set(result, { rig, motion });
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
    private write: (pose: RestBone[]) => void,
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
    claimMotion(this.root!, this, () => {
      this.active = false;
    });
    this.write(pose);
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
    this.active = false;
    this.current = 0;
    claimMotion(this.root!, this, () => {
      this.active = false;
    });
    this.write(structuredClone(this.motion.rest));
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
    this.write = () => {};
    this.motion = { rest: [], tracks: [], duration: 0 };
  }
}
export function createVMDPlayer(rig: VPDRig, binding: BoundVMD) {
  const b = bound.get(binding);
  if (!b || b.rig !== rig) throw new Error('VMD: binding belongs to a different model instance');
  return new VMDPlayer(rig.root, b.motion, (pose) => applyResolvedPose(rig, pose, true));
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
      for (const channel of animation.channels ?? []) {
        const key = `${channel.target?.node}:${channel.target?.path}`;
        if (!expected.delete(key))
          throw new Error(`${EXTENSION_NAME}: fallback must contain exactly the corresponding TRS channels`);
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
    return Promise.resolve(new AnimationClip(def.name ?? 'VMD', payloadMotion(payload).duration, []));
  }
  async afterRoot(result: GLTF) {
    const players: VMDPlayer[] = [];
    for (const def of this.parser.json.animations ?? []) {
      const p = def.extensions?.[EXTENSION_NAME];
      if (p === undefined) continue;
      const motion = payloadMotion(p),
        nodes = new Map<number, Object3D>();
      for (const b of motion.rest) {
        const node = (await this.parser.getDependency('node', b.index)) as Object3D;
        if (!result.scene.getObjectById(node.id))
          throw new Error(`${EXTENSION_NAME}: node outside default scene`);
        nodes.set(b.index, node);
      }
      const meshes: SkinnedMesh[] = [];
      result.scene.traverse((n) => {
        if ((n as SkinnedMesh).isSkinnedMesh) meshes.push(n as SkinnedMesh);
      });
      players.push(
        new VMDPlayer(result.scene, motion, (pose) => {
          for (const b of pose) {
            const node = nodes.get(b.index)!;
            node.position.fromArray(b.translation);
            node.quaternion.fromArray(b.rotation);
            node.scale.fromArray(b.scale);
            node.updateMatrix();
          }
          result.scene.updateMatrixWorld(true);
          meshes.forEach((m) => {
            m.skeleton.update();
            m.computeBoundingBox();
            m.computeBoundingSphere();
          });
        }),
      );
    }
    loaded.set(result, Object.freeze(players));
  }
}
