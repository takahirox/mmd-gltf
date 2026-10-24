import type { Object3D, SkinnedMesh } from 'three';
import type { GLTFWriter } from 'three/addons/exporters/GLTFExporter.js';
interface R186Writer {
  nodeMap: Map<Object3D, number>;
  json: { nodes?: { skin?: number }[]; skins?: { skeleton?: number }[] };
}
/** r186 exports bones[0] as skin.skeleton, even for multi-root PMX rigs.
 * Omit that optional hint when it is not a common ancestor; keep joints, their
 * order, inverse binds, source metadata and applied transforms unchanged. */
export class MMDVPDExporterPlugin {
  readonly name = 'MMD_pose_export';
  private writer: R186Writer;
  constructor(writer: GLTFWriter) { this.writer = writer as unknown as R186Writer; }
  afterParse(input: Object3D | Object3D[]) {
    for (const root of Array.isArray(input) ? input : [input]) root.traverse(object => {
      const mesh = object as SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.skeleton.bones.every(b => b.userData.pmxBone)) return;
      const first = mesh.skeleton.bones[0];
      const common = mesh.skeleton.bones.every(b => {
        for (let node: Object3D | null = b; node; node = node.parent) if (node === first) return true;
        return false;
      });
      if (common) return;
      const index = this.writer.nodeMap.get(mesh);
      const skin = index === undefined ? undefined : this.writer.json.nodes?.[index]?.skin;
      if (skin !== undefined && this.writer.json.skins?.[skin]) delete this.writer.json.skins[skin].skeleton;
    });
  }
}
