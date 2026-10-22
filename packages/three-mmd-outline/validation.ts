import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { EDGE_ATTRIBUTE, EXTENSION_NAME, validatePayload } from './payload';
const fail = (context: string, message: string): never => { throw new Error(`${EXTENSION_NAME}: ${context}: ${message}`); };
const integer = (x: unknown, min = 0): x is number => Number.isSafeInteger(x) && (x as number) >= min;

/** Check raw bounds/sparse ordering before GLTFLoader can truncate or overwrite data. */
export async function decodeAccessor(parser: Pick<GLTFParser, 'json' | 'getDependency'>, index: number, type: 'SCALAR' | 'VEC3' | 'VEC4', components = [5126], label = 'accessor', allowNormalized = false) {
  const json = parser.json;
  const a = json.accessors?.[index];
  if (!integer(index) || !a) fail(label, 'accessor index');
  if (a.type !== type) fail(label, `${type} required`);
  if (!components.includes(a.componentType)) fail(label, components.length === 1 ? 'FLOAT required' : 'invalid component type');
  if (a.normalized !== undefined && typeof a.normalized !== 'boolean') fail(label, 'normalized must be boolean');
  if (a.componentType === 5126 && a.normalized === true) fail(label, 'normalized FLOAT forbidden');
  if (!allowNormalized && a.normalized !== undefined && a.normalized !== false) fail(label, 'normalized forbidden');
  if (!integer(a.count, 1)) fail(label, 'count must be positive');
  const n = type === 'SCALAR' ? 1 : type === 'VEC3' ? 3 : 4;
  const size = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
  const read = (v: DataView, offset: number, component: number) => component === 5126 ? v.getFloat32(offset, true) : component === 5121 ? v.getUint8(offset) : component === 5123 ? v.getUint16(offset, true) : v.getUint32(offset, true);
  async function view(index: number, offset: number, bytes: number, alignment: number, allowStride = false) {
    const b = json.bufferViews?.[index];
    if (!integer(index) || !b || !integer(b.buffer) || !json.buffers?.[b.buffer]) fail(label, 'bufferView reference');
    const start = b.byteOffset ?? 0;
    if (!integer(start) || !integer(b.byteLength, 1) || !integer(offset) || (start + offset) % alignment || offset % alignment) fail(label, 'buffer bounds/alignment');
    if (!allowStride && b.byteStride !== undefined) fail(label, 'sparse/index byteStride forbidden');
    const buffer: ArrayBuffer = await parser.getDependency('buffer', b.buffer);
    if (!integer(json.buffers[b.buffer].byteLength, 1) || start + b.byteLength > Math.min(buffer.byteLength, json.buffers[b.buffer].byteLength) || offset + bytes > b.byteLength) fail(label, 'buffer bounds');
    return new DataView(buffer, start, b.byteLength);
  }
  const values = new Array<number>(a.count * n).fill(0);
  if (a.bufferView !== undefined) {
    if (type === 'SCALAR' && !components.includes(5126) && json.bufferViews?.[a.bufferView]?.byteStride !== undefined) fail(label, 'index byteStride forbidden');
    const stride = json.bufferViews?.[a.bufferView]?.byteStride ?? n * size;
    if (!integer(stride, n * size) || stride % size || (json.bufferViews?.[a.bufferView]?.byteStride !== undefined && (stride % 4 || stride > 252))) fail(label, 'invalid byteStride');
    const offset = a.byteOffset ?? 0;
    const v = await view(a.bufferView, offset, (a.count - 1) * stride + n * size, size, true);
    for (let i = 0; i < a.count; i++) for (let j = 0; j < n; j++) values[i * n + j] = read(v, offset + i * stride + j * size, a.componentType);
  } else if ((a.byteOffset ?? 0) !== 0) fail(label, 'byteOffset without bufferView');
  if (a.sparse !== undefined) {
    const s = a.sparse;
    if (!integer(s.count, 1) || s.count > a.count || !s.indices || !s.values || ![5121, 5123, 5125].includes(s.indices.componentType)) fail(label, 'invalid sparse count/indices');
    const indexSize = s.indices.componentType === 5121 ? 1 : s.indices.componentType === 5123 ? 2 : 4;
    const io = s.indices.byteOffset ?? 0, vo = s.values.byteOffset ?? 0;
    const iv = await view(s.indices.bufferView, io, s.count * indexSize, indexSize);
    const vv = await view(s.values.bufferView, vo, s.count * n * size, size);
    let previous = -1;
    for (let i = 0; i < s.count; i++) {
      const k = read(iv, io + i * indexSize, s.indices.componentType);
      if (k <= previous || k >= a.count) fail(label, 'sparse index order/bounds');
      previous = k;
      for (let j = 0; j < n; j++) values[k * n + j] = read(vv, vo + (i * n + j) * size, a.componentType);
    }
  }
  if (allowNormalized && a.normalized === true && a.componentType !== 5126) {
    const divisor = a.componentType === 5121 ? 255 : 65535;
    for (let i = 0; i < values.length; i++) values[i] /= divisor;
  }
  if (!values.every(Number.isFinite)) fail(label, 'decoded values must be finite');
  if (a.componentType === 5126 && values.some(x => Math.abs(x) > 1e8)) fail(label, 'unsupported numeric range (FLOAT magnitude > 1e8)');
  return values;
}

/** Independent material and decoded geometry validation, including suppressed and unused data. */
export async function validateAsset(parser: Pick<GLTFParser, 'json' | 'getDependency'>) {
  const json = parser.json;
  for (const key of ['extensionsUsed', 'extensionsRequired']) if (json[key] !== undefined && (!Array.isArray(json[key]) || json[key].some((x: unknown) => typeof x !== 'string'))) fail('asset', `${key} must be an array of names`);
  if (json.extensionsRequired?.includes(EXTENSION_NAME) && !json.extensionsUsed?.includes(EXTENSION_NAME)) fail('asset', 'extensionsUsed required declaration');
  for (const [i, material] of (json.materials ?? []).entries()) {
    if (material.extensions?.[EXTENSION_NAME] === undefined) continue;
    if (!json.extensionsUsed?.includes(EXTENSION_NAME)) fail(`material ${i}`, 'extensionsUsed declaration');
    try { validatePayload(material.extensions[EXTENSION_NAME]); } catch (e) { fail(`material ${i}`, String(e)); }
  }
  for (const [mi, mesh] of (json.meshes ?? []).entries()) for (const [pi, primitive] of mesh.primitives.entries()) {
    if (json.materials?.[primitive.material]?.extensions?.[EXTENSION_NAME] === undefined) continue;
    const label = `mesh ${mi} primitive ${pi}`;
    if (![4, 5, 6].includes(primitive.mode ?? 4)) fail(label, 'outline requires triangles');
    for (const semantic of ['POSITION', 'NORMAL']) if (primitive.attributes?.[semantic] === undefined) fail(label, `${semantic} required`);
    if ((primitive.targets ?? []).some((t: Record<string, number>) => EDGE_ATTRIBUTE in t)) fail(label, 'edge scale morph forbidden');
    const positions = await decodeAccessor(parser, primitive.attributes.POSITION, 'VEC3', [5126], `${label} POSITION`);
    const normals = await decodeAccessor(parser, primitive.attributes.NORMAL, 'VEC3', [5126], `${label} NORMAL`);
    if (positions.length !== normals.length) fail(label, 'NORMAL count');
    for (const [ti, target] of (primitive.targets ?? []).entries()) for (const semantic of ['POSITION', 'NORMAL']) {
      if (target[semantic] === undefined) continue;
      const data = await decodeAccessor(parser, target[semantic], 'VEC3', [5126], `${label} morph ${ti} ${semantic}`);
      if (data.length !== positions.length) fail(label, 'morph count');
    }
    const count = positions.length / 3;
    for (const semantic of Object.keys(primitive.attributes).filter(s => /^(JOINTS|WEIGHTS)_\d+$/.test(s))) {
      const set = semantic.split('_')[1];
      if (primitive.attributes[`JOINTS_${set}`] === undefined || primitive.attributes[`WEIGHTS_${set}`] === undefined) fail(label, 'paired JOINTS/WEIGHTS required');
      const joints = semantic.startsWith('JOINTS');
      const a = json.accessors?.[primitive.attributes[semantic]];
      if (!joints && a?.componentType !== 5126 && a?.normalized !== true) fail(label, 'integer weights must be normalized');
      const values = await decodeAccessor(parser, primitive.attributes[semantic], 'VEC4', joints ? [5121, 5123] : [5126, 5121, 5123], `${label} ${semantic}`, !joints);
      if (values.length !== count * 4) fail(label, 'skin attribute count');
      if (!joints && values.some(x => x < 0 || x > 1)) fail(label, 'weights outside [0,1]');
      if (joints) for (const node of json.nodes ?? []) {
        if (node.mesh !== mi || node.skin === undefined) continue;
        const skin = json.skins?.[node.skin];
        if (!skin || values.some(x => x >= skin.joints.length)) fail(label, 'joint index bounds');
      }
    }
    const edge = primitive.attributes[EDGE_ATTRIBUTE];
    if (edge !== undefined) {
      const scales = await decodeAccessor(parser, edge, 'SCALAR', [5126], `${label} edge`);
      if (scales.length !== count) fail(label, 'edge count');
    }
    const indices = primitive.indices === undefined ? null : await decodeAccessor(parser, primitive.indices, 'SCALAR', [5121, 5123, 5125], `${label} indices`);
    if (indices?.some(i => i >= count)) fail(label, 'index bounds');
    const elements = indices?.length ?? count;
    if (elements < 3 || (primitive.mode ?? 4) === 4 && elements % 3 !== 0) fail(label, 'triangle count');
  }
}
