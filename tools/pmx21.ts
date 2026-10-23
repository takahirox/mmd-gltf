/** Bounded PMX 2.1 reader. Layout follows the format-author PMX_spec.txt (see
 * docs/qdef.md). This reads the original bytes, including the mandatory tail;
 * it never rewrites a version or substitutes linear skinning for QDEF. */
import { Parser } from 'mmd-parser';
import type { PMXModel, Vertex } from './pmx-to-gltf';
export const PMX21 = Math.fround(2.1);
export function parsePMX21(bytes: Uint8Array): PMXModel {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0, section = 'header';
  const fail = (message: string): never => { throw new Error(`PMX 2.1 ${section} at byte ${offset}: ${message}`); };
  const take = (size: number) => {
    if (!Number.isSafeInteger(size) || size < 0 || size > bytes.length - offset) fail('truncated/invalid record');
    const start = offset; offset += size; return start;
  };
  const u8 = () => view.getUint8(take(1));
  const i32 = () => view.getInt32(take(4), true);
  const u16 = () => view.getUint16(take(2), true);
  const f32 = () => { const v = view.getFloat32(take(4), true); if (!Number.isFinite(v)) fail('non-finite FLOAT'); return v; };
  const vector = (n: number) => Array.from({ length: n }, f32);
  const count = () => { const n = i32(); if (n < 0 || n > bytes.length - offset) fail(`invalid count ${n}`); return n; };
  const records = <T>(name: string, read: (i: number) => T): T[] => {
    const previous = section; section = name; const n = count();
    const result = Array.from({ length: n }, (_, i) => { section = `${name}[${i}]`; return read(i); });
    section = previous; return result;
  };
  if (new TextDecoder().decode(bytes.subarray(take(4), 4)) !== 'PMX ') fail('invalid magic');
  const version = f32(); if (version !== PMX21) fail(`unsupported version ${version}`);
  if (u8() !== 8) fail('header size must be 8');
  const encoding = u8(), additionalUvNum = u8();
  if (encoding > 1 || additionalUvNum > 4) fail('invalid encoding/additional UV count');
  const widths = Array.from({ length: 6 }, u8);
  if (widths.some(w => ![1, 2, 4].includes(w))) fail('index widths must be 1, 2 or 4');
  const [vertex, texture, material, bone, morph, body] = widths;
  const decoder = new TextDecoder(encoding ? 'utf-8' : 'utf-16le', { fatal: true, ignoreBOM: true });
  const text = () => {
    const n = count(); if (!encoding && n % 2) fail('odd UTF-16LE byte length');
    const start = take(n);
    try { return decoder.decode(bytes.subarray(start, start + n)); } catch { return fail('invalid encoded text'); }
  };
  const names = () => ({ name: text(), englishName: text() });
  const index = (width: number, unsigned = false) => {
    const start = take(width);
    return width === 1 ? unsigned ? view.getUint8(start) : view.getInt8(start) : width === 2 ? unsigned ? view.getUint16(start, true) : view.getInt16(start, true) : view.getInt32(start, true);
  };
  type Target = 'vertices' | 'textures' | 'materials' | 'bones' | 'morphs' | 'rigidBodies';
  const references: { value: number; target: Target; optional: boolean; section: string }[] = [];
  const ref = (width: number, target: Target, optional = false) => {
    const value = index(width, target === 'vertices'); references.push({ value, target, optional, section }); return value;
  };
  const metadata = { format: 'pmx', coordinateSystem: 'left', version, encoding, headerSize: 8, additionalUvNum,
    vertexIndexSize: vertex, textureIndexSize: texture, materialIndexSize: material, boneIndexSize: bone, morphIndexSize: morph, rigidBodyIndexSize: body,
    modelName: text(), englishModelName: text(), comment: text(), englishComment: text(), softBodyCount: 0 };
  const vertices = records('vertices', (): Vertex => {
    const position = vector(3), normal = vector(3), uv = vector(2), auvs = Array.from({ length: additionalUvNum }, () => vector(4)), type = u8();
    if (type > 4) fail(`unsupported skinning type ${type}`);
    const skinIndices = Array.from({ length: [1, 2, 4, 2, 4][type] }, () => index(bone));
    const weight = type === 1 || type === 3 ? f32() : 1;
    const skinWeights = type === 0 ? [1] : type === 1 || type === 3 ? [weight, 1 - weight] : vector(4);
    skinIndices.forEach((value, slot) => {
      if (skinWeights[slot] < 0) fail(`negative weight slot ${slot}`);
      // Ordered SDEF endpoints remain meaningful; other inactive slots may be -1.
      references.push({ value, target: 'bones', optional: type !== 3 && skinWeights[slot] === 0, section });
    });
    const sdef = type === 3 ? { skinC: vector(3), skinR0: vector(3), skinR1: vector(3) } : {};
    return { position, normal, uv, auvs, type, skinIndices, skinWeights, ...sdef, edgeRatio: f32() };
  });
  section = 'faces'; const faceVertices = count(); if (faceVertices % 3) fail('triangle index count must be divisible by 3');
  const faces = Array.from({ length: faceVertices / 3 }, (_, i) => { section = `faces[${i}]`; return { indices: Array.from({ length: 3 }, () => ref(vertex, 'vertices')) }; });
  const textures = records('textures', text);
  const materials = records('materials', () => {
    const result = { ...names(), diffuse: vector(4), specular: vector(3), shininess: f32(), ambient: vector(3), flag: u8(), edgeColor: vector(4), edgeSize: f32(),
      textureIndex: ref(texture, 'textures', true), envTextureIndex: ref(texture, 'textures', true), envFlag: u8() };
    if (result.flag & 0xe0) fail(`unsupported 2.1 drawing flags 0x${result.flag.toString(16)}`);
    const toonFlag = u8(); if (toonFlag > 1) fail(`invalid toon flag ${toonFlag}`);
    const toonIndex = toonFlag ? u8() : ref(texture, 'textures', true);
    if (toonFlag && (toonIndex < 0 || toonIndex > 9)) fail('shared toon index out of bounds');
    const comment = text(), n = count(); if (n % 3) fail('material triangle count must be divisible by 3');
    return { ...result, toonFlag, toonIndex, comment, faceCount: n / 3 };
  });
  const bones = records('bones', () => {
    const result = { ...names(), position: vector(3), parentIndex: ref(bone, 'bones', true), transformationClass: i32(), flag: u16() };
    const flag = result.flag;
    const connection = flag & 1 ? { connectIndex: ref(bone, 'bones', true) } : { offsetPosition: vector(3) };
    const grant = flag & 0x300 ? { grant: { isLocal: !!(flag & 0x80), affectRotation: !!(flag & 0x100), affectPosition: !!(flag & 0x200), parentIndex: ref(bone, 'bones'), ratio: f32() } } : {};
    const axis = flag & 0x400 ? { fixAxis: vector(3) } : {};
    const local = flag & 0x800 ? { localXVector: vector(3), localZVector: vector(3) } : {};
    const key = flag & 0x2000 ? { key: i32() } : {};
    const ik = flag & 0x20 ? { ik: { effector: ref(bone, 'bones'), target: null, iteration: i32(), maxAngle: f32(), links: records(`${section}.ik.links`, () => {
      const index = ref(bone, 'bones'), angleLimitation = u8(); if (angleLimitation > 1) fail('invalid IK limit flag');
      return { index, angleLimitation, ...(angleLimitation ? { lowerLimitationAngle: vector(3), upperLimitationAngle: vector(3) } : {}) };
    }) } } : {};
    return { ...result, ...connection, ...grant, ...axis, ...local, ...key, ...ik };
  });
  const morphs = records('morphs', () => {
    const result = { ...names(), panel: u8(), type: u8() }, type = result.type;
    if (type > 8) fail(`unsupported ${type === 9 ? 'flip' : type === 10 ? 'impulse' : 'unknown'} morph type ${type}`);
    const elements = records(`${section}.elements`, () => {
      if (type === 0) return { index: ref(morph, 'morphs'), ratio: f32() };
      if (type === 1) return { index: ref(vertex, 'vertices'), position: vector(3) };
      if (type === 2) return { index: ref(bone, 'bones'), position: vector(3), rotation: vector(4) };
      if (type < 8) return { index: ref(vertex, 'vertices'), uv: vector(4) };
      const index = ref(material, 'materials', true), operation = u8(); if (operation > 1) fail('invalid material morph operation');
      return { index, type: operation, diffuse: vector(4), specular: vector(3), shininess: f32(), ambient: vector(3), edgeColor: vector(4), edgeSize: f32(), textureColor: vector(4), sphereTextureColor: vector(4), toonColor: vector(4) };
    });
    return { ...result, elementCount: elements.length, elements };
  });
  const frames = records('frames', () => ({ ...names(), type: u8(), elements: records(`${section}.elements`, () => {
    const target = u8(); if (target > 1) fail('invalid display target');
    return { target, index: ref(target ? morph : bone, target ? 'morphs' : 'bones') };
  }) }));
  const rigidBodies = records('rigidBodies', () => ({ ...names(), boneIndex: ref(bone, 'bones', true), groupIndex: u8(), groupTarget: u16(), shapeType: u8(),
    width: f32(), height: f32(), depth: f32(), position: vector(3), rotation: vector(3), weight: f32(), positionDamping: f32(), rotationDamping: f32(), restitution: f32(), friction: f32(), type: u8() }));
  const constraints = records('joints', () => {
    const name = names(), type = u8(); if (type !== 0) fail(`unsupported nonzero joint type ${type}`);
    return { ...name, type, rigidBodyIndex1: ref(body, 'rigidBodies', true), rigidBodyIndex2: ref(body, 'rigidBodies', true), position: vector(3), rotation: vector(3),
      translationLimitation1: vector(3), translationLimitation2: vector(3), rotationLimitation1: vector(3), rotationLimitation2: vector(3), springPosition: vector(3), springRotation: vector(3) };
  });
  section = 'softBodies'; if (i32() !== 0) fail('bounded profile requires zero soft-body count');
  if (offset !== bytes.length) fail('unexpected trailing bytes');
  const tables = { vertices, textures, materials, bones, morphs, rigidBodies };
  for (const r of references) if (!(r.optional && r.value === -1) && (r.value < 0 || r.value >= tables[r.target].length)) {
    section = r.section; fail(`invalid ${r.target} reference ${r.value} (count ${tables[r.target].length})`);
  }
  if (materials.reduce((sum, m) => sum + m.faceCount, 0) !== faces.length) { section = 'materials'; fail('face ranges do not cover triangles'); }
  const model = { metadata: { ...metadata, vertexCount: vertices.length, faceCount: faces.length, boneCount: bones.length, morphCount: morphs.length, rigidBodyCount: rigidBodies.length, constraintCount: constraints.length }, vertices, faces, textures, materials, bones, morphs, frames, rigidBodies, constraints };
  new Parser().leftToRightModel(model);
  return model;
}

/** Apply the same section exclusions to callers supplying parsed model objects. */
export function assertPMX21Profile(model: PMXModel) {
  if (model.metadata.version !== undefined && ![2, PMX21].includes(model.metadata.version)) throw new Error(`Unsupported PMX source version ${model.metadata.version}`);
  if (model.metadata.version !== PMX21) return;
  if (model.metadata.softBodyCount !== 0) throw new Error('PMX 2.1 softBodies: bounded profile requires explicit zero soft-body count');
  model.materials.forEach((m,i)=>{if(m.flag & 0xe0)throw new Error(`PMX 2.1 materials[${i}]: unsupported 2.1 drawing flags 0x${m.flag.toString(16)}`);});
  model.morphs.forEach((m,i)=>{if(!Number.isInteger(m.type)||m.type<0||m.type>8)throw new Error(`PMX 2.1 morphs[${i}]: unsupported morph type ${m.type}`);});
  model.constraints.forEach((j,i)=>{if(!j || (j as {type:number}).type!==0)throw new Error(`PMX 2.1 joints[${i}]: bounded profile requires joint type zero`);});
}
