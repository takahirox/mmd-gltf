import { MMDLoader } from '@takahirox/three-mmd/loaders/MMDLoader.js';
import type { LoadingManager } from 'three';
import { resolveMMDResourcePath } from '../packages/mmd-resource-path';

/** Scoped to @takahirox/three-mmd 0.1.2 until the accompanying upstream patch
 * ships. Resolve at MaterialBuilder's entry point, before cache/handler lookup,
 * for every texture family. Never mutate parser records or vendor files.
 */
export function createMMDLoader(manager?: LoadingManager): MMDLoader {
  const loader = new MMDLoader(manager);
  const builder = loader.meshBuilder.materialBuilder;
  const loadTexture = builder._loadTexture;
  builder._loadTexture = function (filePath, textures, params, onProgress, onError) {
    if (params?.isDefaultToonTexture) return loadTexture.call(this, filePath, textures, params, onProgress, onError);
    const fullPath = resolveMMDResourcePath(this.resourcePath, filePath);
    const base = this.resourcePath;
    this.resourcePath = '';
    try { return loadTexture.call(this, fullPath, textures, params, onProgress, onError); }
    finally { this.resourcePath = base; }
  };
  return loader;
}
