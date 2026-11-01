import {Euler,Matrix3,Matrix4,Quaternion,Vector3} from 'three';
import type {PhysicsProfile,Frame} from '../mmd-physics';
const frame=(f:Frame)=>new Matrix4().compose(new Vector3(...f.translation),new Quaternion(...f.rotation),new Vector3(1,1,1));
const clamp=(v:number,lo:number,hi:number)=>lo>hi?v:Math.max(lo,Math.min(hi,v));
const locked=(j:PhysicsProfile['joints'][number])=>[...j.linearLower,...j.linearUpper,...j.angularLower,...j.angularUpper].every(v=>v===0);
// Under-relax coupled linear equality rows: a full correction in a closed
// network can undo earlier rows indefinitely when its animated anchors strain
// the network. Interval boundaries retain full correction to prevent drift.
const relaxation=.5;
type State={p:Vector3;q:Quaternion;w:number;ii:Matrix3;members:{index:number;mass:number;offset:Matrix4}[]};
/** Nonlinear position stabilization; native Bullet still owns contacts, springs and velocities. */
export class JointProjector {
  private states:State[]=[];
  private joints:{j:PhysicsProfile['joints'][number];a:State;b:State;fa:Quaternion;fb:Quaternion;ta:Vector3;tb:Vector3}[]=[];
  constructor(profile:PhysicsProfile,inverseInertia:Map<number,Vector3>) {
    const offsets=new Map<number,Matrix4>(),owners=new Map<number,State>();
    const graph=new Map<number,{index:number;offset:Matrix4}[]>();
    for(const j of profile.joints.filter(locked)) {
      const relative=frame(j.frameA).multiply(frame(j.frameB).invert());
      if(!graph.has(j.bodyA))graph.set(j.bodyA,[]);if(!graph.has(j.bodyB))graph.set(j.bodyB,[]);
      graph.get(j.bodyA)!.push({index:j.bodyB,offset:relative});graph.get(j.bodyB)!.push({index:j.bodyA,offset:relative.clone().invert()});
    }
    for(const body of profile.bodies) {
      if(owners.has(body.index))continue;
      const state:State={p:new Vector3(),q:new Quaternion(),w:0,ii:new Matrix3(),members:[]};
      const visit=(index:number,offset:Matrix4)=>{
        if(owners.has(index)) {
          const previous=offsets.get(index)!;
          if(owners.get(index)!==state || offset.elements.some((v,k)=>Math.abs(v-previous.elements[k])>1e-6))
            throw new Error('MMD_physics: inconsistent rigid joint cycle in position stabilization');
          return;
        }
        owners.set(index,state);offsets.set(index,offset);
        const b=profile.bodies.find(b=>b.index===index)!;
        state.members.push({index,mass:b.mode===0?0:b.mass,offset});
        for(const next of graph.get(index)??[])visit(next.index,offset.clone().multiply(next.offset));
      };
      visit(body.index,new Matrix4());
      const mass=state.members.reduce((v,b)=>v+b.mass,0),fixed=state.members.some(b=>b.mass===0);
      state.w=fixed?0:1/mass;
      if(fixed)state.members.sort((a,b)=>Number(a.mass!==0)-Number(b.mass!==0));
      const inv=inverseInertia.get(body.index)!;
      // Use a root-centred, unit-radius metric for an exactly rigid cluster.
      // Keeping a seven-metre offset in the scalar inertia preconditioner makes
      // the anchor/angle rows ill-conditioned. This metric affects position
      // stabilization only; Bullet retains every original mass and inertia.
      state.ii=state.members.length>1
        ?new Matrix3().set(state.w,0,0,0,state.w,0,0,0,state.w)
        :new Matrix3().set(inv.x,0,0,0,inv.y,0,0,0,inv.z);
      this.states.push(state);
    }
    for(const j of profile.joints) {
      const a=owners.get(j.bodyA)!,b=owners.get(j.bodyB)!;
      if(a===b)continue;
      const pa=new Vector3(),pb=new Vector3(),qa=new Quaternion(),qb=new Quaternion();
      offsets.get(j.bodyA)!.clone().multiply(frame(j.frameA)).decompose(pa,qa,new Vector3());
      offsets.get(j.bodyB)!.clone().multiply(frame(j.frameB)).decompose(pb,qb,new Vector3());
      this.joints.push({j,a,b,ta:pa,tb:pb,fa:qa,fb:qb});
    }
  }
  project(transforms:Map<number,Matrix4>,iterations:number) {
    for(const s of this.states) {
      const root=s.members[0];
      transforms.get(root.index)!.clone().multiply(root.offset.clone().invert()).decompose(s.p,s.q,new Vector3());
    }
    const inertia=(s:State,v:Vector3)=>v.clone().applyQuaternion(s.q.clone().invert()).applyMatrix3(s.ii).applyQuaternion(s.q);
    const rotate=(q:Quaternion,v:Vector3)=>{const angle=v.length();if(angle>1e-12)q.premultiply(new Quaternion().setFromAxisAngle(v.multiplyScalar(1/angle),angle)).normalize();};
    const e=new Euler(0,0,0,'ZYX');
    for(let i=0;i<iterations;i++) {
      let maximumLinear=0,maximumAngular=0;
      for(const {j,a,b,fa,fb,ta,tb} of this.joints) {
        if(a.w+b.w===0)continue;
        // Gradients of Bullet's negative intrinsic ZYX joint angles.
        for(let k=0;k<3;k++) {
          if(j.angularLower[k]>j.angularUpper[k])continue;
          const qa=a.q.clone().multiply(fa),qb=b.q.clone().multiply(fb),rel=qa.clone().invert().multiply(qb);
          e.setFromQuaternion(rel,'ZYX');
          const angle=-[e.x,e.y,e.z][k],error=angle-clamp(angle,Math.max(-Math.PI,Math.min(Math.PI,j.angularLower[k])),Math.max(-Math.PI,Math.min(Math.PI,j.angularUpper[k])));
          maximumAngular=Math.max(maximumAngular,Math.abs(error));
          if(Math.abs(error)<1e-8)continue;
          const cy=Math.max(1e-6,Math.cos(e.y)),cz=Math.cos(e.z),sz=Math.sin(e.z);
          const axis=(k===0?new Vector3(cz/cy,sz/cy,0):k===1?new Vector3(-sz,cz,0):new Vector3(cz*Math.tan(e.y),sz*Math.tan(e.y),1)).applyQuaternion(qa);
          const ia=inertia(a,axis),ib=inertia(b,axis),weight=axis.dot(ia)+axis.dot(ib);
          if(weight>0){let lambda=-error/weight;const largest=Math.max(ia.length(),ib.length())*Math.abs(lambda);if(largest>.2)lambda*=.2/largest;
            rotate(a.q,ia.multiplyScalar(lambda));rotate(b.q,ib.multiplyScalar(-lambda));}
        }
        // Solve a locked anchor as a 3x3 block, including rotation about the
        // body centre. Translation-only projection cannot close cloak loops.
        if([...j.linearLower,...j.linearUpper].every(v=>v===0)) {
          const ra=ta.clone().applyQuaternion(a.q),rb=tb.clone().applyQuaternion(b.q),delta=b.p.clone().add(rb).sub(a.p).sub(ra);
          maximumLinear=Math.max(maximumLinear,delta.length());
          const k=new Matrix3();
          for(let col=0;col<3;col++) {
            const n=new Vector3().setComponent(col,1),v=n.clone().multiplyScalar(a.w+b.w)
              .add(inertia(a,ra.clone().cross(n)).cross(ra)).add(inertia(b,rb.clone().cross(n)).cross(rb));
            k.elements[col*3]=v.x;k.elements[col*3+1]=v.y;k.elements[col*3+2]=v.z;
          }
          const lambda=delta.applyMatrix3(k.invert()),ia=inertia(a,ra.clone().cross(lambda)),ib=inertia(b,rb.clone().cross(lambda));
          const angle=Math.max(ia.length(),ib.length()),scale=Math.min(relaxation,angle>0?.2/angle:relaxation);
          a.p.addScaledVector(lambda,a.w*scale);b.p.addScaledVector(lambda,-b.w*scale);
          rotate(a.q,ia.multiplyScalar(scale));rotate(b.q,ib.multiplyScalar(-scale));
          continue;
        }
        for(let k=0;k<3;k++) {
          if(j.linearLower[k]>j.linearUpper[k])continue;
          const ra=ta.clone().applyQuaternion(a.q),rb=tb.clone().applyQuaternion(b.q),delta=b.p.clone().add(rb).sub(a.p).sub(ra);
          const axis=new Vector3().setComponent(k,1).applyQuaternion(a.q.clone().multiply(fa));
          const value=delta.dot(axis),error=value-clamp(value,j.linearLower[k],j.linearUpper[k]);
          maximumLinear=Math.max(maximumLinear,Math.abs(error));
          if(Math.abs(error)<1e-8)continue;
          const ja=ra.clone().add(delta).cross(axis),jb=rb.clone().cross(axis),ia=inertia(a,ja),ib=inertia(b,jb);
          const weight=a.w+b.w+ja.dot(ia)+jb.dot(ib);
          let lambda=(j.linearLower[k]===j.linearUpper[k]?relaxation:1)*error/weight;
          const angular=Math.max(ia.length(),ib.length())*Math.abs(lambda);if(angular>.2)lambda*=.2/angular;
          a.p.addScaledVector(axis,a.w*lambda);b.p.addScaledVector(axis,-b.w*lambda);
          rotate(a.q,ia.multiplyScalar(lambda));rotate(b.q,ib.multiplyScalar(-lambda));
        }
      }
      if(maximumLinear<1e-7 && maximumAngular<1e-6)break;
    }
    for(const s of this.states)for(const b of s.members)
      transforms.get(b.index)!.compose(s.p,s.q,new Vector3(1,1,1)).multiply(b.offset);
  }
}
