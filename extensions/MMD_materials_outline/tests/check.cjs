// Test-only CPU specification checker. No renderer, converter or public API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const gltfValidator = require('gltf-validator');

const root = path.resolve(__dirname, '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const name = 'MMD_materials_outline';
const ajv = new Ajv({ strict: true, allErrors: true });
const schema = load('schema/material.MMD_materials_outline.schema.json');
const validExtension = ajv.compile(schema);
const positions = load('tests/positions.json');
const clamp = (x) => Math.min(1, Math.max(0, x));
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const transpose = (m) => m[0].map((_, i) => m.map((row) => row[i]));
const mv = (m, v) => m.map((row) => dot(row, v));
const mm = (a, b) => a.map((row) => transpose(b).map((col) => dot(row, col)));
const mat3 = (m) => m.slice(0, 3).map((row) => row.slice(0, 3));
const add = (a, b) => a.map((x, i) => x + b[i]);

function close(actual, expected, label) {
  if (typeof expected === 'number') {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= positions.tolerance,
      `${label}: expected ${expected}, got ${actual}`);
  } else if (Array.isArray(expected)) {
    assert.equal(actual?.length, expected.length, label);
    expected.forEach((x, i) => close(actual[i], x, `${label}[${i}]`));
  } else assert.equal(actual, expected, label);
}

function cofactor(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  return [[e * i - f * h, f * g - d * i, d * h - e * g],
    [c * h - b * i, a * i - c * g, b * g - a * h],
    [b * f - c * e, c * d - a * f, a * e - b * d]];
}
const determinant = (m) => dot(m[0], cofactor(m)[0]);

function project(input) {
  const v = { ...positions.defaults, ...input };
  const w = v.world ?? identity;
  const skinned = v.joints !== undefined;
  if (!skinned && determinant(mat3(w)) === 0) return { skipped: true };
  const deformation = skinned ? v.joints.reduce((sum, joint) => {
    const transform = mm(joint.world, joint.inverseBind ?? identity);
    return sum.map((row, i) => row.map((x, j) => x + joint.weight * transform[i][j]));
  }, identity.map((row) => row.map(() => 0))) : w;
  const t = mm(v.view ?? identity, deformation);
  const p = add(v.position, v.positionDelta ?? [0, 0, 0]);
  const n = add(v.normal, v.normalDelta ?? [0, 0, 0]);
  const q = mv(t, [...p, 1]);
  const c = mv(v.projection, q);
  const d = determinant(mat3(t));
  const a = d === 0 ? [0, 0, 0] : mv(cofactor(mat3(t)), n).map((x) => x / d);
  const len = Math.hypot(...a);
  const nView = len === 0 ? [0, 0, 0] : a.map((x) => x / len);
  const len2 = Math.hypot(nView[0], nView[1]);
  const u = len2 > 1e-12 ? nView.slice(0, 2).map((x) => x / len2) : [0, 0];
  const tEffective = c[3] > 0 && len2 > 1e-12
    ? (v.material?.sizeFactor ?? 1) * (v.edgeScale ?? 1) : 0;
  const [b, h] = v.viewport;
  const clip = [c[0] + 2 * tEffective * u[0] * c[3] / b,
    c[1] + 2 * tEffective * u[1] * c[3] / h, c[2], c[3]];
  const ndc = c[3] > 0 ? clip.slice(0, 3).map((x) => x / clip[3]) : null;
  const origin = v.origin ?? [0, 0];
  const pixel = ndc ? [(ndc[0] + 1) * b / 2 + origin[0], (ndc[1] + 1) * h / 2 + origin[1]] : null;
  return { clip, ndc, pixel, tEffective, skipped: false,
    reflected: !skinned && determinant(mat3(w)) < 0 };
}

const decode = (x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
const encode = (x) => x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;

function fragment(v) {
  const color = (v.material?.colorFactor ?? [0, 0, 0, 1]).map(clamp);
  const bary = v.barycentric ?? [1 / 3, 1 / 3, 1 / 3];
  const weights = bary.map((x, i) => x / (v.clipW ?? [1, 1, 1])[i]);
  const interpolatedScale = dot(weights, v.tEffective ?? [1, 1, 1]) / weights.reduce((a, b) => a + b);
  const z = v.ndcDepth ?? 0;
  const reason = color[3] === 0 ? 'alpha' : interpolatedScale <= 0 ? 'scale'
    : z < -1 || z > 1 ? 'clip' : (v.ccw ?? false) !== (v.reflected ?? false) ? 'cull'
      : (z + 1) / 2 > (v.sceneDepth ?? 1) ? 'depth' : null;
  if (reason) return { discard: true, reason, depthWrite: false, interpolatedScale };
  const dst = v.destination ?? { premultipliedRGB: [0, 0, 0], alpha: 1 };
  const alpha = color[3] + (1 - color[3]) * dst.alpha;
  const premultipliedRGB = color.slice(0, 3).map((x, i) =>
    color[3] * decode(x) + (1 - color[3]) * dst.premultipliedRGB[i]);
  const straightRGB = premultipliedRGB.map((x) => alpha === 0 ? 0 : x / alpha);
  return { discard: false, depthWrite: false, interpolatedScale, alpha,
    premultipliedRGB, straightRGB, encodedRGB: straightRGB.map(encode) };
}

// Read only the accessor forms needed for the reserved FLOAT SCALAR semantic.
// Core validation of the complete examples is separately performed below.
function edgeValues(asset, accessor) {
  const read = (viewIndex, offset, count, stride, bytes, getter) => {
    const view = asset.bufferViews?.[viewIndex];
    assert.ok(view, 'bufferView index');
    const buffer = asset.buffers?.[view.buffer];
    assert.ok(buffer?.uri?.startsWith('data:application/octet-stream;base64,'), 'embedded test buffer');
    const data = Buffer.from(buffer.uri.split(',')[1], 'base64');
    assert.ok(data.length >= buffer.byteLength, 'buffer bounds');
    assert.ok(offset >= 0 && offset + (count - 1) * stride + bytes <= view.byteLength, 'accessor bounds');
    const start = (view.byteOffset ?? 0) + offset;
    assert.ok(start + (count - 1) * stride + bytes <= buffer.byteLength, 'buffer bounds');
    return Array.from({ length: count }, (_, i) => data[getter](start + i * stride));
  };
  let values = accessor.bufferView === undefined ? Array(accessor.count).fill(0)
    : read(accessor.bufferView, accessor.byteOffset ?? 0, accessor.count,
      asset.bufferViews[accessor.bufferView]?.byteStride ?? 4, 4, 'readFloatLE');
  if (accessor.sparse) {
    const s = accessor.sparse;
    assert.ok(s.count > 0 && s.count <= accessor.count, 'sparse count');
    const types = { 5121: [1, 'readUInt8'], 5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'] };
    const type = types[s.indices.componentType];
    assert.ok(type, 'sparse index type');
    const indices = read(s.indices.bufferView, s.indices.byteOffset ?? 0, s.count, type[0], ...type);
    const replacements = read(s.values.bufferView, s.values.byteOffset ?? 0, s.count, 4, 4, 'readFloatLE');
    indices.forEach((index, i) => {
      assert.ok(index < accessor.count && (i === 0 || indices[i - 1] < index), 'sparse index order/bounds');
      values[index] = replacements[i];
    });
  }
  for (const value of values) {
    assert.ok(Number.isFinite(value), 'edge scale must be finite');
    assert.ok(value >= 0, 'edge scale must be nonnegative');
  }
  return values;
}

function checkAsset(asset) {
  for (const material of asset.materials ?? []) {
    const m = material.extensions?.[name];
    if (m === undefined) continue;
    assert.ok(asset.extensionsUsed?.includes(name), 'extensionsUsed declaration');
    assert.ok(validExtension(m), `schema: ${JSON.stringify(validExtension.errors)}`);
  }
  if (asset.extensionsRequired?.includes(name)) {
    assert.ok(asset.extensionsUsed?.includes(name), 'extensionsUsed required declaration');
  }
  const scales = [];
  for (const mesh of asset.meshes ?? []) for (const primitive of mesh.primitives) {
    if (asset.materials?.[primitive.material]?.extensions?.[name] === undefined) continue;
    assert.ok([4, 5, 6].includes(primitive.mode ?? 4), 'outline requires triangles');
    const position = asset.accessors?.[primitive.attributes.POSITION];
    const normal = asset.accessors?.[primitive.attributes.NORMAL];
    assert.ok(position, 'POSITION required');
    assert.ok(normal, 'NORMAL required');
    assert.equal(normal.count, position.count, 'NORMAL count');
    assert.ok(!(primitive.targets ?? []).some((target) => nameOfScale in target), 'edge scale morph forbidden');
    const index = primitive.attributes[nameOfScale];
    if (index === undefined) scales.push(Array(position.count).fill(1));
    else {
      const accessor = asset.accessors?.[index];
      assert.ok(accessor, 'edge accessor index');
      assert.equal(accessor.type, 'SCALAR', 'SCALAR attribute');
      assert.equal(accessor.componentType, 5126, 'FLOAT attribute');
      assert.ok(accessor.normalized === undefined || accessor.normalized === false, 'normalized attribute forbidden');
      assert.equal(accessor.count, position.count, 'edge count');
      scales.push(edgeValues(asset, accessor));
    }
  }
  return scales;
}
const nameOfScale = '_MMD_EDGE_SCALE';

function shouldDraw(material, scales) {
  const m = material.extensions?.[name];
  return m !== undefined && (m.sizeFactor ?? 1) > 0
    && clamp((m.colorFactor ?? [0, 0, 0, 1])[3]) > 0 && scales.some((x) => x > 0);
}

async function main() {
  const schemaCases = load('tests/schema.json');
  for (const c of schemaCases.valid) assert.equal(validExtension(c.value), true, c.name);
  for (const c of schemaCases.invalid) assert.equal(validExtension(c.value), false, c.name);
  for (const raw of schemaCases.invalidNumericJSON) assert.equal(validExtension(JSON.parse(raw)), false, raw);
  assert.deepEqual(schema.properties.colorFactor.default, [0, 0, 0, 1]);
  assert.equal(schema.properties.sizeFactor.default, 1);
  for (const c of positions.cases) {
    const actual = project(c);
    for (const [key, value] of Object.entries(c.expected)) close(actual[key], value, `${c.name}.${key}`);
    if (c.expectedFaces) {
      assert.equal(actual.skipped, false, `${c.name}: faces must be drawn`);
      for (const [winding, discard] of Object.entries(c.expectedFaces)) {
        assert.equal(fragment({ reflected: actual.reflected, ccw: winding === 'ccw' }).discard,
          discard, `${c.name}.${winding} discard`);
      }
    }
  }
  const fragments = load('tests/fragments.json');
  for (const c of fragments.cases) {
    const actual = fragment(c);
    for (const [key, value] of Object.entries(c.expected)) close(actual[key], value, `${c.name}.${key}`);
  }
  const ordering = fragments.ordering;
  const sorted = ordering.triangles.map((t, i) => ({ ...t, i, depth: -t.viewZ.reduce((a, b) => a + b) / 3 }))
    .sort((a, b) => b.depth - a.depth || a.node - b.node || a.primitive - b.primitive || a.triangle - b.triangle);
  assert.deepEqual(sorted.map((t) => t.i), ordering.expectedIndices, 'triangle draw order');
  const flags = load('tests/flags.json');
  // Mapping assertions only: these do not implement a PMX/PMD converter.
  for (const c of flags.pmx) assert.equal((c.flag & 0x10) !== 0, c.enabled, 'PMX edge flag');
  for (const c of flags.pmdMaterial) assert.equal(c.flag === 1, c.enabled, 'PMD edge flag');
  for (const c of flags.pmdVertex) assert.equal(c.invisible === 1 ? 0 : 1, c.scale, 'PMD scale');
  for (const c of flags.draws) assert.equal(shouldDraw(c.material, c.scales), c.draw, c.name);

  const assets = load('tests/assets.json');
  for (const c of assets) {
    const asset = load(`examples/${c.asset}`);
    for (const change of c.changes) {
      const owner = change.path.slice(0, -1).reduce((obj, key) => obj[key], asset);
      if (change.remove) delete owner[change.path.at(-1)];
      else owner[change.path.at(-1)] = change.value;
    }
    if (c.edgeValues) {
      const buffer = asset.buffers[0];
      const bytes = Buffer.from(buffer.uri.split(',')[1], 'base64');
      c.edgeValues.forEach((x, i) => bytes.writeFloatLE(Number(x), 72 + i * 4));
      buffer.uri = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
    }
    if (c.expectedError) assert.throws(() => checkAsset(asset), new RegExp(c.expectedError), c.name);
    else {
      const scales = checkAsset(asset);
      if (c.expectedScales) close(scales[0], c.expectedScales, c.name);
      if (c.expectedOutlined === false) assert.equal(scales.length, 0, c.name);
      // Also validate positive sparse/modified assets against core glTF rules.
      const report = await gltfValidator.validateString(JSON.stringify(asset), { uri: c.name });
      assert.equal(report.issues.numErrors, 0, `${c.name}: ${JSON.stringify(report.issues.messages)}`);
    }
  }
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const example = [...readme.matchAll(/```json\n([\s\S]*?)\n```/g)];
  assert.equal(example.length, 1, 'one complete material-only README example');
  assert.deepEqual(JSON.parse(example[0][1]), load('examples/material-only.gltf'));
  for (const file of ['material-only.gltf', 'edge-scale.gltf', 'default-scale.gltf']) {
    const asset = load(`examples/${file}`);
    checkAsset(asset);
    const report = await gltfValidator.validateString(JSON.stringify(asset), { uri: file });
    assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
    const codes = [...new Set(report.issues.messages.map((m) => m.code))];
    console.log(`${file}: core glTF validator ${report.validatorVersion}, 0 errors; notices: ${codes.join(', ')}`);
  }
  console.log(`PASS: ${positions.cases.length} position vectors, ${fragments.cases.length} fragment vectors, `
    + `${schemaCases.valid.length + schemaCases.invalid.length + schemaCases.invalidNumericJSON.length} schema cases, `
    + `${assets.length} asset cases, flag/default/skip checks, draw ordering and 3 glTF examples.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
