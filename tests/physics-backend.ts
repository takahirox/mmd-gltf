/** Independently authored direct-backend controls. No converter, adapter, or solver calls. */
import type { AmmoAPI } from "../packages/three-mmd-physics/ammo";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { PhysicsProfile, Frame } from "../packages/mmd-physics";
import type { SolverProfile } from "../packages/mmd-solver";
import { solvePose } from "../packages/mmd-solver";
import type { RestBone } from "../packages/mmd-vpd";
export async function directContactSpring(A: AmmoAPI) {
  const contact = (mask: number, spring: boolean) => {
    const owned: any[] = [],
      own = <T>(v: T): T => {
        owned.push(v);
        return v;
      };
    const config = own(new A.btDefaultCollisionConfiguration()),
      dispatcher = own(new A.btCollisionDispatcher(config)),
      broadphase = own(new A.btDbvtBroadphase()),
      solver = own(new A.btSequentialImpulseConstraintSolver()),
      world = own(
        new A.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, config),
      );
    world.setGravity(own(new A.btVector3(0, -9.80665, 0)));
    const make = (
      mass: number,
      y: number,
      shape: any,
      group: number,
      mask: number,
    ) => {
      const t = own(new A.btTransform());
      t.setIdentity();
      t.setOrigin(own(new A.btVector3(0, y, 0)));
      const state = own(new A.btDefaultMotionState(t)),
        inertia = own(new A.btVector3(0, 0, 0));
      if (mass) shape.calculateLocalInertia(mass, inertia);
      const info = own(
          new A.btRigidBodyConstructionInfo(mass, state, shape, inertia),
        ),
        body = own(new A.btRigidBody(info));
      body.setActivationState(4);
      world.addRigidBody(body, group, mask);
      return body;
    };
    const floor = make(
        0,
        -0.1,
        own(new A.btBoxShape(own(new A.btVector3(5, 0.1, 5)))),
        1,
        65535,
      ),
      ball = make(1, 1, own(new A.btSphereShape(0.1)), 1 << 15, mask);
    let joint: any;
    if (spring) {
      const a = own(new A.btTransform()),
        b = own(new A.btTransform());
      a.setIdentity();
      b.setIdentity();
      a.setOrigin(own(new A.btVector3(0, 1.1, 0)));
      joint = own(new A.btGeneric6DofSpringConstraint(floor, ball, a, b, true));
      joint.setLinearLowerLimit(own(new A.btVector3(0, -0.1, 0)));
      joint.setLinearUpperLimit(own(new A.btVector3(0, 0.1, 0)));
      joint.enableSpring(1, true);
      joint.setStiffness(1, 25);
      joint.setDamping(1, 1);
      joint.setEquilibriumPoint(1, 0);
      world.addConstraint(joint, false);
    }
    for (let i = 0; i < 120; i++) world.stepSimulation(1 / 120, 0, 1 / 120);
    const borrowedTransform = ball.getWorldTransform(),
      borrowedOrigin = borrowedTransform.getOrigin(),
      y = borrowedOrigin.y();
    if (joint) world.removeConstraint(joint);
    world.removeRigidBody(ball);
    world.removeRigidBody(floor);
    for (const v of owned.reverse()) A.destroy(v);
    for (const v of [borrowedTransform, borrowedOrigin])
      delete A.getCache(A.getClass(v))[A.getPointer(v)];
    return y;
  };
  const contactY = contact(1, false),
    wrongMaskY = contact(0, false),
    springY = contact(0, true);
  return {
    contactY,
    wrongMaskY,
    springY,
    springDisplacement: Math.abs(springY - 1),
    jointDrift: Math.max(0, Math.abs(springY - 1) - 0.1),
    positionBound: 0.01,
    jointDriftBound: 0.03,
  };
}
/** Direct-backend rig reference, authored separately from PhysicsWorld. Shares
 * the previously tested pre-IK algorithm, but no adapter coupling or post pass.
 * The fixture's post-local-append consumer is evaluated explicitly below. */
export function referenceRig(
  A: AmmoAPI,
  profile: PhysicsProfile,
  solver: SolverProfile,
  sample: (t: number) => RestBone[],
  controls: (t: number) => ReadonlyMap<number, boolean>,
  time: number,
) {
  const handles: any[] = [],
    keep = <T>(v: T): T => {
      handles.push(v);
      return v;
    },
    config = keep(new A.btDefaultCollisionConfiguration()),
    dispatcher = keep(new A.btCollisionDispatcher(config)),
    broadphase = keep(new A.btDbvtBroadphase()),
    constraintSolver = keep(new A.btSequentialImpulseConstraintSolver()),
    world = keep(
      new A.btDiscreteDynamicsWorld(
        dispatcher,
        broadphase,
        constraintSolver,
        config,
      ),
    );
  const vec = keep(new A.btVector3(...profile.gravity)),
    quat = keep(new A.btQuaternion(0, 0, 0, 1)),
    transform = keep(new A.btTransform());
  world.setGravity(vec);
  const mat = (f: Frame) =>
    new Matrix4().compose(
      new Vector3(...f.translation),
      new Quaternion(...f.rotation),
      new Vector3(1, 1, 1),
    );
  const hierarchy = (pose: RestBone[]) => {
    const out: Matrix4[] = [];
    for (const b of [...pose].sort((a, b) => a.index - b.index)) {
      out[b.index] = (out[b.parentIndex] ?? new Matrix4())
        .clone()
        .multiply(mat(b));
    }
    return out;
  };
  const write = (t: any, m: Matrix4) => {
    const p = new Vector3(),
      q = new Quaternion();
    m.decompose(p, q, new Vector3());
    t.setIdentity();
    vec.setValue(p.x, p.y, p.z);
    quat.setValue(q.x, q.y, q.z, q.w);
    t.setOrigin(vec);
    t.setRotation(quat);
  };
  const bodies: any[] = [],
    joints: any[] = [];
  const borrowed = new Set<unknown>(),
    ref = <T>(value: T): T => {
      borrowed.add(value);
      return value;
    };
  const read = (b: any) => {
    const t = ref(b.getWorldTransform()) as any,
      p = ref(t.getOrigin()) as any;
    (ref(t.getBasis()) as any).getRotation(quat);
    const q = quat;
    return new Matrix4().compose(
      new Vector3(p.x(), p.y(), p.z()),
      new Quaternion(q.x(), q.y(), q.z(), q.w()),
      new Vector3(1, 1, 1),
    );
  };
  const move = (b: any, m: Matrix4) => {
    write(transform, m);
    b.setWorldTransform(transform);
    (ref(b.getMotionState()) as any).setWorldTransform(transform);
  };
  const align = (
    b: any,
    definition: PhysicsProfile["bodies"][number],
    animated: Matrix4,
  ) => {
    const m = read(b),
      bone = m.clone().multiply(mat(definition).invert()),
      q = new Quaternion().setFromRotationMatrix(bone),
      p = new Vector3()
        .setFromMatrixPosition(animated)
        .add(new Vector3(...definition.translation).applyQuaternion(q));
    move(b, m.setPosition(p));
    vec.setValue(0, 0, 0);
    b.setLinearVelocity(vec);
  };
  try {
    const init = hierarchy(solvePose(solver, sample(0), controls(0), "pre"));
    for (const b of profile.bodies) {
      const shape =
        b.shape === "box"
          ? keep(new A.btBoxShape(keep(new A.btVector3(...b.size))))
          : b.shape === "sphere"
            ? keep(new A.btSphereShape(b.size[0]))
            : keep(new A.btCapsuleShape(b.size[0], b.size[1]));
      if (b.shape !== "sphere") shape.setMargin(b.margin);
      const t = keep(new A.btTransform());
      write(t, (init[b.bone] ?? new Matrix4()).clone().multiply(mat(b)));
      const state = keep(new A.btDefaultMotionState(t)),
        inertia = keep(new A.btVector3(0, 0, 0)),
        mass = b.mode === 0 ? 0 : b.mass;
      if (mass) shape.calculateLocalInertia(mass, inertia);
      const info = keep(
          new A.btRigidBodyConstructionInfo(mass, state, shape, inertia),
        ),
        body = keep(new A.btRigidBody(info));
      body.setFriction(b.friction);
      body.setRestitution(b.restitution);
      body.setDamping(b.linearDamping, b.angularDamping);
      body.setActivationState(4);
      if (b.mode === 0) body.setCollisionFlags(body.getCollisionFlags() | 2);
      world.addRigidBody(body, 1 << b.group, b.mask);
      bodies[b.index] = body;
    }
    for (const j of profile.joints) {
      const a = keep(new A.btTransform()),
        b = keep(new A.btTransform());
      write(a, mat(j.frameA));
      write(b, mat(j.frameB));
      const c = keep(
        new A.btGeneric6DofSpringConstraint(
          bodies[j.bodyA],
          bodies[j.bodyB],
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
        vec.setValue(...values);
        c[method](vec);
      }
      for (let axis = 0; axis < 6; axis++) {
        const value = [...j.linearSpring, ...j.angularSpring][axis];
        c.enableSpring(axis, value > 0);
        c.setStiffness(axis, value);
        c.setDamping(axis, 1);
        c.setEquilibriumPoint(axis, 0);
      }
      world.addConstraint(c, false);
      joints.push(c);
    }
    let result: RestBone[] = [];
    for (
      let tick = 0;
      tick <= Math.floor(time / profile.fixedStep + 1e-9);
      tick++
    ) {
      const at = tick * profile.fixedStep,
        raw = sample(at);
      result = solvePose(solver, raw, controls(at), "pre");
      const animated = hierarchy(result);
      for (const def of profile.bodies) {
        if (def.mode === 0)
          move(
            bodies[def.index],
            (animated[def.bone] ?? new Matrix4()).clone().multiply(mat(def)),
          );
        if (def.mode === 2 && def.bone !== -1)
          align(bodies[def.index], def, animated[def.bone]);
      }
      if (tick) world.stepSimulation(profile.fixedStep, 0, profile.fixedStep);
      const final: Matrix4[] = [];
      for (const bone of [...result].sort((a, b) => a.index - b.index)) {
        const def = profile.bodies.find(
            (b) => b.mode !== 0 && b.bone === bone.index,
          ),
          parent = final[bone.parentIndex] ?? new Matrix4();
        if (def) {
          if (def.mode === 2)
            align(bodies[def.index], def, animated[bone.index]);
          const local = parent
              .clone()
              .invert()
              .multiply(read(bodies[def.index]))
              .multiply(mat(def).invert()),
            p = new Vector3(),
            q = new Quaternion();
          local.decompose(p, q, new Vector3());
          bone.translation = p.toArray();
          bone.rotation = q.normalize().toArray();
        }
        final[bone.index] = parent.clone().multiply(mat(bone));
      }
      // Independent explicit local append formula for this fixture's sole post consumer.
      const source = final[4],
        p = new Vector3(),
        q = new Quaternion();
      source.decompose(p, q, new Vector3());
      const original = hierarchy(solver.bones)[4],
        originalP = new Vector3().setFromMatrixPosition(original),
        delta = p.sub(originalP.applyQuaternion(q));
      const consumer = result.find((b) => b.index === 5)!;
      consumer.translation = new Vector3(
        ...raw.find((b) => b.index === 5)!.translation,
      )
        .add(delta)
        .toArray();
      consumer.rotation = new Quaternion(
        ...raw.find((b) => b.index === 5)!.rotation,
      )
        .multiply(q)
        .normalize()
        .toArray();
    }
    return result.sort((a, b) => a.index - b.index);
  } finally {
    for (const c of joints) world.removeConstraint(c);
    for (const b of bodies) if (b) world.removeRigidBody(b);
    for (const h of handles.reverse()) A.destroy(h);
    for (const value of borrowed) {
      const cache = A.getCache(A.getClass(value)),
        pointer = A.getPointer(value);
      if (cache[pointer] === value) delete cache[pointer];
    }
  }
}
