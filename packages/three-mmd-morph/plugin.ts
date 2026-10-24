import type { Mesh, Object3D } from 'three';
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { EXTENSION_NAME, validateMorphPayload, morphIdentity, type MorphPayload } from '../mmd-morph/payload';
import { reduceMorphs } from '../mmd-morph';
import { registerMorphState } from './state';
import { motionScope } from '../three-mmd-vpd/ownership';
import { getSolverModel } from '../three-mmd-solver';
const retained=new WeakMap<Object3D,MorphPayload>();
export function retainedMorph(root:Object3D) { return retained.get(root) ?? retained.get(motionScope(root)); }
const pending=new WeakMap<GLTFParser,Promise<void>>();
export class MMDMorphPlugin implements GLTFLoaderPlugin {
  readonly name=EXTENSION_NAME;
  constructor(private parser:GLTFParser) {}
  beforeRoot() {
    const j=this.parser.json,p=j.extensions?.[EXTENSION_NAME] as MorphPayload | undefined;
    if(!p)return null;
    validateMorphPayload(p,j.nodes?.length??0);
    const parents=new Map<number,number>();
    for(const [i,n] of (j.nodes??[]).entries()) for(const c of n.children??[]) {
      if(parents.has(c))throw new Error('MMD_morphs: multiple parents');parents.set(c,i);
    }
    const boneNodes=new Set(p.nodes.map(b=>b.node)),roots=p.model.bones!.filter(b=>b.parentIndex===-1),bySource=new Map(p.nodes.map(b=>[b.index,b.node]));
    if(new Set(roots.map(b=>parents.get(bySource.get(b.index)!))).size>1 || roots.some(b=>boneNodes.has(parents.get(bySource.get(b.index)!)!)))throw new Error('MMD_morphs: roots require one common model frame');
    const byIndex=new Map(p.nodes.map(b=>[b.index,b.node]));
    for(const b of p.model.bones!) {
      const node=byIndex.get(b.index)!,def=j.nodes[node];
      if(def.matrix || (def.scale??[1,1,1]).some((v:number)=>v!==1) ||
          (b.parentIndex!==-1 && parents.get(node)!==byIndex.get(b.parentIndex))) throw new Error('MMD_morphs: bone hierarchy/TRS mismatch');
      if(def.extras?.pmxRest) {
        const {modelId,metersPerPMXUnit,...rest}=def.extras.pmxRest;
        if(modelId!==p.model.modelId || metersPerPMXUnit!==p.model.metersPerPMXUnit || morphIdentity(rest)!==morphIdentity(b))throw new Error('MMD_morphs: overlapping bone metadata differs');
      }
    }
    for(const n of j.nodes??[]) if(n.extras?.mmdPose && (n.extras.mmdPose.modelId!==p.model.modelId || n.extras.mmdPose.boneCount!==p.nodes.length || n.extras.mmdPose.metersPerPMXUnit!==p.model.metersPerPMXUnit))throw new Error('MMD_morphs: overlapping model metadata differs');
    if(j.extensions?.MMD_skeleton_solver && j.extensions.MMD_skeleton_solver.bones.length!==p.nodes.length)throw new Error('MMD_morphs: solver bone count differs');
    for(const n of j.nodes??[]) if(n.extras?.pmxMorph && morphIdentity(n.extras.pmxMorph)!==morphIdentity(p.model))
      throw new Error('MMD_morphs: overlapping morph metadata differs');
    if(j.extensions?.MMD_skeleton_solver) for(const b of j.extensions.MMD_skeleton_solver.bones) {
      const rest=p.model.bones!.find(v=>v.index===b.index);
      if(!rest || byIndex.get(b.index)!==b.node || morphIdentity([rest.translation,rest.rotation,rest.parentIndex])!==morphIdentity([b.translation,b.rotation,b.parentIndex]))
        throw new Error('MMD_morphs: overlapping solver differs');
    }
    const targets=reduceMorphs(p.model,p.weights).targets;
    for(const node of p.meshes??[]) {
      const mesh=j.meshes?.[j.nodes[node].mesh];
      if(!mesh || mesh.primitives.some((v:any)=>(v.targets?.length??0)!==targets.length || (v.targets??[]).some((t:any)=>!Number.isInteger(t.POSITION))) ||
          morphIdentity(j.nodes[node].weights??mesh.weights??targets.map(()=>0))!==morphIdentity(targets))
        throw new Error('MMD_morphs: geometry target snapshot/layout differs');
    }
    return null;
  }
  afterRoot(result:GLTF) { return ensureMorphLoaded(this.parser,result); }
}
/** Idempotent so retained VMD playback does not depend on plugin registration order. */
export function ensureMorphLoaded(parser:GLTFParser,result:GLTF):Promise<void> {
  if(pending.has(parser))return pending.get(parser)!;
  const job=(async()=>{
    const p=parser.json.extensions?.[EXTENSION_NAME] as MorphPayload | undefined;if(!p)return;
    new MMDMorphPlugin(parser).beforeRoot();
    const nodes=new Map<number,Object3D>();
    for(const b of p.nodes) {
      const n=await parser.getDependency('node',b.node);
      if(!result.scene.getObjectById(n.id))throw new Error('MMD_morphs: joint outside default scene');nodes.set(b.index,n);
    }
    const meshes:Mesh[]=[];
    for(const index of p.meshes??[]) {
      const node=await parser.getDependency('node',index);
      if(!result.scene.getObjectById(node.id))throw new Error('MMD_morphs: mesh outside default scene');
      const collect=(n:Object3D)=>{
        if(n!==node && parser.associations.get(n)?.nodes!==undefined)return;
        if((n as Mesh).isMesh)meshes.push(n as Mesh);n.children.forEach(collect);
      };collect(node);
    }
    const model=structuredClone(p.model);
    retained.set(result.scene,structuredClone(p));retained.set(motionScope(result.scene),structuredClone(p));
    // Retain data and visible core TRS; never apply offsets during loading.
    registerMorphState(result.scene,{model,nodes,meshes,raw:structuredClone(p.raw??model.bones!),controls:[...p.weights],solver:getSolverModel(result.scene)?.profile ?? parser.json.extensions?.MMD_skeleton_solver});
  })();pending.set(parser,job);return job;
}
