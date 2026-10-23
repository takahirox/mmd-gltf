/** Exact PMX source identity, independent of a loader's name dictionary. */
export interface MorphIdentity {
  index: number;
  name: string;
  englishName: string;
  type: number;
  target: number | null;
}
export interface MorphModel {
  version: 1;
  modelId: string;
  morphs: MorphIdentity[];
}
export interface WeightTrack { index: number; keys: { frame: number; weight: number }[] }
/** Common bounded playback profile, including the existing Outline renderer. */
export const MORPH_WEIGHT_LIMIT = 1e4;
export function validWeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MORPH_WEIGHT_LIMIT;
}
export function validateMorphModel(model: MorphModel) {
  if (!model || model.version !== 1 || typeof model.modelId !== 'string' || !model.modelId ||
      !Array.isArray(model.morphs) || model.morphs.length > 65536)
    throw new Error('Morph: missing or invalid model identity');
  let target = 0;
  model.morphs.forEach((m, index) => {
    if (!m || m.index !== index || typeof m.name !== 'string' || typeof m.englishName !== 'string' ||
        !Number.isInteger(m.type) || m.type < 0 || m.type > 10 ||
        (m.type === 1 ? m.target !== target++ : m.target !== null))
      throw new Error('Morph: inconsistent source index/type/target metadata');
  });
}
/** Independent additive scalars: no normalization, clamping or bone Bezier fields. */
export function evaluateWeight(track: WeightTrack, seconds: number) {
  if (!Number.isFinite(seconds)) throw new Error('Morph: time must be finite');
  const keys = track.keys, frame = seconds * 30;
  if (frame <= keys[0].frame) return keys[0].weight;
  if (frame >= keys.at(-1)!.frame) return keys.at(-1)!.weight;
  let lo = 0, hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (hi + lo) >> 1;
    if (keys[mid].frame <= frame) lo = mid; else hi = mid;
  }
  const a = keys[lo], b = keys[hi], u = (frame - a.frame) / (b.frame - a.frame);
  return a.weight + (b.weight - a.weight) * u;
}
