/** Strict VMD 0002 reader. Names are fixed-width Shift_JIS byte fields, not VPD text. */
import type { Vec3, Quat } from '../mmd-vpd';
export interface ByteName {
  raw: number[];
  text: string | null;
  terminated: boolean;
  key: string;
}
export interface BoneKey {
  name: ByteName;
  frame: number;
  translation: Vec3;
  rotation: Quat;
  interpolation: number[];
  raw: number[];
}
export interface VMD {
  header: number[];
  modelName: ByteName;
  bones: BoneKey[];
  morphs: { name: ByteName; frame: number; weight: number; raw: number[] }[];
  cameras: {
    frame: number;
    distance: number;
    position: Vec3;
    rotation: Vec3;
    interpolation: number[];
    fov: number;
    perspective: number;
    raw: number[];
  }[];
  lights: { frame: number; color: Vec3; position: Vec3; raw: number[] }[];
  shadows: { frame: number; mode: number; distance: number; raw: number[] }[];
  displays: { frame: number; visible: number; ik: { name: ByteName; enabled: number }[]; raw: number[] }[];
}
export function byteName(raw: number[]): ByteName {
  if (!Array.isArray(raw) || raw.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    throw new Error('VMD: invalid fixed-width name bytes');
  const end = raw.indexOf(0),
    bytes = raw.slice(0, end < 0 ? raw.length : end);
  let text: string | null = null;
  try {
    text = new TextDecoder('shift_jis', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    /* explicit mapping required */
  }
  return {
    raw: [...raw],
    text,
    terminated: end >= 0,
    key: bytes.map((v) => v.toString(16).padStart(2, '0')).join(''),
  };
}
export function parseVMD(input: Uint8Array): VMD {
  if (input.byteLength > 64 * 1024 * 1024) throw new Error('VMD: maximum input is 64 MiB');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let offset = 0;
  const need = (n: number) => {
    if (n > input.length - offset)
      throw new Error(`VMD: truncated record/count at byte ${offset}; need ${n} bytes`);
  };
  const bytes = (n: number) => {
    need(n);
    const result = Array.from(input.subarray(offset, offset + n));
    offset += n;
    return result;
  };
  const u8 = () => {
    need(1);
    return view.getUint8(offset++);
  };
  const u32 = () => {
    need(4);
    const v = view.getUint32(offset, true);
    offset += 4;
    return v;
  };
  const f32 = () => {
    need(4);
    const v = view.getFloat32(offset, true);
    offset += 4;
    if (!Number.isFinite(v)) throw new Error(`VMD: nonfinite float at byte ${offset - 4}`);
    return v;
  };
  const vec = () => [f32(), f32(), f32()] as Vec3;
  const raw = (start: number) => Array.from(input.subarray(start, offset));
  const name = (n: number) => byteName(bytes(n));
  const header = bytes(30),
    magic = Array.from(new TextEncoder().encode('Vocaloid Motion Data 0002'));
  if (magic.some((v, i) => header[i] !== v) || header.slice(magic.length).some((v) => v !== 0))
    throw new Error(
      'VMD: malformed header or unsupported version; expected Vocaloid Motion Data 0002 with zero padding',
    );
  const result: VMD = {
    header,
    modelName: name(20),
    bones: [],
    morphs: [],
    cameras: [],
    lights: [],
    shadows: [],
    displays: [],
  };
  const count = (section: string, size: number, optional = true) => {
    if (optional && offset === input.length) return 0;
    const n = u32();
    if (n > 1_000_000 || n > Math.floor((input.length - offset) / size))
      throw new Error(`VMD: ${section} count ${n} exceeds remaining bytes or record limit at byte ${offset}`);
    return n;
  };
  for (let i = 0, n = count('bone', 111, false); i < n; i++) {
    const start = offset,
      boneName = name(15),
      frame = u32(),
      translation = vec(),
      rotation = [f32(), f32(), f32(), f32()] as Quat,
      interpolation = bytes(64);
    validateBone({ frame, translation, rotation, interpolation });
    result.bones.push({ name: boneName, frame, translation, rotation, interpolation, raw: raw(start) });
  }
  for (let i = 0, n = count('morph', 23); i < n; i++) {
    const start = offset,
      record = { name: name(15), frame: u32(), weight: f32() };
    result.morphs.push({ ...record, raw: raw(start) });
  }
  for (let i = 0, n = count('camera', 61); i < n; i++) {
    const start = offset,
      record = {
        frame: u32(),
        distance: f32(),
        position: vec(),
        rotation: vec(),
        interpolation: bytes(24),
        fov: u32(),
        perspective: u8(),
      };
    result.cameras.push({ ...record, raw: raw(start) });
  }
  for (let i = 0, n = count('light', 28); i < n; i++) {
    const start = offset,
      record = { frame: u32(), color: vec(), position: vec() };
    result.lights.push({ ...record, raw: raw(start) });
  }
  for (let i = 0, n = count('self-shadow', 9); i < n; i++) {
    const start = offset,
      record = { frame: u32(), mode: u8(), distance: f32() };
    result.shadows.push({ ...record, raw: raw(start) });
  }
  for (let i = 0, n = count('display/IK', 9); i < n; i++) {
    const start = offset,
      frame = u32(),
      visible = u8(),
      ik: VMD['displays'][number]['ik'] = [];
    for (let j = 0, total = count('IK', 21, false); j < total; j++)
      ik.push({ name: name(20), enabled: u8() });
    result.displays.push({ frame, visible, ik, raw: raw(start) });
  }
  if (offset !== input.length) throw new Error(`VMD: unexpected trailing bytes at ${offset}`);
  return result;
}
export function validateBone(bone: Pick<BoneKey, 'frame' | 'translation' | 'rotation' | 'interpolation'>) {
  if (!Number.isInteger(bone.frame) || bone.frame < 0 || bone.frame > 0xffffffff)
    throw new Error('VMD: unsupported frame range');
  if (
    !Array.isArray(bone.translation) ||
    bone.translation.length !== 3 ||
    !bone.translation.every(Number.isFinite)
  )
    throw new Error('VMD: expected finite bone translation');
  const q = bone.rotation;
  if (
    !Array.isArray(q) ||
    q.length !== 4 ||
    !q.every(Number.isFinite) ||
    Math.abs(Math.hypot(...q) - 1) > 1e-5
  )
    throw new Error('VMD: invalid bone quaternion; unit length tolerance 1e-5');
  if (
    !Array.isArray(bone.interpolation) ||
    bone.interpolation.length !== 64 ||
    !bone.interpolation.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) ||
    bone.interpolation.slice(0, 16).some((v) => v > 127)
  )
    throw new Error('VMD: invalid executed Bezier control points; first 16 bytes must be 0..127');
}
export function omittedRecords(vmd: VMD) {
  return {
    morphs: vmd.morphs.length,
    cameras: vmd.cameras.length,
    lights: vmd.lights.length,
    shadows: vmd.shadows.length,
    displays: vmd.displays.length,
    ik: vmd.displays.reduce((n, r) => n + r.ik.length, 0),
  };
}
