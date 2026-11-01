import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Matrix4,Quaternion,Vector3} from 'three';
import {JointProjector} from '../packages/three-mmd-physics/joint-projection';
import type {PhysicsProfile} from '../packages/mmd-physics';
import {jointViolations} from './physics-joints';
const minimal=JSON.parse(await readFile('extensions/MMD_physics/examples/minimal.gltf','utf8'));
const fixture=()=>{
  const p=structuredClone(minimal.extensions.MMD_physics) as PhysicsProfile;
  p.bodies=[{...p.bodies[0],index:0,mode:0},{...p.bodies[0],index:1,mode:2}];
  const frame={translation:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number]};
  p.joints=[{index:0,name:'constraint',type:0,bodyA:0,bodyB:1,frameA:structuredClone(frame),frameB:structuredClone(frame),
    linearLower:[0,0,0],linearUpper:[0,0,0],angularLower:[0,0,0],angularUpper:[0,0,0],linearSpring:[100000,100000,100000],angularSpring:[640,640,640]}];
  return p;
};
test('a fully locked seven-metre counterweight stays rigid without moving its kinematic anchor',()=>{
  const profile=fixture();profile.joints[0].frameB.translation=[0,-7,0];
  const poses=new Map([[0,new Matrix4().makeTranslation(1,2,3)],[1,new Matrix4().compose(new Vector3(-2,10,0),new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.7),new Vector3(1,1,1))]]);
  const anchor=poses.get(0)!.clone();
  new JointProjector(profile,new Map([[0,new Vector3()],[1,new Vector3(1,2,3)]])).project(poses,128);
  assert.deepEqual(poses.get(0),anchor);
  assert.deepEqual(new Vector3().setFromMatrixPosition(poses.get(1)!).toArray(),[1,9,3]);
  assert.deepEqual(jointViolations(profile,Object.fromEntries([...poses].map(([k,v])=>[k,v.toArray()]))),[{index:0,linear:0,angular:0}]);
  assert.equal(profile.bodies.length,2);assert.equal(profile.joints.length,1);
});
test('inverted linear and angular limits retain free axes during stabilization',()=>{
  const profile=fixture();profile.joints[0].linearLower[1]=1;profile.joints[0].linearUpper[1]=-1;
  profile.joints[0].angularLower[0]=1;profile.joints[0].angularUpper[0]=-1;
  const moving=new Matrix4().compose(new Vector3(0,2,0),new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.4),new Vector3(1,1,1));
  const poses=new Map([[0,new Matrix4()],[1,moving.clone()]]);
  new JointProjector(profile,new Map([[0,new Vector3()],[1,new Vector3(1,2,3)]])).project(poses,128);
  poses.get(1)!.elements.forEach((v,k)=>assert.ok(Math.abs(v-moving.elements[k])<1e-15));
  assert.deepEqual(jointViolations(profile,Object.fromEntries([...poses].map(([k,v])=>[k,v.toArray()]))),[{index:0,linear:0,angular:0}]);
});
