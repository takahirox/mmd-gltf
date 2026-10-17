// Test-only evaluator and fixture checks; not a renderer or reusable runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const gltfValidator = require('gltf-validator');

const root = path.resolve(__dirname, '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const schema = load('schema/material.MMD_materials_toon.schema.json');
const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
const validExtension = ajv.compile(schema);
const vectors = load('tests/shading.json');
const clamp = (x) => Math.min(1, Math.max(0, x));
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const decode = (c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const encode = (x) => x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
const sharedName = (i) => `toon${String(i + 1).padStart(2, '0')}.bmp`;

function close(actual, expected, label) {
  if (typeof expected === 'number') {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= vectors.tolerance,
      `${label}: expected ${expected}, got ${actual}`);
  } else if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, label);
    expected.forEach((v, i) => close(actual[i], v, `${label}[${i}]`));
  } else {
    assert.equal(actual, expected, label);
  }
}

// Only the deterministic base-level filters used by these fixtures are needed.
// Rows run top to bottom; interpolation operates on stored source components.
function sample(index, uv) {
  const texture = vectors.textures[index];
  assert.ok(texture, 'fixture texture must exist');
  const pixels = texture.pixels;
  const height = pixels.length;
  const width = pixels[0].length;
  const address = (i, size, wrap) => wrap === 'repeat'
    ? ((i % size) + size) % size : Math.min(size - 1, Math.max(0, i));
  const texel = (x, y) => pixels[address(y, height, texture.wrapT)]
    [address(x, width, texture.wrapS)].map((v) => texture.encoding === 'unorm8' ? v / 255 : v);
  if (texture.filter === 'nearest') {
    return texel(Math.floor(uv[0] * width), Math.floor(uv[1] * height));
  }
  assert.equal(texture.filter, 'linear');
  const x = uv[0] * width - 0.5;
  const y = uv[1] * height - 0.5;
  const i = Math.floor(x), j = Math.floor(y);
  const a = x - i, b = y - j;
  const p00 = texel(i, j), p10 = texel(i + 1, j);
  const p01 = texel(i, j + 1), p11 = texel(i + 1, j + 1);
  return p00.map((v, k) => (v * (1 - a) + p10[k] * a) * (1 - b)
    + (p01[k] * (1 - a) + p11[k] * a) * b);
}

function evaluate(input) {
  const material = input.material;
  const m = material.extensions.MMD_materials_toon;
  assert.ok(validExtension(m), JSON.stringify(validExtension.errors));
  const d = m.diffuseFactor ?? [1, 1, 1, 1];
  const a = m.ambientFactor ?? [0, 0, 0];
  const p = m.specularFactor ?? [0, 0, 0];
  const q = m.shininessFactor ?? 0;
  const lightRGB = input.lightRGB ?? [1, 1, 1];
  const n = input.normal ?? [0, 0, 1];
  const l = input.light ?? [0, 0, 1];
  const v = input.view ?? [0, 0, 1];
  const normalView = input.normalView ?? n;
  for (const direction of [n, l, v, normalView]) close(dot(direction, direction), 1, 'unit input');
  const uvs = input.uvs ?? { 0: [0.5, 0.5] };
  const baseUV = m.baseTexture ? uvs[m.baseTexture.texCoord ?? 0] : null;
  if (m.baseTexture) assert.ok(baseUV, 'base UV required');
  const t = m.baseTexture ? sample(m.baseTexture.index, baseUV) : [1, 1, 1, 1];
  const litBase = a.map((x, i) => clamp(d[i] * lightRGB[i] + x));
  let surface = litBase.map((x, i) => x * t[i]);
  let alpha = d[3] * t[3];
  let sphereUV = null;
  const mode = m.sphereMode ?? 'none';
  if (mode !== 'none') {
    sphereUV = mode === 'subTexture' ? uvs[1]
      : [0.5 + normalView[0] * 0.5, 0.5 - normalView[1] * 0.5];
    assert.ok(sphereUV, 'TEXCOORD_1 required');
    const s = sample(m.sphereTexture.index, sphereUV);
    surface = surface.map((x, i) => mode === 'add' ? x + s[i] : x * s[i]);
    if (mode === 'subTexture') alpha *= s[3];
  }
  let toonUV = null, sharedResource = null;
  if (m.sharedToonIndex !== undefined || m.toonTexture) {
    toonUV = [0, clamp(dot(n, l) + 0.5)];
    const isShared = m.sharedToonIndex !== undefined;
    if (isShared) sharedResource = sharedName(m.sharedToonIndex);
    // Deliberately inject synthetic data; never load/copy real shared images.
    const r = sample(isShared ? input.sharedSyntheticTexture : m.toonTexture.index, toonUV);
    surface = surface.map((x, i) => x * r[i]);
  }
  let specRGB = [0, 0, 0];
  const sum = l.map((x, i) => x + v[i]);
  const length = Math.hypot(...sum);
  if (q > 0 && length > 0) {
    const h = sum.map((x) => x / length);
    const highlight = Math.max(dot(n, h), 0) ** q;
    specRGB = p.map((x, i) => x * lightRGB[i] * highlight);
  }
  const rgb = surface.map((x, i) => clamp(x + specRGB[i]));
  alpha = clamp(alpha);
  const modeAlpha = material.alphaMode ?? 'OPAQUE';
  const discard = modeAlpha === 'MASK' && alpha < (material.alphaCutoff ?? 0.5);
  const coverage = discard ? 0 : modeAlpha === 'BLEND' ? alpha : 1;
  const linearRGB = rgb.map(decode);
  const result = { litBase, baseUV, sphereUV, toonUV, sharedResource, specRGB,
    rgb, alpha, coverage, discard, linearRGB, encodedRGB: linearRGB.map(encode) };
  if (input.backgroundLinearRGB) {
    result.blendedLinearRGB = linearRGB.map((x, i) =>
      coverage * x + (1 - coverage) * input.backgroundLinearRGB[i]);
  }
  return result;
}

// These are only the extension-specific cross-object checks, not a core validator.
function checkAsset(asset) {
  for (const material of asset.materials ?? []) {
    const m = material.extensions?.MMD_materials_toon;
    if (!m) continue;
    assert.ok(validExtension(m), JSON.stringify(validExtension.errors));
    for (const key of ['baseTexture', 'toonTexture', 'sphereTexture']) {
      if (!m[key]) continue;
      const texture = asset.textures?.[m[key].index];
      assert.ok(texture, `${key}: texture index out of bounds`);
      assert.ok(asset.images?.[texture.source], `${key}: image index out of bounds`);
    }
  }
  for (const mesh of asset.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const m = asset.materials?.[primitive.material]?.extensions?.MMD_materials_toon;
      if (!m) continue;
      if (m.sphereMode === 'subTexture') {
        assert.ok(primitive.attributes.TEXCOORD_1 !== undefined, 'TEXCOORD_1 required');
      }
      if (m.baseTexture) {
        const set = m.baseTexture.extensions?.KHR_texture_transform?.texCoord
          ?? m.baseTexture.texCoord ?? 0;
        assert.ok(primitive.attributes[`TEXCOORD_${set}`] !== undefined, `TEXCOORD_${set} required`);
      }
    }
  }
}

async function main() {
  const schemaCases = load('tests/schema.json');
  for (const c of schemaCases.valid) assert.equal(validExtension(c.value), true, c.name);
  for (const c of schemaCases.invalid) assert.equal(validExtension(c.value), false, c.name);
  for (const raw of schemaCases.invalidNumericJSON) {
    assert.equal(validExtension(JSON.parse(raw)), false, 'non-finite machine number');
  }
  for (const item of vectors.sharedMapping) assert.equal(sharedName(item.index), item.resource);
  for (const c of vectors.cases) {
    const actual = evaluate(c);
    for (const [key, value] of Object.entries(c.expected)) close(actual[key], value, `${c.name}.${key}`);
  }
  const assetCases = load('tests/assets.json');
  for (const c of assetCases) {
    const asset = load(`examples/${c.asset}`);
    for (const change of c.changes) {
      const owner = change.path.slice(0, -1).reduce((obj, key) => obj[key], asset);
      owner[change.path.at(-1)] = change.value;
    }
    if (c.expectedError) assert.throws(() => checkAsset(asset), new RegExp(c.expectedError), c.name);
    else checkAsset(asset);
  }
  // Check the executable evaluator rejects absent UV1 as well as the asset check.
  const missingUV = vectors.cases.find((c) => c.name === 'subtexture-uv1-not-view-uv');
  assert.throws(() => evaluate({ ...missingUV, uvs: { 0: [0.5, 0.5] } }), /TEXCOORD_1/);

  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const examples = [...readme.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
  assert.equal(examples.length, 2, 'two complete README examples');
  for (const [i, name] of ['material-only.gltf', 'subtexture.gltf'].entries()) {
    const asset = load(`examples/${name}`);
    assert.deepEqual(examples[i], asset, `${name} matches README`);
    checkAsset(asset);
    const report = await gltfValidator.validateString(JSON.stringify(asset), { uri: name });
    assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
    const codes = [...new Set(report.issues.messages.map((message) => message.code))];
    console.log(`${name}: core glTF validator ${report.validatorVersion}, 0 errors; notices: ${codes.join(', ')}`);
  }
  console.log(`PASS: ${vectors.cases.length} shading vectors, ${vectors.sharedMapping.length} shared mappings, `
    + `${schemaCases.valid.length + schemaCases.invalid.length + schemaCases.invalidNumericJSON.length} schema cases, `
    + `${assetCases.length} whole-asset cases, missing-UV evaluator rejection, 2 complete glTF examples.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
