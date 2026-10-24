import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import Ajv from "ajv";
import { AnimationMixer, Vector3, Quaternion, Matrix4 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { validateBytes, validateString } from "gltf-validator";
import { physicsPMX } from "../tools/synthetic-physics";
import { solverVMD, solverVPD } from "../tools/synthetic-solver";
import { convertModel, convertPMX, parsePMX } from "../tools/pmx-to-gltf";
import { createSolver } from "../tools/pmx-solver";
import { validatePhysics, type PhysicsProfile } from "../packages/mmd-physics";
import { solvePose, type SolverProfile } from "../packages/mmd-solver";
import { loadAmmoNode } from "../packages/three-mmd-physics/node";
import { BACKEND_SHA256 } from "../packages/three-mmd-physics/ammo";
import {
  PhysicsWorld,
  PhysicsTimeline,
  MMDPhysicsPlugin,
  PhysicsRig,
  createPhysicsRig,
  getPhysicsModel,
} from "../packages/three-mmd-physics";
import { MMDSolverPlugin } from "../packages/three-mmd-solver";
import {
  createVPDRig,
  bindVPD,
  applyVPD,
  resetVPD,
  parseVPD,
  getVPDModel,
} from "../packages/three-mmd-vpd";
import {
  MMDVMDPlugin,
  getVMDPlayers,
  bindVMD,
  createVMDPlayer,
  parseVMD,
} from "../packages/three-mmd-vmd";
import { orientationError } from "../tools/vmd-animation";
import { createMorphRig, getMorphWeights } from "../packages/three-mmd-morph";
import { evaluateMotion, evaluateIK, bindMotion } from "../packages/mmd-vmd";
import { directContactSpring, referenceRig } from "./physics-backend";
globalThis.ProgressEvent ??= class extends Event {
  constructor(t: string, init: any = {}) {
    super(t);
    Object.assign(this, init);
  }
} as any;
const { api } = await loadAmmoNode();
const evidence: Record<string, unknown> = {
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  backendSHA256: BACKEND_SHA256,
  originalMMD: "unmeasured",
  cases: [],
};
const cases = evidence.cases as object[];
const minimal = JSON.parse(
  await readFile("extensions/MMD_physics/examples/minimal.gltf", "utf8"),
);
const base = () => ({
  profile: structuredClone(minimal.extensions.MMD_physics) as PhysicsProfile,
  solver: structuredClone(
    minimal.extensions.MMD_skeleton_solver,
  ) as SolverProfile,
});
const load = (data: Uint8Array | string, exact = true) =>
  new GLTFLoader()
    .register((p) => new MMDSolverPlugin(p))
    .register((p) => new MMDPhysicsPlugin(p))
    .register((p) => (exact ? new MMDVMDPlugin(p) : { name: "core" }))
    .parseAsync(
      typeof data === "string"
        ? data
        : (data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer),
      "",
    );
const snapshot = (root: any) => {
  const a: any[] = [];
  root.traverse((n: any) => {
    if (n.userData.pmxBone)
      a[n.userData.pmxBone.index] = {
        translation: n.position.toArray(),
        rotation: n.quaternion.toArray(),
      };
  });
  return a;
};
const near = (a: number[], b: number[], t = 3e-6) =>
  a.forEach((v, i) =>
    assert.ok(Math.abs(v - b[i]) < t, `${a} != ${b} at ${i}`),
  );
const compare = (
  a: ReturnType<typeof snapshot>,
  b: ReturnType<typeof snapshot>,
  t = 3e-6,
) =>
  a.forEach((v, i) => {
    near(v.translation, b[i].translation, t);
    assert.ok(orientationError(v.rotation, b[i].rotation) < 2e-5);
  });
test("physics schema, invalid fixtures, standalone minimal asset, backend hash and explicit failure", async () => {
  assert.equal(
    createHash("sha256")
      .update(await readFile("node_modules/ammojs-typed/ammo/ammo.js"))
      .digest("hex"),
    BACKEND_SHA256,
  );
  const valid = new Ajv({ strict: false }).compile(
    JSON.parse(
      await readFile(
        "extensions/MMD_physics/schema/glTF.MMD_physics.schema.json",
        "utf8",
      ),
    ),
  );
  assert.ok(valid(minimal.extensions.MMD_physics));
  for (const fixture of JSON.parse(
    await readFile("extensions/MMD_physics/tests/invalid.json", "utf8"),
  )) {
    const { profile, solver } = base();
    const keys = fixture.path
      .replaceAll("[", ".")
      .replaceAll("]", "")
      .split(".");
    let target: any = profile;
    for (const key of keys.slice(0, -1)) target = target[key];
    target[keys.at(-1)] = fixture.value;
    assert.throws(() => validatePhysics(profile, solver), /MMD_physics/);
  }
  const asset = await load(JSON.stringify(minimal)),
    node = asset.scene.children[0],
    before = node.position.toArray();
  await assert.rejects(
    () =>
      createPhysicsRig(asset.scene, async () => {
        throw new Error("synthetic backend failure");
      }),
    /synthetic backend/,
  );
  near(node.position.toArray(), before);
  const rig = new PhysicsRig(asset.scene, api);
  rig.step(0.5);
  assert.ok(node.position.y < 0);
  rig.dispose();
  rig.dispose();
  assert.equal(PhysicsWorld.allocations, 0);
  assert.equal(
    (await validateString(JSON.stringify(minimal))).issues.numErrors,
    0,
  );
});
test("analytical finite-step gravity, original-rest offsets, fractional hold, partitioning and transactional budgets", () => {
  const { profile, solver } = base(),
    timeline = new PhysicsTimeline(api, profile, solver),
    rest = solver.bones;
  const n = 60,
    h = profile.fixedStep,
    g = profile.gravity[1],
    pose = timeline.seek(n * h, () => rest),
    expected = 1 + (g * h * h * n * (n + 1)) / 2;
  near(pose[0].translation, [0, expected, 0], 2e-6);
  const body = timeline.bodyTransforms().get(0)!;
  near(body.slice(12, 15), [0.2, expected, 0], 2e-6);
  const held = timeline.seek(0.5 + h * 0.49, () => rest);
  near(held[0].translation, pose[0].translation, 1e-12);
  let clock = 0;
  for (const delta of [0.1, 0.07, 0.03, 0.1, 0.2]) {
    timeline.validateDelta(delta);
    clock += delta;
    timeline.seek(clock, () => rest);
  }
  near(
    timeline.seek(clock, () => rest)[0].translation,
    pose[0].translation,
    1e-12,
  );
  const before = timeline.bodyTransforms();
  assert.throws(() => timeline.seek(31, () => rest), /budget/);
  assert.throws(() => timeline.seek(-1, () => rest), /invalid/);
  assert.throws(() => timeline.validateDelta(2.01), /budget/);
  assert.deepEqual(timeline.bodyTransforms(), before);
  assert.throws(
    () => timeline.seek(0.1, () => [{ ...rest[0], translation: [NaN, 0, 0] }]),
    /invalid input/,
  );
  assert.deepEqual(timeline.bodyTransforms(), before);
  const rotated = structuredClone(rest);
  rotated[0].rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  timeline.seek(0, () => rotated);
  near(timeline.bodyTransforms().get(0)!.slice(12, 15), [0, 1.2, 0]);
  cases.push({
    kind: "analytical symplectic Euler",
    ticks: n,
    step: h,
    expectedY: expected,
    actualY: pose[0].translation[1],
    absoluteError: Math.abs(expected - pose[0].translation[1]),
    positionBound: 2e-6,
  });
  timeline.dispose();
  assert.equal(PhysicsWorld.allocations, 0);
  const large = base();
  large.solver.bones = Array.from({ length: 1000 }, (_, index) => ({
    ...structuredClone(large.solver.bones[0]),
    index,
  }));
  const bounded = new PhysicsTimeline(api, large.profile, large.solver);
  assert.throws(() => bounded.preflight(30), /budget/);
  assert.equal(PhysicsWorld.allocations, 0);
  bounded.dispose();
});
test("mode-0 follows, mode-1 writes, mode-2 aligns bone origin, unbound bodies do not write", () => {
  for (const mode of [0, 1, 2] as const) {
    const { profile, solver } = base();
    profile.bodies[0].mode = mode;
    const timeline = new PhysicsTimeline(api, profile, solver),
      pose = timeline.seek(0.5, () => solver.bones);
    assert.equal(mode === 1, pose[0].translation[1] < 0.5);
    if (mode !== 1) near(pose[0].translation, [0, 1, 0]);
    timeline.dispose();
  }
  const { profile, solver } = base();
  profile.bodies[0].bone = -1;
  const timeline = new PhysicsTimeline(api, profile, solver);
  near(timeline.seek(0.5, () => solver.bones)[0].translation, [0, 1, 0]);
  assert.ok(timeline.bodyTransforms().get(0)![13] < -1);
  timeline.dispose();
});
test("tick-zero disabled IK and player overrides initialize dynamic bodies from the controlled pose", async (t) => {
  const source = parsePMX(physicsPMX("box"));
  source.rigidBodies = [{
    ...(source.rigidBodies[1] as object),
    boneIndex: 2,
    position: [...source.bones[2].position],
    rotation: [0, 0, 0],
  }];
  source.constraints = [];
  source.metadata.rigidBodyCount = 1;
  source.metadata.constraintCount = 0;
  const result = await convertModel(source, ".", {
    mode: "bdef", scale: 0.2, physics: "rigid-body-v1",
  });
  const asset = await load(await result.io.writeBinary(result.document));
  const model = getPhysicsModel(asset.scene)!;
  model.profile.gravity = [0, 0, 0];
  const timeline = new PhysicsTimeline(api, model.profile, model.solver);
  t.after(() => timeline.dispose());
  for (const time of [0, model.profile.fixedStep]) {
    const pose = timeline.seek(time, () => model.solver.bones, () => new Map([[3, false]]));
    near(pose[2].translation, [0.2, 0, 0]);
    assert.ok(orientationError(pose[2].rotation, [0, 0, 0, 1]) < 2e-5);
    near(timeline.bodyTransforms().get(0)!.slice(12, 15), [0.2, 0, 0]);
  }
  const physics = new PhysicsRig(asset.scene, api);
  t.after(() => physics.dispose());
  const vmd = parseVMD(solverVMD("b"));
  vmd.bones = [];
  vmd.morphs = [];
  vmd.displays = [vmd.displays[0]];
  vmd.displays[0].ik[0].enabled = 0;
  const handle = createVPDRig(asset.scene);
  const player = createVMDPlayer(handle, bindVMD(handle, vmd));
  t.after(() => player.dispose());
  const check = (position: number[]) => {
    near(snapshot(asset.scene)[2].translation, [0.2, 0, 0]);
    assert.ok(orientationError(snapshot(asset.scene)[2].rotation, [0, 0, 0, 1]) < 2e-5);
    near(physics.timeline.bodyTransforms().get(0)!.slice(12, 15), position);
  };
  player.seek(0);
  check([0.2, 0, 0]);
  player.setIKEnabled(3, true);
  check([0, 0.2, 0]);
  player.setIKEnabled(3, false);
  check([0.2, 0, 0]);
  player.setIKEnabled(3, undefined);
  check([0.2, 0, 0]);
});
test("physics fallback deduplicates FLOAT key/tick collisions and retains IK seams in GLB/glTF", async () => {
  for (const id of ["a", "b"] as const) {
    const vmd = Buffer.from(solverVMD(id));
    for (let i = 0; i < vmd.readUInt32LE(50); i++) {
      const offset = 54 + i * 111 + 15;
      if (vmd.readUInt32LE(offset) === 45) vmd.writeUInt32LE(23, offset);
    }
    assert.notEqual(23 / 30, 92 * (1 / 120));
    assert.equal(Math.fround(23 / 30), Math.fround(92 * (1 / 120)));
    const result = await convertModel(parsePMX(physicsPMX("box")), ".", {
      mode: "bdef", scale: 0.2, physics: "rigid-body-v1", vmd,
    });
    for (const sampler of result.document.getRoot().listAnimations()[0].listSamplers()) {
      if (sampler.getOutput()!.getType() === "SCALAR") continue;
      const times = Array.from(sampler.getInput()!.getArray()!);
      assert.ok(times.every((time, i) => i === 0 || time > times[i - 1]));
      assert.equal(times.filter(time => time === Math.fround(23 / 30)).length, 1);
      for (const seam of [0.5, 1]) {
        const f = new Float32Array([seam]);
        new Uint32Array(f.buffer)[0]--;
        assert.ok(times.includes(f[0]) && times.includes(seam));
      }
    }
    const binary = await result.io.writeBinary(result.document);
    assert.equal((await validateBytes(binary)).issues.numErrors, 0);
    const json = await result.io.writeJSON(result.document);
    for (const b of json.json.buffers ?? [])
      b.uri = `data:application/octet-stream;base64,${Buffer.from(json.resources[b.uri!]).toString("base64")}`;
    const encoded = JSON.stringify(json.json);
    assert.equal((await validateString(encoded)).issues.numErrors, 0);
    for (const data of [binary, encoded]) {
      const live = await load(data), physics = new PhysicsRig(live.scene, api),
        player = getVMDPlayers(live)[0];
      try {
        player.seek(23 / 30);
        const fallback = await load(data, false), mixer = new AnimationMixer(fallback.scene);
        mixer.clipAction(fallback.animations[0]).play();
        mixer.setTime(Math.fround(23 / 30));
        compare(snapshot(fallback.scene), snapshot(live.scene), 2e-5);
      } finally {
        player.dispose();
        physics.dispose();
      }
    }
  }
  assert.equal(PhysicsWorld.allocations, 0);
});
test("mode-2 spring rotation preserves the animated bone origin and composes a rotated body offset", () => {
  const { profile, solver } = base();
  profile.gravity = [0, 0, 0];
  profile.bodies[0].mode = 2;
  profile.bodies[0].mask = 0;
  profile.bodies.push({
    ...structuredClone(profile.bodies[0]),
    index: 1,
    bone: -1,
    mode: 0,
    mass: 0,
    translation: [0, 1, 0],
  });
  profile.joints = [
    {
      index: 0,
      name: "strained angular spring",
      type: 0,
      bodyA: 0,
      bodyB: 1,
      frameA: { translation: [-0.2, 0, 0], rotation: [0, 0, 0, 1] },
      frameB: {
        translation: [0, 0, 0],
        rotation: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
      },
      linearLower: [-10, -10, -10],
      linearUpper: [10, 10, 10],
      angularLower: [-2.9, -2.9, -2.9],
      angularUpper: [2.9, 2.9, 2.9],
      linearSpring: [0, 0, 0],
      angularSpring: [0, 0, 20],
    },
  ];
  const timeline = new PhysicsTimeline(api, profile, solver);
  try {
    const result = timeline.seek(0.25, () => solver.bones)[0];
    near(result.translation, [0, 1, 0]);
    assert.ok(orientationError(result.rotation, [0, 0, 0, 1]) > 0.01);
    const center = new Vector3(0.2, 0, 0)
      .applyQuaternion(new Quaternion(...result.rotation))
      .add(new Vector3(0, 1, 0));
    near(timeline.bodyTransforms().get(0)!.slice(12, 15), center.toArray());
    cases.push({
      kind: "mode-2 nonzero spring rotation",
      rotation: result.rotation,
      position: result.translation,
      positionBound: 3e-6,
    });
  } finally {
    timeline.dispose();
  }
});

test("independent direct Ammo contact and spring cases; raw PMX exclusions and group 15 filter through Bullet", async () => {
  const direct = await directContactSpring(api);
  cases.push({
    kind: "independently authored direct-backend conformance",
    ...direct,
  });
  assert.ok(direct.contactY > 0.09 && direct.contactY < 0.11);
  assert.ok(direct.wrongMaskY < -2);
  assert.ok(direct.springDisplacement > 1e-4);
  assert.ok(direct.jointDrift < 0.03);
  const heights: number[] = [];
  for (const excluded of [0, 1]) {
    const model = parsePMX(physicsPMX("box"));
    model.constraints = [];
    model.metadata.constraintCount = 0;
    model.rigidBodies = [
      {
        name: "floor",
        boneIndex: -1,
        groupIndex: 0,
        groupTarget: 0,
        shapeType: 1,
        width: 5,
        height: 0.1,
        depth: 5,
        position: [0, -0.1, 0],
        rotation: [0, 0, 0],
        weight: 0,
        positionDamping: 0,
        rotationDamping: 0,
        restitution: 0,
        friction: 0.5,
        type: 0,
      },
      {
        name: "ball",
        boneIndex: -1,
        groupIndex: 15,
        groupTarget: excluded,
        shapeType: 0,
        width: 0.1,
        height: 0,
        depth: 0,
        position: [0, 1, 0],
        rotation: [0, 0, 0],
        weight: 1,
        positionDamping: 0,
        rotationDamping: 0,
        restitution: 0,
        friction: 0.5,
        type: 1,
      },
    ];
    model.metadata.rigidBodyCount = 2;
    const r = await convertModel(model, ".", {
        mode: "bdef",
        physics: "rigid-body-v1",
        scale: 1,
      }),
      asset = await load(await r.io.writeBinary(r.document)),
      retained = getPhysicsModel(asset.scene)!,
      t = new PhysicsTimeline(api, retained.profile, retained.solver);
    t.seek(1, () => retained.solver.bones);
    heights.push(t.bodyTransforms().get(1)![13]);
    t.dispose();
  }
  assert.ok(heights[0] > 0.09 && heights[0] < 0.11);
  assert.ok(heights[1] < -2);
  cases.push({
    kind: "raw PMX bit filtering",
    group: 15,
    rawExclusion0: heights[0],
    rawExclusion1: heights[1],
  });
  assert.equal(PhysicsWorld.allocations, 0);
});
test("indexed validation rejects invalid sources and dependencies without output", async () => {
  const mutations: ((m: ReturnType<typeof parsePMX>) => void)[] = [
    (m) => {
      (m.rigidBodies[1] as any).boneIndex = 999;
    },
    (m) => {
      (m.rigidBodies[1] as any).width = 0;
    },
    (m) => {
      (m.rigidBodies[1] as any).groupIndex = 16;
    },
    (m) => {
      (m.rigidBodies[1] as any).groupTarget = 65536;
    },
    (m) => {
      (m.rigidBodies[2] as any).boneIndex = 4;
    },
    (m) => {
      (m.constraints[0] as any).type = 1;
    },
    (m) => {
      (m.constraints[0] as any).rigidBodyIndex1 = -1;
    },
    (m) => {
      m.bones[5].flag! &= ~0x1000;
    },
    (m) => {
      m.bones[4].flag = 0x2000;
    },
    (m) => {
      m.metadata.rigidBodyCount = 99;
    },
    (m) => {
      m.metadata.coordinateSystem = "left";
    },
  ];
  for (const mutate of mutations) {
    const model = parsePMX(physicsPMX("box"));
    mutate(model);
    await assert.rejects(
      () =>
        convertModel(model, ".", { mode: "bdef", physics: "rigid-body-v1" }),
      /PMX|MMD_/,
    );
  }
  const directory = await mkdtemp(join(tmpdir(), "mmd-physics-"));
  try {
    await writeFile(join(directory, "input.pmx"), physicsPMX("box"));
    await assert.rejects(
      () =>
        convertPMX(
          join(directory, "input.pmx"),
          join(directory, "absent", "out.gltf"),
          { mode: "bdef", physics: "rigid-body-v1", physicsSettle: 31 },
        ),
      /Invalid physicsSettle/,
    );
    await assert.rejects(() => readFile(join(directory, "absent", "out.gltf")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("both PMX parser paths reflect physics once, preserve source identities and scale joint frames/limits", async () => {
  const profiles: PhysicsProfile[] = [];
  for (const mode of ["bdef", "qdef"] as const) {
    const source = parsePMX(physicsPMX("wedge", mode));
    near((source.rigidBodies[1] as any).rotation, [-0.2, -0.1, 0.3]);
    near(
      (source.constraints[0] as any).translationLimitation1,
      [-0.6, -0.4, -0.5],
    );
    near(
      (source.constraints[0] as any).translationLimitation2,
      [0.3, 0.6, 0.2],
    );
    near(
      (source.constraints[0] as any).rotationLimitation1,
      [-0.3, -0.4, -0.1],
    );
    near((source.constraints[0] as any).rotationLimitation2, [0.5, 0.2, 0.6]);
    const result = await convertModel(source, ".", {
        mode,
        physics: "rigid-body-v1",
        scale: 0.2,
      }),
      asset = await load(await result.io.writeBinary(result.document)),
      p = getPhysicsModel(asset.scene)!.profile;
    profiles.push(p);
    assert.equal(p.bodies[3].index, 3);
    assert.equal(p.bodies[3].bone, -1);
    assert.equal(p.bodies[3].group, 15);
    assert.equal(p.bodies[3].mask, 1);
    assert.equal(p.joints[0].name, "translated rotated spring");
    near(p.bodies[1].size, [0.05, 0, 0]);
    near(p.bodies[2].size, [0.04, 0.12, 0]);
    near(p.joints[0].linearLower, [-0.12, -0.08, -0.1]);
    near(p.joints[0].angularSpring, [0.08, 0.12, 0.04]);
  }
  assert.deepEqual(profiles[0], profiles[1]);
});
for (const rigName of ["box", "wedge"] as const)
  for (const mode of ["bdef", "sdef", "qdef"] as const)
    test(`physics ${rigName} ${mode}: VMD/VPD bytes, retained output, fallback, ownership and reset`, async (t) => {
      assert.deepEqual(
        await readFile(`tests/fixtures/physics-${rigName}-${mode}.pmx`),
        physicsPMX(rigName, mode),
      );
      const source = parsePMX(physicsPMX(rigName, mode)),
        converted = await convertModel(source, ".", {
          mode,
          scale: 0.2,
          physics: "rigid-body-v1",
        }),
        bytes = await converted.io.writeBinary(converted.document);
      assert.equal((await validateBytes(bytes)).issues.numErrors, 0);
      const asset = await load(bytes),
        handle = createVPDRig(asset.scene),
        physics = new PhysicsRig(asset.scene, api),
        rest = getVPDModel(handle);
      const originalSnapshot = snapshot(asset.scene);
      t.after(() => physics.dispose());
      assert.equal(rest.solver!.version, 2);
      assert.equal(source.metadata.coordinateSystem, "right");
      for (const id of ["a", "b"] as const) {
        const player = createVMDPlayer(
          handle,
          bindVMD(handle, parseVMD(solverVMD(id))),
        );
        player.seek(0.5);
        const expected = snapshot(asset.scene);
        const motion = bindMotion(rest, parseVMD(solverVMD(id)), {
            morphUnmatched: "ignore",
          }),
          reference = referenceRig(
            api,
            physics.timeline.profile,
            rest.solver!,
            (t) => evaluateMotion(motion, t, undefined, true),
            (t) => evaluateIK(motion, t),
            0.5,
          );
        compare(expected, reference);
        cases.push({
          kind: "independent direct-backend rig coupling and explicit post append",
          rig: rigName,
          mode,
          motion: id,
          positionBound: 3e-6,
          rotationBound: 2e-5,
        });
        const paused = structuredClone(expected);
        player.pause().update(0.1);
        assert.deepEqual(snapshot(asset.scene), paused);
        player.seek(0.2).seek(0.5);
        compare(snapshot(asset.scene), expected);
        player.seek(1.2).seek(0.5);
        compare(snapshot(asset.scene), expected);
        player.loop = true;
        player.seek(1.4).play().update(0.6);
        assert.ok(Math.abs(player.time - 0.5) < 1e-10);
        compare(snapshot(asset.scene), expected);
        player.pause();
        physics.enabled = false;
        player.seek(0.5);
        const disabled = snapshot(asset.scene);
        assert.ok(
          Math.abs(disabled[4].translation[1] - expected[4].translation[1]) >
            0.001,
        );
        physics.enabled = true;
        player.seek(0.5);
        const pre = solvePose(rest.solver, rest.bones, new Map(), "pre"),
          wrong = solvePose(rest.solver, pre, new Map(), "post");
        assert.ok(
          Math.hypot(
            ...expected[5].translation.map(
              (v: number, i: number) => v - wrong[5].translation[i],
            ),
          ) > 0.001,
        );
        const stable = snapshot(asset.scene);
        assert.throws(() => player.update(2.1), /budget/);
        assert.deepEqual(snapshot(asset.scene), stable);
        if (mode === "bdef") {
          const r = await convertModel(source, ".", {
              mode,
              scale: 0.2,
              physics: "rigid-body-v1",
              vmd: solverVMD(id),
            }),
            binary = await r.io.writeBinary(r.document);
          assert.equal((await validateBytes(binary)).issues.numErrors, 0);
          const json = await r.io.writeJSON(r.document);
          for (const b of json.json.buffers ?? [])
            b.uri = `data:application/octet-stream;base64,${Buffer.from(json.resources[b.uri!]).toString("base64")}`;
          const encoded = JSON.stringify(json.json);
          assert.equal((await validateString(encoded)).issues.numErrors, 0);
          for (const data of [binary, encoded]) {
            const retained = await load(data),
              p = new PhysicsRig(retained.scene, api),
              play = getVMDPlayers(retained)[0];
            play.seek(0.5);
            compare(snapshot(retained.scene), expected);
            p.dispose();
            play.dispose();
          }
          const fallback = await load(binary, false),
            mixer = new AnimationMixer(fallback.scene);
          mixer.clipAction(fallback.animations[0]).play();
          mixer.setTime(0.5);
          compare(snapshot(fallback.scene), expected, 2e-5);
          let maximumInterpolation = 0,
            maximumRotation = 0,
            maximumWeight = 0;
          const liveMorph = createMorphRig(asset.scene),
            coreMorph = createMorphRig(fallback.scene);
          const runtime = createVMDPlayer(
            handle,
            bindVMD(handle, parseVMD(solverVMD(id))),
          );
          for (const t of [0.123, 0.371, 0.719]) {
            runtime.seek(t);
            mixer.setTime(t);
            const actual = snapshot(asset.scene),
              approx = snapshot(fallback.scene);
            for (let i = 0; i < actual.length; i++) {
              maximumInterpolation = Math.max(
                maximumInterpolation,
                Math.hypot(
                  ...actual[i].translation.map(
                    (v: number, k: number) => v - approx[i].translation[k],
                  ),
                ),
              );
              maximumRotation = Math.max(
                maximumRotation,
                orientationError(actual[i].rotation, approx[i].rotation),
              );
            }
            const weights = getMorphWeights(liveMorph),
              approximateWeights = getMorphWeights(coreMorph);
            weights.forEach(
              (v, i) =>
                (maximumWeight = Math.max(
                  maximumWeight,
                  Math.abs(v - approximateWeights[i]),
                )),
            );
            const tick = Math.floor(t * 120 + 1e-9) / 120;
            near(
              weights,
              [
                id === "a"
                  ? 0.1 + (0.1 * tick) / 1.5
                  : -0.15 + (0.2 * tick) / 1.5,
                (id === "a" ? 0.6 : -0.4) + (0.2 * tick) / 1.5,
              ],
              1e-6,
            );
          }
          runtime.dispose();
          cases.push({
            rig: rigName,
            mode,
            motion: id,
            sourceSHA256: createHash("sha256")
              .update(physicsPMX(rigName, mode))
              .digest("hex"),
            GLBSHA256: createHash("sha256").update(binary).digest("hex"),
            measuredFallbackTranslationError: maximumInterpolation,
            measuredFallbackRotationError: maximumRotation,
            measuredFallbackWeightError: maximumWeight,
            interpolation:
              "three finite between-tick probes, no continuous guarantee",
          });
        }
        for (const poseId of ["a", "b"] as const) {
          const binding = bindVPD(handle, parseVPD(solverVPD(poseId), "utf-8"));
          applyVPD(handle, binding);
          physics.step(0.25);
          const posed = snapshot(asset.scene);
          applyVPD(handle, binding);
          physics.step(0.25);
          compare(snapshot(asset.scene), posed);
          assert.equal(player.playing, false);
          resetVPD(handle);
          physics.reset();
        }
        player.seek(0.5).play().stop();
        assert.equal(player.playing, false);
        assert.equal(player.time, 0);
        assert.equal(physics.time, 0);
        compare(snapshot(asset.scene), originalSnapshot);
        player.play().update(0.1).pause();
        assert.ok(Math.abs(player.time - 0.1) < 1e-12);
        player.reset();
        compare(snapshot(asset.scene), originalSnapshot);
        player.dispose();
        player.dispose();
      }
      physics.dispose();
      assert.equal(PhysicsWorld.allocations, 0);
    });
test("two model instances, async load failure, native allocations and post-phase order", async (t) => {
  const classes = [
      api.btTransform,
      api.btQuaternion,
      api.btVector3,
      api.btMatrix3x3,
      api.btMotionState,
    ],
    cacheCounts = () => classes.map((c) => Object.keys(api.getCache(c)).length),
    beforeCaches = cacheCounts();
  const originalGetRotation = api.btTransform.prototype.getRotation;
  api.btTransform.prototype.getRotation = () => {
    throw new Error("Allocating [Value] getRotation must not be used");
  };
  t.after(() => {
    api.btTransform.prototype.getRotation = originalGetRotation;
  });
  const a = await load(JSON.stringify(minimal)),
    b = await load(JSON.stringify(minimal)),
    x = new PhysicsRig(a.scene, api),
    y = new PhysicsRig(b.scene, api);
  x.step(0.5);
  near(b.scene.children[0].position.toArray(), [0, 1, 0]);
  for (const delta of [0.1, 0.07, 0.13, 0.2]) y.step(delta);
  near(
    a.scene.children[0].position.toArray(),
    b.scene.children[0].position.toArray(),
    1e-12,
  );
  y.reset();
  y.step(0.25);
  assert.ok(a.scene.children[0].position.y < b.scene.children[0].position.y);
  for (let i = 0; i < 10; i++) x.reset();
  x.dispose();
  y.dispose();
  assert.equal(PhysicsWorld.allocations, 0);
  assert.deepEqual(cacheCounts(), beforeCaches);
  cases.push({
    kind: "owned native handles and borrowed JS wrappers",
    remainingNativeAllocations: PhysicsWorld.allocations,
    cacheCountsBefore: beforeCaches,
    cacheCountsAfter: cacheCounts(),
    resets: 11,
    allocatingValueGetter: "forbidden by executable guard",
  });
});
test("CLI opts into physics for GLB and external-buffer glTF without changing legacy defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mmd-physics-cli-"));
  try {
    await writeFile(join(dir, "source.pmx"), physicsPMX("box"));
    for (const ext of ["glb", "gltf"]) {
      const output = join(dir, `model.${ext}`),
        result = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "tools/pmx-to-gltf.ts",
            join(dir, "source.pmx"),
            output,
            "--mode",
            "bdef",
            "--physics",
            "rigid-body-v1",
            "--physics-settle",
            "0.25",
          ],
          { encoding: "utf8" },
        );
      assert.equal(result.status, 0, result.stderr);
      const bytes = await readFile(output);
      if (ext === "glb")
        assert.equal((await validateBytes(bytes)).issues.numErrors, 0);
      else {
        const json = JSON.parse(bytes.toString());
        assert.equal(json.extensions.MMD_physics.version, 1);
        assert.ok(json.buffers[0].uri);
        assert.ok((await readFile(join(dir, json.buffers[0].uri))).length > 0);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("built physics assets: all skin modes, VMDs and VPD snapshots validate; settled poses preserve immutable rest", async () => {
  const references = JSON.parse(
    await readFile("public/physics/reference.json", "utf8"),
  ).poses;
  let validated = 0;
  for (const rig of ["box", "wedge"])
    for (const mode of ["bdef", "sdef", "qdef"])
      for (const state of ["rest", "a", "b", "pose-a", "pose-b"]) {
        const directory = `public/physics/${rig}-${mode}`,
          binary = await readFile(`${directory}/${state}.glb`),
          text = await readFile(`${directory}/${state}.gltf`, "utf8");
        assert.equal((await validateBytes(binary)).issues.numErrors, 0);
        assert.equal(
          (
            await validateString(text, {
              externalResourceFunction: async (uri: string) =>
                new Uint8Array(await readFile(join(directory, uri))),
            })
          ).issues.numErrors,
          0,
        );
        validated += 2;
        if (state.startsWith("pose-")) {
          const json = JSON.parse(text);
          for (const b of json.buffers ?? [])
            b.uri = `data:application/octet-stream;base64,${Buffer.from(await readFile(join(directory, b.uri))).toString("base64")}`;
          for (const data of [binary, JSON.stringify(json)]) {
            const asset = await load(data);
            compare(snapshot(asset.scene), references[`${rig}-${state}`]);
            const handle = createVPDRig(asset.scene),
              rest = getVPDModel(handle);
            resetVPD(handle);
            assert.deepEqual(getVPDModel(handle), rest);
          }
        }
      }
  cases.push({
    kind: "generated asset validator",
    validated,
    errors: 0,
    formats: ["GLB", "external-buffer glTF"],
    skinning: ["BDEF", "SDEF", "QDEF"],
  });
});
test("save measured physics evidence", async () => {
  await writeFile(
    "docs/physics-node-validation.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
});
