import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import Ajv from "ajv";
import { validateBytes, validateString } from "gltf-validator";
import {
  AnimationMixer,
  LoopOnce,
  Vector3,
  Quaternion,
  type Object3D,
  type SkinnedMesh,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { convertModel, convertPMX, parsePMX } from "../tools/pmx-to-gltf";
import { solverPMX, solverVMD, solverVPD } from "../tools/synthetic-solver";
import {
  solvePose,
  validateSolver,
  EXTENSION_NAME,
  type SolverProfile,
} from "../packages/mmd-solver";
import {
  parseVMD,
  bindMotion,
  evaluateMotion,
  evaluateIK,
} from "../packages/mmd-vmd";
import { validatePayload, payloadMotion, type VMDPayload } from "../packages/mmd-vmd/payload";
import {
  parseVPD,
  createVPDRig,
  bindVPD,
  applyVPD,
  resetVPD,
  getVPDModel,
} from "../packages/three-mmd-vpd";
import {
  MMDVMDPlugin,
  getVMDPlayers,
  bindVMD,
  createVMDPlayer,
  VMDPlayer,
} from "../packages/three-mmd-vmd";
import { MMDSolverPlugin } from "../packages/three-mmd-solver";
import { orientationError } from "../tools/vmd-animation";
import { createMorphRig, getMorphModel } from "../packages/three-mmd-morph";
import { MMDQDEFPlugin } from "../packages/three-mmd-qdef";
import { solverVertex, solverExpected } from "./solver-oracle";
import type { RestBone } from "../packages/mmd-vpd";
globalThis.ProgressEvent ??= class extends Event {
  constructor(type: string, init: any = {}) {
    super(type);
    Object.assign(this, init);
  }
} as any;
const load = (data: Uint8Array | string, exact = true) =>
  new GLTFLoader()
    .register((p) => new MMDSolverPlugin(p))
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
const near = (a: number[], b: number[], t = 2e-6) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= t, `${a} != ${b}`));
const snapshot = (root: Object3D) => {
  const result: RestBone[] = [];
  root.traverse((n) => {
    if (n.userData.pmxBone)
      result[n.userData.pmxBone.index] = {
        index: n.userData.pmxBone.index,
        name: "",
        parentIndex: -1,
        translation: n.position.toArray(),
        rotation: n.quaternion.toArray(),
        scale: [1, 1, 1],
      };
  });
  return result;
};
function check(actual: RestBone[], expected: RestBone[], rotation = 1e-5) {
  for (const b of expected) {
    const a = actual.find((v) => v.index === b.index)!;
    near(a.translation, b.translation);
    assert.ok(
      orientationError(a.rotation, b.rotation) <= rotation,
      `bone ${b.index} orientation ${a.rotation} != ${b.rotation}`,
    );
  }
}
async function jsonOutput(r: Awaited<ReturnType<typeof convertModel>>) {
  const json = await r.io.writeJSON(r.document);
  for (const b of json.json.buffers ?? []) {
    b.uri = `data:application/octet-stream;base64,${Buffer.from(json.resources[b.uri!]).toString("base64")}`;
  }
  return JSON.stringify(json.json);
}

test("retained IK endpoints determine playback duration beyond all other channels", async () => {
  const minimal = JSON.parse(await readFile(
    "extensions/MMD_skeleton_solver/examples/minimal.gltf", "utf8",
  ));
  const solver: SolverProfile = minimal.extensions[EXTENSION_NAME];
  for (const shorterChannels of [false, true]) {
    const payload: VMDPayload = {
      version: 3, solver,
      rest: solver.bones.map(b => ({ node: b.node!, translation: b.translation, rotation: b.rotation })),
      tracks: shorterChannels ? [{ node: solver.bones[0].node!, keys: [{
        frame: 15, translation: [0,0,0], rotation: [0,0,0,1],
        curves: [[0,0,127,127], [0,0,127,127], [0,0,127,127], [0,0,127,127]],
      }] }] : [],
      ik: [{ index: 2, keys: [{frame: 30, enabled: false}] }],
      visibility: shorterChannels ? [{frame: 10, visible: 1, raw: []}] : [],
    };
    validatePayload(payload);
    const motion = payloadMotion(payload);
    assert.equal(motion.duration, 1);
    let resolved: RestBone[] = [];
    const player = new VMDPlayer((await load(JSON.stringify(minimal))).scene, motion,
      pose => () => { resolved = pose; });
    player.seek(1 - 1e-6);
    assert.equal(player.ikStates[2], true);
    near(resolved[0].rotation, [0,0,Math.SQRT1_2,Math.SQRT1_2]);
    player.seek(1);
    assert.equal(player.time, 1);
    assert.equal(player.ikStates[2], false);
    near(resolved[0].rotation, [0,0,0,1]);
    player.seek(0).play().update(1);
    assert.equal(player.playing, false);
    assert.equal(player.ikStates[2], false);
    player.loop = true;
    player.play().update(0.25);
    assert.equal(player.time, 0.25);
    assert.equal(player.ikStates[2], true);
    player.dispose();
  }
});

test("VPD rejects stale converter solver extras before mutating a root-contract pose", async () => {
  const model = parsePMX(solverPMX("box"));
  model.bones[3].ik!.maxAngle = 0;
  const converted = await convertModel(model, ".", {mode: "bdef", scale: 0.2, solver: "pre-physics-v1"});
  const json = JSON.parse(await jsonOutput(converted));
  assert.equal(json.extensions[EXTENSION_NAME].bones[3].ik.angle, 0);
  const container = json.nodes.find((n: any) => n.extras?.mmdSolver);
  container.extras.mmdSolver.bones[3].ik.angle = Math.PI;
  const gltf = await load(JSON.stringify(json));
  const before = snapshot(gltf.scene);
  near(before[1].rotation, [0,0,0,1]);
  assert.throws(() => createVPDRig(gltf.scene), /solver metadata differs from root contract/);
  assert.deepEqual(snapshot(gltf.scene), before);
  // Compatible extras and absent solver extras both use the validated root contract.
  for (const extras of [json.extensions[EXTENSION_NAME], undefined]) {
    container.extras.mmdSolver = extras;
    const compatible = await load(JSON.stringify(json));
    const rig = createVPDRig(compatible.scene);
    resetVPD(rig);
    near(snapshot(compatible.scene)[1].rotation, [0,0,0,1]);
    const player = createVMDPlayer(rig, bindVMD(rig, parseVMD(solverVMD("a"))));
    player.seek(0.371);
    near(snapshot(compatible.scene)[1].rotation, [0,0,0,1]);
    player.dispose();
  }
});

test("solver fixtures: deterministic authored bytes, raw source records, bounded schema and standalone minimal glTF", async () => {
  for (const shape of ["box", "wedge"] as const)
    for (const mode of ["bdef", "sdef", "qdef"] as const)
      assert.deepEqual(
        await readFile(`tests/fixtures/solver-${shape}-${mode}.pmx`),
        solverPMX(shape, mode),
      );
  for (const id of ["a", "b"] as const) {
    assert.deepEqual(
      await readFile(`tests/fixtures/solver-${id}.vmd`),
      solverVMD(id),
    );
    assert.deepEqual(
      await readFile(`tests/fixtures/solver-${id}.vpd`),
      solverVPD(id),
    );
  }
  const schema = JSON.parse(
    await readFile(
      "extensions/MMD_skeleton_solver/schema/glTF.MMD_skeleton_solver.schema.json",
      "utf8",
    ),
  );
  const valid = new Ajv({ strict: false }).compile(schema);
  const minimal = JSON.parse(
    await readFile(
      "extensions/MMD_skeleton_solver/examples/minimal.gltf",
      "utf8",
    ),
  );
  assert.ok(
    valid(minimal.extensions[EXTENSION_NAME]),
    JSON.stringify(valid.errors),
  );
  const gltf = await load(JSON.stringify(minimal));
  const rig = createVPDRig(gltf.scene);
  resetVPD(rig);
  near(gltf.scene.getObjectByName("link")!.quaternion.toArray(), [
    0,
    0,
    Math.SQRT1_2,
    Math.SQRT1_2,
  ]);
  const invalid = JSON.parse(
    await readFile("extensions/MMD_skeleton_solver/tests/invalid.json", "utf8"),
  );
  for (const fixture of invalid) {
    const p: any = structuredClone(minimal.extensions[EXTENSION_NAME]);
    Object.assign(p.bones[fixture.bone], fixture.patch);
    assert.throws(() => validateSolver(p, minimal.nodes.length), /bones\[/);
  }
});

test("shared evaluator: two independent geometries × both VMD motions and VPD poses, core/retained GLB/glTF and repeat seeks", async () => {
  const measurements: object[] = [];
  for (const shape of ["box", "wedge"] as const)
    for (const id of ["a", "b"] as const) {
      let maximumOrientation = 0,
        maximumPosition = 0;
      const model = parsePMX(solverPMX(shape));
      const converted = await convertModel(model, ".", {
        mode: "bdef",
        scale: 0.2,
        solver: "pre-physics-v1",
        vmd: solverVMD(id),
        vmdSampling: { translationTolerance: 1e-7, rotationTolerance: 2e-7 },
      });
      const binary = await converted.io.writeBinary(converted.document),
        json = await jsonOutput(converted);
      const report = await validateBytes(binary);
      assert.equal(
        report.issues.numErrors,
        0,
        JSON.stringify(report.issues.messages),
      );
      assert.equal((await validateString(json)).issues.numErrors, 0);
      const gltf = await load(binary),
        rig = createVPDRig(gltf.scene),
        motion = bindMotion(
          getVPDModel(rig),
          parseVMD(solverVMD(id)),
          {},
          getMorphModel(createMorphRig(rig.root)),
        );
      const rawPlayer = createVMDPlayer(
        rig,
        bindVMD(rig, parseVMD(solverVMD(id))),
      );
      const sources = [
        { gltf, player: rawPlayer },
        { gltf: await load(binary), player: undefined as any },
        { gltf: await load(json), player: undefined as any },
      ];
      for (const s of sources.slice(1)) s.player = getVMDPlayers(s.gltf)[0];
      const core = await load(binary, false),
        mixer = new AnimationMixer(core.scene),
        action = mixer.clipAction(core.animations[0]);
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      const probeTimes = [
        0,
        0.25,
        0.49999,
        0.4999999701976776,
        0.5,
        0.50001,
        0.75,
        0.99999,
        0.9999999403953552,
        1,
        1.00001,
        1.25,
        1.5,
        0.371,
        0.719,
        0.371,
        ...Array.from({ length: 1201 }, (_, i) => i / 800),
      ];
      for (const time of probeTimes) {
        const expected = solverExpected(
          shape,
          id,
          time < 0.5 || time >= 1,
          0.2,
          time,
        );
        check(evaluateMotion(motion, time), expected);
        for (const s of sources) {
          s.player.seek(time);
          check(snapshot(s.gltf.scene), expected);
        }
        action.reset().play();
        mixer.setTime(time);
        check(snapshot(core.scene), expected, 1e-4);
        core.scene.updateMatrixWorld(true);
        for (const scene of [...sources.map((s) => s.gltf.scene), core.scene]) {
          for (const actual of snapshot(scene)) {
            maximumOrientation = Math.max(
              maximumOrientation,
              orientationError(
                actual.rotation,
                expected[actual.index].rotation,
              ),
            );
          }
          scene.traverse((n) => {
            const mesh = n as SkinnedMesh;
            if (!mesh.isSkinnedMesh) return;
            mesh.skeleton.update();
            for (let i = 0; i < 24; i++) {
              const predicted = solverVertex(
                  shape,
                  id,
                  time < 0.5 || time >= 1,
                  i,
                  "bdef",
                  true,
                  false,
                  false,
                  time,
                ).p,
                actual = mesh.getVertexPosition(i, new Vector3());
              maximumPosition = Math.max(
                maximumPosition,
                actual.distanceTo(predicted),
              );
              near(actual.toArray(), predicted.toArray());
            }
          });
        }
      }
      assert.equal(evaluateIK(motion, 0.5).get(3), false);
      assert.equal(evaluateIK(motion, 1).get(3), true);
      for (const pose of ["a", "b"] as const) {
        const b = bindVPD(rig, parseVPD(solverVPD(pose), "utf-8"));
        applyVPD(rig, b);
        check(snapshot(rig.root), solverExpected(shape, pose));
        const before = snapshot(rig.root);
        applyVPD(rig, b);
        assert.deepEqual(snapshot(rig.root), before);
      }
      resetVPD(rig);
      const baseline = snapshot(rig.root);
      const expectedLink = [
        0,
        0,
        (shape === "box" ? 1 : -1) * Math.SQRT1_2,
        Math.SQRT1_2,
      ];
      assert.ok(
        orientationError(
          baseline[1].rotation,
          expectedLink as [number, number, number, number],
        ) <= 1e-5,
      );
      near(
        rig.root
          .getObjectByName("tip")!
          .getWorldPosition(new Vector3())
          .toArray(),
        shape === "box" ? [0, 0.2, 0] : [0.4, 0.2, 0],
      );
      resetVPD(rig);
      assert.deepEqual(snapshot(rig.root), baseline);
      rawPlayer.seek(0.371);
      check(snapshot(rig.root), solverExpected(shape, id, true, 0.2, 0.371));
      const other = createVPDRig((await load(binary)).scene);
      assert.throws(
        () => createVMDPlayer(other, bindVMD(rig, parseVMD(solverVMD(id)))),
        /instance/,
      );
      const unchanged = snapshot(rig.root);
      assert.throws(() => rawPlayer.seek(NaN));
      assert.deepEqual(snapshot(rig.root), unchanged);
      rawPlayer.dispose();
      assert.throws(() => rawPlayer.seek(0), /disposed/);
      measurements.push({
        shape,
        motion: id,
        maximumOrientation,
        maximumPosition,
        times: probeTimes.length,
        paths: 4,
        sourceSHA256: createHash("sha256")
          .update(solverPMX(shape))
          .digest("hex"),
      });
    }
  await writeFile(
    "docs/solver-node-validation.json",
    JSON.stringify(measurements, null, 2) + "\n",
  );
});

test("solver degeneracies, hinge/unreachable prediction, iteration/angle caps and disabled negative control", () => {
  const bone = (index: number, parentIndex: number, t: number[]): any => ({
    index,
    parentIndex,
    name: String(index),
    translation: t,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    flags: 0,
    layer: index,
  });
  const profile: SolverProfile = {
    version: 1,
    bones: [
      bone(0, -1, [0, 0, 0]),
      bone(1, 0, [1, 0, 0]),
      {
        ...bone(2, -1, [0, 1, 0]),
        ik: {
          effector: 1,
          iterations: 1,
          angle: Math.PI,
          links: [{ index: 0, hinge: { axis: 2, min: 0, max: Math.PI / 4 } }],
        },
      },
    ],
  };
  const result = solvePose(profile, profile.bones);
  near(
    result[0].rotation,
    [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
    1e-12,
  );
  const disabled = solvePose(profile, profile.bones, new Map([[2, false]]));
  near(disabled[0].rotation, [0, 0, 0, 1]);
  const signed = structuredClone(profile);
  signed.bones[0].rotation = [0, 0, 0, -1];
  assert.ok(
    orientationError(
      solvePose(signed, signed.bones)[0].rotation,
      result[0].rotation,
    ) < 1e-7,
  );
  const zeroCap = structuredClone(profile);
  zeroCap.bones[2].ik!.angle = 0;
  zeroCap.bones[0].rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  near(
    solvePose(zeroCap, zeroCap.bones)[0].rotation,
    zeroCap.bones[0].rotation,
    1e-12,
  );
  const malformed = structuredClone(profile);
  malformed.bones.reverse();
  malformed.bones.find((b) => b.index === 0)!.parentIndex = 1;
  assert.throws(() => validateSolver(malformed), /parent must precede/);
  assert.throws(
    () => solvePose(profile, profile.bones, new Map([[99, false]])),
    /controls\[99\]/,
  );
  delete profile.bones[2].ik!.links[0].hinge;
  profile.bones[2].translation = [-1, 0, 0];
  near(solvePose(profile, profile.bones)[0].rotation, [0, 0, 1, 0], 1e-12);
  profile.bones[1].translation = [0, 0, 0];
  near(solvePose(profile, profile.bones)[0].rotation, [0, 0, 0, 1]);
  profile.bones[1].translation = [1, 0, 0];
  profile.bones[2].translation = [0, 2, 0];
  profile.bones[2].ik!.angle = 0.1;
  near(
    solvePose(profile, profile.bones)[0].rotation,
    [0, 0, Math.sin(0.05), Math.cos(0.05)],
    1e-12,
  );
  profile.bones[2].ik!.iterations = 0;
  near(solvePose(profile, profile.bones)[0].rotation, [0, 0, 0, 1]);
});

test("conversion validates indexed unsupported dependencies and malformed solvers; legacy preserves identities and truthful losses", async () => {
  for (const modify of [
    (m: any) => (m.bones[1].flag = 0x400),
    (m: any) => (m.bones[3].flag |= 0x1000),
    (m: any) => (m.bones[4].grant.parentIndex = 6),
    (m: any) => (m.bones[3].ik.links[0].index = 99),
    (m: any) => (m.bones[3].ik.iteration = 256),
    (m: any) => (m.bones[4].grant.ratio = NaN),
    (m: any) => (m.bones[3].ik.linkCount = 5),
    (m: any) => {
      m.bones[3].ik.links[0] = {
        index: 1,
        angleLimitation: 1,
        lowerLimitationAngle: [-1, -1, 0],
        upperLimitationAngle: [1, 1, 0],
      };
    },
  ]) {
    const model = parsePMX(solverPMX("box"));
    modify(model);
    await assert.rejects(
      convertModel(model, ".", { mode: "bdef", solver: "pre-physics-v1" }),
      /bones\[/,
    );
  }
  const legacy = await convertModel(parsePMX(solverPMX("box")), ".", {
    mode: "bdef",
  });
  assert.ok(legacy.warnings.some((w) => w.includes("unsupported")));
  assert.equal(
    (legacy.document.getRoot().getExtras().sourceSolvers as any[])[3].ik
      .effector,
    2,
  );
  const dir = await mkdtemp(join(tmpdir(), "solver-"));
  try {
    const output = join(dir, "invalid.glb");
    await assert.rejects(
      convertPMX("tests/fixtures/solver-box-bdef.pmx", output, {
        mode: "bdef",
        solver: "pre-physics-v1",
        vmd: solverVMD("a"),
        vmdSampling: { maxSamples: 1 },
      }),
      /budget/,
    );
    await assert.rejects(readFile(output), /ENOENT/);
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "tools/pmx-to-gltf.ts",
        "tests/fixtures/solver-box-bdef.pmx",
        join(dir, "valid.gltf"),
        "--mode",
        "bdef",
        "--solver",
        "pre-physics-v1",
        "--scale",
        ".2",
      ],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.ok(await readFile(join(dir, "valid.gltf")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("solver-before-BDEF/SDEF/QDEF CPU vertices, group weights, bounds and disabled/incorrect-order negative controls", async () => {
  let separation = 0,
    orderSeparation = 0;
  for (const shape of ["box", "wedge"] as const)
    for (const mode of ["bdef", "sdef", "qdef"] as const)
      for (const id of ["a", "b"] as const) {
        const converted = await convertModel(
          parsePMX(solverPMX(shape, mode)),
          ".",
          { mode, scale: 0.2, solver: "pre-physics-v1", vmd: solverVMD(id) },
        );
        const loader = new GLTFLoader()
          .register((p) => new MMDSolverPlugin(p))
          .register((p) => new MMDVMDPlugin(p))
          .register((p) => new MMDQDEFPlugin(p));
        const bytes = await converted.io.writeBinary(converted.document),
          gltf = await loader.parseAsync(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
            "",
          );
        const player = getVMDPlayers(gltf)[0];
        for (const time of [0.371, 0.5, 0.719, 1, 1.5]) {
          player.seek(time);
          gltf.scene.traverse((n) => {
            const mesh = n as SkinnedMesh;
            if (!mesh.isSkinnedMesh) return;
            for (let i = 0; i < 24; i++) {
              const expected = solverVertex(
                  shape,
                  id,
                  time < 0.5 || time >= 1,
                  i,
                  mode,
                  true,
                  false,
                  false,
                  time,
                ),
                actual = mesh.getVertexPosition(i, new Vector3());
              near(actual.toArray(), expected.p.toArray());
              assert.ok(mesh.boundingBox!.containsPoint(actual));
              assert.ok(
                mesh.boundingSphere!.center.distanceTo(actual) <=
                  mesh.boundingSphere!.radius + 2e-6,
              );
              if (time === 0.371) {
                separation = Math.max(
                  separation,
                  actual.distanceTo(
                    solverVertex(
                      shape,
                      id,
                      false,
                      i,
                      mode,
                      true,
                      false,
                      false,
                      time,
                    ).p,
                  ),
                );
                orderSeparation = Math.max(
                  orderSeparation,
                  actual.distanceTo(
                    solverVertex(
                      shape,
                      id,
                      true,
                      i,
                      mode,
                      true,
                      true,
                      false,
                      time,
                    ).p,
                  ),
                );
              }
            }
          });
        }
        const fallback = await load(bytes, false),
          mixer = new AnimationMixer(fallback.scene),
          action = mixer.clipAction(fallback.animations[0]);
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        for (const time of [0, 0.371, 0.5, 0.719, 1, 1.5, 0.371]) {
          action.reset().play();
          mixer.setTime(time);
          fallback.scene.updateMatrixWorld(true);
          fallback.scene.traverse((n) => {
            const mesh = n as SkinnedMesh;
            if (!mesh.isSkinnedMesh) return;
            mesh.skeleton.update();
            for (let i = 0; i < 24; i++)
              near(
                mesh.getVertexPosition(i, new Vector3()).toArray(),
                solverVertex(
                  shape,
                  id,
                  time < 0.5 || time >= 1,
                  i,
                  mode,
                  true,
                  false,
                  false,
                  time,
                  true,
                ).p.toArray(),
              );
          });
        }
        const rawConversion = await convertModel(
          parsePMX(solverPMX(shape, mode)),
          ".",
          { mode, scale: 0.2, vmd: solverVMD(id) },
        );
        const rawBytes = await rawConversion.io.writeBinary(
          rawConversion.document,
        );
        const rawAsset = await new GLTFLoader()
          .register((p) => new MMDVMDPlugin(p))
          .register((p) => new MMDQDEFPlugin(p))
          .parseAsync(
            rawBytes.buffer.slice(
              rawBytes.byteOffset,
              rawBytes.byteOffset + rawBytes.byteLength,
            ) as ArrayBuffer,
            "",
          );
        getVMDPlayers(rawAsset)[0].seek(0.371);
        rawAsset.scene.traverse((n) => {
          const mesh = n as SkinnedMesh;
          if (!mesh.isSkinnedMesh) return;
          for (let i = 0; i < 24; i++)
            near(
              mesh.getVertexPosition(i, new Vector3()).toArray(),
              solverVertex(
                shape,
                id,
                true,
                i,
                mode,
                true,
                true,
                false,
                0.371,
              ).p.toArray(),
            );
        });
        player.setIKEnabled(3, false);
        assert.equal(player.ikStates[3], false);
        player.setIKEnabled(3, undefined);
        assert.equal(player.ikStates[3], true);
        player.dispose();
      }
  assert.ok(separation > 0.01);
  assert.ok(orderSeparation > 0.001);
});

test("IK controls: default, name/byte binding, duplicates, unmatched, visibility, strict FLOAT seam and accuracy budgets", async () => {
  const base = await convertModel(parsePMX(solverPMX("box")), ".", {
    mode: "bdef",
    scale: 0.2,
    solver: "pre-physics-v1",
  });
  const asset = await load(await base.io.writeBinary(base.document)),
    rig = createVPDRig(asset.scene),
    model = getVPDModel(rig),
    morph = getMorphModel(createMorphRig(rig.root));
  const source = parseVMD(solverVMD("a"));
  source.displays.shift();
  const motion = bindMotion(model, source, {}, morph);
  assert.equal(evaluateIK(motion, 0).get(3), true);
  assert.equal(evaluateIK(motion, 0.5).get(3), false);
  assert.equal(evaluateIK(motion, 1).get(3), true);
  assert.equal(motion.omitted.displays, 2);
  assert.equal(motion.omitted.ik, 0);
  assert.deepEqual(motion.visibility![0].raw, source.displays[0].raw);
  const duplicated = structuredClone(source);
  duplicated.displays.push(duplicated.displays[0]);
  assert.throws(() => bindMotion(model, duplicated, {}, morph), /duplicate/);
  const repeated = structuredClone(source);
  repeated.displays[0].ik.push(repeated.displays[0].ik[0]);
  assert.throws(() => bindMotion(model, repeated, {}, morph), /duplicate/);
  const unmatched = structuredClone(source);
  unmatched.displays[0].ik[0].name = {
    ...unmatched.displays[0].ik[0].name,
    raw: [...Buffer.from("missing"), ...Array(13).fill(0)],
    key: "6d697373696e67",
    text: "missing",
  };
  assert.throws(() => bindMotion(model, unmatched, {}, morph), /unmatched/);
  assert.equal(
    bindMotion(model, unmatched, { ikUnmatched: "ignore" }, morph).omitted.ik,
    1,
  );
  const full = structuredClone(source),
    name = full.displays[0].ik[0].name;
  name.raw = Array(20).fill(65);
  name.key = "41".repeat(20);
  name.text = "A".repeat(20);
  name.terminated = false;
  assert.throws(() => bindMotion(model, full, {}, morph), /mapping/);
  assert.equal(
    bindMotion(model, full, { ikMapping: { [name.key]: 3 } }, morph).ik![0]
      .index,
    3,
  );
  const raw = solverVMD("a");
  // API-authored VMD with an unrepresentable 1/30 switch also exercises the writer.
  const input = parseVMD(raw);
  input.displays[1].frame = 1;
  const binding = bindMotion(model, input, {}, morph);
  const { addVMDAnimation } = await import("../tools/vmd-animation");
  assert.throws(
    () =>
      addVMDAnimation(
        base.document,
        base.document.getRoot().listBuffers()[0],
        binding,
        base.document
          .getRoot()
          .listNodes()
          .filter((n) => n.getExtras().pmxBone)
          .sort(
            (a, b) =>
              (a.getExtras().pmxBone as any).index -
              (b.getExtras().pmxBone as any).index,
          ),
      ),
    /switch accuracy/,
  );
  await assert.rejects(
    convertModel(parsePMX(solverPMX("box")), ".", {
      mode: "bdef",
      scale: 0.2,
      solver: "pre-physics-v1",
      vmd: raw,
      vmdSampling: { controlTimeTolerance: 1e-12 },
    }),
    /switch accuracy/,
  );
  await assert.rejects(
    convertModel(parsePMX(solverPMX("box")), ".", {
      mode: "bdef",
      scale: 0.2,
      solver: "pre-physics-v1",
      vmd: raw,
      vmdSampling: { rotationTolerance: 1e-12 },
    }),
    /accuracy/,
  );
});

test("all generated solver GLB/external-buffer glTF outputs are core-valid across skinning, rest, both motions and poses", async () => {
  for (const shape of ["box", "wedge"])
    for (const mode of ["bdef", "sdef", "qdef"])
      for (const state of ["rest", "a", "b", "pose-a", "pose-b"])
        for (const format of ["glb", "gltf"]) {
          const directory = `public/solver/${shape}-${mode}`,
            data = await readFile(`${directory}/${state}.${format}`);
          const report =
            format === "glb"
              ? await validateBytes(data)
              : await validateString(data.toString(), {
                  externalResourceFunction: (uri: string) =>
                    readFile(`${directory}/${uri}`),
                });
          assert.equal(
            report.issues.numErrors,
            0,
            `${shape}/${mode}/${state}/${format}: ${JSON.stringify(report.issues.messages)}`,
          );
        }
});

test("multiple IK controllers obey layer/index turns; PMX hinge reflection and dependency closure are explicit", async () => {
  const bone = (
    index: number,
    parentIndex: number,
    t: number[],
    ik?: any,
  ): any => ({
    index,
    parentIndex,
    name: String(index),
    translation: t,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    flags: 0,
    layer: index,
    ik,
  });
  const ik = {
    effector: 1,
    iterations: 1,
    angle: Math.PI,
    links: [{ index: 0 }],
  };
  const profile: SolverProfile = {
    version: 1,
    bones: [
      bone(0, -1, [0, 0, 0]),
      bone(1, 0, [1, 0, 0]),
      bone(2, -1, [0, 1, 0], ik),
      bone(3, -1, [1, 0, 0], ik),
    ],
  };
  near(solvePose(profile, profile.bones)[0].rotation, [0, 0, 0, 1], 1e-12);
  profile.bones[2].layer = 4;
  near(
    solvePose(profile, profile.bones)[0].rotation,
    [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    1e-12,
  );
  const model = parsePMX(solverPMX("box"));
  model.bones[3].ik!.links[0] = {
    index: 1,
    angleLimitation: 1,
    lowerLimitationAngle: [0, 0, 0],
    upperLimitationAngle: [1, 0, 0],
  };
  const converted = await convertModel(model, ".", {
    mode: "bdef",
    scale: 0.2,
    solver: "pre-physics-v1",
  });
  const skeleton = converted.document
    .getRoot()
    .listNodes()
    .find((n) => n.getExtras().mmdSolver)!;
  const p = skeleton.getExtras().mmdSolver as unknown as SolverProfile;
  assert.deepEqual(p.bones[3].ik!.links[0].hinge, { axis: 0, min: -1, max: 0 });
  const late = structuredClone(p);
  late.bones[4].layer = 0;
  assert.throws(() => validateSolver(late), /append consumer precedes IK/);
});

test("append powers retain very small input angles at large finite signed rates", () => {
  const bone = (index: number): any => ({
    index,
    parentIndex: -1,
    name: String(index),
    translation: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    flags: 0,
    layer: index,
  });
  const profile: SolverProfile = {
    version: 1,
    bones: [
      bone(0),
      {
        ...bone(1),
        append: {
          source: 0,
          rate: 1e20,
          local: false,
          rotation: true,
          translation: false,
        },
      },
    ],
  };
  const input = structuredClone(profile.bones);
  input[0].rotation = [0, 0, 1e-20, 1];
  near(
    solvePose(profile, input)[1].rotation,
    [0, 0, Math.sin(1), Math.cos(1)],
    1e-12,
  );
  profile.bones[1].append!.rate = -1e20;
  near(
    solvePose(profile, input)[1].rotation,
    [0, 0, -Math.sin(1), Math.cos(1)],
    1e-12,
  );
});

test("exact VMD loading validates the solver hierarchy even without the optional rig-inspection plugin", async () => {
  const converted = await convertModel(parsePMX(solverPMX("box")), ".", {
    mode: "bdef",
    scale: 0.2,
    solver: "pre-physics-v1",
    vmd: solverVMD("a"),
  });
  const json = JSON.parse(await jsonOutput(converted)),
    profile = json.extensions[EXTENSION_NAME];
  const root = profile.bones.find((b: any) => b.index === 0).node,
    link = profile.bones.find((b: any) => b.index === 1).node,
    tip = profile.bones.find((b: any) => b.index === 2).node;
  json.nodes[link].children = json.nodes[link].children.filter(
    (i: number) => i !== tip,
  );
  json.nodes[root].children.push(tip);
  await assert.rejects(
    new GLTFLoader()
      .register((p) => new MMDVMDPlugin(p))
      .parseAsync(JSON.stringify(json), ""),
    /hierarchy mismatch/,
  );
});

test("version 3 solver identity is independent of JSON property and bone-table order", async () => {
  const converted = await convertModel(parsePMX(solverPMX("box")), ".", {
    mode: "bdef",
    scale: 0.2,
    solver: "pre-physics-v1",
    vmd: solverVMD("a"),
  });
  const json = JSON.parse(await jsonOutput(converted)),
    payload = json.animations[0].extensions.MMD_animation_vmd;
  payload.solver.bones.reverse();
  payload.solver.bones = payload.solver.bones.map((b: object) =>
    Object.fromEntries(Object.entries(b).reverse()),
  );
  const gltf = await new GLTFLoader()
    .register((p) => new MMDVMDPlugin(p))
    .parseAsync(JSON.stringify(json), "");
  getVMDPlayers(gltf)[0].seek(0.371);
  check(snapshot(gltf.scene), solverExpected("box", "a", true, 0.2, 0.371));
});

test("pure VPD/VMD binding rejects a solver original-rest mismatch before producing output", async () => {
  const converted = await convertModel(parsePMX(solverPMX("box")), ".", {
    mode: "bdef",
    scale: 0.2,
    solver: "pre-physics-v1",
  });
  const asset = await load(await converted.io.writeBinary(converted.document)),
    rig = createVPDRig(asset.scene),
    before = snapshot(rig.root),
    model = getVPDModel(rig);
  model.solver!.bones[0].translation[0] += 0.1;
  const { bindPose } = await import("../packages/mmd-vpd");
  assert.throws(
    () => bindPose(model, parseVPD(solverVPD("a"), "utf-8")),
    /original rest differs/,
  );
  assert.throws(
    () => bindMotion(model, parseVMD(solverVMD("a"))),
    /original rest differs/,
  );
  assert.deepEqual(snapshot(rig.root), before);
});

test("BDEF solver requests reject malformed vertex layouts with source indices", async () => {
  for (const mutate of [
    (m: any) => {
      delete m.vertices[0].position[1];
    },
    (m: any) => {
      m.vertices[0].normal = [0, 1];
    },
    (m: any) => {
      m.vertices[0].uv = [NaN, 0];
    },
  ]) {
    const model = parsePMX(solverPMX("box"));
    mutate(model);
    await assert.rejects(
      convertModel(model, ".", {
        mode: "bdef",
        scale: 0.2,
        solver: "pre-physics-v1",
      }),
      /Vertex 0: invalid .* layout/,
    );
  }
});

test("hinges use original-rest axes, repair off-axis input and follow feasible paths across the angle cut", () => {
  const bone = (index: number, parentIndex: number, t: number[]): any => ({
    index,
    parentIndex,
    name: String(index),
    translation: t,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    flags: 0,
    layer: index,
  });
  const profile: SolverProfile = {
    version: 1,
    bones: [
      bone(0, -1, [0, 0, 0]),
      bone(1, 0, [1, 0, 0]),
      {
        ...bone(2, -1, [0, 1, 0]),
        ik: {
          effector: 1,
          iterations: 1,
          angle: Math.PI,
          links: [{ index: 0, hinge: { axis: 2, min: 0, max: Math.PI / 2 } }],
        },
      },
    ],
  };
  for (const rotation of [
    [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    [1, 0, 0, 0],
    [-1, 0, 0, -0],
  ] as [number, number, number, number][]) {
    const input = structuredClone(profile.bones);
    input[0].rotation = rotation;
    near(
      solvePose(profile, input)[0].rotation,
      [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      1e-12,
    );
  }
  const h = profile.bones[2].ik!.links[0].hinge!;
  h.min = -Math.PI;
  h.max = 0;
  profile.bones[2].translation = [-1, 0, 0];
  assert.ok(
    orientationError(
      solvePose(profile, profile.bones)[0].rotation,
      [0, 0, -1, 0],
    ) < 1e-7,
  );
  h.max = Math.PI;
  const desired = (-170 * Math.PI) / 180;
  profile.bones[2].translation = [Math.cos(desired), Math.sin(desired), 0];
  profile.bones[2].ik!.iterations = 40;
  profile.bones[2].ik!.angle = Math.PI / 18;
  const start = structuredClone(profile.bones);
  start[0].rotation = [
    0,
    0,
    Math.sin((170 * Math.PI) / 360),
    Math.cos((170 * Math.PI) / 360),
  ];
  assert.ok(
    orientationError(solvePose(profile, start)[0].rotation, [
      0,
      0,
      Math.sin(desired / 2),
      Math.cos(desired / 2),
    ]) < 1e-7,
  );
  // Nonidentity original rest: Z quarter turn followed by an X hinge.
  profile.bones[0].rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  profile.bones[1].translation = [0, 1, 0];
  profile.bones[2].translation = [-0.5, 0, Math.sqrt(0.75)];
  h.axis = 0;
  h.min = 0;
  h.max = Math.PI / 2;
  profile.bones[2].ik!.iterations = 1;
  profile.bones[2].ik!.angle = Math.PI / 6;
  const rotated = structuredClone(profile.bones);
  rotated[0].rotation = new Quaternion(...profile.bones[0].rotation)
    .multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6),
    )
    .toArray();
  const expected = new Quaternion(...profile.bones[0].rotation)
    .multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 3),
    )
    .toArray();
  assert.ok(
    orientationError(solvePose(profile, rotated)[0].rotation, expected) < 1e-7,
  );
});

test("limited PMX links round-trip as resolved GLB/glTF poses and constrain repeated off-axis VPD input", async () => {
  const model = parsePMX(solverPMX("box"));
  model.bones[3].ik!.links[0] = {
    index: 1,
    angleLimitation: 1,
    lowerLimitationAngle: [0, 0, 0],
    upperLimitationAngle: [0, 0, Math.PI / 4],
  };
  const converted = await convertModel(model, ".", {
    mode: "bdef",
    scale: 0.2,
    solver: "pre-physics-v1",
  });
  const pose = parseVPD(
    Buffer.from(
      `Vocaloid Pose Data file\noriginal.pmx;\n1;\nBone0{link\n0,0,0;\n${Math.SQRT1_2},0,0,${Math.SQRT1_2};\n}\n`,
    ),
    "utf-8",
  );
  for (const encoded of [
    await converted.io.writeBinary(converted.document),
    await jsonOutput(converted),
  ]) {
    const gltf = await load(encoded),
      rig = createVPDRig(gltf.scene),
      binding = bindVPD(rig, pose);
    for (const apply of [
      () => {},
      () => applyVPD(rig, binding),
      () => applyVPD(rig, binding),
      () => resetVPD(rig),
    ]) {
      apply();
      near(
        gltf.scene.getObjectByName("link")!.quaternion.toArray(),
        [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
        1e-7,
      );
      near(
        gltf.scene
          .getObjectByName("tip")!
          .getWorldPosition(new Vector3())
          .toArray(),
        [0.2 * Math.SQRT1_2, 0.2 * Math.SQRT1_2, 0],
      );
    }
  }
});

test("binary PMX 2.0/2.1 hinge limits canonicalize FLOAT pi without mutating retained source records", async () => {
  for (const mode of ["bdef", "qdef"] as const) {
    const model = parsePMX(solverPMX("box", mode, 0));
    assert.equal(
      model.bones[3].ik!.links[0].lowerLimitationAngle![0],
      -Math.fround(Math.PI),
    );
    const converted = await convertModel(model, ".", {
      mode,
      scale: 0.2,
      solver: "pre-physics-v1",
    });
    const profile = converted.document
      .getRoot()
      .listNodes()
      .find((n) => n.getExtras().mmdSolver)!
      .getExtras().mmdSolver as unknown as SolverProfile;
    assert.deepEqual(profile.bones[3].ik!.links[0].hinge, {
      axis: 0,
      min: 0,
      max: Math.PI,
    });
    assert.equal(
      (converted.document.getRoot().getExtras().sourceSolvers as any[])[3].ik
        .links[0].lowerLimitationAngle[0],
      -Math.fround(Math.PI),
    );
    model.bones[3].ik!.links[0].lowerLimitationAngle![0] = -3.2;
    assert.equal((converted.document.getRoot().getExtras().sourceSolvers as any[])[3].ik.links[0].lowerLimitationAngle[0],-Math.fround(Math.PI));
    await assert.rejects(
      convertModel(model, ".", { mode, scale: 0.2, solver: "pre-physics-v1" }),
      /invalid hinge/,
    );
  }
});
