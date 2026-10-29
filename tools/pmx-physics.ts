import { Extension, type Node, type WriterContext } from "@gltf-transform/core";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import {
  EXTENSION_NAME,
  validatePhysics,
  type PhysicsProfile,
  type Frame,
  type Body,
  type Joint,
} from "../packages/mmd-physics";
import type { SolverProfile } from "../packages/mmd-solver";
import type { PMXModel } from "./pmx-to-gltf";
export interface SourceBody {
  name: string;
  boneIndex: number;
  groupIndex: number;
  groupTarget: number;
  shapeType: number;
  width: number;
  height: number;
  depth: number;
  position: number[];
  rotation: number[];
  weight: number;
  positionDamping: number;
  rotationDamping: number;
  friction: number;
  restitution: number;
  type: number;
}
export interface SourceJoint {
  name: string;
  type: number;
  rigidBodyIndex1: number;
  rigidBodyIndex2: number;
  position: number[];
  rotation: number[];
  translationLimitation1: number[];
  translationLimitation2: number[];
  rotationLimitation1: number[];
  rotationLimitation2: number[];
  springPosition: number[];
  springRotation: number[];
}
const from = (p: number[], r: number[], scale: number) =>
  new Matrix4().compose(
    new Vector3(...p.map((v) => v * scale)),
    new Quaternion().setFromEuler(new Euler(r[0], r[1], r[2], "XYZ")),
    new Vector3(1, 1, 1),
  );
const frame = (m: Matrix4): Frame => {
  const p = new Vector3(),
    q = new Quaternion();
  m.decompose(p, q, new Vector3());
  return { translation: p.toArray(), rotation: q.normalize().toArray() };
};
const vector = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  v.length === 3 &&
  Array.from(v).every((v) => typeof v === "number" && Number.isFinite(v));
export function createPhysics(
  model: PMXModel,
  solver: SolverProfile,
  scale: number,
): PhysicsProfile {
  if (
    !Array.isArray(model.rigidBodies) ||
    !Array.isArray(model.constraints) ||
    model.rigidBodies.length > 2147483647 ||
    model.constraints.length > 2147483647
  )
    throw new Error("PMX physics: body/joint count outside bounded profile");
  if (model.metadata.coordinateSystem !== "right")
    throw new Error(
      "PMX physics: parsed input must explicitly declare coordinateSystem right; use parsePMX for either parser path",
    );
  for (const [field, records] of [
    ["rigidBodyCount", model.rigidBodies],
    ["constraintCount", model.constraints],
  ] as const)
    if (
      model.metadata[field] !== undefined &&
      model.metadata[field] !== records.length
    )
      throw new Error(`PMX ${field}: declared count differs from records`);
  const rest = new Map<number, Matrix4>();
  const remaining = [...solver.bones];
  while (remaining.length)
    for (let i = remaining.length - 1; i >= 0; i--) {
      const b = remaining[i];
      if (b.parentIndex !== -1 && !rest.has(b.parentIndex)) continue;
      const local = new Matrix4().compose(
        new Vector3(...b.translation),
        new Quaternion(...b.rotation),
        new Vector3(1, 1, 1),
      );
      rest.set(
        b.index,
        (rest.get(b.parentIndex) ?? new Matrix4()).clone().multiply(local),
      );
      remaining.splice(i, 1);
    }
  const originals: Matrix4[] = [];
  const bodies: Body[] = model.rigidBodies.map((value, i) => {
    const b = value as SourceBody;
    if (
      !b ||
      ![b.position, b.rotation].every(vector) ||
      !Number.isInteger(b.shapeType) ||
      b.shapeType < 0 ||
      b.shapeType > 2 ||
      ![
        b.width,
        b.height,
        b.depth,
        b.weight,
        b.positionDamping,
        b.rotationDamping,
        b.friction,
        b.restitution,
      ].every((v) => typeof v === "number" && Number.isFinite(v)) ||
      b.width <= 0 ||
      b.height < 0 ||
      b.depth < 0 ||
      !Number.isInteger(b.groupTarget) ||
      b.groupTarget < 0 ||
      b.groupTarget > 65535 ||
      (b.boneIndex !== -1 && !rest.has(b.boneIndex))
    )
      throw new Error(
        `PMX rigidBodies[${i}]: invalid shape, ranges, transform or reference`,
      );
    const original = from(b.position, b.rotation, scale);
    originals.push(original);
    return {
      index: i,
      name: b.name,
      bone: b.boneIndex,
      mode: b.type as Body["mode"],
      shape: (["sphere", "box", "capsule"] as const)[b.shapeType],
      size: [
        b.width * scale,
        b.shapeType === 0 ? 0 : b.height * scale,
        b.shapeType === 1 ? b.depth * scale : 0,
      ],
      ...frame(
        (rest.get(b.boneIndex) ?? new Matrix4())
          .clone()
          .invert()
          .multiply(original),
      ),
      group: b.groupIndex,
      mask: ~b.groupTarget & 65535,
      mass: b.weight,
      linearDamping: b.positionDamping,
      angularDamping: b.rotationDamping,
      friction: b.friction,
      restitution: b.restitution,
      margin:
        b.shapeType === 0
          ? b.width * scale
          : Math.min(
              0.004,
              (b.shapeType === 1
                ? Math.min(b.width, b.height, b.depth)
                : b.width) *
                scale *
                0.1,
            ),
    };
  });
  const joints: Joint[] = model.constraints.map((value, i) => {
    const j = value as SourceJoint;
    if (
      !j ||
      !Number.isInteger(j.type) || j.type < 0 || j.type > 5 ||
      ![
        j.position,
        j.rotation,
        j.translationLimitation1,
        j.translationLimitation2,
        j.rotationLimitation1,
        j.rotationLimitation2,
        j.springPosition,
        j.springRotation,
      ].every(vector) ||
      !Number.isInteger(j.rigidBodyIndex1) ||
      !Number.isInteger(j.rigidBodyIndex2) ||
      !(originals[j.rigidBodyIndex1] || j.rigidBodyIndex1 === -1) ||
      !(originals[j.rigidBodyIndex2] || j.rigidBodyIndex2 === -1)
    )
      throw new Error(
        `PMX joints[${i}]: unsupported type, endpoints or transform`,
      );
    const original = from(j.position, j.rotation, scale);
    return {
      index: i,
      name: j.name,
      type: j.type as Joint["type"],
      bodyA: j.rigidBodyIndex1,
      bodyB: j.rigidBodyIndex2,
      frameA: frame(
        (originals[j.rigidBodyIndex1] ?? new Matrix4()).clone().invert().multiply(original),
      ),
      frameB: frame(
        (originals[j.rigidBodyIndex2] ?? new Matrix4()).clone().invert().multiply(original),
      ),
      linearLower: j.translationLimitation1.map(
        (v) => v * scale,
      ) as Joint["linearLower"],
      linearUpper: j.translationLimitation2.map(
        (v) => v * scale,
      ) as Joint["linearUpper"],
      angularLower: [...j.rotationLimitation1] as Joint["angularLower"],
      angularUpper: [...j.rotationLimitation2] as Joint["angularUpper"],
      linearSpring: [...j.springPosition] as Joint["linearSpring"],
      angularSpring: j.springRotation.map(
        (v) => v * scale * scale,
      ) as Joint["angularSpring"],
    };
  });
  const profile: PhysicsProfile = {
    version: 1,
    gravity: [0, -9.80665, 0],
    fixedStep: 1 / 120,
    bodies,
    joints,
  };
  if (model.morphs.some(m=>m.type===10) || model.softBodies?.length) {
    profile.version=2;
    profile.retained={coordinateSystem:"pmx-source",metersPerPMXUnit:scale,vertexCount:model.vertices.length,materialCount:model.materials.length,impulseMorphs:structuredClone(model.morphs.filter(m=>m.type===10)),softBodies:structuredClone(model.softBodies??[])};
  }
  try { validatePhysics(profile, solver); }
  catch { profile.version=2; validatePhysics(profile,solver); }
  return profile;
}
export class PhysicsWriter extends Extension {
  static EXTENSION_NAME = EXTENSION_NAME;
  readonly extensionName = EXTENSION_NAME;
  profile?: PhysicsProfile;
  solver?: SolverProfile;
  nodes: Node[] = [];
  read(): this {
    throw new Error("PhysicsWriter is converter-only");
  }
  write(context: WriterContext): this {
    if (this.profile) {
      validatePhysics(this.profile, this.solver!);
      context.jsonDoc.json.extensions = {
        ...context.jsonDoc.json.extensions,
        [EXTENSION_NAME]: structuredClone(this.profile),
      };
    }
    return this;
  }
}
