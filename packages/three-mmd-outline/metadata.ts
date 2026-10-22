import type { Material, Mesh, BufferAttribute } from 'three';
import { validatePayload, type OutlinePayload } from './payload';
export interface OutlineRecord {
  /** Mutable factors; no geometry or source material is replaced. */
  payload: OutlinePayload;
  /** Index in mesh.material for multi-material meshes. */
  materialIndex: number;
  /** Raw core skin factors, retained independently of GLTFLoader normalization. */
  skinAttributes?: { joints: BufferAttribute; weights: BufferAttribute }[];
  getDiffuseAlpha: (material: Material) => number;
}
const records = new WeakMap<Mesh, OutlineRecord[]>();
/** For explicit other-material integrations and procedural geometry. Return the current factor, before textures/coverage. */
export function setOutlineRecords(mesh: Mesh, value: OutlineRecord[]) {
  for (const record of value) validatePayload(record.payload);
  records.set(mesh, value);
}
export const getOutlineRecords = (mesh: Mesh) => records.get(mesh) ?? [];
export const removeOutlineRecords = (mesh: Mesh) => { records.delete(mesh); };
