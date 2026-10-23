/** Solver-free VPD bone offsets, in source left-handed PMX units until resolvePose. */
export type VPDEncoding = 'shift_jis' | 'utf-8';
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface VPDRecord { id: number; name: string; translation: Vec3; rotation: Quat }
export interface VPD { parentFile: string; records: VPDRecord[] }
export const VPD_QUATERNION_TOLERANCE = 1e-5;
const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const finiteArray = (value: unknown, size: number): value is number[] => Array.isArray(value) && value.length === size && value.every(Number.isFinite);
function quaternion(value: unknown, context: string): Quat {
  if (!finiteArray(value, 4)) throw new Error(`${context}: expected four finite quaternion values`);
  const length = Math.hypot(...value);
  if (!length || Math.abs(length - 1) > VPD_QUATERNION_TOLERANCE) throw new Error(`${context}: quaternion length ${length}; expected 1 within ${VPD_QUATERNION_TOLERANCE}`);
  return value.map(v => v / length) as Quat;
}
export function parseVPD(bytes: Uint8Array, encoding: VPDEncoding = 'shift_jis'): VPD {
  if (encoding !== 'shift_jis' && encoding !== 'utf-8') throw new Error(`VPD: unsupported encoding ${encoding}; choose shift_jis or utf-8`);
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (cause) { throw new Error(`VPD: malformed ${encoding} bytes; select the file's encoding explicitly`, { cause }); }
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).map((line, i) => ({ text: line.replace(/\/\/.*$/, ''), line: i + 1 })).filter(line => line.text.trim());
  let cursor = 0;
  const next = () => { const line = lines[cursor++]; if (!line) throw new Error('VPD: truncated header or bone record'); return line; };
  const expect = (pattern: RegExp, description: string) => { const line = next(); const match = pattern.exec(line.text); if (!match) throw new Error(`VPD line ${line.line}: expected ${description}`); return match; };
  expect(/^\s*Vocaloid Pose Data file\s*$/, 'Vocaloid Pose Data file header');
  const parentFile = expect(/^\s*(.+);\s*$/, 'informational parent filename followed by ;')[1];
  const countText = expect(/^\s*(\d+);\s*$/, 'nonnegative bone record count followed by ;')[1];
  const count = Number(countText);
  if (!Number.isSafeInteger(count) || count > 65536) throw new Error(`VPD: invalid record count ${countText}; maximum 65536`);
  const records: VPDRecord[] = [], ids = new Set<number>();
  const vector = (size: number) => {
    const line = next(); const match = /^\s*(.*);\s*$/.exec(line.text);
    const fields = match?.[1].split(',').map(v => v.trim());
    if (!fields || fields.length !== size || fields.some(v => !numberPattern.test(v) || !Number.isFinite(Number(v)))) throw new Error(`VPD line ${line.line}: expected ${size} finite decimal values followed by ;`);
    return fields.map(Number);
  };
  while (cursor < lines.length) {
    const match = expect(/^\s*Bone(\d+)\{([^{}]+)$/, 'BoneN{exact source name');
    const id = Number(match[1]), name = match[2];
    if (!Number.isSafeInteger(id) || ids.has(id)) throw new Error(`VPD: invalid or duplicate record label Bone${match[1]}`);
    ids.add(id);
    const translation = vector(3) as Vec3, rotation = quaternion(vector(4), `VPD record ${records.length} (${name})`);
    expect(/^\s*}\s*$/, 'closing } for bone record');
    records.push({ id, name, translation, rotation });
    if (records.length > count) throw new Error(`VPD: record count ${count} does not match records (extra record)`);
  }
  if (records.length !== count) throw new Error(`VPD: record count ${count} does not match ${records.length} records (truncated input)`);
  return { parentFile, records };
}
export interface RestBone { index: number; name: string; parentIndex: number; translation: Vec3; rotation: Quat; scale: Vec3 }
export interface PoseModel { version: 1; modelId: string; metersPerPMXUnit: number; bones: RestBone[] }
export interface BindingOptions { /** Keys are zero-based record ordinals, NOT BoneN labels. */ mapping?: Record<string, number>; unmatched?: 'error' | 'ignore' }
export interface PoseBinding { readonly modelId: string; readonly assignments: readonly { index: number; translation: Vec3; rotation: Quat }[]; readonly unmatched: readonly string[] }
export function validatePoseModel(model: PoseModel) {
  if (model.version !== 1 || typeof model.modelId !== 'string' || !model.modelId || !Number.isFinite(model.metersPerPMXUnit) || model.metersPerPMXUnit <= 0 || !Array.isArray(model.bones) || !model.bones.length) throw new Error('VPD: missing or inconsistent model/scale/baseline metadata (version 1 required)');
  const indices = new Set<number>();
  for (const bone of model.bones) {
    if (!Number.isInteger(bone.index) || bone.index < 0 || indices.has(bone.index) || typeof bone.name !== 'string' || !finiteArray(bone.translation, 3) || !finiteArray(bone.scale, 3) || bone.scale.some(v => v !== 1) || !Number.isInteger(bone.parentIndex)) throw new Error('VPD: inconsistent bone identity/rest metadata');
    quaternion(bone.rotation, `VPD rest bone ${bone.index}`); indices.add(bone.index);
  }
  for (const bone of model.bones) if (bone.parentIndex !== -1 && !indices.has(bone.parentIndex)) throw new Error(`VPD: missing rest parent ${bone.parentIndex}`);
}
export function bindPose(model: PoseModel, pose: VPD, options: BindingOptions = {}): PoseBinding {
  validatePoseModel(model);
  if (options.unmatched !== undefined && !['error', 'ignore'].includes(options.unmatched)) throw new Error('VPD: unmatched policy must be error or ignore');
  if (options.mapping !== undefined && (!options.mapping || typeof options.mapping !== 'object' || Array.isArray(options.mapping))) throw new Error('VPD: mapping must be a JSON object from record ordinals to PMX indices');
  if (!pose || !Array.isArray(pose.records)) throw new Error('VPD: missing bone records');
  const byIndex = new Map(model.bones.map(b => [b.index, b]));
  const byName = new Map<string, RestBone[]>();
  model.bones.forEach(b => { const matches = byName.get(b.name) ?? []; matches.push(b); byName.set(b.name, matches); });
  const mapping = options.mapping ?? {}, assigned = new Set<number>(), unmatched: string[] = [];
  for (const key of Object.keys(mapping)) if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= pose.records.length) throw new Error(`VPD: invalid mapping record ordinal ${key}`);
  const assignments: { index: number; translation: Vec3; rotation: Quat }[] = [];
  pose.records.forEach((record, ordinal) => {
    if (typeof record.name !== 'string' || !finiteArray(record.translation, 3)) throw new Error(`VPD record ${ordinal}: invalid name/finite translation`);
    const rotation = quaternion(record.rotation, `VPD record ${ordinal}`);
    const explicit = Object.hasOwn(mapping, String(ordinal));
    const matches = explicit ? (byIndex.has(mapping[ordinal]) ? [byIndex.get(mapping[ordinal])!] : []) : (byName.get(record.name) ?? []);
    if (explicit && (!Number.isInteger(mapping[ordinal]) || matches.length !== 1)) throw new Error(`VPD record ${ordinal}: invalid mapped PMX index ${mapping[ordinal]}`);
    if (matches.length > 1) throw new Error(`VPD record ${ordinal} (${record.name}): ambiguous exact source name; provide an explicit record-to-PMX-index mapping`);
    if (!matches.length) { unmatched.push(`record ${ordinal} (${record.name})`); return; }
    const index = matches[0].index;
    if (assigned.has(index)) throw new Error(`VPD record ${ordinal}: repeated target assignment to PMX index ${index}`);
    assigned.add(index);
    assignments.push({ index, translation: [...record.translation], rotation });
  });
  if (unmatched.length && options.unmatched !== 'ignore') throw new Error(`VPD: unmatched ${unmatched.join(', ')}; select unmatched: ignore only for intentional partial application`);
  return { modelId: model.modelId, assignments, unmatched };
}
/** Resolve from immutable ORIGINAL local rest, never current transforms. No solvers. */
export function resolvePose(model: PoseModel, binding?: PoseBinding): RestBone[] {
  validatePoseModel(model);
  if (binding && binding.modelId !== model.modelId) throw new Error('VPD: binding belongs to a different model');
  const assignments = new Map(binding?.assignments.map(a => [a.index, a]));
  return model.bones.map(bone => {
    const offset = assignments.get(bone.index);
    if (!offset) return structuredClone(bone);
    const translation = bone.translation.map((v, i) => v + offset.translation[i] * model.metersPerPMXUnit * (i === 2 ? -1 : 1)) as Vec3;
    const [ax, ay, az, aw] = bone.rotation, [x, y, z, w] = offset.rotation;
    // rest * reflected offset, reflection S=diag(1,1,-1).
    const bx = -x, by = -y, bz = z, bw = w;
    const rotation: Quat = [ax*bw + aw*bx + ay*bz - az*by, ay*bw + aw*by + az*bx - ax*bz, az*bw + aw*bz + ax*by - ay*bx, aw*bw - ax*bx - ay*by - az*bz];
    if (!translation.every(v => Number.isFinite(v) && Number.isFinite(Math.fround(v)))) throw new Error(`VPD bone ${bone.index}: translation exceeds supported numeric range`);
    return { ...bone, translation, rotation, scale: [...bone.scale] };
  });
}
