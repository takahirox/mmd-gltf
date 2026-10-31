import { MMDLoader } from '@takahirox/three-mmd/loaders/MMDLoader.js';
import type { LoadingManager } from 'three';
import { resolveMMDResourcePath } from '../packages/mmd-resource-path';

/** Scoped to @takahirox/three-mmd 0.1.2 until the accompanying upstream patch
 * ships. Resolve before PMD role classification and cache/handler lookup for
 * every texture family. Never mutate parser records or vendor files.
 */
export function createMMDLoader(manager?: LoadingManager): MMDLoader {
  const loader = new MMDLoader(manager);
  const builder = loader.meshBuilder.materialBuilder;
  const build = builder.build;
  builder.build = function (data, geometry, onProgress, onError) {
    if (data.metadata.format !== 'pmd') return build.call(this, data, geometry, onProgress, onError);
    // 0.1.2 classifies PMD sphere maps by filename suffix before _loadTexture.
    // Use build-local role aliases so queries/fragments cannot hide (or fake) a
    // sphere suffix. Map back before resolving/loading; aliases never reach the
    // cache, handlers, requests or original source records.
    const paths = new Map<string, string>();
    const canonical = { ...data, materials: data.materials.map((material: { fileName: string }) => ({ ...material,
      fileName: material.fileName.split('*').map(name => {
        if (!name) return name;
        const path = resolveMMDResourcePath('', name);
        const extension = new URL(path, 'https://mmd.invalid/').pathname.slice(-4).toLowerCase();
        const alias = `mmd-compat-${paths.size}${extension === '.sph' || extension === '.spa' ? extension : ''}`;
        paths.set(alias, path);
        return alias;
      }).join('*'),
    })) };
    const loadTexture = this._loadTexture;
    this._loadTexture = function (filePath, textures, params, onProgress, onError) {
      // Toon filenames are independent of the base/sphere classification aliases.
      const path = params?.isToonTexture ? filePath : paths.get(filePath) ?? filePath;
      return loadTexture.call(this, path, textures, params, onProgress, onError);
    };
    try {
      const materials = build.call(this, canonical, geometry, onProgress, onError);
      materials.forEach((material, index) => { material.userData.MMD.sourceFileName = data.materials[index].fileName; });
      return materials;
    } finally { this._loadTexture = loadTexture; }
  };
  const loadTexture = builder._loadTexture;
  builder._loadTexture = function (filePath, textures, params, onProgress, onError) {
    if (params?.isDefaultToonTexture) return loadTexture.call(this, filePath, textures, params, onProgress, onError);
    const fullPath = resolveMMDResourcePath(this.resourcePath, filePath);
    const base = this.resourcePath;
    const manager = this.manager;
    // 0.1.2 examines the final four URL characters. Queries/fragments must not
    // choose the decoder, while handlers, requests and cache keep the whole URL.
    const pathname = new URL(fullPath, 'https://mmd.invalid/').pathname;
    const fallback = pathname.toLowerCase().endsWith('.tga') ? this._getTGALoader() : this.textureLoader;
    this.manager = { ...manager, getHandler: url => manager.getHandler(url) ?? fallback };
    this.resourcePath = '';
    try { return loadTexture.call(this, fullPath, textures, params, onProgress, onError); }
    finally { this.resourcePath = base; this.manager = manager; }
  };
  return loader;
}
