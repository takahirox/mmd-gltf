import { type Object3D, type Bone } from 'three';
import { validatePhysics, physicsBindingDiagnostics, type PhysicsProfile } from '../packages/mmd-physics';
import { validateSolver, type SolverProfile } from '../packages/mmd-solver';
import type { RestBone } from '../packages/mmd-vpd';
import type { VMD } from '../packages/mmd-vmd';
import { PhysicsWorld } from '../packages/three-mmd-physics/world';
import { jointAngularErrors } from '../packages/three-mmd-physics/joint-limits';
import type { AmmoAPI } from '../packages/three-mmd-physics/ammo';
import { comparisonIK } from './comparison-ik';

const jointProjectionIterations=128;
const maximumAngularError=.005;
type ConstraintFailure={pane:number;index:number;angular:number;time:number};
export type PublicPhysicsBinding={version:1;solver:SolverProfile;physics:PhysicsProfile};
/** Availability covers the entire clip, including seeks and replay intermediates. */
export function publicPhysicsUnavailableReason(model:'uka'|'gene',motion:string,ik:boolean) {
  return model==='gene' && motion==='22_apology' && ik
    ? 'Gene Apology with IK On exceeds joint accuracy limits. Turn IK Off or choose another motion; source-consistent constraint execution needs follow-up.'
    : '';
}
/** Explicit retained-source binding, separate from automatic animation solver ownership. */
export function validatePublicPhysics(binding:PublicPhysicsBinding) {
  if(binding?.version!==1)throw new Error('Missing public physics source binding');
  if(binding.solver?.version!==3 || binding.physics?.version!==2)throw new Error('Public physics requires retained solver 3 / physics 2 contracts');
  validateSolver(binding.solver);validatePhysics(binding.physics,binding.solver);
  const issues=physicsBindingDiagnostics(binding.physics,binding.solver,{maxBodies:256,maxJoints:256});
  if(issues.length)throw new Error(issues.map(d=>`${d.code}: ${d.message}`).join('; '));
  const bones=binding.solver.bones,byIndex=new Map(bones.map(b=>[b.index,b]));
  const order=(a:typeof bones[number],b:typeof bones[number])=>Number(!!(a.flags&0x1000))-Number(!!(b.flags&0x1000))||a.layer-b.layer||a.index-b.index;
  for(const b of bones) {
    if(b.ik?.links.some(l=>l.hinge))throw new Error(`Public physics requires XYZ IK limit records at ${b.index}`);
    if(b.localAxes || b.externalParent!==undefined)throw new Error(`Unsupported local axes/external parent at ${b.index}`);
    if(b.fixedAxis && (Math.hypot(...b.fixedAxis)<1e-10 || binding.physics.bodies.some(body=>body.bone===b.index && body.mode!==0) || bones.some(c=>c.ik?.links.some(l=>l.index===b.index))))
      throw new Error(`Unsupported fixed-axis procedural write at ${b.index}`);
    if(b.append && (b.append.local || order(byIndex.get(b.append.source)!,b)>=0))
      throw new Error(`Unsupported append space/order at ${b.index}`);
  }
  return binding;
}
export function physicsBones(root:Object3D,binding:PublicPhysicsBinding,direct=false) {
  const nodes=new Map<number,Bone>();
  root.traverse(n=>{if(n.type==='Bone') {
    const index=direct?(root as import('three').SkinnedMesh).skeleton.bones.indexOf(n as Bone):n.userData.pmxBone?.index;
    if(index!==undefined)nodes.set(index,n as Bone);
  }});
  if(nodes.size!==binding.solver.bones.length)throw new Error('Physics skeleton count mismatch');
  for(const b of binding.solver.bones) {
    const n=nodes.get(b.index),parent=b.parentIndex===-1?undefined:nodes.get(b.parentIndex);
    if(!n || (n.userData.pmxBone?.name??n.name)!==b.name || (parent && n.parent!==parent) || n.scale.toArray().some(v=>v!==1) ||
      n.position.toArray().some((v,k)=>Math.abs(v*(direct?.08:1)-b.translation[k])>1e-6) ||
      Math.abs(n.quaternion.w)<1-1e-8)throw new Error(`Physics rest binding mismatch at ${b.index} (${b.name})`);
  }
  const read=(metres=false):RestBone[]=>binding.solver.bones.map(b=>({index:b.index,name:b.name,parentIndex:b.parentIndex,
    translation:nodes.get(b.index)!.position.toArray().map(v=>v*(direct && !metres?.08:1)) as RestBone['translation'],
    rotation:nodes.get(b.index)!.quaternion.toArray(),scale:[1,1,1]}));
  const write=(pose:RestBone[],metres=false)=>{
    for(const b of pose) {
      const n=nodes.get(b.index)!;
      n.position.fromArray(b.translation).multiplyScalar(direct && !metres?12.5:1);n.quaternion.fromArray(b.rotation);
    }
    root.updateMatrixWorld(true);
  };
  return {read,write};
}
const canonicalPose=(pose:RestBone[]):RestBone[]=>pose.map(b=>{
  const q=b.rotation.map(v=>Math.round(v*1e7+1e-7)/1e7),length=Math.hypot(...q);
  return {...b,translation:b.translation.map(v=>Math.round(v*1e7+1e-7)/1e7) as RestBone['translation'],rotation:q.map(v=>v/length) as RestBone['rotation']};
});
/** Three independent native worlds. One integer tick, no independent pane clock.
 * Forward playback reuses worlds; backward seeks/reset replay in cancellable slices.
 * The displayed pose holds floor(t/step); source UI time remains the requested time. */
export class ComparisonPhysics {
  private worlds:PhysicsWorld[]=[];
  private tick=-1;
  private generation=0;
  private closed=false;
  private source?:VMD;
  private ik=true;
  private at=0;
  readonly stats={jointProjectionIterations,worldsCreated:0,resets:0,steps:0,tick:0,time:0,lastMS:0,maxSliceMS:0,cpuMS:0,native:0,backendBytes:0,bodiesPerWorld:0,jointsPerWorld:0,constraintFailures:[] as ConstraintFailure[]};
  readonly inputs:RestBone[][]=[];
  readonly adapters:ReturnType<typeof comparisonIK>[];
  readonly bindings:ReturnType<typeof physicsBones>[];
  private api?:AmmoAPI;
  setBackend(api:AmmoAPI) {this.api=api;this.stats.backendBytes=(api as unknown as {HEAP8?:Int8Array}).HEAP8?.byteLength??0;}
  constructor(private binding:PublicPhysicsBinding,private roots:Object3D[],private workBudgetMS=150) {
    validatePublicPhysics(binding);
    this.stats.bodiesPerWorld=binding.physics.bodies.length;this.stats.jointsPerWorld=binding.physics.joints.length;
    this.bindings=roots.map((r,i)=>physicsBones(r,binding,i===0));
    const source=binding.solver.bones.map(b=>({index:b.index,name:b.name,flags:b.flags,layer:b.layer,
      fixAxis:b.fixedAxis?.map((v,k)=>k===2?-v:v),
      grant:b.append?{parentIndex:b.append.source,ratio:b.append.rate,isLocal:b.append.local,affectRotation:b.append.rotation,affectPosition:b.append.translation}:undefined,
      ik:b.ik?{effector:b.ik.effector,iteration:b.ik.iterations,maxAngle:b.ik.angle,links:b.ik.links.map(l=>({index:l.index,angleLimitation:l.limits?1:0,
        lowerLimitationAngle:l.limits?[-l.limits.upper[0],-l.limits.upper[1],l.limits.lower[2]]:undefined,
        upperLimitationAngle:l.limits?[-l.limits.lower[0],-l.limits.lower[1],l.limits.upper[2]]:undefined}))}:undefined}));
    this.adapters=roots.map((r,i)=>{
      const rest=this.bindings[i].read(),scale=r.scale.clone();
      try {
        if(i===0) {r.scale.setScalar(1);this.bindings[i].write(rest,true);}
        return comparisonIK(r,source,i===0,true,1);
      } finally {r.scale.copy(scale);this.bindings[i].write(rest);}
    });
    if(this.adapters.some(a=>!a.state.available))throw new Error(this.adapters.map(a=>a.state.reason).join('; '));
  }
  reset(source:VMD|undefined,ik:boolean) {
    this.generation++;this.worlds.forEach(w=>w.dispose());this.worlds=[];this.tick=-1;this.inputs.length=0;
    this.source=source;this.ik=ik;this.stats.resets++;this.stats.tick=0;this.stats.time=0;this.stats.native=PhysicsWorld.allocations;
  }
  async seek(time:number,sample:(time:number)=>void) {
    if(this.closed)return false;
    if(!Number.isFinite(time) || time<0 || time>30)throw new Error('Physics seek exceeds 30 second replay budget');
    if(!this.api)throw new Error('Physics backend not loaded');
    const start=performance.now(),step=this.binding.physics.fixedStep;
    const target=Math.floor(time/step+1e-9);
    if(target<this.tick)this.reset(this.source,this.ik);
    const token=this.generation;
    let slice=performance.now();
    let workStart=slice;
    const checkpoint=async()=>{
      const end=performance.now(),cost=end-slice;
      this.stats.cpuMS+=end-workStart;
      this.stats.maxSliceMS=Math.max(this.stats.maxSliceMS,cost);
      if(cost>this.workBudgetMS)throw new Error(`Physics exceeds this device’s ${this.workBudgetMS} ms work budget; switch Off or retry`);
      if(cost>=8) {await new Promise<void>(resolve=>setTimeout(resolve,0));slice=performance.now();}
      workStart=performance.now();
    };
    while(this.tick<target) {
      if(this.closed || token!==this.generation)return false;
      const tick=this.tick+1;this.at=tick*step;
      sample(this.at);
      const raw=this.bindings.map(b=>b.read());
      if(!this.worlds.length) {
        try {
          for(const [i,b] of this.bindings.entries()) {
            const adapter=this.adapters[i];
            const world=new PhysicsWorld(this.api,this.binding.physics,this.binding.solver,raw[i],new Map(),{maxBodies:256,maxJoints:256},{
              validate:()=>{validatePublicPhysics(this.binding);if(!adapter.state.available)throw new Error(adapter.state.reason);},
              evaluate:(pose,_enabled,phase)=>{
                // Common metre-space arithmetic for each independently evaluated
                // skeleton prevents unit conversion roundoff from selecting a
                // different constrained-IK branch before contact simulation.
                const root=this.roots[i],scale=root.scale.clone();
                const input=phase==='pre'?canonicalPose(pose):pose;
                try {
                  if(input.some(b=>[...b.translation,...b.rotation].some(v=>!Number.isFinite(v) || !Number.isFinite(Math.fround(v)))))
                    throw new Error('Physics received a non-finite pose; switch Off or retry');
                  if(i===0)root.scale.setScalar(1);
                  b.write(input,true);adapter.apply(this.source,this.at,phase==='pre'?'prePhysics':'postPhysics',this.ik);
                  if(adapter.state.error)throw new Error(adapter.state.error);
                  const evaluated=phase==='pre'?canonicalPose(b.read(true)):b.read(true);
                  if(phase==='pre')this.inputs[i]=evaluated;
                  root.scale.copy(scale);b.write(evaluated);
                  return evaluated;
                } finally {root.scale.copy(scale);}
              },
            },jointProjectionIterations);
            this.stats.worldsCreated++;this.worlds.push(world);
            // Initialization is native work too. Keep each pane cancellable
            // without exposing a partially initialized or simulated tick.
            await checkpoint();
            if(this.closed || token!==this.generation)return false;
          }
        } catch(error){this.worlds.forEach(w=>w.dispose());this.worlds=[];throw error;}
      }
      for(const [i,world] of this.worlds.entries()) {
        this.bindings[i].write(world.resolve(raw[i],new Map(),tick!==0));
        await checkpoint();
        if(this.closed || token!==this.generation)return false;
      }
      this.tick=tick;this.stats.steps+=tick!==0?1:0;
    }
    // Never publish a successful state solely because Bullet and stabilization
    // returned. Check every joint in every independent native world against the
    // existing angular accuracy gate before the host can report Physics On.
    // Replay intermediates are private; only the requested held pose is shown.
    const failures=this.worlds.flatMap((world,pane)=>jointAngularErrors(this.binding.physics,world.bodyTransforms())
      .filter(error=>!Number.isFinite(error.angular) || error.angular>=maximumAngularError)
      .map(error=>({...error,pane,time:target*step})));
    this.stats.constraintFailures=failures;
    if(failures.length) {
      this.reset(this.source,this.ik);
      const first=failures[0];
      throw new Error(`Joint ${first.index} angular error ${first.angular.toFixed(6)} rad exceeds ${maximumAngularError} at ${first.time.toFixed(3)} s`);
    }
    // Same tick calls must preserve solved bones (sampling would overwrite them).
    this.stats.backendBytes=(this.api as unknown as {HEAP8?:Int8Array}).HEAP8?.byteLength??0;
    this.stats.time=time;this.stats.tick=this.tick;this.stats.lastMS=performance.now()-start;this.stats.native=PhysicsWorld.allocations;
    return !this.closed && token===this.generation;
  }
  bodyTransforms() {return this.worlds.map(w=>Object.fromEntries(w.bodyTransforms()));}
  dispose() {if(this.closed)return;this.reset(undefined,false);this.closed=true;}
}

/** Compare direct-loader source records, undoing its PMX position normalization
 * and its mode-2 compatibility rewrite. The public contract executes original modes. */
export async function verifyDirectPhysics(mesh:import('three').SkinnedMesh,binding:PublicPhysicsBinding) {
  const {createPhysics}=await import('../packages/mmd-physics/source');
  const data=mesh.geometry.userData.MMD;
  const positions=new Map<number,number[]>();
  const absolute=(index:number):number[]=>{
    if(index===-1)return [0,0,0];
    if(!positions.has(index)) {
      const b=binding.solver.bones.find(b=>b.index===index)!;
      const parent=absolute(b.parentIndex);
      positions.set(index,b.translation.map((v,k)=>v/.08+parent[k]));
    }
    return positions.get(index)!;
  };
  const bodies=(data.rigidBodies as (import('../packages/mmd-physics/source').SourceBody & {originalType:number})[]).map(b=>({...b,
    type:b.originalType,position:b.position.map((v,k)=>v+absolute(b.boneIndex)[k])}));
  const model={metadata:{coordinateSystem:'right'},rigidBodies:bodies,constraints:data.constraints,morphs:[],softBodies:[],vertices:[],materials:[]};
  const direct=createPhysics(model,binding.solver,.08);
  const equal=(a:unknown,b:unknown):boolean=>typeof a==='number' && typeof b==='number'?Math.abs(a-b)<1e-8:
    a!==null && b!==null && typeof a==='object' && typeof b==='object'?
      Object.keys(a).length===Object.keys(b).length && Object.entries(a).every(([k,v])=>equal(v,Reflect.get(b,k))):a===b;
  if(!equal(direct,binding.physics))throw new Error('Direct PMX and retained glTF physics records differ');
}
