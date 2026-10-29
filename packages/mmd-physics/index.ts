/** Runtime-independent, bounded rigid-body-v1 contract. Metres, kilograms, seconds. */
import { diagnosticError, MMDDiagnosticError, validateBudget, type Diagnostic } from "../mmd-diagnostics";
import { validateSolver, solverDiagnostics, phaseOrder, type SolverProfile } from "../mmd-solver";
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
  type: 0 | 1 | 2 | 3 | 4 | 5;
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
  version: 1 | 2;
  retained?: { impulseMorphs: unknown[]; softBodies: unknown[]; vertexCount: number; materialCount: number; metersPerPMXUnit: number; coordinateSystem: "pmx-source" };
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
/** Validate transport only; runtime capability checks never redefine source validity. */
export function validatePhysics(value: unknown, solver: SolverProfile): asserts value is PhysicsProfile {
  validatePhysicsInternal(value,solver);
}
function validatePhysicsInternal(
  value: unknown,
  solver: SolverProfile,
  execution = false,
): asserts value is PhysicsProfile {
  validateSolver(solver);
  const p = value as PhysicsProfile;
  const fail = (where: string, why: string): never => {
    diagnosticError("malformed-data", "invalid-physics", `${EXTENSION_NAME} ${where}`, why);
  };
  const strict = p?.version !== 2 || execution;
  if (
    !properties(p, ["version", "gravity", "fixedStep", "bodies", "joints", ...(p?.version === 2 ? ["retained"] : [])]) ||
    ![1,2].includes(p.version) ||
    (p.version === 1 ? solver.version !== 2 : ![2,3].includes(solver.version)) ||
    !vector(p.gravity, 3) ||
    !finite(p.fixedStep) ||
    p.fixedStep < 1 / 240 ||
    p.fixedStep > 1 / 30 ||
    !Array.isArray(p.bodies) ||
    (p.version === 1 && !p.bodies.length) ||
    p.bodies.length > (p.version === 1 ? 1024 : 2147483647) ||
    !Array.isArray(p.joints) ||
    p.joints.length > (p.version === 1 ? 4096 : 2147483647)
  )
    fail(
      "profile",
      "invalid version, clock, gravity or counts (requires solver version 2)",
    );
  if (p.retained !== undefined) {
    if (!properties(p.retained,['impulseMorphs','softBodies','vertexCount','materialCount','metersPerPMXUnit','coordinateSystem']) || !Array.isArray(p.retained.impulseMorphs) || !Array.isArray(p.retained.softBodies) || !integer(p.retained.vertexCount,0,2147483647) || !integer(p.retained.materialCount,0,2147483647) || !finite(p.retained.metersPerPMXUnit) || p.retained.metersPerPMXUnit<=0 || p.retained.coordinateSystem!=='pmx-source') fail('retained','invalid retained records');
    const pending: {value:unknown;depth:number;exit?:boolean}[] = [{value:p.retained,depth:0}];
    const active=new WeakSet<object>();
    while(pending.length) {
      const {value,depth,exit}=pending.pop()!;
      if(exit){active.delete(value as object);continue;}
      if(depth>64) diagnosticError('resource-exhaustion','retained-depth-budget',EXTENSION_NAME,'retained record nesting exceeds parser budget');
      if(typeof value==='number' && !finite(value) || value===undefined) fail('retained','invalid numeric/undefined value');
      if(value && typeof value==='object') {
        if(active.has(value)) fail('retained','cyclic object; JSON records required');
        active.add(value);pending.push({value,depth,exit:true});
        for(const child of Object.values(value)) pending.push({value:child,depth:depth+1});
      } else if(!['string','number','boolean'].includes(typeof value) && value!==null) fail('retained','non-JSON value');
    }
  }
  const maxIndex = p.version===2 ? 2147483646 : 65535;
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
      !integer(b.index, 0, maxIndex) ||
      bodies.has(b.index) ||
      typeof b.name !== "string" ||
      !integer(b.bone, -1, maxIndex) ||
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
    if (strict && b.mode !== 0 && b.bone !== -1) {
      if (writers.has(b.bone))
        fail(`bodies[${i}]`, "ambiguous multiple body writers");
      const bone = bones.get(b.bone)!;
      if (phaseOrder(bone) || bone.append || bone.ik)
        fail(`bodies[${i}]`, "writer bone must be a plain pre-physics bone");
      writers.add(b.bone);
    }
    if (strict && b.mode === 0 && b.bone !== -1 && phaseOrder(bones.get(b.bone)!))
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
      !integer(j.index, 0, maxIndex) ||
      ids.has(j.index) ||
      typeof j.name !== "string" ||
      (p.version === 1 ? j.type !== 0 : !integer(j.type,0,5)) ||
      !(bodies.has(j.bodyA) || p.version === 2 && j.bodyA === -1) ||
      !(bodies.has(j.bodyB) || p.version === 2 && j.bodyB === -1) ||
      (p.version === 1 && j.bodyA === j.bodyB) ||
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
      (p.version === 1 && (j.linearLower.some((v, k) => v > j.linearUpper[k]) ||
      j.angularLower.some((v, k) => v > j.angularUpper[k] || v < -Math.PI) ||
      j.angularUpper.some((v) => v > Math.PI))) ||
      [...j.linearSpring, ...j.angularSpring].some((v) => v < 0)
    )
      fail(
        `joints[${i}]`,
        "invalid identity, endpoints, type, frames, limits or springs",
      );
    ids.add(j.index);
  });
  if(p.retained) {
    const retained=p.retained;
    for(const [i,record] of retained.impulseMorphs.entries()) {
      const m=record as {type:number;elementCount:number;elements:{index:number;local:number;velocity:number[];torque:number[]}[]};
      if(!m || m.type!==10 || !Array.isArray(m.elements) || m.elementCount!==m.elements.length || Array.from(m.elements).some(e=>!e || !bodies.has(e.index) || ![0,1].includes(e.local) || !vector(e.velocity,3) || !vector(e.torque,3))) fail(`retained.impulseMorphs[${i}]`,'invalid impulse records/references');
    }
    for(const [i,record] of retained.softBodies.entries()) {
      const b=record as {shape:number;material:number;config:number[];cluster:number[];iterations:number[];stiffness:number[];anchors:{body:number;vertex:number;near:number}[];pins:number[]};
      if(!b || !integer(b.shape,0,1) || !integer(b.material,0,retained.materialCount-1) || !vector(b.config,12) || !vector(b.cluster,6) || !vector(b.iterations,4) || b.iterations.some(v=>!integer(v,0,2147483647)) || !vector(b.stiffness,3) || !Array.isArray(b.anchors) || !Array.isArray(b.pins) ||
          Array.from(b.anchors).some(a=>!a || !bodies.has(a.body) || !integer(a.vertex,0,retained.vertexCount-1) || ![0,1].includes(a.near)) || Array.from(b.pins).some(v=>!integer(v,0,retained.vertexCount-1))) fail(`retained.softBodies[${i}]`,'invalid soft-body records/references');
    }
  }
  if (!strict) return;
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

export interface PhysicsBudget { maxBodies?: number; maxJoints?: number }
export function physicsDiagnostics(profile: PhysicsProfile, solver: SolverProfile, budget: PhysicsBudget = {}): Diagnostic[] {
  validatePhysics(profile,solver);
  const result=solverDiagnostics(solver);
  const maxBodies=budget.maxBodies??1024, maxJoints=budget.maxJoints??4096;
  validateBudget(maxBodies,EXTENSION_NAME);validateBudget(maxJoints,EXTENSION_NAME);
  if(profile.bodies.length>maxBodies || profile.joints.length>maxJoints) result.push({category:'resource-exhaustion',code:'physics-count-budget',path:EXTENSION_NAME,message:`body/joint execution budget exceeded (${maxBodies}/${maxJoints})`});
  if(profile.retained?.impulseMorphs.length || profile.retained?.softBodies.length) result.push({category:'unsupported-capability',code:'retained-physics-features',path:EXTENSION_NAME,message:'impulse morphs/soft bodies retained without simulation support'});
  if(profile.joints.some(j=>j.type!==0 || j.bodyA===-1 || j.bodyB===-1 || j.bodyA===j.bodyB)) result.push({category:'unsupported-capability',code:'joint-type-or-binding',path:EXTENSION_NAME,message:'joint type, world binding or identical endpoints are not executed'});
  if(profile.joints.some(j=>j.angularLower.some((v,k)=>v<=j.angularUpper[k] && (v < -Math.fround(Math.PI) || j.angularUpper[k] > Math.fround(Math.PI))))) result.push({category:'unsupported-capability',code:'joint-angular-range',path:EXTENSION_NAME,message:'bounded angular ranges outside [-pi,pi] are retained without Bullet normalization'});
  if(profile.version===2) try {validatePhysicsInternal(profile,solver,true);} catch(error) {
    result.push({category:'unsupported-capability',code:'physics-dependency',path:EXTENSION_NAME,message:error instanceof Error ? error.message : String(error)});
  }
  return result;
}
export function assertPhysicsExecutable(profile: PhysicsProfile, solver: SolverProfile, budget: PhysicsBudget = {}) {
  const diagnostics=physicsDiagnostics(profile,solver,budget);
  if(diagnostics.length) throw new MMDDiagnosticError(diagnostics[0]);
}
