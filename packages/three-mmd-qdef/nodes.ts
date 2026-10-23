/** Original TSL implementation of the project's rigid-dq-v1 equations.
 * General DQS reference: Ladislav Kavan dqs.cg; not an MMD measurement. */
import type { Node } from 'three/webgpu';
import type { SkinnedMesh } from 'three';
import { Fn, If, OnBeforeObjectUpdate, attribute, float, normalLocal, positionLocal, reference, tangentLocal, vec4 } from 'three/tsl';
import { boneMatrices, rotationQuaternion, rotate } from '../three-mmd-sdef/nodes';
const multiply = Fn(([a,b]: [Node<'vec4'>,Node<'vec4'>])=>vec4(a.xyz.mul(b.w).add(b.xyz.mul(a.w)).add(a.xyz.cross(b.xyz)), a.w.mul(b.w).sub(a.xyz.dot(b.xyz))));
const canonical = Fn(([matrix]: [Node<'mat4'>])=>{
  const q=rotationQuaternion(matrix).toVar();
  const first=q.w.abs().greaterThan(1e-6).select(q.w,q.x.abs().greaterThan(1e-6).select(q.x,q.y.abs().greaterThan(1e-6).select(q.y,q.z)));
  return first.lessThan(0).select(q.negate(),q);
});
export const qdefSkinning = Fn(builder=>{
  const mesh=builder.object as SkinnedMesh;
  OnBeforeObjectUpdate(({object})=>{(object as SkinnedMesh).skeleton.update();});
  const palette=boneMatrices(builder,mesh), indices=attribute('skinIndex','uvec4'), weights=attribute('skinWeight','vec4');
  const bind=reference('bindMatrix','mat4',undefined), inverse=reference('bindMatrixInverse','mat4',undefined);
  const real=vec4(0).toVar(), dual=vec4(0).toVar(), active=vec4(0,0,0,1).toVar(), activeDual=vec4(0).toVar(), found=float(0).toVar();
  for (const slot of ['x','y','z','w'] as const) {
    If(weights[slot].greaterThan(0),()=>{
      const matrix=inverse.mul(palette.element(indices[slot])).mul(bind).toVar();
      const q=canonical(matrix).toVar();
      const translation=(matrix as unknown as {element(i:number):Node<'vec4'>}).element(3).xyz;
      const d=multiply(vec4(translation,0),q).mul(0.5).toVar();
      If(found.equal(0),()=>{active.assign(q);activeDual.assign(d);found.assign(1);});
      const w=active.dot(q).lessThan(-1e-6).select(weights[slot].negate(),weights[slot]);
      real.addAssign(q.mul(w));dual.addAssign(d.mul(w));
    });
  }
  const length=real.length().toVar();
  If(length.lessThanEqual(1e-8),()=>{real.assign(active);dual.assign(activeDual);}).Else(()=>{
    real.divAssign(length);dual.divAssign(length);dual.subAssign(real.mul(real.dot(dual)));
  });
  const conjugate=vec4(real.xyz.negate(),real.w);
  positionLocal.assign(rotate(real,positionLocal).add(multiply(dual,conjugate).xyz.mul(2)));
  if(builder.geometry.hasAttribute('normal')) {
    normalLocal.assign(rotate(real,normalLocal));
    if(builder.geometry.hasAttribute('tangent'))tangentLocal.assign(rotate(real,tangentLocal));
  }
},'void');
