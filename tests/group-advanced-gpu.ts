/** Focused actual GPU group-before-SDEF/QDEF probes; unchanged advanced tolerances. */
import { WebGPURenderer, Scene, OrthographicCamera, Mesh, BufferGeometry, BufferAttribute, NodeMaterial, RenderTarget, FloatType, NoColorSpace, NoBlending, DoubleSide, Vector3, type SkinnedMesh } from 'three/webgpu';
import { Fn, vec4, float, vertexIndex, positionLocal, normalLocal, varyingProperty } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDSDEFPlugin } from '../packages/three-mmd-sdef';
import { MMDQDEFPlugin } from '../packages/three-mmd-qdef';
import { setupMMDPosition } from '../packages/three-mmd-sdef/nodes';
import { createVPDRig } from '../packages/three-mmd-vpd';
import { parseVMD, bindVMD, createVMDPlayer } from '../packages/three-mmd-vmd';
import { sdefPrediction } from './sdef-oracle';
import { qdefPrediction } from './qdef-oracle';
import { groupPoint } from './group-oracle';
async function run() {
  const renderer=new WebGPURenderer({forceWebGL:true,antialias:false});await renderer.init();
  const camera=new OrthographicCamera(-1,1,1,-1,0.1,20);
  const target=new RenderTarget(24,1,{type:FloatType});target.texture.colorSpace=NoColorSpace;
  const evidence:object[]=[];let maximumPosition=0,maximumNormal=0;
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
    const output=varyingProperty('vec3','qdefProbe');
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
  const base=import.meta.env.BASE_URL;
  for(const rig of ['box','wedge'] as const)for(const mode of ['sdef','qdef'] as const)for(const motion of ['a','b'] as const) {
    let plugin!:MMDSDEFPlugin|MMDQDEFPlugin;
    const asset=await new GLTFLoader().register(p=>plugin=mode==='sdef'?new MMDSDEFPlugin(p):new MMDQDEFPlugin(p)).loadAsync(`${base}group/${rig}/${mode}.glb`);
    const handle=createVPDRig(asset.scene);
    const player=createVMDPlayer(handle,bindVMD(handle,parseVMD(new Uint8Array(await(await fetch(`${base}group/group-${motion}.vmd`)).arrayBuffer())),{
      mapping:await(await fetch(`${base}vmd/motion-${motion}-map.json`)).json(),morphMapping:await(await fetch(`${base}group/group-map.json`)).json()}));
    const time=0.719;player.seek(time);
    const list:SkinnedMesh[]=[];asset.scene.traverse(n=>{if((n as SkinnedMesh).isSkinnedMesh)list.push(n as SkinnedMesh);});
    for(const mesh of list) {
      const positions=await probe(mesh,false),normals=await probe(mesh,true);
      for(let i=0;i<24;i++) {
        const predict=mode==='sdef'?sdefPrediction:qdefPrediction;
        const expected=predict(rig,motion,i,time,false,p=>groupPoint(rig,motion,i,time,p));
        for(let c=0;c<3;c++) {
          maximumPosition=Math.max(maximumPosition,Math.abs(positions[i*4+c]-expected.p.getComponent(c)));
          maximumNormal=Math.max(maximumNormal,Math.abs(normals[i*4+c]-expected.n.getComponent(c)));
        }
        if(positions[i*4+3]!==1||normals[i*4+3]!==1)throw new Error('Missing group GPU probe coverage');
        if(mesh.getVertexPosition(i,new Vector3()).distanceTo(expected.p)>2e-6)throw new Error('Group advanced CPU mismatch');
      }
    }
    evidence.push({rig,mode,motion,time,maximumPosition,maximumNormal});
    player.dispose();plugin.dispose();
    asset.scene.traverse(n=>{const m=n as Mesh;if(m.isMesh){m.geometry.dispose();for(const material of Array.isArray(m.material)?m.material:[m.material])material.dispose();}});
  }
  target.dispose();renderer.dispose();
  if(maximumPosition>1e-4||maximumNormal>5e-4)throw new Error(`Group GPU range ${maximumPosition} / ${maximumNormal}`);
  return {evidence,maximumPosition,maximumNormal};
}
run().then(result=>Object.assign(window,{groupAdvanced:result})).catch(error=>Object.assign(window,{groupAdvancedError:String(error)}));
