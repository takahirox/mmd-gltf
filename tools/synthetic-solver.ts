/** Original synthetic PMX/VMD/VPD works by mmd-gltf contributors, Issue #43.
 * Independent binary authoring; no third-party assets or evaluator-derived values. */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
function writer() {
  const chunks: Buffer[] = [];
  const bytes = (b: Uint8Array) => {
    chunks.push(Buffer.from(b));
  };
  const u8 = (n: number) => bytes(Buffer.from([n & 255]));
  const i32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n);
    bytes(b);
  };
  const f = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeFloatLE(n);
    bytes(b);
  };
  const fs = (ns: number[]) => ns.forEach(f);
  const text = (s: string) => {
    const b = Buffer.from(s, "utf8");
    i32(b.length);
    bytes(b);
  };
  const fixed = (s: string, n: number) => {
    const b = Buffer.alloc(n);
    b.write(s);
    bytes(b);
  };
  return {
    bytes,
    u8,
    i32,
    f,
    fs,
    text,
    fixed,
    result: () => Buffer.concat(chunks),
  };
}
export function solverPMX(
  shape: "box" | "wedge",
  mode: "bdef" | "sdef" | "qdef" = "bdef",
  hingeAxis?: 0 | 1 | 2,
  physics = false,
) {
  const { bytes, u8, i32, f, fs, text, result } = writer();
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n);
    bytes(b);
  };
  bytes(Buffer.from("PMX "));
  f(mode === "qdef" ? 2.1 : 2);
  u8(8);
  [1, 0, 1, 1, 1, 1, 1, 1].forEach(u8);
  [
    "Solver " + shape,
    "Original Issue 43 rig",
    "Original synthetic fixture by mmd-gltf contributors; no third-party bytes.",
    "Analytical conformance; original-MMD unmeasured.",
  ].forEach(text);
  const faces = [
    {
      n: [0, 0, -1],
      p: [
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [1, 0, 0],
      ],
    },
    {
      n: [0, 0, 1],
      p: [
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
        [0, 0, 1],
      ],
    },
    {
      n: [-1, 0, 0],
      p: [
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0],
        [0, 0, 0],
      ],
    },
    {
      n: [1, 0, 0],
      p: [
        [1, 0, 0],
        [1, 1, 0],
        [1, 1, 1],
        [1, 0, 1],
      ],
    },
    {
      n: [0, 1, 0],
      p: [
        [0, 1, 0],
        [0, 1, 1],
        [1, 1, 1],
        [1, 1, 0],
      ],
    },
    {
      n: [0, -1, 0],
      p: [
        [0, 0, 1],
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
      ],
    },
  ];
  i32(24);
  faces.forEach((face) =>
    face.p.forEach((v, i) => {
      fs(shape === "box" ? v : [v[0] * 0.75 + v[1] * 0.2, v[1], v[2]]);
      fs(
        shape === "box"
          ? face.n
          : [face.n[0] / 0.75, face.n[1] - (face.n[0] * 0.2) / 0.75, face.n[2]],
      );
      fs([i & 1, i >> 1]);
      const type =
        mode === "qdef"
          ? [0, 3, 4, 4][i]
          : mode === "sdef"
            ? [0, 3, 3, 3][i]
            : [0, 1, 2, 2][i];
      u8(type);
      if (type === 0) u8(4);
      else if (type === 1 || type === 3) {
        [1, 4].forEach(u8);
        f(0.25);
      } else {
        [1, 4, 5, 6].forEach(u8);
        fs([0.1, 0.2, 0.3, 0.4]);
      }
      if (type === 3) fs([0.2, 0.3, 0.4, 0.1, 0.2, 0.3, -0.1, 0.4, 0.2]);
      f(1);
    }),
  );
  i32(36);
  for (let q = 0; q < 6; q++) [0, 1, 2, 0, 2, 3].forEach((i) => u8(q * 4 + i));
  i32(0);
  i32(1);
  text("Surface and outline");
  text("Original");
  fs([0.8, 0.4, 0.2, 1]);
  fs([0, 0, 0]);
  f(1);
  fs([0.1, 0.1, 0.1]);
  u8(0x10);
  fs([0, 0, 0, 1]);
  f(2);
  [255, 255, 0, 0, 255].forEach(u8);
  text("No image dependencies");
  i32(36);
  i32(7);
  const positions =
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
  for (let i = 0; i < 7; i++) {
    text(["root", "link", "tip", "IK", "append", "local", "chain"][i]);
    text("Original bone " + i);
    fs(positions[i]);
    u8(i === 1 || (shape === "wedge" && i === 4) ? 0 : i === 2 ? 1 : 255);
    i32(i < 3 ? 0 : i === 3 ? 1 : i < 6 ? 2 : 3);
    const flags = physics && (i===4 || i===6) ? 0 : physics && i===5 ? 0x1380 :
      i === 3 ? 0x20 : i === 4 || i === 6 ? 0x300 : i === 5 ? 0x380 : 0;
    u16(flags);
    fs([0, 1, 0]);
    if (flags & 0x300) {
      u8(i === 4 ? 1 : 4);
      f(i === 6 ? -0.5 : 1);
    }
    if (i === 3) {
      u8(2);
      i32(16);
      f(Math.PI);
      i32(1);
      u8(1);
      u8(hingeAxis === undefined ? 0 : 1);
      if (hingeAxis !== undefined) {
        const lower = [0, 0, 0];
        lower[hingeAxis] = -Math.PI;
        fs(lower);
        fs([0, 0, 0]);
      }
    }
  }
  // One vertex target and a one-hop group exercise solver-before-deformation.
  i32(2);
  text("vertex");
  text("Original vertex");
  u8(1);
  u8(1);
  i32(24);
  for (let i = 0; i < 24; i++) {
    u8(i);
    fs([0.1, 0.05, -0.05]);
  }
  text("group");
  text("Original group");
  u8(1);
  u8(0);
  i32(1);
  u8(0);
  f(0.5);
  i32(0); // frames
  i32(physics ? 4 : 0);
  if (physics) for (const [id,bone,group,exclude,shape,size,p,r,mass,coupling] of [
    [0,0,0,65535 ^ ((1<<1)|(1<<15)),1,[3,.2,3],[0,-1,0],[.1,0,.1],0,0],
    [1,4,1,65535 ^ 1,0,[.25,0,0],[1,0,0],[.2,.1,.3],1,1],
    [2,6,2,65535,2,[.2,.6,0],[-1,0,0],[.1,.2,-.1],.5,2],
    [3,255,15,65535 ^ 1,0,[.3,0,0],[0,2,0],[0,0,0],.5,1],
  ] as [number,number,number,number,number,number[],number[],number[],number,number][]) {
    text('physics body '+id);text('Original Issue 45');u8(bone);u8(group);u16(exclude);u8(shape);fs(size);fs(p);fs(r);
    f(mass);f(.02);f(.04);f(.1);f(.5);u8(coupling);
  }
  i32(physics ? 1 : 0);
  if(physics){text('translated rotated spring');text('Original Issue 45');u8(0);u8(0);u8(1);fs([.4,.2,.1]);fs([.2,.1,.3]);
    fs([-.6,-.4,-.2]);fs([.3,.6,.5]);fs([-.5,-.2,-.1]);fs([.3,.4,.6]);fs([5,8,3]);fs([2,3,1]);}
  if (mode === "qdef") i32(0);
  return result();
}
export function solverVMD(motion: "a" | "b") {
  const { u8, i32, fs, f, fixed, bytes, result } = writer();
  fixed("Vocaloid Motion Data 0002", 30);
  fixed("Original solver", 20);
  // Linear source curves produce nonlinear solved trajectories with closed-form geometric predictions.
  i32(8);
  for (const [name, t, q] of [
    [
      "root",
      [0, 0, 0],
      motion === "a" ? [Math.SQRT1_2, 0, 0, Math.SQRT1_2] : [0, 0, 0, 1],
    ],
    ["link", [0.1, 0.2, 0.1], [0, 0, 0, 1]],
    ["IK", motion === "a" ? [0, 0, 0] : [1, -1, 0], [0, 0, 0, 1]],
    [
      "append",
      [0.2, 0.1, 0.3],
      motion === "a"
        ? [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)]
        : [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
    ],
  ] as [string, number[], number[]][]) {
    for (const frame of [0, 45]) {
      fixed(name, 15);
      i32(frame);
      const u = frame / 45,
        translation = [...t],
        rotation = [...q];
      if (name === "IK") {
        translation[0] += (motion === "a" ? 0.15 : -0.2) * u;
        translation[1] += (motion === "a" ? 0 : 0.1) * u;
        translation[2] += 0.05 * u;
      }
      if (name === "append") {
        translation[0] += 0.1 * u;
        translation[1] -= 0.1 * u;
        translation[2] += 0.1 * u;
      }
      if (name === "root" || name === "append") {
        const axis =
          name === "root" ? (motion === "a" ? 0 : 2) : motion === "a" ? 1 : 2;
        const angle =
          name === "root"
            ? motion === "a"
              ? (Math.PI / 2) * (1 - 0.25 * u)
              : 0.3 * u
            : (Math.PI / 4) * (motion === "a" ? 1 + 0.25 * u : 1 - 0.25 * u);
        rotation.fill(0);
        rotation[axis] = Math.sin(angle / 2);
        rotation[3] = Math.cos(angle / 2);
      }
      fs(translation);
      fs(rotation);
      const c = Buffer.alloc(64);
      for (let j = 0; j < 4; j++) {
        c[j] = 20;
        c[j + 4] = 20;
        c[j + 8] = 107;
        c[j + 12] = 107;
      }
      bytes(c);
    }
  }
  i32(4);
  for (const name of ["vertex", "group"])
    for (const frame of [0, 45]) {
      fixed(name, 15);
      i32(frame);
      const u = frame / 45;
      f(
        name === "group"
          ? (motion === "a" ? 0.6 : -0.4) + 0.2 * u
          : motion === "a"
            ? 0.1 + 0.1 * u
            : -0.15 + 0.2 * u,
      );
    }

  i32(0);
  i32(0);
  i32(0);
  i32(3);
  for (const [frame, on] of [
    [0, 1],
    [15, 0],
    [30, 1],
  ]) {
    i32(frame);
    u8(frame === 15 ? 0 : 1);
    i32(1);
    fixed("IK", 20);
    u8(on);
  }
  return result();
}
export function solverVPD(pose: "a" | "b") {
  const q = pose === "a" ? [Math.SQRT1_2, 0, 0, Math.SQRT1_2] : [0, 0, 0, 1];
  return Buffer.from(
    `Vocaloid Pose Data file\noriginal.pmx;\n4;\nBone0{root\n0,0,0;\n${q.join(",")};\n}\nBone3{link\n.1,.2,.1;\n0,0,0,1;\n}\nBone1{IK\n${pose === "a" ? "0,0,0" : "1,-1,0"};\n0,0,0,1;\n}\nBone2{append\n.2,.1,.3;\n${pose === "a" ? [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)].join(",") : [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)].join(",")};\n}\n`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  for (const shape of ["box", "wedge"] as const)
    for (const mode of ["bdef", "sdef", "qdef"] as const)
      await writeFile(
        `tests/fixtures/solver-${shape}-${mode}.pmx`,
        solverPMX(shape, mode),
      );
  for (const id of ["a", "b"] as const) {
    await writeFile(`tests/fixtures/solver-${id}.vmd`, solverVMD(id));
    await writeFile(`tests/fixtures/solver-${id}.vpd`, solverVPD(id));
  }
}
