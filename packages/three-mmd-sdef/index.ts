import { Vector3, type Vector4, InterleavedBuffer, InterleavedBufferAttribute, MeshStandardMaterial, type Material, type SkinnedMesh } from 'three';
import { MeshStandardNodeMaterial, type NodeMaterial } from 'three/webgpu';
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { decodeAccessor } from '../three-mmd-outline/validation';
import { EXTENSION_NAME, fields, attributes, validatePayload, type SDEFPayload } from './payload';
import { applySDEF, validateSDEFTransforms } from './cpu';
import { setupMMDPosition, hasSdef } from './nodes';
export { EXTENSION_NAME } from './payload';
export { applySDEF, evaluateSDEF, validateSDEFTransforms } from './cpu';
export { MMDSDEFExporterPlugin } from './exporter';

/** Instance-scoped loader integration. No dependency on activating Toon. */
export class MMDSDEFPlugin implements GLTFLoaderPlugin {
  readonly name = EXTENSION_NAME;
  private decoded = new Map<string, number[][]>();
  private releases: (() => void)[] = [];
  constructor(private parser: GLTFParser) {}
  async beforeRoot() {
    const json = this.parser.json;
    for (const [mi, mesh] of (json.meshes ?? []).entries()) for (const [pi, p] of mesh.primitives.entries()) {
      const value = p.extensions?.[EXTENSION_NAME];
      if (value === undefined) continue;
      validatePayload(value);
      if ((p.mode ?? 4) !== 4) throw new Error(`${EXTENSION_NAME}: triangle primitives required`);
      if (!json.extensionsUsed?.includes(EXTENSION_NAME)) throw new Error(`${EXTENSION_NAME}: extensionsUsed declaration required`);
      const count = json.accessors?.[p.attributes?.POSITION]?.count;
      const positions = await decodeAccessor(this.parser, p.attributes?.POSITION, 'VEC3', [5126], EXTENSION_NAME);
      const normals = await decodeAccessor(this.parser, p.attributes?.NORMAL, 'VEC3', [5126], EXTENSION_NAME);
      if (positions.length !== normals.length) throw new Error(`${EXTENSION_NAME}: normal count`);
      const arrays = await Promise.all(fields.map((key, i) => decodeAccessor(this.parser, value[key], i === 0 ? 'SCALAR' : 'VEC3', i === 0 ? [5121] : [5126], `${EXTENSION_NAME} ${mi}/${pi} ${key}`)));
      if (arrays.some((a, i) => a.length !== count * (i === 0 ? 1 : 3)) || arrays[0].some(x => x !== 0 && x !== 1)) throw new Error(`${EXTENSION_NAME}: invalid selection/count`);
      if (Object.keys(p.attributes).some(k => /^(JOINTS|WEIGHTS)_[1-9]/.test(k))) throw new Error(`${EXTENSION_NAME}: only JOINTS_0/WEIGHTS_0 supported`);
      const joints = await decodeAccessor(this.parser, p.attributes.JOINTS_0, 'VEC4', [5121, 5123], EXTENSION_NAME);
      const weights = await decodeAccessor(this.parser, p.attributes.WEIGHTS_0, 'VEC4', [5126], EXTENSION_NAME);
      if (joints.length !== count * 4 || weights.length !== count * 4 || weights.some(w => w < 0 || w > 1)) throw new Error(`${EXTENSION_NAME}: invalid influence layout`);
      const nodes = (json.nodes ?? []).filter((n: any) => n.mesh === mi);
      if (!nodes.length || nodes.some((n: any) => !json.skins?.[n.skin]?.joints?.length)) throw new Error(`${EXTENSION_NAME}: skin required for every instance`);
      for (const node of nodes) if (joints.some(j => j >= json.skins[node.skin].joints.length)) throw new Error(`${EXTENSION_NAME}: joint bounds`);
      for (let i = 0; i < count; i++) if (arrays[0][i] === 1 && (weights[i * 4 + 2] !== 0 || weights[i * 4 + 3] !== 0 || Math.abs(weights[i * 4] + weights[i * 4 + 1] - 1) > 1e-6)) throw new Error(`${EXTENSION_NAME}: ordered pair weights required`);
      this.decoded.set(`${mi}/${pi}`, arrays);
    }
  }
  async afterRoot(result: GLTF) {
    if (!this.decoded.size) return;
    result.scenes.forEach(scene => scene.updateMatrixWorld(true));
    const meshes = new Set<SkinnedMesh>();
    result.scenes.forEach(s => s.traverse(n => { if ((n as SkinnedMesh).isSkinnedMesh) meshes.add(n as SkinnedMesh); }));
    for (const mesh of meshes) {
      const a = this.parser.associations.get(mesh), data = this.decoded.get(`${a?.meshes}/${a?.primitives}`);
      if (!data) continue;
      const originalGeometry = mesh.geometry, geometry = originalGeometry.clone();
      const interleaved = new Float32Array(data[0].length * 10);
      for (let i = 0; i < data[0].length; i++) {
        interleaved[i * 10] = data[0][i];
        for (let j = 1; j < 4; j++) interleaved.set(data[j].slice(i * 3, i * 3 + 3), i * 10 + 1 + (j - 1) * 3);
      }
      const buffer = new InterleavedBuffer(interleaved, 10);
      attributes.forEach((key, i) => geometry.setAttribute(key, new InterleavedBufferAttribute(buffer, i === 0 ? 1 : 3, i === 0 ? 0 : 1 + (i - 1) * 3)));
      mesh.geometry = geometry;
      const originalApply = mesh.applyBoneTransform;
      const originalBefore = mesh.onBeforeRender;
      const originalMaterial = mesh.material;
      const owned: NodeMaterial[] = [];
      const convert = (source: Material) => {
        let material: NodeMaterial;
        if ((source as NodeMaterial).isNodeMaterial) material = source.clone() as NodeMaterial;
        else if ((source as MeshStandardMaterial).isMeshStandardMaterial) {
          material = new MeshStandardNodeMaterial();
          // r186 NodeMaterial.copy also expects node fields. Copy standard fields
          // with MeshStandardMaterial's own implementation before installing nodes.
          MeshStandardMaterial.prototype.copy.call(material, source);
        } else throw new Error(`${EXTENSION_NAME}: unsupported surface material ${source.type}`);
        const original = material.setupPosition;
        material.setupPosition = function(builder) { return hasSdef(builder) ? setupMMDPosition(this, builder) : original.call(this, builder); };
        material.customProgramCacheKey = () => `${source.customProgramCacheKey()}:MMD_skinning_sdef-v1`;
        const association = this.parser.associations.get(source);
        if (association) this.parser.associations.set(material, association);
        owned.push(material); return material;
      };
      mesh.material = Array.isArray(originalMaterial) ? originalMaterial.map(convert) : convert(originalMaterial);
      mesh.applyBoneTransform = function<T extends Vector3 | Vector4>(this: SkinnedMesh, index: number, target: T): T {
        if (this.geometry.getAttribute('mmdSkinningType').getX(index) !== 1) { originalApply.call(this, index, target); return target; }
        const p = applySDEF(this, index, new Vector3(target.x, target.y, target.z));
        if ('w' in target && target.w !== 1) p.addScaledVector(applySDEF(this, index, new Vector3()), target.w - 1);
        target.x = p.x; target.y = p.y; target.z = p.z; return target;
      };
      mesh.onBeforeRender = function(...args) {
        validateSDEFTransforms(this as SkinnedMesh);
        (this as SkinnedMesh).skeleton.update();
        originalBefore.apply(this, args);
      };
      mesh.updateWorldMatrix(true, false);
      validateSDEFTransforms(mesh);
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      this.releases.push(() => {
        mesh.geometry = originalGeometry; mesh.material = originalMaterial;
        mesh.applyBoneTransform = originalApply; mesh.onBeforeRender = originalBefore;
        geometry.dispose(); owned.forEach(m => m.dispose());
      });
    }
  }
  /** Restore instance hooks/materials/geometry; source resources remain caller-owned. */
  dispose() { this.releases.splice(0).forEach(release => release()); this.decoded.clear(); }
}
