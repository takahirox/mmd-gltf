export const EXTENSION_NAME = 'MMD_materials_outline';
export const EDGE_ATTRIBUTE = '_MMD_EDGE_SCALE';
export interface OutlinePayload {
  colorFactor?: number[];
  sizeFactor?: number;
  extensions?: Record<string, object>;
  extras?: unknown;
}
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
export function validatePayload(value: unknown): asserts value is OutlinePayload {
  const fail = (s: string): never => { throw new Error(`${EXTENSION_NAME}: schema: ${s}`); };
  if (!object(value)) fail('expected object');
  const m = value as Record<string, unknown>;
  for (const key of Object.keys(m)) if (!['colorFactor', 'sizeFactor', 'extensions', 'extras'].includes(key)) fail(`unknown ${key}`);
  if ('sizeFactor' in m && (typeof m.sizeFactor !== 'number' || !Number.isFinite(m.sizeFactor))) fail('finite sizeFactor required');
  if ('colorFactor' in m && (!Array.isArray(m.colorFactor) || m.colorFactor.length !== 4 || !m.colorFactor.every(x => typeof x === 'number' && Number.isFinite(x)))) fail('four finite colorFactor components required');
  if ('extensions' in m && (!object(m.extensions) || !Object.values(m.extensions).every(object))) fail('invalid extensions');
}
