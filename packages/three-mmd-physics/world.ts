import { Matrix4, Quaternion, Vector3 } from "three";
import type Ammo from "ammojs-typed";
import { solvePose, type SolverProfile } from "../mmd-solver";
import {
  validatePhysics,
  type PhysicsProfile,
  type Frame,
  MAX_SEEK_STEPS,
  MAX_UPDATE_STEPS,
} from "../mmd-physics";
import type { RestBone } from "../mmd-vpd";
import { checkAmmo, type AmmoAPI } from "./ammo";
const matrix = (f: Frame) =>
  new Matrix4().compose(
    new Vector3(...f.translation),
    new Quaternion(...f.rotation),
    new Vector3(1, 1, 1),
  );
const worlds = (pose: RestBone[]) => {
  const out = new Map<number, Matrix4>(),
    remaining = [...pose];
  while (remaining.length) {
    let progress = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const b = remaining[i];
      if (b.parentIndex !== -1 && !out.has(b.parentIndex)) continue;
      out.set(
        b.index,
        b.parentIndex === -1
          ? matrix(b)
          : out.get(b.parentIndex)!.clone().multiply(matrix(b)),
      );
      remaining.splice(i, 1);
      progress = true;
    }
    if (!progress)
      throw new Error("MMD_physics: cyclic/incomplete pose hierarchy");
  }
  return out;
};
/** Each world owns every constructed native handle, never borrowed return values. */
export class PhysicsWorld {
  private owned: unknown[] = [];
  private borrowed = new Map<unknown, Map<number, unknown>>();
  private bodies = new Map<number, Ammo.btRigidBody>();
  private constraints: Ammo.btGeneric6DofSpringConstraint[] = [];
  private world!: Ammo.btDiscreteDynamicsWorld;
  private scratch!: Ammo.btTransform;
  private vector!: Ammo.btVector3;
  private quaternion!: Ammo.btQuaternion;
  private disposed = false;
  static allocations = 0;
  private own<T>(value: T): T {
    this.owned.push(value);
    PhysicsWorld.allocations++;
    return value;
  }
  private borrow<T>(value: T): T {
    const type = this.api.getClass(value),
      pointer = this.api.getPointer(value);
    let refs = this.borrowed.get(type);
    if (!refs) this.borrowed.set(type, (refs = new Map()));
    refs.set(pointer, value);
    return value;
  }
  constructor(
    private api: AmmoAPI,
    readonly profile: PhysicsProfile,
    readonly solver: SolverProfile,
    initial: RestBone[],
  ) {
    checkAmmo(api);
    validatePhysics(profile, solver);
    const pre = solvePose(solver, initial, new Map(), "pre"),
      poseWorld = worlds(pre);
    try {
      const config = this.own(new api.btDefaultCollisionConfiguration()),
        dispatcher = this.own(new api.btCollisionDispatcher(config)),
        broadphase = this.own(new api.btDbvtBroadphase()),
        constraintSolver = this.own(
          new api.btSequentialImpulseConstraintSolver(),
        );
      this.world = this.own(
        new api.btDiscreteDynamicsWorld(
          dispatcher,
          broadphase,
          constraintSolver,
          config,
        ),
      );
      this.vector = this.own(new api.btVector3(...profile.gravity));
      this.world.setGravity(this.vector);
      this.scratch = this.own(new api.btTransform());
      this.quaternion = this.own(new api.btQuaternion(0, 0, 0, 1));
      for (const b of profile.bodies) {
        const shape =
          b.shape === "sphere"
            ? this.own(new api.btSphereShape(b.size[0]))
            : b.shape === "capsule"
              ? this.own(new api.btCapsuleShape(b.size[0], b.size[1]))
              : this.own(
                  new api.btBoxShape(this.own(new api.btVector3(...b.size))),
                );
        // Bullet spheres use their radius as collision margin. Box/capsule use explicit policy.
        if (b.shape !== "sphere") shape.setMargin(b.margin);
        const transform = this.own(new api.btTransform());
        this.setTransform(
          transform,
          (poseWorld.get(b.bone) ?? new Matrix4()).clone().multiply(matrix(b)),
        );
        const state = this.own(new api.btDefaultMotionState(transform)),
          inertia = this.own(new api.btVector3(0, 0, 0)),
          mass = b.mode === 0 ? 0 : b.mass;
        if (mass) shape.calculateLocalInertia(mass, inertia);
        const info = this.own(
            new api.btRigidBodyConstructionInfo(mass, state, shape, inertia),
          ),
          body = this.own(new api.btRigidBody(info));
        body.setDamping(b.linearDamping, b.angularDamping);
        body.setFriction(b.friction);
        body.setRestitution(b.restitution);
        body.setActivationState(4);
        if (b.mode === 0) body.setCollisionFlags(body.getCollisionFlags() | 2);
        this.world.addRigidBody(body, 1 << b.group, b.mask);
        this.bodies.set(b.index, body);
      }
      for (const j of profile.joints) {
        const a = this.own(new api.btTransform()),
          b = this.own(new api.btTransform());
        this.setTransform(a, matrix(j.frameA));
        this.setTransform(b, matrix(j.frameB));
        const constraint = this.own(
          new api.btGeneric6DofSpringConstraint(
            this.bodies.get(j.bodyA)!,
            this.bodies.get(j.bodyB)!,
            a,
            b,
            true,
          ),
        );
        for (const [method, values] of [
          ["setLinearLowerLimit", j.linearLower],
          ["setLinearUpperLimit", j.linearUpper],
          ["setAngularLowerLimit", j.angularLower],
          ["setAngularUpperLimit", j.angularUpper],
        ] as const) {
          this.vector.setValue(...values);
          constraint[method](this.vector);
        }
        [...j.linearSpring, ...j.angularSpring].forEach((value, i) => {
          constraint.enableSpring(i, value !== 0);
          constraint.setStiffness(i, value);
          constraint.setDamping(i, 1);
          constraint.setEquilibriumPoint(i, 0);
        });
        this.world.addConstraint(constraint, false);
        this.constraints.push(constraint);
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  private setTransform(out: Ammo.btTransform, m: Matrix4) {
    const p = new Vector3(),
      q = new Quaternion();
    m.decompose(p, q, new Vector3());
    this.vector.setValue(p.x, p.y, p.z);
    this.quaternion.setValue(q.x, q.y, q.z, q.w);
    out.setIdentity();
    out.setOrigin(this.vector);
    out.setRotation(this.quaternion);
  }
  private read(body: Ammo.btRigidBody) {
    const t = this.borrow(body.getWorldTransform()),
      p = this.borrow(t.getOrigin());
    // getRotation() is [Value] in this artifact's IDL and allocates native memory.
    // Read the borrowed basis into the explicitly owned quaternion instead.
    this.borrow(t.getBasis()).getRotation(this.quaternion);
    const q = this.quaternion;
    return new Matrix4().compose(
      new Vector3(p.x(), p.y(), p.z()),
      new Quaternion(q.x(), q.y(), q.z(), q.w()),
      new Vector3(1, 1, 1),
    );
  }
  private write(body: Ammo.btRigidBody, m: Matrix4) {
    this.setTransform(this.scratch, m);
    body.setWorldTransform(this.scratch);
    this.borrow(body.getMotionState()).setWorldTransform(this.scratch);
    body.activate(true);
  }
  bodyTransforms() {
    if (this.disposed) throw new Error("MMD_physics: disposed world");
    return new Map(
      [...this.bodies].map(([i, b]) => [i, this.read(b).toArray()]),
    );
  }
  resolve(
    raw: RestBone[],
    enabled: ReadonlyMap<number, boolean> = new Map(),
    step = true,
  ) {
    if (this.disposed) throw new Error("MMD_physics: disposed world");
    const pre = solvePose(this.solver, raw, enabled, "pre"),
      animated = worlds(pre);
    for (const b of this.profile.bodies) {
      const body = this.bodies.get(b.index)!;
      if (b.mode === 0)
        this.write(
          body,
          (animated.get(b.bone) ?? new Matrix4()).clone().multiply(matrix(b)),
        );
      if (b.mode === 2 && b.bone !== -1)
        this.align(b.index, animated.get(b.bone)!);
    }
    // maxSubSteps=0 deliberately disables Bullet's hidden accumulator and interpolation.
    if (step)
      this.world.stepSimulation(
        this.profile.fixedStep,
        0,
        this.profile.fixedStep,
      );
    const result = structuredClone(pre),
      byIndex = new Map(result.map((b) => [b.index, b])),
      pending = result.slice();
    const resolvedWorld = new Map<number, Matrix4>(),
      writers = new Map(
        this.profile.bodies
          .filter((b) => b.mode !== 0 && b.bone !== -1)
          .map((b) => [b.bone, b]),
      );
    while (pending.length) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const bone = pending[i];
        if (bone.parentIndex !== -1 && !resolvedWorld.has(bone.parentIndex))
          continue;
        const b = writers.get(bone.index),
          parent = resolvedWorld.get(bone.parentIndex) ?? new Matrix4();
        if (b) {
          if (b.mode === 2) this.align(b.index, animated.get(bone.index)!);
          const target = this.read(this.bodies.get(b.index)!).multiply(
            matrix(b).invert(),
          );
          const local = parent.clone().invert().multiply(target),
            p = new Vector3(),
            q = new Quaternion();
          local.decompose(p, q, new Vector3());
          const out = byIndex.get(bone.index)!;
          out.translation = p.toArray();
          out.rotation = q.normalize().toArray();
        }
        resolvedWorld.set(bone.index, parent.clone().multiply(matrix(bone)));
        pending.splice(i, 1);
      }
    }
    return solvePose(this.solver, result, enabled, "post");
  }
  private align(index: number, animated: Matrix4) {
    const b = this.profile.bodies.find((b) => b.index === index)!,
      body = this.bodies.get(index)!,
      bodyMatrix = this.read(body),
      boneMatrix = bodyMatrix.clone().multiply(matrix(b).invert()),
      q = new Quaternion().setFromRotationMatrix(boneMatrix),
      p = new Vector3()
        .setFromMatrixPosition(animated)
        .add(new Vector3(...b.translation).applyQuaternion(q));
    bodyMatrix.setPosition(p);
    this.write(body, bodyMatrix);
    this.vector.setValue(0, 0, 0);
    body.setLinearVelocity(this.vector);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.world) {
      for (const c of this.constraints) this.world.removeConstraint(c);
      for (const b of this.bodies.values()) this.world.removeRigidBody(b);
    }
    for (const value of this.owned.reverse()) {
      this.api.destroy(value);
      PhysicsWorld.allocations--;
    }
    // Evict borrowed JS wrappers without destroying their parent-owned native memory.
    for (const [type, refs] of this.borrowed)
      for (const [pointer, value] of refs) {
        const cache = this.api.getCache(type);
        if (cache[pointer] === value) delete cache[pointer];
      }
    this.borrowed.clear();
    this.owned = [];
    this.bodies.clear();
    this.constraints = [];
    this.world = undefined!;
    this.scratch = undefined!;
    this.vector = undefined!;
    this.quaternion = undefined!;
    this.api = undefined!;
  }
}
export type PoseSampler = (time: number) => RestBone[];
export type ControlSampler = (time: number) => ReadonlyMap<number, boolean>;
/** Reset/replay makes seeks reproducible. Candidate worlds commit only after successful resolution. */
export class PhysicsTimeline {
  private world?: PhysicsWorld;
  private disposed = false;
  time = 0;
  constructor(
    private api: AmmoAPI,
    readonly profile: PhysicsProfile,
    readonly solver: SolverProfile,
  ) {
    checkAmmo(api);
    validatePhysics(profile, solver);
    this.profile = structuredClone(profile);
    this.solver = structuredClone(solver);
  }
  preflight(time: number) {
    const samples = Math.floor(time / this.profile.fixedStep + 1e-9) + 1;
    const solverWork =
      this.solver.bones.length +
      this.solver.bones.reduce(
        (sum, b) =>
          sum +
          ((b.ik?.iterations ?? 0) + 1) *
            (b.ik?.links.length ?? 0) *
            this.solver.bones.length,
        0,
      );
    if (
      this.disposed ||
      !Number.isFinite(time) ||
      time < 0 ||
      samples - 1 > MAX_SEEK_STEPS ||
      samples * this.solver.bones.length > 1_000_000 ||
      samples * solverWork > 20_000_000
    )
      throw new Error(
        "MMD_physics: invalid/over-budget seek or disposed timeline",
      );
  }
  validateDelta(delta: number) {
    if (
      !Number.isFinite(delta) ||
      delta < 0 ||
      Math.ceil(delta / this.profile.fixedStep - 1e-10) > MAX_UPDATE_STEPS
    )
      throw new Error(
        "MMD_physics: update exceeds 240-step budget or invalid delta",
      );
  }
  seek(
    time: number,
    sample: PoseSampler,
    controls: ControlSampler = () => new Map(),
  ) {
    this.preflight(time);
    const ticks = Math.floor(time / this.profile.fixedStep + 1e-9),
      inputs = Array.from({ length: ticks + 1 }, (_, i) => ({
        pose: sample(i * this.profile.fixedStep),
        enabled: controls(i * this.profile.fixedStep),
      }));
    // Validate complete raw inputs before allocating/mutating native simulation.
    for (const v of inputs) solvePose(this.solver, v.pose, v.enabled, "pre");
    const candidate = new PhysicsWorld(
      this.api,
      this.profile,
      this.solver,
      inputs[0].pose,
    );
    try {
      let pose = candidate.resolve(inputs[0].pose, inputs[0].enabled, false);
      for (let i = 1; i <= ticks; i++)
        pose = candidate.resolve(inputs[i].pose, inputs[i].enabled);
      this.world?.dispose();
      this.world = candidate;
      this.time = time;
      return pose;
    } catch (error) {
      candidate.dispose();
      throw error;
    }
  }
  bodyTransforms() {
    return this.world?.bodyTransforms() ?? new Map();
  }
  clear() {
    if (this.disposed) throw new Error("MMD_physics: disposed timeline");
    this.world?.dispose();
    this.world = undefined;
    this.time = 0;
  }
  dispose() {
    if (this.disposed) return;
    this.world?.dispose();
    this.world = undefined;
    this.disposed = true;
  }
}
