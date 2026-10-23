import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { validateBytes, validateString } from 'gltf-validator';
import { AnimationMixer, Group, LoopOnce, Vector3, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  parseVMD,
  byteName,
  bindMotion,
  evaluateMotion,
  bezier,
  evaluateTrack,
  slerp,
} from '../packages/mmd-vmd';
import { EXTENSION_NAME, validatePayload } from '../packages/mmd-vmd/payload';
import { MMDVMDPlugin, getVMDPlayers, bindVMD, createVMDPlayer } from '../packages/three-mmd-vmd';
import { createVPDRig, getVPDModel, bindVPD, parseVPD, applyVPD, resetVPD } from '../packages/three-mmd-vpd';
import { convertModel, parsePMX, convertPMX } from '../tools/pmx-to-gltf';
import { syntheticVMD, motionMappings } from '../tools/synthetic-vmd';
import { sampleTrack, orientationError } from '../tools/vmd-animation';
import { scalarLocal, scalarPosition, weight, type MotionCase } from './vmd-oracle';
import { rigScale, type RigCase } from './vpd-oracle';
// Node has fetch but no browser ProgressEvent, used for unpacked data-URI reload.
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  lengthComputable = false;
  loaded = 0;
  total = 0;
  constructor(type: string, init: any = {}) {
    super(type);
    Object.assign(this, init);
  }
} as any;
const bytes = (name: string) => readFile(`tests/fixtures/${name}`);
const near = (a: number[], b: number[], tolerance: number) =>
  a.forEach((v, i) =>
    assert.ok(
      Math.abs(v - b[i]) <= tolerance,
      `${a} != ${b}, error ${Math.abs(v - b[i])}, tolerance ${tolerance}`,
    ),
  );
const load = (data: Uint8Array | string, exact = false) =>
  new GLTFLoader()
    .register((p) => (exact ? new MMDVMDPlugin(p) : { name: 'test-no-extension' }))
    .parseAsync(
      typeof data === 'string'
        ? data
        : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer),
      '',
    );
async function loadFile(path: string, exact = false) {
  const json = JSON.parse(await readFile(path, 'utf8'));
  for (const b of json.buffers ?? [])
    b.uri = `data:application/octet-stream;base64,${(await readFile(join(path, '..', b.uri))).toString('base64')}`;
  return load(JSON.stringify(json), exact);
}
const snapshot = (root: Object3D) => {
  const out: any[] = [];
  root.traverse((n) => {
    if (n.userData.pmxBone)
      out[n.userData.pmxBone.index] = [n.position.toArray(), n.quaternion.toArray(), n.scale.toArray()];
  });
  return out;
};
async function base(rig: RigCase = 'box') {
  const result = await convertModel(
    parsePMX(await bytes(rig === 'box' ? 'bdef.pmx' : 'vpd-wedge.pmx')),
    '.',
    { mode: 'bdef', scale: rigScale[rig] },
  );
  const gltf = await load(await result.io.writeBinary(result.document));
  return { result, gltf, rig: createVPDRig(gltf.scene) };
}

test('bounded VMD reader: every section, fixed byte names, boundary EOF, malformed counts/truncation/nonfinite/header/curves/quaternions', async () => {
  const data = await bytes('motion-a.vmd');
  assert.deepEqual(data, syntheticVMD('a'));
  assert.deepEqual(await bytes('motion-b.vmd'), syntheticVMD('b'));
  const v = parseVMD(data);
  assert.equal(v.bones.length, 7);
  assert.equal(v.morphs[0].weight, 0.5);
  assert.equal(v.cameras[0].raw.length, 61);
  assert.equal(v.lights[0].raw.length, 28);
  assert.equal(v.shadows[0].mode, 2);
  assert.equal(v.displays[0].ik[0].enabled, 0);
  assert.equal(v.bones[0].interpolation[63], 0xab);
  const japanese = v.bones.find((b) => b.name.raw[0] === 0x93)!.name;
  assert.ok(japanese.text!.startsWith('同名.骨'));
  assert.equal(japanese.terminated, false);
  assert.equal(japanese.raw.length, 15);
  const boundaries = [
    54 + 7 * 111,
    54 + 7 * 111 + 27,
    54 + 7 * 111 + 27 + 65,
    54 + 7 * 111 + 27 + 65 + 32,
    54 + 7 * 111 + 27 + 65 + 32 + 13,
    data.length,
  ];
  for (const end of boundaries) assert.doesNotThrow(() => parseVMD(data.subarray(0, end)));
  // Every non-boundary cut is rejected; no permissive partial-record recovery.
  for (let end = 0; end < data.length; end++)
    if (!boundaries.includes(end)) assert.throws(() => parseVMD(data.subarray(0, end)), /VMD/);
  for (const offset of [
    50,
    boundaries[0],
    boundaries[1],
    boundaries[2],
    boundaries[3],
    boundaries[4],
    boundaries[4] + 9,
  ]) {
    const corrupt = Buffer.from(data);
    corrupt.writeUInt32LE(0xffffffff, offset);
    assert.throws(() => parseVMD(corrupt), /count|remaining/);
  }
  for (const offset of [
    54 + 19,
    boundaries[0] + 4 + 19,
    boundaries[1] + 4 + 4,
    boundaries[2] + 4 + 4,
    boundaries[3] + 4 + 5,
  ]) {
    const corrupt = Buffer.from(data);
    corrupt.writeFloatLE(NaN, offset);
    assert.throws(() => parseVMD(corrupt), /nonfinite/);
  }
  for (const mutation of [
    (b: Buffer) => b.write('0001', 20),
    (b: Buffer) => b.fill(0, 54 + 31, 54 + 47),
    (b: Buffer) => {
      b[54 + 47] = 128;
    },
    (b: Buffer) => {
      b[29] = 1;
    },
  ]) {
    const b = Buffer.from(data);
    mutation(b);
    assert.throws(() => parseVMD(b), /header|version|quaternion|Bezier/);
  }
  assert.throws(() => parseVMD(Buffer.concat([data, Buffer.from([0])])), /trailing/);
  assert.equal(byteName([0x82, 0, ...Array(13).fill(0)]).text, null);
  assert.equal(byteName([...Buffer.from('123456789012345')]).terminated, false);
});

test('VMD binding: exact byte identity, explicit ambiguous/truncated/invalid names, collisions, unmatched, sorting and duplicate rejection', async () => {
  const { rig } = await base(),
    model = getVPDModel(rig),
    vmd = parseVMD(await bytes('motion-a.vmd'));
  const binding = bindMotion(model, vmd, { mapping: motionMappings.a });
  assert.equal(binding.tracks.length, 3);
  assert.deepEqual(
    binding.tracks[1].keys.map((k) => k.frame),
    [6, 7, 30],
  );
  assert.deepEqual(binding.omitted, { morphs: 1, cameras: 1, lights: 1, shadows: 1, displays: 1, ik: 1 });
  for (const options of [
    {},
    { mapping: { missing: 1 } },
    { mapping: { ...motionMappings.a, [Object.keys(motionMappings.a)[0]]: -1 } },
    { mapping: { ...motionMappings.a, [Object.keys(motionMappings.a)[0]]: 1 } },
    { mapping: [] as any },
    { unmatched: 'bad' as any },
  ])
    assert.throws(() => bindMotion(model, vmd, options), /VMD/);
  const one = structuredClone(vmd);
  one.bones = [one.bones.find((b) => b.name.text === 'bone 1')!];
  one.bones[0].name = byteName([...Buffer.from([0x82]), ...Array(14).fill(0)]);
  assert.throws(() => bindMotion(model, one), /undecodable/);
  assert.equal(bindMotion(model, one, { mapping: { '82': 1 } }).tracks.length, 1);
  one.bones[0].name = byteName([...Buffer.from('missing'), ...Array(8).fill(0)]);
  assert.throws(() => bindMotion(model, one), /unmatched/);
  assert.equal(bindMotion(model, one, { unmatched: 'ignore' }).unmatched.length, 1);
  one.bones[0].name = byteName([...Buffer.from('bone 1'), ...Array(9).fill(0)]);
  const japaneseModel = structuredClone(model);
  japaneseModel.bones.find(b=>b.index===1)!.name = '同名.骨';
  one.bones[0].name = byteName([0x93,0xaf,0x96,0xbc,0x2e,0x8d,0x9c,...Array(8).fill(0)]);
  assert.equal(bindMotion(japaneseModel,one).tracks[0].index,1);
  one.bones[0].name=byteName([...Buffer.from('bone 1'),...Array(9).fill(0)]);
  const duplicateModel = structuredClone(model);
  duplicateModel.bones.find(b=>b.index===2)!.name = 'bone 1';
  assert.throws(() => bindMotion(duplicateModel, one), /ambiguous/);
  const duplicate = structuredClone(vmd);
  duplicate.bones.push(structuredClone(duplicate.bones[0]));
  assert.throws(() => bindMotion(model, duplicate, { mapping: motionMappings.a }), /duplicate frame/);
  // Two source names with the same 15-byte prefix are one byte track. A colliding frame is rejected.
  const collision = structuredClone(one);
  collision.bones[0].name = byteName([...Buffer.from('123456789012345')]);
  collision.bones.push(structuredClone(collision.bones[0]));
  assert.throws(
    () => bindMotion(model, collision, { mapping: { [collision.bones[0].name.key]: 1 } }),
    /duplicate frame/,
  );
  const overflow = structuredClone(vmd);
  overflow.bones[0].translation[0] = 1e308;
  assert.throws(() => bindMotion(model, overflow, { mapping: motionMappings.a }), /numeric range/);
  const invalid = structuredClone(vmd);
  invalid.bones[0].rotation = [0, 0, 0, 0];
  assert.throws(() => bindMotion(model, invalid, { mapping: motionMappings.a }), /quaternion/);
});

test('continuous destination curves, adjacent frames, clamping, nonidentity rest and sign equivalence against independent scalar oracle', async () => {
  const { rig } = await base(),
    model = getVPDModel(rig);
  const binding = bindMotion(model, parseVMD(await bytes('motion-a.vmd')), { mapping: motionMappings.a });
  for (let axis = 0; axis < 4; axis++)
    for (let step = 0; step <= 100; step++)
      near(
        [
          bezier(
            [
              [20, 5, 100, 120],
              [50, 100, 90, 10],
              [10, 110, 110, 30],
              [35, 0, 90, 127],
            ][axis] as any,
            step / 100,
          ),
        ],
        [weight(axis, step / 100)],
        2e-13,
      );
  for (const time of [-2, 0, 0.1, 0.2, 6.5 / 30, 7 / 30, 0.45, 0.999, 1, 5]) {
    for (const b of evaluateMotion(binding, time)) {
      const expected = scalarLocal('box', 'a', b.index, time);
      near(b.translation, expected.translation, 4e-9);
      assert.ok(orientationError(b.rotation, expected.rotation as any) < 1e-7);
    }
  }
  const t = structuredClone(binding.tracks.find((t) => t.index === 1)!);
  t.keys = t.keys.slice(0, 1);
  near(evaluateTrack(t, 100).translation, t.keys[0].translation, 0);
  const destination = structuredClone(binding.tracks.find(t=>t.index===1)!);
  destination.keys[0].curves = Array.from({length:4},()=>[0,0,127,127]) as any;
  const mid = evaluateTrack(destination,6.5/30);
  const expectedMid = scalarLocal('box','a',1,6.5/30);
  near(mid.translation,expectedMid.translation,4e-9);
  assert.ok(orientationError(mid.rotation,expectedMid.rotation as any)<1e-7);
  const signs = structuredClone(binding);
  for (const t of signs.tracks) for (const k of t.keys) k.rotation = k.rotation.map((v) => -v) as any;
  for (const time of [0, 6.5 / 30, 0.531, 1]) {
    const a = evaluateMotion(binding, time),
      b = evaluateMotion(signs, time);
    a.forEach((v, i) => assert.ok(orientationError(v.rotation, b[i].rotation) < 1e-7));
  }
  const nonidentity = structuredClone(model);
  nonidentity.bones.find((b) => b.index === 1)!.rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const composed = bindMotion(nonidentity, parseVMD(await bytes('motion-a.vmd')), {
    mapping: motionMappings.a,
  });
  const q = evaluateMotion(composed, 1).find((b) => b.index === 1)!.rotation;
  near(
    q,
    [
      -Math.sin(0.45) * Math.SQRT1_2,
      -Math.sin(0.45) * Math.SQRT1_2,
      Math.cos(0.45) * Math.SQRT1_2,
      Math.cos(0.45) * Math.SQRT1_2,
    ],
    2e-8,
  );
  assert.throws(() => evaluateMotion(binding, NaN), /finite/);
});

test('reusable lifecycle: instance isolation, atomic failures, VPD handoff, history-independent seek, pause/loop/stop/dispose', async () => {
  const a = await base(),
    b = await base(),
    motion = parseVMD(await bytes('motion-a.vmd')),
    binding = bindVMD(a.rig, motion, { mapping: motionMappings.a });
  const player = createVMDPlayer(a.rig, binding),
    otherSnapshot = snapshot(b.gltf.scene),
    rest = snapshot(a.gltf.scene);
  assert.throws(() => createVMDPlayer(b.rig, binding), /different model instance/);
  player.seek(0.341);
  const desired = snapshot(a.gltf.scene);
  player.seek(0.7).seek(0).seek(0.341);
  assert.deepEqual(snapshot(a.gltf.scene), desired);
  player.play().update(0.01).pause();
  const paused = snapshot(a.gltf.scene);
  player.update(10);
  assert.deepEqual(snapshot(a.gltf.scene), paused);
  for (const action of [
    () => player.seek(NaN),
    () => player.update(-1),
    () => bindVMD(a.rig, motion),
    () => bindVMD(a.rig, { ...motion, bones: [{ ...motion.bones[0], rotation: [0, 0, 0, 0] }] }),
  ]) {
    assert.throws(action);
    assert.deepEqual(snapshot(a.gltf.scene), paused);
  }
  const wrapper = new Group().add(a.gltf.scene);
  const alternateHandle = createVPDRig(wrapper);
  player.play();
  resetVPD(alternateHandle);
  assert.equal(player.playing, false, 'wrapper handles share the same model owner');
  player.seek(0.341);
  assert.deepEqual(snapshot(a.gltf.scene), desired);
  player.loop = true;
  player.seek(0.9).play().update(0.25);
  near([player.time], [0.15], 1e-14);
  assert.equal(player.playing, true);
  player.loop = false;
  player.update(2);
  assert.equal(player.time, 1);
  assert.equal(player.playing, false);
  player.play();
  applyVPD(a.rig, bindVPD(a.rig, parseVPD(await bytes('pose-b.vpd'), 'utf-8'), { mapping: { '0': 259 } }));
  assert.equal(player.playing, false);
  player.seek(0.341);
  assert.deepEqual(snapshot(a.gltf.scene), desired);
  const next = createVMDPlayer(
    a.rig,
    bindVMD(a.rig, parseVMD(await bytes('motion-b.vmd')), { mapping: motionMappings.b }),
  );
  player.play();
  next.seek(0.3);
  assert.equal(player.playing, false);
  next.stop();
  assert.deepEqual(snapshot(a.gltf.scene), rest);
  player.reset();
  assert.deepEqual(snapshot(a.gltf.scene), rest);
  assert.deepEqual(snapshot(b.gltf.scene), otherSnapshot);
  resetVPD(a.rig);
  next.dispose();
  next.dispose();
  assert.throws(() => next.seek(0), /disposed/);
  player.dispose();
});

test('extension schema/semantic fixtures and fallback representability guards', async () => {
  const valid = JSON.parse(await readFile('extensions/MMD_animation_vmd/tests/valid.json', 'utf8')),
    invalid = JSON.parse(await readFile('extensions/MMD_animation_vmd/tests/invalid.json', 'utf8'));
  const schema = JSON.parse(
    await readFile('extensions/MMD_animation_vmd/schema/animation.MMD_animation_vmd.schema.json', 'utf8'),
  );
  const validate = new Ajv({ strict: false }).compile(schema);
  assert.equal(validate(valid), true);
  validatePayload(valid, 1);
  invalid.forEach((p: unknown) => assert.throws(() => validatePayload(p, 1), /invalid payload/));
  assert.ok(invalid.some((p: unknown) => !validate(p)));
  for (const mutate of [
    (p: any) => {
      p.tracks[0].keys[1].frame = 6;
    },
    (p: any) => {
      p.rest.push(p.rest[0]);
    },
    (p: any) => {
      p.tracks.push(p.tracks[0]);
    },
    (p: any) => {
      p.rest[0].translation[0] = Infinity;
    },
    (p: any) => {
      p.rest[0].node = 2;
    },
  ]) {
    const p = structuredClone(valid);
    mutate(p);
    assert.throws(() => validatePayload(p, 1));
  }
  const exampleText=await readFile('extensions/MMD_animation_vmd/examples/bone-curve.gltf','utf8');
  const report=await validateString(exampleText);
  assert.equal(report.issues.numErrors,0,JSON.stringify(report.issues.messages));
  const example=await load(exampleText,true);
  getVMDPlayers(example)[0].seek(0.5);
  const joint=example.scene.getObjectByName('Animated_joint')!;
  near(joint.position.toArray(),[0.1*weight(0,0.375),1,0],1e-12);
  getVMDPlayers(example)[0].dispose();
  const track = { index: 0, keys: valid.tracks[0].keys };
  for (const options of [
    { maxSamples: 1 },
    { maxSamples: 200001 },
    { translationTolerance: 0 },
    { rotationTolerance: NaN },
    { translationTolerance: 1e-30 },
  ])
    assert.throws(() => sampleTrack(track, options), /VMD/);
  const big = structuredClone(track);
  big.keys[0].frame = 0xfffffffe;
  big.keys[1].frame = 0xffffffff;
  assert.throws(() => sampleTrack(big), /FLOAT/);
});

test('two motions × two rigs: byte playback + exact GLB/glTF reload, independent skin oracle, measured fallback grid, validator and deterministic CLI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mmd-vmd-'));
  try {
    // Declared before measurement: exact position 2e-6 m; rotation 1e-7 rad.
    // Fallback local translation 1e-5 m; orientation 1e-4 rad, keys + 1201-point grid.
    for (const rigCase of ['box', 'wedge'] as RigCase[])
      for (const motionCase of ['a', 'b'] as MotionCase[]) {
        const source = rigCase === 'box' ? 'bdef.pmx' : 'vpd-wedge.pmx',
          options = {
            mode: 'bdef' as const,
            scale: rigScale[rigCase],
            vmd: await bytes(`motion-${motionCase}.vmd`),
            vmdBinding: { mapping: motionMappings[motionCase] },
          };
        const result = await convertModel(parsePMX(await bytes(source)), '.', options),
          binary = await result.io.writeBinary(result.document),
          again = await convertModel(parsePMX(await bytes(source)), '.', options);
        assert.deepEqual(binary, await again.io.writeBinary(again.document));
        assert.equal((await validateBytes(binary)).issues.numErrors, 0);
        const output = join(directory, `${rigCase}-${motionCase}.gltf`);
        await convertPMX(`tests/fixtures/${source}`, output, options);
        const validation = await validateString(await readFile(output, 'utf8'), {
          externalResourceFunction: (uri: string) => readFile(join(directory, uri)),
        });
        assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues.messages));
        const direct = await base(rigCase),
          player = createVMDPlayer(
            direct.rig,
            bindVMD(direct.rig, parseVMD(options.vmd), options.vmdBinding),
          );
        const glb = await load(binary, true),
          gltf = await loadFile(output, true);
        const fallback = await load(binary),
          mixer = new AnimationMixer(fallback.scene),
          action = mixer.clipAction(fallback.animations[0]);
        action.play();
        assert.ok(fallback.animations[0].tracks.length > 0);
        assert.equal(glb.animations[0].tracks.length, 0);
        assert.equal(gltf.animations[0].tracks.length, 0);
        let maximumPositionError = 0,
          maximumRotationError = 0,
          maximumFallbackTranslationError = 0,
          maximumFallbackRotationError = 0;
        const duration = player.duration,
          keyTimes = Array.from(new Set(parseVMD(options.vmd).bones.map((k) => k.frame / 30)));
        const exactTimes = [0, ...keyTimes, 6.5 / 30, 0.371, 0.719, duration];
        for (const [asset, p] of [
          [direct.gltf, player],
          [glb, getVMDPlayers(glb)[0]],
          [gltf, getVMDPlayers(gltf)[0]],
        ] as const) {
          for (const time of exactTimes) {
            p.seek(time);
            asset.scene.traverse((n) => {
              if (n.userData.pmxBone) {
                const expected = scalarLocal(rigCase, motionCase, n.userData.pmxBone.index, time);
                near(n.position.toArray(), expected.translation, 2e-6);
                maximumRotationError = Math.max(
                  maximumRotationError,
                  orientationError(n.quaternion.toArray(), expected.rotation as any),
                );
              }
              const mesh = n as SkinnedMesh;
              if (!mesh.isSkinnedMesh) return;
              const positions = mesh.geometry.getAttribute('position');
              for (let i = 0; i < positions.count; i++) {
                const actual = mesh.getVertexPosition(i, new Vector3()).toArray(),
                  expected = scalarPosition(rigCase, motionCase, i, time, [
                    positions.getX(i),
                    positions.getY(i),
                    positions.getZ(i),
                  ]);
                maximumPositionError = Math.max(
                  maximumPositionError,
                  ...actual.map((v, j) => Math.abs(v - expected[j])),
                );
              }
            });
          }
          p.stop();
          assert.deepEqual(snapshot(asset.scene), snapshot((await base(rigCase)).gltf.scene));
          p.dispose();
        }
        for (const time of [...keyTimes, ...Array.from({ length: 1201 }, (_, i) => (duration * i) / 1200)]) {
          // At duration the mixer wraps by default; evaluate just before and explicitly clamp the action.
          action.setLoop(LoopOnce, 1);
          action.clampWhenFinished = true;
          action.paused = false;
          action.enabled = true;
          mixer.setTime(time);
          fallback.scene.traverse((n) => {
            if (!n.userData.pmxBone) return;
            const expected = scalarLocal(rigCase, motionCase, n.userData.pmxBone.index, time);
            maximumFallbackTranslationError = Math.max(
              maximumFallbackTranslationError,
              Math.hypot(...n.position.toArray().map((v, j) => v - expected.translation[j])),
            );
            maximumFallbackRotationError = Math.max(
              maximumFallbackRotationError,
              orientationError(n.quaternion.toArray(), expected.rotation as any),
            );
          });
        }
        assert.ok(maximumPositionError <= 2e-6, `exact skin ${maximumPositionError}`);
        assert.ok(maximumRotationError <= 1e-7, `exact rotation ${maximumRotationError}`);
        assert.ok(
          maximumFallbackTranslationError <= 1e-5,
          `fallback translation ${maximumFallbackTranslationError}`,
        );
        assert.ok(maximumFallbackRotationError <= 1e-4, `fallback rotation ${maximumFallbackRotationError}`);
        console.log(
          'VMD evidence:',
          JSON.stringify({
            rig: rigCase,
            motion: motionCase,
            maximumPositionError,
            maximumRotationError,
            maximumFallbackTranslationError,
            maximumFallbackRotationError,
            fallbackGrid: 1201,
            exactPaths: 3,
          }),
        );
        const cli = spawnSync(
          process.execPath,
          [
            'node_modules/tsx/dist/cli.mjs',
            'tools/pmx-to-gltf.ts',
            `tests/fixtures/${source}`,
            join(directory, 'cli.glb'),
            '--mode',
            'bdef',
            '--scale',
            String(options.scale),
            '--vmd',
            `tests/fixtures/motion-${motionCase}.vmd`,
            '--vmd-map',
            `tests/fixtures/motion-${motionCase}-map.json`,
          ],
          { encoding: 'utf8' },
        );
        assert.equal(cli.status, 0, cli.stderr);
        assert.deepEqual(await readFile(join(directory, 'cli.glb')), Buffer.from(binary));
        const root = JSON.parse(await readFile(output, 'utf8'));
        assert.ok(root.extensionsUsed.includes(EXTENSION_NAME));
        assert.ok(!root.extensionsRequired?.includes(EXTENSION_NAME));
        assert.ok(result.warnings.some((w) => w.includes('Omitted execution counts')));
        const baseModel = await base(rigCase);
        assert.deepEqual(
          result.document.getRoot().listSkins()[0].getInverseBindMatrices()!.getArray(),
          baseModel.result.document.getRoot().listSkins()[0].getInverseBindMatrices()!.getArray(),
        );
        const bad = structuredClone(root);
        bad.animations[0].channels.pop();
        await assert.rejects(load(JSON.stringify(bad), true), /missing corresponding/);
      }
    const model = parsePMX(await bytes('bdef.pmx'));
    await assert.rejects(
      convertModel(model, '.', { vmd: await bytes('motion-a.vmd') }),
      /requires mode bdef/,
    );
    await assert.rejects(
      convertModel(model, '.', {
        mode: 'bdef',
        vmd: await bytes('motion-a.vmd'),
        vpd: await bytes('pose-a.vpd'),
      }),
      /Simultaneous/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
