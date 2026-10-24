/** Exact PMX source identity, independent of a loader's name dictionary. */
export interface MorphIdentity {
  index: number;
  name: string;
  englishName: string;
  type: number;
  target: number | null;
  /** Version 2 only; ordered source entries, including duplicates and zero rates. */
  group?: { index: number; rate: number }[];
  unsupported?: { index: number; type: number; reason: string }[];
}
export interface MorphModel {
  version: 1 | 2;
  modelId: string;
  morphs: MorphIdentity[];
}
export interface WeightTrack { index: number; keys: { frame: number; weight: number }[] }
/** Common bounded playback profile, including the existing Outline renderer. */
export const MORPH_WEIGHT_LIMIT = 1e4;
export function validWeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MORPH_WEIGHT_LIMIT;
}
/** A group is executable only when every immediate dependency is a vertex morph.
 * Graph inspection is diagnostic only: it never evaluates nested group deltas. */
export function groupIssues(morphs: MorphIdentity[], index: number) {
  const reaches = (start: number) => {
    const pending = [start], seen = new Set<number>();
    while (pending.length) {
      const next = pending.pop()!;
      if (next === index) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      if (morphs[next].type === 0) for (const e of morphs[next].group!) pending.push(e.index);
    }
    return false;
  };
  return morphs[index].group!.filter(e => morphs[e.index].type !== 1).map(e => ({
    index: e.index, type: morphs[e.index].type,
    reason: e.index === index ? 'self dependency' : morphs[e.index].type !== 0 ? 'unsupported child family' :
      reaches(e.index) ? 'cyclic group dependency' : 'nested group dependency',
  }));
}
export function validateMorphModel(model: MorphModel) {
  if (!model || ![1, 2].includes(model.version) || typeof model.modelId !== 'string' || !model.modelId ||
      !Array.isArray(model.morphs) || model.morphs.length > 65536)
    throw new Error('Morph: missing or invalid model identity');
  let entries = 0;
  Array.from(model.morphs).forEach((m, index) => {
    if (!m || m.index !== index || typeof m.name !== 'string' || typeof m.englishName !== 'string' ||
        !Number.isInteger(m.type) || m.type < 0 || m.type > 10)
      throw new Error(`Morph ${index}: inconsistent source index/type metadata`);
    if (model.version === 2 && m.type === 0) {
      if (!Array.isArray(m.group)) throw new Error(`Morph ${index}: missing group references`);
      entries += m.group.length;
      for (const e of m.group) if (!e || !Number.isInteger(e.index) || e.index < 0 || e.index >= model.morphs.length ||
          typeof e.rate !== 'number' || !Number.isFinite(e.rate) || !Number.isFinite(Math.fround(e.rate)))
        throw new Error(`Morph ${index}: invalid group reference or FLOAT rate`);
    } else if (m.group !== undefined || m.unsupported !== undefined)
      throw new Error(`Morph ${index}: unexpected group metadata`);
  });
  if (entries > 1000000) throw new Error('Morph: group entry limit (1000000) exceeded');
  // Keep existing vertex target indices stable; append supported groups in source order.
  const ordered = model.morphs.filter(m => m.type === 1);
  for (const m of model.morphs) if (model.version === 2 && m.type === 0) {
    const issues = groupIssues(model.morphs, m.index);
    if (!Array.isArray(m.unsupported) || m.unsupported.length !== issues.length ||
        Array.from(m.unsupported).some((e, i) => !e || e.index !== issues[i].index || e.type !== issues[i].type || e.reason !== issues[i].reason))
      throw new Error(`Morph ${m.index}: inconsistent group dependency diagnostics`);
    if (!issues.length) ordered.push(m);
  }
  const targets = new Map(ordered.map((m, i) => [m.index, i]));
  for (const m of model.morphs) if (m.target !== (targets.get(m.index) ?? null))
    throw new Error(`Morph ${m.index}: inconsistent source index/type/target metadata`);
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
