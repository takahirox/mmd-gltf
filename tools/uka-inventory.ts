import type { PMXModel } from './pmx-to-gltf';
import type { VMD } from '../packages/mmd-vmd';
const counts = (values: number[]) => Object.fromEntries([...new Set(values)].sort((a,b)=>a-b).map(k=>[k,values.filter(v=>v===k).length]));
export function inventoryUka(model: PMXModel, motion: VMD) {
  const sections = ['bones','morphs','cameras','lights','shadows','displays'] as const;
  return {
    vertices: model.vertices.length, faces: model.faces.length, materials: model.materials.length,
    skinningTypes: counts(model.vertices.map(v=>v.type!)),
    textures: model.textures.map(p=>p.replaceAll('\\','/')),
    materialReferences: model.materials.map(m=>({name:m.name,texture:m.textureIndex,sphere:m.envTextureIndex,sphereMode:m.envFlag,toon:m.toonFlag===0?{texture:m.toonIndex}:{shared:m.toonIndex},faces:m.faceCount})),
    morphTypes: counts(model.morphs.map(m=>m.type)),
    morphs: model.morphs.map((m,index)=>({index,name:m.name,type:m.type,elements:m.elementCount,...(m.type===0?{group:m.elements}:{})})),
    bones: model.bones.length,
    ik: model.bones.flatMap((b,index)=>b.ik?[{index,name:b.name,...b.ik}]:[]),
    grants: model.bones.flatMap((b,index)=>b.grant?[{index,name:b.name,...b.grant}]:[]),
    fixedAxes: model.bones.filter(b=>!!((b.flag??0)&0x400)).length,
    localAxes: model.bones.filter(b=>!!((b.flag??0)&0x800)).length,
    afterPhysics: model.bones.filter(b=>!!((b.flag??0)&0x1000)).length,
    externalParents: model.bones.filter(b=>!!((b.flag??0)&0x2000)).length,
    rigidBodies: model.rigidBodies.length, joints: model.constraints.length,
    rigidBodyTypes: counts(model.rigidBodies.map(b=>(b as {type:number}).type)),
    jointTypes: counts(model.constraints.map(b=>(b as {type:number}).type)),
    motion: {path:'motion/03_smile.vmd',modelName:motion.modelName.text,
      records:Object.fromEntries(sections.map(k=>[k,motion[k].length])),
      lastFrame:Math.max(...sections.flatMap(k=>motion[k].map(v=>v.frame))),
      boneTracks:[...new Map(motion.bones.map(v=>[v.name.key,{key:v.name.key,name:v.name.text,sourceMatches:model.bones.flatMap((b,i)=>b.name===v.name.text?[i]:[])}])).values()],
      morphTracks:[...new Map(motion.morphs.map(v=>[v.name.key,{key:v.name.key,name:v.name.text,sourceMatches:model.morphs.flatMap((m,i)=>m.name===v.name.text?[i]:[])}])).values()],
      displays:motion.displays,
      execution:'Not played. Names include truncated/unmatched tracks; modelName is informational. This demo uses manual vertex expressions, not this motion or IK/physics.'},
  };
}
