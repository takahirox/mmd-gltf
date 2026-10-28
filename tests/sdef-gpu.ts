import { WebGPURenderer, Matrix4, Matrix3, Bone, Skeleton, Scene, Color, DirectionalLight, OrthographicCamera, Mesh, Group, BufferGeometry, BufferAttribute, NodeMaterial, RenderTarget, FloatType, NoColorSpace, NoBlending, DoubleSide, Vector3, type SkinnedMesh } from 'three/webgpu';
import { Fn, vec4, float, vertexIndex, positionLocal, normalLocal, varyingProperty } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MMDSDEFPlugin, MMDSDEFExporterPlugin } from '../packages/three-mmd-sdef';
import { setupMMDPosition } from '../packages/three-mmd-sdef/nodes';
import { MMDToonPlugin } from '../packages/three-mmd-toon';
import { MMDOutlinePlugin, MMDOutlineEffect, getOutlineRecords, setOutlineRecords } from '../packages/three-mmd-outline';
import { createVPDRig, parseVPD, bindVPD, applyVPD, resetVPD } from '../packages/three-mmd-vpd';
import { createVMDPlayer, parseVMD, bindVMD, MMDVMDPlugin, getVMDPlayers } from '../packages/three-mmd-vmd';
import { mappings, rigScale } from './vpd-oracle';
import { sdefPrediction, type SDEFState } from './sdef-oracle';
const base=import.meta.env.BASE_URL;
async function run() {
  const renderer=new WebGPURenderer({forceWebGL:true,antialias:false});await renderer.init();renderer.setSize(160,160);document.body.append(renderer.domElement);
  const effect=new MMDOutlineEffect(renderer), scene=new Scene();scene.background=new Color(0xd0d0d0);
  const light=new DirectionalLight(0xffffff,2);light.position.set(1,2,4);scene.add(light);
  const camera=new OrthographicCamera(-1,1,1,-1,0.1,20);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=160;const context=canvas.getContext('2d')!;
  const pixels=()=>{context.drawImage(renderer.domElement,0,0);return context.getImageData(0,0,160,160).data;};
  const difference=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>{let n=0;for(let i=0;i<a.length;i+=4)if([0,1,2].some(j=>Math.abs(a[i+j]-b[i+j])>2))n++;return n;};
  const target=new RenderTarget(24,1,{type:FloatType});target.texture.colorSpace=NoColorSpace;
  const evidence:object[]=[];let maximumPosition=0, maximumNormal=0, fallbackDifference=0;
  // Read actual vertex-stage results through RGBA32F pixels, one quad per vertex.
  const probe=async(mesh:SkinnedMesh, normal:boolean)=>{
    const source=mesh.geometry,g=new BufferGeometry();
    for(const [key,a] of Object.entries(source.attributes)) {
      const data=new Float32Array(a.count*6*a.itemSize);
      for(let i=0;i<a.count;i++)for(let k=0;k<6;k++)for(let c=0;c<a.itemSize;c++)data[(i*6+k)*a.itemSize+c]=a.getComponent(i,c);
      g.setAttribute(key,new BufferAttribute(data,a.itemSize));
    }
    g.morphTargetsRelative=true;
    for(const [key,targets] of Object.entries(source.morphAttributes))g.morphAttributes[key as 'position']=targets!.map(a=>{
      const data=new Float32Array(a.count*18);for(let i=0;i<a.count;i++)for(let k=0;k<6;k++)for(let c=0;c<3;c++)data[(i*6+k)*3+c]=a.getComponent(i,c);
      return new BufferAttribute(data,3);
    });
    const material=new NodeMaterial();material.side=DoubleSide;material.blending=NoBlending;material.depthTest=material.depthWrite=material.toneMapped=false;
    const output=varyingProperty('vec3','sdefProbe');
    material.setupPosition=()=>positionLocal;
    material.vertexNode=Fn(builder=>{
      setupMMDPosition(material,builder);
      output.assign(normal?normalLocal.normalize():positionLocal);
      const corner=vertexIndex.mod(6), x=corner.equal(1).or(corner.equal(3)).or(corner.equal(4)).select(1,0), y=corner.equal(2).or(corner.equal(4)).or(corner.equal(5)).select(1,0);
      return vec4(float(vertexIndex.div(6)).add(x).div(24).mul(2).sub(1),float(y).mul(2).sub(1),0,1);
    })();
    material.fragmentNode=vec4(output,1);
    const savedGeometry=mesh.geometry,savedMaterial=mesh.material;mesh.geometry=g;mesh.material=material;
    const savedVisibility=new Map<Mesh,boolean>();mesh.parent!.traverse(n=>{if((n as Mesh).isMesh){savedVisibility.set(n as Mesh,n.visible);n.visible=n===mesh;}});
    const probeScene=new Scene();
    // Keep source parents/bones intact; renderer can draw the actual mesh through
    // a temporary scene child list without reparenting it.
    probeScene.children=[mesh];mesh.frustumCulled=false;
    renderer.setRenderTarget(target);renderer.render(probeScene,camera);
    const values=await renderer.readRenderTargetPixelsAsync(target,0,0,24,1) as Float32Array;
    renderer.setRenderTarget(null);mesh.geometry=savedGeometry;mesh.material=savedMaterial;
    savedVisibility.forEach((v,m)=>m.visible=v);g.dispose();material.dispose();return values;
  };
  for(const rig of ['box','wedge'] as const)for(const mode of ['toon','pbr'])for(const source of ['bytes','glb','gltf','export-glb','export-gltf'])for(const state of ['pose-a','pose-b','a','b'] as const) {
    // Every rig/material/pose/motion/time remains in the canonical bytes path.
    // Serialization is a Node cross-product plus representative GPU reloads;
    // recompiling identical skinning shaders for every encoding adds no oracle.
    const reloads = [
      ['box','toon','glb','a'], ['wedge','pbr','gltf','b'],
      ['box','pbr','export-glb','pose-a'], ['wedge','toon','export-gltf','pose-b'],
      ['box','toon','export-glb','a'], ['wedge','pbr','export-gltf','b'],
    ];
    if (source !== 'bytes' && !reloads.some(c => c[0]===rig && c[1]===mode && c[2]===source && c[3]===state)) continue;
    if(source.startsWith('export-')&&!state.startsWith('pose-'))continue;
    Object.assign(window,{sdefProgress:{rig,mode,source,state,comparisons:evidence.length,stage:'load'}});
    let sdef!:MMDSDEFPlugin;
    const loader=new GLTFLoader().register(p=>new MMDVMDPlugin(p)).register(p=>sdef=new MMDSDEFPlugin(p)).register(p=>new MMDOutlinePlugin(p));
    if(mode==='toon')loader.register(p=>new MMDToonPlugin(p));
    let asset;
    if(source.startsWith('export-')) {
      const original=await new GLTFLoader().register(p=>new MMDSDEFPlugin(p)).loadAsync(`${base}sdef/${rig}/rest.glb`);
      const pose=state.slice(-1) as 'a'|'b',handle=createVPDRig(original.scene);
      applyVPD(handle,bindVPD(handle,parseVPD(new Uint8Array(await(await fetch(`${base}vpd/pose-${pose}.vpd`)).arrayBuffer()),pose==='b'?'utf-8':'shift_jis'),{mapping:mappings[pose]}));
      const exporter=new GLTFExporter().register(w=>new MMDSDEFExporterPlugin(w));
      const encoded=await exporter.parseAsync(original.scene,{binary:source==='export-glb',includeCustomExtensions:true});
      asset=await loader.parseAsync(encoded instanceof ArrayBuffer?encoded:JSON.stringify(encoded),'');
    } else asset=await loader.loadAsync(`${base}sdef/${rig}/${source==='bytes'?'rest.glb':`${state}.${source}`}`);
    const list:SkinnedMesh[]=[];asset.scene.traverse(n=>{if((n as SkinnedMesh).isSkinnedMesh)list.push(n as SkinnedMesh);});
    if(list.length!==2)throw new Error('Expected multiple SDEF primitives');
    const handle=createVPDRig(asset.scene), posed=state.startsWith('pose-'), id=state.slice(-1) as 'a'|'b';
    let player=getVMDPlayers(asset)[0];
    if(source==='bytes') {
      if(posed)applyVPD(handle,bindVPD(handle,parseVPD(new Uint8Array(await(await fetch(`${base}vpd/pose-${id}.vpd`)).arrayBuffer()),id==='b'?'utf-8':'shift_jis'),{mapping:mappings[id]}));
      else player=createVMDPlayer(handle,bindVMD(handle,parseVMD(new Uint8Array(await(await fetch(`${base}morph/combined-${id}.vmd`)).arrayBuffer())),{mapping:await(await fetch(`${base}vmd/motion-${id}-map.json`)).json(),morphMapping:{'8fce82a2':1}}));
    }
    const scale=rigScale[rig];camera.left=camera.bottom=-2.2*scale;camera.right=camera.top=2.2*scale;camera.position.set(2.5+scale,2+scale,4-2*scale);camera.lookAt(scale,scale,-2*scale);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    for(const time of posed?[0]:[0.371,0.719]) {
      player?.seek(time);asset.scene.updateMatrixWorld(true);
      for(const mesh of list) {
        Object.assign(window,{sdefProgress:{rig,mode,source,state,comparisons:evidence.length,stage:'probe'}});
        const positions=await probe(mesh,false),normals=await probe(mesh,true);
        for(let i=0;i<24;i++) {
          const expected=sdefPrediction(rig,state,i,time),actual=mesh.getVertexPosition(i,new Vector3());
          if(actual.distanceTo(expected.p)>2e-6)throw new Error(`CPU mismatch ${rig}/${state}/${source}/${i}`);
          for(let c=0;c<3;c++) {maximumPosition=Math.max(maximumPosition,Math.abs(positions[i*4+c]-expected.p.getComponent(c)));maximumNormal=Math.max(maximumNormal,Math.abs(normals[i*4+c]-expected.n.getComponent(c)));}
          if(positions[i*4+3]!==1||normals[i*4+3]!==1)throw new Error('GPU probe missing coverage');
        }
      }
      if(maximumPosition>1e-4||maximumNormal>5e-4)throw new Error(`GPU error ${maximumPosition} m / ${maximumNormal} normal`);
      for(const pass of ['surface','outline']) {
        Object.assign(window,{sdefProgress:{rig,mode,source,state,comparisons:evidence.length,stage:pass}});
        const baked=new Group();for(const mesh of list) {
          mesh.frustumCulled=false;const g=mesh.geometry.clone();
          g.morphAttributes={};
          for(let i=0;i<24;i++){const e=sdefPrediction(rig,state,i,time);g.getAttribute('position').setXYZ(i,...e.p.toArray());g.getAttribute('normal').setXYZ(i,...e.n.toArray());}
          g.deleteAttribute('skinIndex');g.deleteAttribute('skinWeight');
          const m=new Mesh(g,mesh.material);m.frustumCulled=false;
          setOutlineRecords(m,getOutlineRecords(mesh).map(r=>({...r,skinAttributes:undefined})));baked.add(m);
          (Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>{m.colorWrite=m.depthWrite=pass==='surface';});
        }
        effect.enabled=pass==='outline';scene.add(asset.scene);effect.render(scene,camera);const actual=pixels();scene.remove(asset.scene);
        scene.add(baked);effect.render(scene,camera);const expected=pixels();scene.remove(baked);
        const mismatch=difference(actual,expected);if(mismatch>128)throw new Error(`Raster ${rig}/${mode}/${source}/${state}/${time}/${pass}: ${mismatch}`);
        if(!actual.some((v,i)=>i%4<3&&v<180))throw new Error('Empty raster');
        evidence.push({rig,mode,source,state,time,pass,oraclePixelMismatches:mismatch});
        baked.children.forEach(n=>(n as Mesh).geometry.dispose());
      }
    }
    player?.stop();resetVPD(handle);
    for(const mesh of list)for(let i=0;i<24;i++)if(mesh.getVertexPosition(i,new Vector3()).distanceTo(sdefPrediction(rig,'rest',i).p)>2e-6)throw new Error('Reset lost rest metadata');
    player?.dispose();effect.release(asset.scene);sdef.dispose();
  }
  // Force the >64 KiB bone texture path, nonidentity rigid bind and scene placement.
  Object.assign(window,{sdefProgress:{stage:'large-palette/bind/placement',comparisons:evidence.length}});
  const stress=await new GLTFLoader().register(p=>new MMDSDEFPlugin(p)).register(p=>new MMDOutlinePlugin(p)).loadAsync(`${base}sdef/box/pose-a.glb`);
  const stressMeshes:SkinnedMesh[]=[];stress.scene.traverse(n=>{if((n as SkinnedMesh).isSkinnedMesh)stressMeshes.push(n as SkinnedMesh);});
  const old=stressMeshes[0].skeleton, bones=[...old.bones], inverses=old.boneInverses.map(m=>m.clone());
  while(bones.length<1100){const bone=new Bone();stress.scene.add(bone);bones.push(bone);inverses.push(new Matrix4());}
  const skeleton=new Skeleton(bones,inverses),bind=new Matrix4().makeRotationY(0.4).setPosition(0.1,-0.2,0.05),inverse=bind.clone().invert();
  for(const mesh of stressMeshes){
    mesh.skeleton=skeleton;mesh.bindMatrix.copy(bind);mesh.geometry.applyMatrix4(inverse);
    for(const key of ['mmdSdefC','mmdSdefR0','mmdSdefR1']){const attr=mesh.geometry.getAttribute(key);for(let i=0;i<attr.count;i++){const p=new Vector3().fromBufferAttribute(attr,i).applyMatrix4(inverse);attr.setXYZ(i,p.x,p.y,p.z);}attr.needsUpdate=true;}
    const direction=new Matrix3().setFromMatrix4(inverse);
    for(const attr of mesh.geometry.morphAttributes.position??[])for(let i=0;i<attr.count;i++){const p=new Vector3().fromBufferAttribute(attr,i).applyMatrix3(direction);attr.setXYZ(i,p.x,p.y,p.z);}
  }
  stress.scene.position.set(0.1,-0.05,0.2);stress.scene.rotation.z=0.3;stress.scene.scale.setScalar(1.1);stress.scene.updateMatrixWorld(true);
  for(const state of ['pose-a','rest','pose-a'] as const){
    if(state==='rest')for(let i=0;i<260;i++){const b=bones[i],r=b.userData.pmxRest;b.position.fromArray(r.translation);b.quaternion.fromArray(r.rotation);b.updateMatrix();}
    if(state==='pose-a')for(let i=0;i<260;i++){const src=old.bones[i];if(state==='pose-a'&&src.userData.stressPose){src.position.fromArray(src.userData.stressPose.p);src.quaternion.fromArray(src.userData.stressPose.q);}else src.userData.stressPose={p:src.position.toArray(),q:src.quaternion.toArray()};}
    stress.scene.updateMatrixWorld(true);
    for(const mesh of stressMeshes){const positions=await probe(mesh,false),normals=await probe(mesh,true);for(let i=0;i<24;i++){const e=sdefPrediction('box',state,i);for(let c=0;c<3;c++){maximumPosition=Math.max(maximumPosition,Math.abs(positions[i*4+c]-e.p.getComponent(c)));maximumNormal=Math.max(maximumNormal,Math.abs(normals[i*4+c]-e.n.getComponent(c)));}}}
    if(maximumPosition>1e-4||maximumNormal>5e-4)throw new Error(`Large-palette/bind/placement GPU error ${maximumPosition}/${maximumNormal}`);
    effect.enabled=true;scene.add(stress.scene);effect.render(scene,camera);scene.remove(stress.scene);
  }
  if(!skeleton.boneTexture)throw new Error('Large palette did not exercise bone texture');
  effect.release(stress.scene);
  // Ordinary loader is measured separately as the documented approximation.
  Object.assign(window,{sdefProgress:{stage:'ordinary fallback',comparisons:evidence.length}});
  const fallback=await new GLTFLoader().loadAsync(`${base}sdef/box/pose-a.glb`);fallback.scene.updateMatrixWorld(true);
  fallback.scene.traverse(n=>{const mesh=n as SkinnedMesh;if(!mesh.isSkinnedMesh)return;for(let i=0;i<24;i++){const actual=mesh.getVertexPosition(i,new Vector3());const predicted=sdefPrediction('box','pose-a',i,0,true).p;if(actual.distanceTo(predicted)>2e-6)throw new Error('Core fallback differs from BDEF2');fallbackDifference=Math.max(fallbackDifference,actual.distanceTo(sdefPrediction('box','pose-a',i).p));}});
  if(fallbackDifference<=0.001)throw new Error('Insufficient SDEF/BDEF2 separation');
  target.dispose();effect.dispose();renderer.dispose();return {passed:evidence.length,maximumPosition,maximumNormal,fallbackDifference,evidence};
}
run().then(result=>Object.assign(window,{sdefConformance:result})).catch(error=>{console.error(error);Object.assign(window,{sdefConformanceError:String(error)});});
