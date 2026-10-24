/** Independently authored closed-form one-link reference. Uses geometric shortest
 * arc and scalar quaternion power, never imports the production solver. */
import { Quaternion, Vector3 } from "three";
import type { RestBone } from "../packages/mmd-vpd";
export function solverExpected(
  shape: "box" | "wedge",
  motion: "a" | "b",
  enabled = true,
  scale = 0.2,
  time = 0,
): RestBone[] {
  const u = Math.max(0, Math.min(1, time / 1.5));
  const source =
    shape === "box"
      ? [
          [0, 0, 0],
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [1, 0, 0],
          [1, 1, 0],
          [-1, 0, 0],
        ]
      : [
          [0, 0, 0],
          [0, 1, 0],
          [0, 3, 0],
          [2, 1, 0],
          [1, 0, 0],
          [1, 1, 0],
          [-1, 0, 0],
        ];
  const p = source.map(
    (v) => new Vector3(v[0] * scale, v[1] * scale, -v[2] * scale),
  );
  const root = new Quaternion().setFromAxisAngle(
    new Vector3(motion === "a" ? 1 : 0, 0, motion === "b" ? 1 : 0),
    motion === "a" ? (-Math.PI / 2) * (1 - 0.25 * u) : 0.3 * u,
  );
  const linkOffset = new Vector3(0.1, 0.2, -0.1).multiplyScalar(scale);
  const linkPosition = p[1].clone().add(linkOffset).applyQuaternion(root);
  const goal = p[3]
    .clone()
    .add(
      new Vector3(
        (motion === "b" ? 1 - 0.2 * u : 0.15 * u) * scale,
        (motion === "b" ? -1 + 0.1 * u : 0) * scale,
        -0.05 * u * scale,
      ),
    );
  const link = new Quaternion();
  if (enabled) {
    const from = p[2].clone().sub(p[1]).normalize(),
      to = goal
        .clone()
        .sub(linkPosition)
        .applyQuaternion(root.clone().invert())
        .normalize();
    link.setFromUnitVectors(from, to);
  }
  const own = new Quaternion().setFromAxisAngle(
    new Vector3(0, motion === "a" ? 1 : 0, motion === "b" ? 1 : 0),
    motion === "a"
      ? (-Math.PI / 4) * (1 + 0.25 * u)
      : (Math.PI / 4) * (1 - 0.25 * u),
  );
  const append = own.multiply(link),
    local = shape === "wedge" ? root.clone().multiply(append) : append.clone();
  const inputT = new Vector3(
      0.2 + 0.1 * u,
      0.1 - 0.1 * u,
      -0.3 - 0.1 * u,
    ).multiplyScalar(scale),
    appendT = inputT.clone().add(linkOffset);
  const localT = p[4].clone().add(appendT);
  if (shape === "wedge") localT.applyQuaternion(root);
  localT.sub(p[4].clone().applyQuaternion(local));
  const signed = append.w < 0 ? -1 : 1,
    angle = 2 * Math.acos(Math.min(1, append.w * signed));
  const axis = new Vector3(
    append.x * signed,
    append.y * signed,
    append.z * signed,
  ).normalize();
  const chained =
    angle < 1e-15
      ? new Quaternion()
      : new Quaternion().setFromAxisAngle(axis, -0.5 * angle);
  return p.map((v, i) => ({
    index: i,
    name: ["root", "link", "tip", "IK", "append", "local", "chain"][i],
    parentIndex:
      i === 1 || (shape === "wedge" && i === 4) ? 0 : i === 2 ? 1 : -1,
    translation: (i === 1
      ? v.clone().add(linkOffset)
      : i === 2
        ? v.clone().sub(p[1])
        : i === 3
          ? goal
          : i === 4
            ? v.clone().add(appendT)
            : i === 5
              ? v.clone().add(localT)
              : i === 6
                ? v.clone().addScaledVector(appendT, -0.5)
                : v
    ).toArray(),
    rotation: (i === 0
      ? root
      : i === 1
        ? link
        : i === 4
          ? append
          : i === 5
            ? local
            : i === 6
              ? chained
              : new Quaternion()
    ).toArray(),
    scale: [1, 1, 1],
  }));
}

import { Matrix4, Matrix3 } from "three";
import { scalarDq } from "./qdef-oracle";
export function solverVertex(
  shape: "box" | "wedge",
  motion: "a" | "b",
  enabled: boolean,
  index: number,
  mode: "bdef" | "sdef" | "qdef" = "bdef",
  morph = true,
  wrongOrder = false,
  outline = false,
  time = 0,
  approximation = false,
  suppliedPose?: RestBone[],
) {
  const u = Math.max(0, Math.min(1, time / 1.5));
  const faces = [
    [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
    [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
    [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
    [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
    [
      [0, 0, 1],
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ],
  ];
  const normals = [
      [0, 0, -1],
      [0, 0, 1],
      [-1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
    ],
    f = Math.floor(index / 4),
    slot = index % 4;
  const v = faces[f][slot],
    normal = normals[f];
  const p = new Vector3(
    shape === "box" ? v[0] : v[0] * 0.75 + v[1] * 0.2,
    v[1],
    -v[2],
  ).multiplyScalar(0.2);
  const n = new Vector3(
    shape === "box" ? normal[0] : normal[0] / 0.75,
    shape === "box" ? normal[1] : normal[1] - (normal[0] * 0.2) / 0.75,
    -normal[2],
  ).normalize();
  const delta = new Vector3(0.1, 0.05, 0.05).multiplyScalar(
    0.2 * (motion === "a" ? 0.4 + 0.2 * u : -0.35 + 0.3 * u),
  );
  if (morph) p.add(delta);
  const rest =
    shape === "box"
      ? [
          [0, 0, 0],
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [1, 0, 0],
          [1, 1, 0],
          [-1, 0, 0],
        ]
      : [
          [0, 0, 0],
          [0, 1, 0],
          [0, 3, 0],
          [2, 1, 0],
          [1, 0, 0],
          [1, 1, 0],
          [-1, 0, 0],
        ];
  const expected = suppliedPose ?? solverExpected(shape, motion, enabled, 0.2, time),
    world: Matrix4[] = [],
    palette: Matrix4[] = [];
  if (wrongOrder) {
    // Deliberately deform from the raw joint palette, before IK/append run.
    // A late solver can update joint diagnostics but cannot fix these vertices.
    expected[1].rotation = [0, 0, 0, 1];
    expected[4].rotation = new Quaternion()
      .setFromAxisAngle(
        new Vector3(0, motion === "a" ? 1 : 0, motion === "b" ? 1 : 0),
        motion === "a"
          ? (-Math.PI / 4) * (1 + 0.25 * u)
          : (Math.PI / 4) * (1 - 0.25 * u),
      )
      .toArray();
    expected[4].translation = [
      (1.2 + 0.1 * u) * 0.2,
      (0.1 - 0.1 * u) * 0.2,
      (-0.3 - 0.1 * u) * 0.2,
    ];
    for (const index of [5, 6]) {
      expected[index].rotation = [0, 0, 0, 1];
      expected[index].translation = rest[index].map(
        (v, c) => v * 0.2 * (c === 2 ? -1 : 1),
      ) as [number, number, number];
    }
  }
  for (const b of expected) {
    const local = new Matrix4().compose(
      new Vector3(...b.translation),
      new Quaternion(...b.rotation),
      new Vector3(1, 1, 1),
    );
    world[b.index] =
      b.parentIndex < 0 ? local : world[b.parentIndex].clone().multiply(local);
    palette[b.index] = world[b.index]
      .clone()
      .multiply(
        new Matrix4().makeTranslation(
          -rest[b.index][0] * 0.2,
          -rest[b.index][1] * 0.2,
          rest[b.index][2] * 0.2,
        ),
      );
  }
  let result: { p: Vector3; n: Vector3 };
  if (slot === 0)
    result = {
      p: p.clone().applyMatrix4(palette[4]),
      n: n
        .clone()
        .applyMatrix3(new Matrix3().setFromMatrix4(palette[4]))
        .normalize(),
    };
  else if (
    !approximation &&
    mode !== "bdef" &&
    (mode === "sdef" || slot === 1)
  ) {
    const a = palette[1],
      b = palette[4],
      w = 0.25,
      c = new Vector3(0.2, 0.3, -0.4).multiplyScalar(0.2),
      d = new Vector3(0.2, -0.2, -0.1).multiplyScalar(0.2);
    const qa = new Quaternion().setFromRotationMatrix(a),
      qb = new Quaternion().setFromRotationMatrix(b);
    if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
    const angle = Math.acos(Math.min(1, qa.dot(qb))),
      ca = angle < 1e-8 ? w : Math.sin(w * angle) / Math.sin(angle),
      cb = angle < 1e-8 ? 1 - w : Math.sin((1 - w) * angle) / Math.sin(angle);
    const q = new Quaternion(
      qa.x * ca + qb.x * cb,
      qa.y * ca + qb.y * cb,
      qa.z * ca + qb.z * cb,
      qa.w * ca + qb.w * cb,
    ).normalize();
    const correction = d
      .clone()
      .applyMatrix3(new Matrix3().setFromMatrix4(a))
      .sub(d.clone().applyMatrix3(new Matrix3().setFromMatrix4(b)))
      .multiplyScalar((w * (1 - w)) / 2);
    result = {
      p: p
        .clone()
        .sub(c)
        .applyQuaternion(q)
        .addScaledVector(c.clone().applyMatrix4(a), w)
        .addScaledVector(c.clone().applyMatrix4(b), 1 - w)
        .add(correction),
      n: n.clone().applyQuaternion(q).normalize(),
    };
  } else if (!approximation && mode === "qdef")
    result = scalarDq(
      p,
      n,
      [1, 4, 5, 6].map((i) => palette[i]),
      [0.1, 0.2, 0.3, 0.4],
    );
  else {
    const indices = slot === 1 || mode === "sdef" ? [1, 4] : [1, 4, 5, 6],
      weights =
        slot === 1 || mode === "sdef" ? [0.25, 0.75] : [0.1, 0.2, 0.3, 0.4];
    const point = new Vector3(),
      normal = new Vector3();
    indices.forEach((j, i) => {
      point.addScaledVector(p.clone().applyMatrix4(palette[j]), weights[i]);
      normal.addScaledVector(
        n.clone().applyMatrix3(new Matrix3().setFromMatrix4(palette[j])),
        weights[i],
      );
    });
    if (outline) {
      const blended = new Matrix4();
      blended.elements.fill(0);
      indices.forEach((j, i) =>
        palette[j].elements.forEach(
          (v, k) => (blended.elements[k] += weights[i] * v),
        ),
      );
      normal.copy(n).applyMatrix3(new Matrix3().getNormalMatrix(blended));
    }
    result = { p: point, n: normal.normalize() };
  }

  return result;
}
