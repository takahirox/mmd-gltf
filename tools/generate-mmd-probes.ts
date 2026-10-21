/** Newly authored PMX inputs for Issue #13. No MMD output or shared toon bytes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PNG } from 'pngjs';
import { validateBytes } from 'gltf-validator';
import { convertModel, parsePMX } from './pmx-to-gltf';

type RGB = [number, number, number];
interface Probe {
  id: string;
  diffuse: RGB; ambient: RGB; specular: RGB; exponent: number; alpha: number;
  normal: RGB; lightRGB: RGB; towardLight: RGB;
  base?: string; toon?: string; sphere?: string; sphereMode: number;
  doubleSided: boolean;
}
const gray = (v: number): RGB => [v, v, v];
const probes: Probe[] = [];
function add(id: string, changes: Partial<Probe>) {
  probes.push({ id, diffuse: gray(0.5), ambient: gray(0), specular: gray(0), exponent: 0,
    alpha: 1, normal: [0, 0, -1], lightRGB: gray(1), towardLight: [0, 0, -1],
    sphereMode: 0, doubleSided: false, ...changes });
}
for (const a of [0, 0.125, 0.25, 0.5]) {
  for (const [label, lightRGB] of Object.entries({ white: gray(1), half: gray(0.5), red: [1, 0, 0] as RGB, black: gray(0) })) {
    add(`ambient-${a}-${label}`, { diffuse: gray(0), ambient: gray(a), lightRGB });
  }
}
for (const dot of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
  const normal: RGB = [Math.sqrt(1 - dot * dot), 0, -dot];
  for (const toon of [undefined, 'white.png', 'ramp.png']) {
    add(`normal-${dot}-${toon ?? 'no-toon'}`, { normal, toon, doubleSided: true });
  }
}
for (const base of [undefined, 'black.png', 'gray.png', 'white.png', 'color.png', 'alpha.png']) {
  add(`base-${base ?? 'absent'}`, { base });
  add(`ambient-base-${base ?? 'absent'}`, { base, diffuse: gray(0), ambient: gray(0.25) });
}
add('initial-clamp', { diffuse: gray(0.8), ambient: gray(0.4), base: 'gray.png' });
add('colored-light', { diffuse: [0.4, 0.2, 0.6], ambient: [0.1, 0.2, 0.05], lightRGB: [0.5, 1, 0.25] });
for (const exponent of [0, 0.1, 1, 8, 32]) {
  add(`specular-${exponent}`, { diffuse: gray(0), specular: [0.2, 0.3, 0.4], exponent });
  add(`specular-angle-${exponent}`, { diffuse: gray(0), specular: gray(0.4), exponent,
    towardLight: [Math.SQRT1_2, 0, -Math.SQRT1_2] });
}
for (const sphereMode of [1, 2, 3]) {
  add(`sphere-${sphereMode}`, { sphereMode, sphere: 'color.png', base: 'gray.png', toon: 'ramp.png',
    specular: [0.2, 0.3, 0.4], exponent: 8 });
}
for (const alpha of [0, 0.25, 0.5, 1]) {
  add(`alpha-${alpha}`, { alpha });
  add(`alpha-texture-${alpha}`, { alpha, base: 'alpha.png' });
}
add('back-normal-single', { normal: [0, 0, 1] });
add('back-normal-double', { normal: [0, 0, 1], doubleSided: true });

// PMX 2.0, UTF-16LE, one-byte indices, one static BDEF1 root. Geometry faces -Z
// in PMX coordinates; Additional UV1 is constant to isolate subtexture sampling.
function pmx(probe: Probe) {
  const chunks: Buffer[] = [];
  const u8 = (v: number) => chunks.push(Buffer.from([v & 255]));
  const i32 = (v: number) => { const b = Buffer.alloc(4); b.writeInt32LE(v); chunks.push(b); };
  const f32 = (v: number) => { const b = Buffer.alloc(4); b.writeFloatLE(v); chunks.push(b); };
  const floats = (v: number[]) => v.forEach(f32);
  const str = (v: string) => { const b = Buffer.from(v, 'utf16le'); i32(b.length); chunks.push(b); };
  chunks.push(Buffer.from('PMX ')); f32(2); u8(8);
  [0, 1, 1, 1, 1, 1, 1, 1].forEach(u8);
  [probe.id, probe.id, 'New synthetic material probe; no original MMD measurements.', 'Issue #13'].forEach(str);
  i32(4);
  for (const [x, y] of [[-5, 5], [-5, 15], [5, 15], [5, 5]]) {
    floats([x, y, 0]); floats(probe.normal); floats([(x + 5) / 10, (15 - y) / 10]);
    floats([0.25, 0.75, 0, 0]); u8(0); u8(0); f32(0);
  }
  i32(6); [0, 1, 2, 0, 2, 3].forEach(u8);
  const textures = [...new Set([probe.base, probe.toon, probe.sphere].filter((s): s is string => !!s))];
  const index = (s?: string) => s ? textures.indexOf(s) : -1;
  i32(textures.length); textures.forEach(str);
  i32(1); str(probe.id); str(probe.id);
  floats([...probe.diffuse, probe.alpha]); floats(probe.specular); f32(probe.exponent); floats(probe.ambient);
  u8(probe.doubleSided ? 1 : 0); floats([0, 0, 0, 0]); f32(0);
  u8(index(probe.base)); u8(index(probe.sphere)); u8(probe.sphereMode);
  u8(0); u8(index(probe.toon)); str(''); i32(6);
  i32(1); str('root'); str('root'); floats([0, 0, 0]); u8(-1); i32(0);
  chunks.push(Buffer.from([0, 0])); floats([0, 1, 0]); // bone flags, tail offset
  i32(0); // morphs
  i32(1); str('Root'); str('Root'); u8(1); i32(1); u8(0); u8(0); // display frame
  i32(0); i32(0); // rigid bodies, joints
  return Buffer.concat(chunks);
}

const directory = resolve('.cache/mmd-reference');
await mkdir(directory, { recursive: true });
const textures: Record<string, number[][]> = {
  'black.png': [[0, 0, 0, 255]], 'gray.png': [[128, 128, 128, 255]],
  'white.png': [[255, 255, 255, 255]], 'color.png': [[64, 128, 192, 128]],
  'alpha.png': [[255, 255, 255, 128]],
  'ramp.png': [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]],
};
const hashes: Record<string, string> = {};
async function save(name: string, bytes: Uint8Array) {
  await writeFile(join(directory, name), bytes);
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
}
for (const [name, pixels] of Object.entries(textures)) {
  const image = new PNG({ width: 1, height: pixels.length });
  image.data.set(pixels.flat()); await save(name, PNG.sync.write(image));
}
for (const probe of probes) {
  const bytes = pmx(probe);
  const parsed = parsePMX(bytes);
  assert.equal(parsed.vertices.length, 4); assert.equal(parsed.faces.length, 2);
  assert.equal(parsed.bones.length, 1); assert.equal(parsed.materials[0].toonIndex, probe.toon ? parsed.textures.indexOf(probe.toon) : -1);
  assert.equal(parsed.materials[0].envFlag, probe.sphereMode);
  for (const field of ['diffuse', 'ambient', 'specular'] as const) {
    const expected = field === 'diffuse' ? [...probe.diffuse, probe.alpha] : probe[field];
    parsed.materials[0][field].forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6));
  }
  const converted = await convertModel(parsed, directory, 1);
  const glb = await converted.io.writeBinary(converted.document);
  const validation = await validateBytes(glb);
  assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues.messages));
  await save(`${probe.id}.pmx`, bytes); await save(`${probe.id}.glb`, glb);
}
await writeFile(join(directory, 'manifest.json'), JSON.stringify({
  status: 'uncaptured', coordinateSystem: 'PMX left-handed; GLB reflects Z and winding',
  camera: { position: [0, 10, -30], target: [0, 10, 0], note: 'Requested setup, not observed MMD defaults; reflect Z for GLB.' },
  backgrounds: [[0, 0, 0], [1, 1, 1]], textures, probes, sha256: hashes,
  originalMMD: { build: null, platform: null, settings: null, captures: null, measurements: null },
}, null, 2) + '\n');
console.log(`Generated ${probes.length} PMX/GLB pairs and six synthetic PNGs in ${directory}; parsed every PMX and validated every GLB (zero errors). No MMD captures or expected pixels exist.`);
