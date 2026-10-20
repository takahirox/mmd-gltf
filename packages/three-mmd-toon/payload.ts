export const EXTENSION_NAME = 'MMD_materials_toon';
export interface TextureReference { index: number }
export interface BaseTextureReference extends TextureReference {
  texCoord?: number;
  extensions?: { KHR_texture_transform?: { offset?: number[]; scale?: number[]; rotation?: number; texCoord?: number }; [key: string]: unknown };
  extras?: unknown;
}
export interface ToonPayload {
  diffuseFactor?: number[];
  ambientFactor?: number[];
  specularFactor?: number[];
  shininessFactor?: number;
  baseTexture?: BaseTextureReference;
  toonTexture?: TextureReference;
  sharedToonIndex?: number;
  sphereTexture?: TextureReference;
  sphereMode?: 'none' | 'multiply' | 'add' | 'subTexture';
  extensions?: Record<string, object>;
  extras?: unknown;
}
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const index = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;
const vector = (x: unknown, n: number) => Array.isArray(x) && x.length === n && x.every((v) => typeof v === 'number' && Number.isFinite(v));
const extensionObject = (x: unknown) => object(x) && Object.values(x).every(object);

/** Reject malformed payloads before resource loading or shader construction. No factor clamping. */
export function validatePayload(value: unknown): asserts value is ToonPayload {
  const fail = (message: string): never => { throw new Error(`${EXTENSION_NAME}: ${message}`); };
  if (!object(value)) fail('expected an object');
  const m = value as Record<string, any>;
  const allowed = ['diffuseFactor', 'ambientFactor', 'specularFactor', 'shininessFactor', 'baseTexture', 'toonTexture', 'sharedToonIndex', 'sphereTexture', 'sphereMode', 'extensions', 'extras'];
  for (const key of Object.keys(m)) if (!allowed.includes(key)) fail(`unknown property ${key}`);
  for (const [key, size] of [['diffuseFactor', 4], ['ambientFactor', 3], ['specularFactor', 3]] as const) {
    if (key in m && !vector(m[key], size)) fail(`invalid ${key}`);
  }
  if ('shininessFactor' in m && (typeof m.shininessFactor !== 'number' || !Number.isFinite(m.shininessFactor) || m.shininessFactor < 0)) fail('invalid shininessFactor');
  if ('extensions' in m && !extensionObject(m.extensions)) fail('invalid extensions');
  if ('sharedToonIndex' in m && (!index(m.sharedToonIndex) || m.sharedToonIndex > 9)) fail('invalid sharedToonIndex');
  if ('sharedToonIndex' in m && 'toonTexture' in m) fail('shared/custom toon are mutually exclusive');
  if ('sphereMode' in m && !['none', 'multiply', 'add', 'subTexture'].includes(m.sphereMode)) fail('invalid sphereMode');
  if (m.sphereMode && m.sphereMode !== 'none' && !('sphereTexture' in m)) fail('sphereMode requires sphereTexture');
  for (const key of ['baseTexture', 'toonTexture', 'sphereTexture']) {
    if (!(key in m)) continue;
    const ref = m[key];
    if (!object(ref) || !index(ref.index)) fail(`invalid ${key} index`);
    if (key !== 'baseTexture') {
      if (Object.keys(ref).some((k) => k !== 'index')) fail(`${key} accepts only index`);
    } else {
      if ('texCoord' in ref && !index(ref.texCoord)) fail('invalid base texCoord');
      if ('extensions' in ref && !extensionObject(ref.extensions)) fail('invalid base extensions');
      if (ref.extensions?.KHR_texture_transform !== undefined) {
        const t = ref.extensions.KHR_texture_transform;
        if (!object(t) || ('offset' in t && !vector(t.offset, 2)) || ('scale' in t && !vector(t.scale, 2))
          || ('rotation' in t && (typeof t.rotation !== 'number' || !Number.isFinite(t.rotation)))
          || ('texCoord' in t && !index(t.texCoord))) fail('invalid KHR_texture_transform');
      }
    }
  }
}
export function baseUVSet(m: ToonPayload) {
  return m.baseTexture?.extensions?.KHR_texture_transform?.texCoord ?? m.baseTexture?.texCoord ?? 0;
}
export function sharedToonName(index: number) {
  if (!Number.isInteger(index) || index < 0 || index > 9) throw new Error('Invalid shared toon selector');
  return `toon${String(index + 1).padStart(2, '0')}.bmp`;
}
