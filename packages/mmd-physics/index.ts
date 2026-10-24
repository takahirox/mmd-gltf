/** Runtime-independent, bounded rigid-body-v1 contract. Metres, kilograms, seconds. */
import { validateSolver, phaseOrder, type SolverProfile } from "../mmd-solver";
import type { Vec3, Quat } from "../mmd-vpd";
export const EXTENSION_NAME = "MMD_physics";
export interface Frame {
  translation: Vec3;
  rotation: Quat;
}
export interface Body extends Frame {
  index: number;
  name: string;
  bone: number;
  mode: 0 | 1 | 2;
  shape: "sphere" | "box" | "capsule";
  size: Vec3;
  group: number;
  mask: number;
  mass: number;
  linearDamping: number;
  angularDamping: number;
  friction: number;
  restitution: number;
  margin: number;
}
export interface Joint {
  index: number;
  name: string;
  type: 0;
  bodyA: number;
  bodyB: number;
  frameA: Frame;
  frameB: Frame;
  linearLower: Vec3;
  linearUpper: Vec3;
  angularLower: Vec3;
  angularUpper: Vec3;
  linearSpring: Vec3;
  angularSpring: Vec3;
}
export interface PhysicsProfile {
  version: 1;
  gravity: Vec3;
  fixedStep: number;
  bodies: Body[];
  joints: Joint[];
}
export const MAX_UPDATE_STEPS = 240;
export const MAX_SEEK_STEPS = 3600;
const finite = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  Number.isFinite(Math.fround(v));
const vector = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && Array.from(v).every(finite);
const integer = (v: number, lo: number, hi: number) =>
  Number.isInteger(v) && v >= lo && v <= hi;
const properties = (v: object, keys: string[]) =>
  !!v && typeof v === "object" && Object.keys(v).every((k) => keys.includes(k));
const frame = (v: Frame) =>
  properties(v, ["translation", "rotation"]) &&
  vector(v.translation, 3) &&
  vector(v.rotation, 4) &&
  Math.abs(Math.hypot(...v.rotation) - 1) <= 1e-10;
export function validatePhysics(
  value: unknown,
  solver: SolverProfile,
): asserts value is PhysicsProfile {
  validateSolver(solver);
  const p = value as PhysicsProfile;
  const fail = (where: string, why: string): never => {
    throw new Error(`${EXTENSION_NAME} ${where}: ${why}`);
  };
  if (
    !properties(p, ["version", "gravity", "fixedStep", "bodies", "joints"]) ||
    p.version !== 1 ||
    solver.version !== 2 ||
    !vector(p.gravity, 3) ||
    !finite(p.fixedStep) ||
    p.fixedStep < 1 / 240 ||
    p.fixedStep > 1 / 30 ||
    !Array.isArray(p.bodies) ||
    !p.bodies.length ||
    p.bodies.length > 1024 ||
    !Array.isArray(p.joints) ||
    p.joints.length > 4096
  )
    fail(
      "profile",
      "invalid version, clock, gravity or counts (requires solver version 2)",
    );
  const bones = new Map(solver.bones.map((b) => [b.index, b])),
    bodies = new Map<number, Body>(),
    writers = new Set<number>();
  Array.from(p.bodies).forEach((b, i) => {
    if (
      !properties(b, [
        "index",
        "name",
        "bone",
        "mode",
        "shape",
        "size",
        "group",
        "mask",
        "mass",
        "linearDamping",
        "angularDamping",
        "friction",
        "restitution",
        "margin",
        "translation",
        "rotation",
      ]) ||
      !integer(b.index, 0, 65535) ||
      bodies.has(b.index) ||
      typeof b.name !== "string" ||
      !integer(b.bone, -1, 65535) ||
      (b.bone !== -1 && !bones.has(b.bone)) ||
      !integer(b.mode, 0, 2) ||
      !["sphere", "box", "capsule"].includes(b.shape) ||
      !vector(b.size, 3) ||
      Math.fround(b.size[0]) <= 0 ||
      (b.shape === "box"
        ? b.size.some((v) => Math.fround(v) <= 0)
        : b.shape === "capsule"
          ? b.size[1] < 0 || b.size[2] !== 0
          : b.size[1] !== 0 || b.size[2] !== 0) ||
      !vector(b.translation, 3) ||
      !vector(b.rotation, 4) ||
      Math.abs(Math.hypot(...b.rotation) - 1) > 1e-10 ||
      !integer(b.group, 0, 15) ||
      !integer(b.mask, 0, 65535) ||
      !finite(b.mass) ||
      b.mass < 0 ||
      (b.mode !== 0 && (Math.fround(b.mass) <= 0 || !finite(1 / b.mass))) ||
      !finite((b.mass + 1) * Math.max(...b.size) ** 2) ||
      ![b.linearDamping, b.angularDamping, b.restitution].every(
        (v) => finite(v) && v >= 0 && v <= 1,
      ) ||
      !finite(b.friction) ||
      b.friction < 0 ||
      !finite(b.margin) ||
      b.margin < 0 ||
      b.margin > (b.shape === "box" ? Math.min(...b.size) : b.size[0]) ||
      (b.shape === "sphere" && b.margin !== b.size[0])
    )
      fail(
        `bodies[${i}]`,
        "invalid identity, reference, shape, dimensions, filter, transform or material",
      );
    bodies.set(b.index, b);
    if (b.mode !== 0 && b.bone !== -1) {
      if (writers.has(b.bone))
        fail(`bodies[${i}]`, "ambiguous multiple body writers");
      const bone = bones.get(b.bone)!;
      if (phaseOrder(bone) || bone.append || bone.ik)
        fail(`bodies[${i}]`, "writer bone must be a plain pre-physics bone");
      writers.add(b.bone);
    }
    if (b.mode === 0 && b.bone !== -1 && phaseOrder(bones.get(b.bone)!))
      fail(`bodies[${i}]`, "bone-driven body requires pre-physics bone");
  });
  const ids = new Set<number>();
  Array.from(p.joints).forEach((j, i) => {
    if (
      !properties(j, [
        "index",
        "name",
        "type",
        "bodyA",
        "bodyB",
        "frameA",
        "frameB",
        "linearLower",
        "linearUpper",
        "angularLower",
        "angularUpper",
        "linearSpring",
        "angularSpring",
      ]) ||
      !integer(j.index, 0, 65535) ||
      ids.has(j.index) ||
      typeof j.name !== "string" ||
      j.type !== 0 ||
      !bodies.has(j.bodyA) ||
      !bodies.has(j.bodyB) ||
      j.bodyA === j.bodyB ||
      !frame(j.frameA) ||
      !frame(j.frameB) ||
      ![
        j.linearLower,
        j.linearUpper,
        j.angularLower,
        j.angularUpper,
        j.linearSpring,
        j.angularSpring,
      ].every((v) => vector(v, 3)) ||
      j.linearLower.some((v, k) => v > j.linearUpper[k]) ||
      j.angularLower.some((v, k) => v > j.angularUpper[k] || v < -Math.PI) ||
      j.angularUpper.some((v) => v > Math.PI) ||
      [...j.linearSpring, ...j.angularSpring].some((v) => v < 0)
    )
      fail(
        `joints[${i}]`,
        "invalid identity, endpoints, type, frames, limits or springs",
      );
    ids.add(j.index);
  });
  const ancestry = (index: number) => {
    const result: number[] = [];
    while (index !== -1) {
      result.push(index);
      index = bones.get(index)!.parentIndex;
    }
    return result;
  };
  solver.bones.forEach((b, i) => {
    if (
      !phaseOrder(b) &&
      b.append &&
      (b.append.local ? ancestry(b.append.source) : [b.append.source]).some(
        (i) => writers.has(i),
      )
    )
      fail(`bones[${i}]`, "physics append consumer must be post-physics");
    if (
      b.ik?.links.some(
        (l) =>
          writers.has(l.index) ||
          (phaseOrder(b) &&
            [...writers].some((w) => ancestry(w).includes(l.index))),
      )
    )
      fail(
        `bones[${i}]`,
        "IK cannot rewrite a body writer or its post-physics ancestor",
      );
  });
}
