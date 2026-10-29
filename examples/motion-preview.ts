import { BufferGeometry, type Mesh, type Object3D } from 'three';

/** Render-only projection. Player metadata, CPU target order and identities stay intact.
 * Only motion-active (plus manual) buffers enter the GPU morph texture. */
export function motionPreview(root: Object3D, indices: (mesh: Mesh) => number[]) {
  const entries: {mesh:Mesh; geometry:BufferGeometry; compact:BufferGeometry; indices:number[]; weights:number[]}[]=[];
  root.traverse(object=>{
    const mesh=object as Mesh;
    if(!mesh.isMesh)return;
    const selected=indices(mesh);
    if(selected.some(i=>!Number.isInteger(i) || !mesh.geometry.morphAttributes.position?.[i]))throw new Error('Motion preview: missing active target');
    const source=mesh.geometry, compact=new BufferGeometry();
    compact.index=source.index; compact.attributes={...source.attributes};
    compact.userData={...source.userData};
    compact.groups=source.groups.map(g=>({...g}));compact.drawRange={...source.drawRange};
    compact.morphTargetsRelative=source.morphTargetsRelative;
    for(const [key,attributes] of Object.entries(source.morphAttributes))compact.morphAttributes[key as 'position']=selected.map(i=>attributes[i]);
    compact.boundingBox=source.boundingBox;compact.boundingSphere=source.boundingSphere;
    entries.push({mesh,geometry:source,compact,indices:selected,weights:[]});
  });
  return {
    targets: entries.map(e=>e.indices.length),
    bytes: entries.reduce((sum,e)=>sum+Object.values(e.compact.morphAttributes).flat().reduce((n,a)=>n+a.array.byteLength,0),0),
    begin() { for(const e of entries) {e.geometry=e.mesh.geometry;e.weights=e.mesh.morphTargetInfluences??[];e.compact.boundingBox=e.geometry.boundingBox;e.compact.boundingSphere=e.geometry.boundingSphere;e.mesh.geometry=e.compact;e.mesh.morphTargetInfluences=e.indices.map(i=>e.weights[i]);} },
    end() {for(const e of entries){e.mesh.geometry=e.geometry;e.mesh.morphTargetInfluences=e.weights;}},
    dispose(){for(const e of entries)e.compact.dispose();},
  };
}
