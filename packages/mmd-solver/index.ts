/** Runtime-independent pre-physics-v1 policy. All scratch state belongs to one call. */
import type { RestBone, Vec3, Quat } from "../mmd-vpd";
export const EXTENSION_NAME = "MMD_skeleton_solver";
export interface Append {
  source: number;
  rate: number;
  local: boolean;
  rotation: boolean;
  translation: boolean;
}
export interface IKLink {
  index: number;
  hinge?: { axis: 0 | 1 | 2; min: number; max: number };
}
export interface IK {
  effector: number;
  iterations: number;
  angle: number;
  links: IKLink[];
}
export interface SolverBone extends RestBone {
  node?: number;
  layer: number;
  flags: number;
  append?: Append;
  ik?: IK;
}
export interface SolverProfile {
  version: 1;
  bones: SolverBone[];
}
const identity: Quat = [0, 0, 0, 1];
export const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const inv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const add = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v + b[i]) as Vec3;
const sub = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v - b[i]) as Vec3;
const times = (a: Vec3, s: number): Vec3 => a.map((v) => v * s) as Vec3;
const dot = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(...a);
const unit = (a: Vec3) => times(a, 1 / norm(a));
const rotate = (q: Quat, v: Vec3): Vec3 =>
  mul(mul(q, [...v, 0]), inv(q)).slice(0, 3) as Vec3;
const axisAngle = (axis: Vec3, angle: number): Quat => [
  ...times(axis, Math.sin(angle / 2)),
  Math.cos(angle / 2),
];
/** Shortest canonical quaternion power, including signed and >1 rates. */
function power(q: Quat, rate: number): Quat {
  if (q[3] < 0 || (q[3] === 0 && (q.find((v) => v !== 0) ?? 0) < 0))
    q = q.map((v) => -v) as Quat;
  const length = Math.hypot(...q.slice(0, 3));
  return length === 0
    ? [...identity]
    : axisAngle(
        q.slice(0, 3).map((v) => v / length) as Vec3,
        2 * Math.atan2(length, q[3]) * rate,
      );
}
const finite = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) &&
  v.length === n &&
  Array.from(v).every(
    (x) =>
      typeof x === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(Math.fround(x)),
  );
const int = (v: number, min: number, max: number) =>
  Number.isInteger(v) && v >= min && v <= max;
export function validateSolver(
  value: unknown,
  nodeCount?: number,
): asserts value is SolverProfile {
  const p = value as SolverProfile;
  const fail = (i: number, why: string): never => {
    throw new Error(`${EXTENSION_NAME} bones[${i}]: ${why}`);
  };
  if (
    !p ||
    p.version !== 1 ||
    !Array.isArray(p.bones) ||
    !p.bones.length ||
    p.bones.length > 65536 ||
    Object.keys(p).some((k) => !["version", "bones"].includes(k))
  )
    fail(-1, "invalid version/count/properties");
  const byIndex = new Map<number, SolverBone>(),
    nodes = new Set<number>();
  Array.from(p.bones).forEach((b, i) => {
    if (
      !b ||
      Object.keys(b).some(
        (k) =>
          ![
            "index",
            "node",
            "name",
            "parentIndex",
            "translation",
            "rotation",
            "scale",
            "layer",
            "flags",
            "append",
            "ik",
          ].includes(k),
      ) ||
      !int(b.index, 0, 65535) ||
      byIndex.has(b.index) ||
      typeof b.name !== "string" ||
      !int(b.parentIndex, -1, 65535) ||
      !int(b.layer, -2147483648, 2147483647) ||
      !int(b.flags, 0, 65535) ||
      !finite(b.translation, 3) ||
      !finite(b.rotation, 4) ||
      Math.abs(Math.hypot(...b.rotation) - 1) > 1e-10 ||
      !finite(b.scale, 3) ||
      b.scale.some((v) => v !== 1)
    )
      fail(i, "invalid identity, original rest, layer or flags");
    if (
      nodeCount !== undefined &&
      (!int(b.node!, 0, nodeCount - 1) || nodes.has(b.node!))
    )
      fail(i, "invalid/duplicate node");
    nodes.add(b.node!);
    byIndex.set(b.index, b);
    if (b.flags & 0x3400)
      fail(
        i,
        "post-physics, external parent or fixed-axis dependency outside pre-physics-v1",
      );
    const a = b.append;
    if (
      b.append !== undefined &&
      (!a ||
        typeof a !== "object" ||
        Object.keys(a).some(
          (k) =>
            !["source", "rate", "local", "rotation", "translation"].includes(k),
        ) ||
        !Number.isFinite(a.rate) ||
        !Number.isFinite(Math.fround(a.rate)) ||
        typeof a.local !== "boolean" ||
        typeof a.rotation !== "boolean" ||
        typeof a.translation !== "boolean" ||
        !(a.rotation || a.translation))
    )
      fail(i, "invalid append");
    const ik = b.ik;
    if (
      b.ik !== undefined &&
      (!ik ||
        typeof ik !== "object" ||
        Object.keys(ik).some(
          (k) => !["effector", "iterations", "angle", "links"].includes(k),
        ) ||
        !int(ik.iterations, 0, 255) ||
        !Number.isFinite(ik.angle) ||
        ik.angle < 0 ||
        ik.angle > Math.PI ||
        !Array.isArray(ik.links) ||
        !ik.links.length ||
        ik.links.length > 256)
    )
      fail(i, "invalid IK caps/count");
    if (ik)
      Array.from(ik.links).forEach((l, j) => {
        if (!l || Object.keys(l).some((k) => !["index", "hinge"].includes(k)))
          fail(i, `links[${j}]: invalid properties`);
        const h = l.hinge;
        if (
          l.hinge !== undefined &&
          (!h ||
            typeof h !== "object" ||
            Object.keys(h).some((k) => !["axis", "min", "max"].includes(k)) ||
            !int(h.axis, 0, 2) ||
            !Number.isFinite(h.min) ||
            !Number.isFinite(h.max) ||
            h.min > h.max ||
            h.min < -Math.PI ||
            h.max > Math.PI)
        )
          fail(i, `links[${j}]: invalid hinge`);
      });
  });
  const work = p.bones.reduce(
    (n, b) =>
      n +
      ((b.ik?.iterations ?? 0) + 1) *
        (b.ik?.links.length ?? 0) *
        p.bones.length,
    0,
  );
  if (work > 20_000_000)
    fail(-1, "solver work budget exceeds 20000000 bone updates");
  const order = [...p.bones].sort(
      (a, b) => a.layer - b.layer || a.index - b.index,
    ),
    rank = new Map(order.map((b, i) => [b.index, i]));
  // Parent and append cycles/late dependencies are rejected instead of guessing an order.
  p.bones.forEach((b, i) => {
    if (b.parentIndex !== -1 && !byIndex.has(b.parentIndex))
      fail(i, "missing parent reference");
    if (
      b.append &&
      (!byIndex.has(b.append.source) ||
        rank.get(b.append.source)! >= rank.get(b.index)!)
    )
      fail(i, "append source must precede destination by layer/index");
    if (b.parentIndex !== -1 && rank.get(b.parentIndex)! >= rank.get(b.index)!)
      fail(i, "hierarchy parent must precede child by layer/index");
  });
  p.bones.forEach((b, i) => {
    if (!b.ik) return;
    if (!byIndex.has(b.ik.effector) || b.ik.effector === b.index)
      fail(i, "invalid effector");
    let ancestor = byIndex.get(b.ik.effector)!.parentIndex;
    const links = new Set<number>();
    for (const [j, l] of b.ik.links.entries()) {
      if (
        !byIndex.has(l.index) ||
        links.has(l.index) ||
        rank.get(l.index)! >= rank.get(b.index)!
      )
        fail(i, `links[${j}]: invalid/repeated/late reference`);
      while (ancestor !== -1 && ancestor !== l.index)
        ancestor = byIndex.get(ancestor)!.parentIndex;
      if (ancestor === -1)
        fail(i, `links[${j}]: must be ordered effector ancestors`);
      ancestor = byIndex.get(l.index)!.parentIndex;
      links.add(l.index);
      // An append consumer already evaluated would otherwise need a second pass.
      for (const consumer of p.bones) {
        if (!consumer.append || rank.get(consumer.index)! > rank.get(b.index)!)
          continue;
        let source = byIndex.get(consumer.append.source);
        while (source) {
          if (source.index === l.index)
            fail(i, `links[${j}]: append consumer precedes IK`);
          source = consumer.append.local
            ? byIndex.get(source.parentIndex)
            : undefined;
        }
      }
      let controller: SolverBone | undefined = b;
      while (controller) {
        if (controller.index === l.index)
          fail(i, `links[${j}]: controller depends on link`);
        controller = byIndex.get(controller.parentIndex);
      }
    }
  });
}
export function solvePose(
  profile: SolverProfile | undefined,
  input: RestBone[],
  enabled: ReadonlyMap<number, boolean> = new Map(),
): RestBone[] {
  if (!profile) return structuredClone(input);
  validateSolver(profile);
  for (const [index, value] of enabled)
    if (
      typeof value !== "boolean" ||
      !profile.bones.some((b) => b.index === index && b.ik)
    )
      throw new Error(
        `${EXTENSION_NAME} controls[${index}]: invalid controller or enable value`,
      );
  const raw = new Map(input.map((b) => [b.index, b])),
    rest = new Map(profile.bones.map((b) => [b.index, b]));
  if (raw.size !== profile.bones.length || input.length !== raw.size)
    throw new Error(`${EXTENSION_NAME}: incomplete original input pose`);
  for (const b of profile.bones) {
    const v = raw.get(b.index);
    if (
      !v ||
      !finite(v.translation, 3) ||
      !finite(v.rotation, 4) ||
      Math.abs(Math.hypot(...v.rotation) - 1) > 1e-5 ||
      !finite(v.scale, 3) ||
      v.scale.some((x) => x !== 1)
    )
      throw new Error(
        `${EXTENSION_NAME} bones[${b.index}]: invalid input pose`,
      );
  }
  const pose = new Map(
    input.map((b) => {
      const copy = structuredClone(b),
        length = Math.hypot(...copy.rotation);
      copy.rotation = copy.rotation.map((v) => v / length) as Quat;
      return [b.index, copy];
    }),
  );
  const order = [...profile.bones].sort(
    (a, b) => a.layer - b.layer || a.index - b.index,
  );
  const hierarchy = order; // Validation guarantees parents precede children.
  const world = new Map<number, { t: Vec3; q: Quat }>(),
    original = new Map<number, { t: Vec3; q: Quat }>();
  const update = (values: Map<number, RestBone>, out: typeof world) => {
    for (const b of hierarchy) {
      const v = values.get(b.index)!,
        p = out.get(b.parentIndex);
      out.set(
        b.index,
        p
          ? { t: add(p.t, rotate(p.q, v.translation)), q: mul(p.q, v.rotation) }
          : { t: [...v.translation], q: [...v.rotation] },
      );
    }
  };
  update(rest, original);
  update(pose, world);
  for (const b of order) {
    const dest = pose.get(b.index)!,
      a = b.append;
    if (a) {
      const source = pose.get(a.source)!,
        base = rest.get(a.source)!;
      // Local append uses the current model-space deformation, including hierarchy.
      const q = a.local
        ? mul(world.get(a.source)!.q, inv(original.get(a.source)!.q))
        : mul(inv(base.rotation), source.rotation);
      const t = a.local
        ? sub(world.get(a.source)!.t, rotate(q, original.get(a.source)!.t))
        : sub(source.translation, base.translation);
      if (a.rotation) dest.rotation = mul(dest.rotation, power(q, a.rate));
      if (a.translation)
        dest.translation = add(dest.translation, times(t, a.rate));
      update(pose, world);
    }
    const ik = b.ik;
    if (
      !ik ||
      ik.angle === 0 ||
      ik.iterations === 0 ||
      enabled.get(b.index) === false
    )
      continue;
    const target = [...world.get(b.index)!.t] as Vec3;
    for (let iteration = 0; iteration < ik.iterations; iteration++) {
      for (const l of ik.links) {
        const link = pose.get(l.index)!,
          w = world.get(l.index)!;
        let e = rotate(inv(w.q), sub(world.get(ik.effector)!.t, w.t)),
          t = rotate(inv(w.q), sub(target, w.t));
        if (norm(e) < 1e-12 || norm(t) < 1e-12) continue;
        e = unit(e);
        t = unit(t);
        if (l.hinge) {
          const h = l.hinge,
            axis: Vec3 = [0, 0, 0];
          axis[h.axis] = 1;
          const base = rest.get(l.index)!;
          let relative = mul(inv(base.rotation), link.rotation);
          if (
            relative[3] < 0 ||
            (relative[3] === 0 && (relative.find((v) => v !== 0) ?? 0) < 0)
          )
            relative = relative.map((v) => -v) as Quat;
          // Enforce the hinge in ORIGINAL rest coordinates before the CCD step.
          const twist =
            relative[h.axis] === 0 && relative[3] === 0
              ? 0
              : 2 * Math.atan2(relative[h.axis], relative[3]);
          const current = Math.max(h.min, Math.min(h.max, twist));
          link.rotation = mul(base.rotation, axisAngle(axis, current));
          update(pose, world);
          const frame = mul(
            world.get(base.parentIndex)?.q ?? identity,
            base.rotation,
          );
          e = rotate(inv(frame), sub(world.get(ik.effector)!.t, w.t));
          t = rotate(inv(frame), sub(target, w.t));
          e = sub(e, times(axis, dot(e, axis)));
          t = sub(t, times(axis, dot(t, axis)));
          if (norm(e) < 1e-12 || norm(t) < 1e-12) continue;
          const desired =
            current + Math.atan2(dot(axis, cross(e, t)), dot(e, t));
          // Equivalent angles can lie on opposite sides of the -pi/pi cut.
          // Choose the best feasible orientation, then follow its feasible path.
          const candidates = [
            desired,
            desired + 2 * Math.PI,
            desired - 2 * Math.PI,
          ].map((v) => Math.max(h.min, Math.min(h.max, v)));
          const error = (v: number) =>
            Math.abs(Math.atan2(Math.sin(v - desired), Math.cos(v - desired)));
          candidates.sort((a, b) => {
            const difference = error(a) - error(b);
            return Math.abs(difference) > 1e-12
              ? difference
              : Math.abs(a - current) - Math.abs(b - current) || a - b;
          });
          const step = Math.max(
            -ik.angle,
            Math.min(ik.angle, candidates[0] - current),
          );
          link.rotation = mul(base.rotation, axisAngle(axis, current + step));
        } else {
          const angle = Math.min(
            ik.angle,
            Math.acos(Math.max(-1, Math.min(1, dot(e, t)))),
          );
          if (angle < 1e-14) continue;
          let axis = cross(e, t);
          if (norm(axis) < 1e-12) {
            const basis: Vec3 = [0, 0, 0];
            basis[e.map(Math.abs).indexOf(Math.min(...e.map(Math.abs)))] = 1;
            axis = cross(e, basis);
          }
          link.rotation = mul(link.rotation, axisAngle(unit(axis), angle));
        }
        const length = Math.hypot(...link.rotation);
        link.rotation = link.rotation.map((v) => v / length) as Quat;
        update(pose, world);
      }
      if (norm(sub(world.get(ik.effector)!.t, target)) < 1e-10) break;
    }
  }
  const result = input.map((b) => pose.get(b.index)!);
  const invalid = result.find((b) =>
    [...b.translation, ...b.rotation].some(
      (v) => !Number.isFinite(v) || !Number.isFinite(Math.fround(v)),
    ),
  );
  if (invalid)
    throw new Error(
      `${EXTENSION_NAME} bones[${invalid.index}]: evaluated numeric range`,
    );
  return result;
}
