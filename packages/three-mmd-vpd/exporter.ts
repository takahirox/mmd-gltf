import { getSolverModel } from '../three-mmd-solver';
import { EXTENSION_NAME, validateSolver } from '../mmd-solver';
import type { Object3D, SkinnedMesh } from 'three';
import type { GLTFWriter } from 'three/addons/exporters/GLTFExporter.js';
interface R186Writer {
  nodeMap: Map<Object3D, number>;
  extensionsUsed: Record<string,boolean>;
  json: { extensions?: Record<string,unknown>; nodes?: { skin?: number; matrix?: number[]; translation?:number[];rotation?:number[];scale?:number[] }[]; skins?: { skeleton?: number }[] };
}
/** r186 exports bones[0] as skin.skeleton, even for multi-root MMD rigs.
 * Omit that optional hint when it is not a common ancestor; keep joints, their
 * order, inverse binds, source metadata and applied transforms unchanged. */
export class MMDVPDExporterPlugin {
  readonly name = 'MMD_pose_export';
  private writer: R186Writer;
  constructor(writer: GLTFWriter) { this.writer = writer as unknown as R186Writer; }
  afterParse(input: Object3D | Object3D[]) {
    const roots = Array.isArray(input) ? input : [input];
    const solverNodes = new Set<Object3D>();
    for (const root of roots) root.traverse(object => {
      if(object.userData.pmxBone){
        const index=this.writer.nodeMap.get(object),def=index===undefined?undefined:this.writer.json.nodes?.[index];
        if(def?.matrix){delete def.matrix;def.translation=object.position.toArray();def.rotation=object.quaternion.toArray();def.scale=object.scale.toArray();}
      }
      const retained=getSolverModel(object);
      if(object.userData.mmdSolver || retained && ![...retained.nodes.values()].some(n=>n.userData.pmxBone)) {
        if(this.writer.json.extensions?.[EXTENSION_NAME])throw new Error('Solver export: one model per asset required');
        const profile=structuredClone(object.userData.mmdSolver ?? retained!.profile);
        const nodes=new Map<number,Object3D>(retained?.nodes);object.traverse(n=>{if(n.userData.pmxBone)nodes.set(n.userData.pmxBone.index,n);});
        profile.bones.forEach((b:{index:number;node?:number})=>{
          const node=nodes.get(b.index)!;solverNodes.add(node);b.node=this.writer.nodeMap.get(node);
          const def=b.node===undefined?undefined:this.writer.json.nodes?.[b.node];
          if(def?.matrix){delete def.matrix;def.translation=node.position.toArray();def.rotation=node.quaternion.toArray();def.scale=node.scale.toArray();}
        });
        validateSolver(profile,this.writer.json.nodes?.length??0);
        this.writer.json.extensions={...this.writer.json.extensions,[EXTENSION_NAME]:profile};this.writer.extensionsUsed[EXTENSION_NAME]=true;
      }
    });
    // Collect all solver joints first: a skin can precede its retained model root.
    for (const root of roots) root.traverse(object => {
      const mesh = object as SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.skeleton.bones.every(b => b.userData.pmxBone || solverNodes.has(b))) return;
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
