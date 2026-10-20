import { ClampToEdgeWrapping, LinearFilter, NoColorSpace, TextureSource, type Texture } from 'three';
import type { GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { EXTENSION_NAME, baseUVSet, sharedToonName, validatePayload } from './payload';
import { createToonMaterial, createToonLighting, type ToonLighting } from './shading';
export { createToonLighting } from './shading';
export { EXTENSION_NAME, sharedToonName } from './payload';
export type { ToonPayload } from './payload';
export interface ToonPluginOptions {
  lighting?: ToonLighting;
  /** Supply legally obtained exact shared resources; reject missing images. No built-in approximations. */
  resolveSharedToon?: (index: number, resourceName: string) => Texture | Promise<Texture>;
}
/** A distinct GPU source/view prevents a PBR sRGB upload from affecting MMD encoded sampling. */
export function encodedTextureView(original: Texture, shared = false) {
  if (!original?.image) throw new Error(`${EXTENSION_NAME}: texture has no image`);
  const view = original.clone();
  view.source = new TextureSource(original.image);
  view.colorSpace = NoColorSpace;
  view.flipY = false;
  if (shared) {
    view.wrapS = view.wrapT = ClampToEdgeWrapping;
    view.magFilter = view.minFilter = LinearFilter;
    view.generateMipmaps = false;
  }
  view.needsUpdate = true;
  return view;
}
export class MMDToonPlugin implements GLTFLoaderPlugin {
  readonly name = EXTENSION_NAME;
  private readonly lighting: ToonLighting;
  private readonly views = new Map<string, Promise<Texture>>();
  constructor(private readonly parser: GLTFParser, private readonly options: ToonPluginOptions = {}) {
    this.lighting = options.lighting ?? createToonLighting();
  }
  beforeRoot() {
    const json = this.parser.json;
    for (const material of json.materials ?? []) {
      const m = material.extensions?.[EXTENSION_NAME];
      if (m === undefined) continue;
      validatePayload(m);
      for (const ref of [m.baseTexture, m.toonTexture, m.sphereTexture]) {
        if (!ref) continue;
        const t = json.textures?.[ref.index];
        if (!t) throw new Error(`${EXTENSION_NAME}: texture index out of bounds`);
        if (!json.images?.[t.source]) throw new Error(`${EXTENSION_NAME}: image index out of bounds`);
      }
    }
    for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
      const m = json.materials?.[primitive.material]?.extensions?.[EXTENSION_NAME];
      if (!m) continue;
      if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error(`${EXTENSION_NAME}: only triangle primitives are supported`);
      for (const set of [m.baseTexture ? baseUVSet(m) : null, m.sphereMode === 'subTexture' ? 1 : null]) {
        if (set !== null && primitive.attributes?.[`TEXCOORD_${set}`] === undefined) throw new Error(`${EXTENSION_NAME}: TEXCOORD_${set} required`);
      }
    }
    return null;
  }
  private view(index: number) {
    const key = `texture:${index}`;
    if (!this.views.has(key)) this.views.set(key, this.parser.getDependency('texture', index).then((t: Texture) => encodedTextureView(t)));
    return this.views.get(key)!;
  }
  loadMaterial(index: number) {
    const def = this.parser.json.materials[index];
    const m = def.extensions?.[EXTENSION_NAME];
    if (m === undefined) return null;
    validatePayload(m);
    return (async () => {
      let toon: Texture | undefined;
      if (m.sharedToonIndex !== undefined) {
        const i = m.sharedToonIndex, name = sharedToonName(i), key = `shared:${i}`;
        if (!this.options.resolveSharedToon) throw new Error(`${EXTENSION_NAME}: missing shared resource ${name}; provide resolveSharedToon`);
        if (!this.views.has(key)) this.views.set(key, Promise.resolve().then(() => this.options.resolveSharedToon!(i, name)).then((t) => encodedTextureView(t, true)));
        toon = await this.views.get(key);
      } else if (m.toonTexture) toon = await this.view(m.toonTexture.index);
      const [base, sphere] = await Promise.all([m.baseTexture ? this.view(m.baseTexture.index) : undefined, m.sphereTexture ? this.view(m.sphereTexture.index) : undefined]);
      const material = createToonMaterial(m, def, { base, sphere, toon }, this.lighting);
      this.parser.associations.set(material, { materials: index });
      return material;
    })().catch((error) => { throw new Error(`${EXTENSION_NAME}: material ${index} (${def.name ?? ''}): ${String(error)}`, { cause: error }); });
  }
  /** Call after disposing the loaded scene's materials/geometries. Resolver-owned originals are retained. */
  async dispose() {
    const results = await Promise.allSettled(this.views.values());
    for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
    this.views.clear();
  }
}
