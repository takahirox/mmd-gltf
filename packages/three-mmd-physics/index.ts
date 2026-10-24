import type { Object3D, SkinnedMesh } from "three";
import type {
  GLTF,
  GLTFLoaderPlugin,
  GLTFParser,
} from "three/addons/loaders/GLTFLoader.js";
import {
  EXTENSION_NAME,
  validatePhysics,
  type PhysicsProfile,
} from "../mmd-physics";
import { solvePose, type SolverProfile } from "../mmd-solver";
import { MMDSolverPlugin } from "../three-mmd-solver";
import type { RestBone } from "../mmd-vpd";
import { refreshDeformation } from "../three-mmd-morph";
import { claimMotion, releaseMotion } from "../three-mmd-vpd/ownership";
import {
  PhysicsTimeline,
  type PoseSampler,
  type ControlSampler,
} from "./world";
import {
  registerPhysics,
  releasePhysics,
  type PhysicsSession,
} from "./registry";
import { checkAmmo, type AmmoAPI } from "./ammo";
export { loadAmmoBrowser, BACKEND_SHA256 } from "./ammo";
export { PhysicsTimeline, PhysicsWorld } from "./world";
const models = new WeakMap<
  Object3D,
  {
    profile: PhysicsProfile;
    solver: SolverProfile;
    nodes: Map<number, Object3D>;
  }
>();
export function getPhysicsModel(root: Object3D) {
  const m = models.get(root);
  return m
    ? {
        profile: structuredClone(m.profile),
        solver: structuredClone(m.solver),
        nodes: new Map(m.nodes),
      }
    : undefined;
}
/** Loading retains core snapshot and original rest. It never starts simulation. */
export class MMDPhysicsPlugin implements GLTFLoaderPlugin {
  readonly name = EXTENSION_NAME;
  constructor(private parser: GLTFParser) {}
  beforeRoot() {
    const json = this.parser.json,
      p = json.extensions?.[EXTENSION_NAME];
    if (p === undefined) return null;
    const solver = json.extensions?.MMD_skeleton_solver;
    validatePhysics(p, solver);
    new MMDSolverPlugin(this.parser).beforeRoot();
    return null;
  }
  async afterRoot(result: GLTF) {
    const json = this.parser.json,
      p = json.extensions?.[EXTENSION_NAME];
    if (p === undefined) return;
    const solver: SolverProfile = json.extensions.MMD_skeleton_solver,
      nodes = new Map<number, Object3D>();
    for (const b of solver.bones) {
      const node = await this.parser.getDependency("node", b.node!);
      if (!result.scene.getObjectById(node.id))
        throw new Error(`MMD_physics bones[${b.index}]: outside default scene`);
      nodes.set(b.index, node);
    }
    models.set(result.scene, {
      profile: structuredClone(p),
      solver: structuredClone(solver),
      nodes,
    });
  }
}
/** Explicit instance owner. Native state is rebuilt on reset, seek, pose handoff and looping. */
export class PhysicsRig implements PhysicsSession {
  readonly timeline: PhysicsTimeline;
  private raw: RestBone[];
  private disposed = false;
  private active = false;
  private enabledValue = true;
  private poseTime = 0;
  private nodes: Map<number, Object3D>;
  private solver: SolverProfile;
  private root?: Object3D;
  get enabled() {
    return this.enabledValue;
  }
  set enabled(value: boolean) {
    this.check();
    if (typeof value !== "boolean")
      throw new Error("MMD_physics: enabled must be boolean");
    this.enabledValue = value;
    if (!value) this.timeline.clear();
  }
  get time() {
    return this.timeline.time;
  }
  constructor(root: Object3D, api: AmmoAPI) {
    checkAmmo(api);
    const m = getPhysicsModel(root);
    if (!m) throw new Error("MMD_physics: load with MMDPhysicsPlugin first");
    for (const [index, node] of m.nodes)
      if (node.scale.toArray().some((v) => v !== 1))
        throw new Error(`MMD_physics bones[${index}]: unit scale required`);
    this.root = root;
    this.nodes = m.nodes;
    this.solver = m.solver;
    this.raw = structuredClone(m.solver.bones);
    this.timeline = new PhysicsTimeline(api, m.profile, m.solver);
    try {
      registerPhysics(root, this);
    } catch (error) {
      this.timeline.dispose();
      throw error;
    }
  }
  private check() {
    if (this.disposed) throw new Error("MMD_physics: disposed rig");
  }
  motion(time: number, sample: PoseSampler, controls: ControlSampler) {
    this.check();
    const pose = this.enabled
      ? this.timeline.seek(time, sample, controls)
      : solvePose(this.solver, sample(time), controls(time));
    const sampled = this.enabled
      ? Math.floor(time / this.timeline.profile.fixedStep + 1e-9) *
        this.timeline.profile.fixedStep
      : time;
    this.raw = structuredClone(sample(sampled));
    this.poseTime = 0;
    this.active = false;
    return pose;
  }
  pose(raw: RestBone[]) {
    this.check();
    const pose = this.enabled
      ? this.timeline.seek(0, () => raw)
      : solvePose(this.solver, raw);
    if (!this.enabled) this.timeline.clear();
    this.raw = structuredClone(raw);
    this.poseTime = 0;
    this.active = false;
    return pose;
  }
  private write(pose: RestBone[]) {
    for (const b of pose) {
      const n = this.nodes.get(b.index)!;
      n.position.fromArray(b.translation);
      n.quaternion.fromArray(b.rotation);
      n.updateMatrix();
    }
    refreshDeformation(this.root!);
  }
  reset() {
    this.check();
    const resolved = this.pose(this.raw);
    claimMotion(this.root!, this, () => {
      this.active = false;
    });
    this.write(resolved);
  }
  step(delta = this.timeline.profile.fixedStep) {
    this.check();
    this.timeline.validateDelta(delta);
    const time = this.poseTime + delta;
    this.timeline.preflight(time);
    const pose = this.enabled
      ? this.timeline.seek(time, () => this.raw)
      : solvePose(this.solver, this.raw);
    claimMotion(this.root!, this, () => {
      this.active = false;
    });
    this.write(pose);
    this.poseTime = time;
    return this;
  }
  play() {
    this.check();
    claimMotion(this.root!, this, () => {
      this.active = false;
    });
    this.active = true;
    return this;
  }
  pause() {
    this.check();
    this.active = false;
    return this;
  }
  update(delta: number) {
    this.check();
    this.timeline.validateDelta(delta);
    if (this.active) this.step(delta);
    return this;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    releaseMotion(this.root!, this);
    releasePhysics(this.root!, this);
    this.timeline.dispose();
    this.nodes.clear();
    this.raw = [];
    this.root = undefined;
  }
}
export async function createPhysicsRig(
  root: Object3D,
  backend: () => Promise<{
    api: AmmoAPI;
  }>,
) {
  const { api } = await backend();
  return new PhysicsRig(root, api);
}
