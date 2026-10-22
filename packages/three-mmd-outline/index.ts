import { Float32BufferAttribute, Uint16BufferAttribute, Mesh, type Material, type MeshStandardMaterial } from 'three';
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { EXTENSION_NAME } from './payload';
import { decodeAccessor, validateAsset } from './validation';
import { setOutlineRecords, removeOutlineRecords, type OutlineRecord } from './metadata';
export { EXTENSION_NAME, EDGE_ATTRIBUTE } from './payload';
export type { OutlinePayload } from './payload';
export { MMDOutlineEffect } from './effect';
export { getOutlineRecords, setOutlineRecords, removeOutlineRecords } from './metadata';
export type { OutlineRecord } from './metadata';
export interface OutlinePluginOptions {
  /** Override for another active material model. Must return its current finite diffuse factor alpha. */
  getDiffuseAlpha?: (material: Material) => number;
}
/** Uses beforeRoot for raw validation and afterRoot for GLTFLoader's final instance/primitive associations. */
export class MMDOutlinePlugin implements GLTFLoaderPlugin {
  readonly name = EXTENSION_NAME;
  private meshes = new Set<Mesh>();
  private alphaMetadata = new Set<Material>();
  constructor(private readonly parser: GLTFParser, private readonly options: OutlinePluginOptions = {}) {}
  async beforeRoot() { await validateAsset(this.parser); }
  async afterRoot(result: GLTF) {
    const meshes = new Set<Mesh>();
    for (const scene of result.scenes) scene.traverse(object => { if ((object as Mesh).isMesh) meshes.add(object as Mesh); });
    for (const mesh of meshes) {
      const association = this.parser.associations.get(mesh);
      if (association?.meshes === undefined || association.primitives === undefined) continue;
      const primitive = this.parser.json.meshes[association.meshes].primitives[association.primitives];
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some(material => this.parser.json.materials?.[this.parser.associations.get(material)?.materials ?? primitive.material]?.extensions?.[EXTENSION_NAME] !== undefined)) continue;
      const skinAttributes: NonNullable<OutlineRecord['skinAttributes']> = [];
      for (const semantic of Object.keys(primitive.attributes ?? {}).filter(s => /^JOINTS_\d+$/.test(s)).sort()) {
        const set = semantic.split('_')[1];
        const joints = await decodeAccessor(this.parser, primitive.attributes[semantic], 'VEC4', [5121, 5123], `mesh ${association.meshes} ${semantic}`);
        const weights = await decodeAccessor(this.parser, primitive.attributes[`WEIGHTS_${set}`], 'VEC4', [5126, 5121, 5123], `mesh ${association.meshes} WEIGHTS_${set}`, true);
        skinAttributes.push({ joints: new Uint16BufferAttribute(joints, 4), weights: new Float32BufferAttribute(weights, 4) });
      }
      const entries: OutlineRecord[] = materials.flatMap((material, materialIndex) => {
        const materialId = this.parser.associations.get(material)?.materials ?? primitive.material;
        const def = this.parser.json.materials?.[materialId];
        const payload = def?.extensions?.[EXTENSION_NAME];
        if (payload === undefined) return [];
        let alpha = this.options.getDiffuseAlpha;
        if (!alpha && material.userData.mmdMaterialModel === 'MMD_materials_toon') alpha = m => m.userData.mmdDiffuseFactor[3];
        if (!alpha && typeof material.userData.mmdDiffuseAlpha === 'function') alpha = m => m.userData.mmdDiffuseAlpha();
        if (!alpha && (material as MeshStandardMaterial).isMeshStandardMaterial) {
          // GLTFLoader forces opacity=1 for OPAQUE. Retain its factor separately in that case.
          if ((def.alphaMode ?? 'OPAQUE') === 'OPAQUE') {
            this.alphaMetadata.add(material);
            material.userData.mmdBaseFactorAlpha = def.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1;
            alpha = m => m.userData.mmdBaseFactorAlpha;
          } else alpha = m => m.opacity;
        }
        if (!alpha) throw new Error(`${EXTENSION_NAME}: material ${primitive.material}: unsupported material-alpha integration`);
        const value = alpha(material);
        if (!Number.isFinite(value)) throw new Error(`${EXTENSION_NAME}: material ${primitive.material}: diffuse alpha must be finite`);
        return [{ payload: structuredClone(payload), materialIndex, getDiffuseAlpha: alpha, skinAttributes }];
      });
      if (!entries.length) continue;
      setOutlineRecords(mesh, entries);
      this.meshes.add(mesh);
    }
  }
  /** Detach metadata; source materials, geometry and textures remain application-owned. Dispose effects separately. */
  dispose() {
    for (const mesh of this.meshes) removeOutlineRecords(mesh);
    this.meshes.clear();
    for (const material of this.alphaMetadata) delete material.userData.mmdBaseFactorAlpha;
    this.alphaMetadata.clear();
  }
}
