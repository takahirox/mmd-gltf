import type { Object3D } from "three";
import type { RestBone } from "../mmd-vpd";
import type { PhysicsTimeline, PoseSampler, ControlSampler } from "./world";
import { motionScope } from "../three-mmd-vpd/ownership";
export interface PhysicsSession {
  enabled: boolean;
  timeline: PhysicsTimeline;
  pose(raw: RestBone[]): RestBone[];
  motion(
    time: number,
    sample: PoseSampler,
    controls: ControlSampler,
  ): RestBone[];
  reset(): void;
}
const sessions = new WeakMap<Object3D, PhysicsSession>();
export const getPhysicsSession = (root: Object3D) =>
  sessions.get(motionScope(root));
export function registerPhysics(root: Object3D, session: PhysicsSession) {
  const key = motionScope(root);
  if (sessions.has(key))
    throw new Error("MMD_physics: model already has an owner");
  sessions.set(key, session);
}
export function releasePhysics(root: Object3D, session: PhysicsSession) {
  const key = motionScope(root);
  if (sessions.get(key) === session) sessions.delete(key);
}
