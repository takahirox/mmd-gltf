/** Focused actual GPU group-before-SDEF/QDEF probes; unchanged advanced tolerances. */
import { WebGPURenderer, Scene, OrthographicCamera, Mesh, BufferGeometry, BufferAttribute, NodeMaterial, RenderTarget, NoBlending, DoubleSide, Vector3, type SkinnedMesh } from 'three/webgpu';
import { Fn, vec4, float, vertexIndex, positionLocal, normalLocal, varyingProperty, morphReference, skinning } from 'three/tsl';
import { setupMMDPosition } from '../packages/three-mmd-sdef/nodes';
  // Read actual vertex-stage results through RGBA32F pixels, one quad per vertex.
export const probe=async(renderer:WebGPURenderer,target:RenderTarget,camera:OrthographicCamera,mesh:SkinnedMesh, normal:boolean)=>{
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
      if(g.hasAttribute('mmdSkinningType'))setupMMDPosition(material,builder);
      else {if(g.morphAttributes.position)morphReference(mesh);skinning(mesh);}
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
