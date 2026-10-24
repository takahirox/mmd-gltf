import { Extension, type Node, type WriterContext } from "@gltf-transform/core";
import {
  EXTENSION_NAME,
  validateSolver,
  type SolverProfile,
  type SolverBone,
  type IKLink,
} from "../packages/mmd-solver";
import type { PoseModel } from "../packages/mmd-vpd";
import type { PMXModel } from "./pmx-to-gltf";
export interface SourceGrant {
  isLocal: boolean;
  affectRotation: boolean;
  affectPosition: boolean;
  parentIndex: number;
  ratio: number;
}
export interface SourceIK {
  effector: number;
  target?: number | null;
  iteration: number;
  maxAngle: number;
  linkCount?: number;
  links: {
    index: number;
    angleLimitation: number;
    lowerLimitationAngle?: number[];
    upperLimitationAngle?: number[];
  }[];
}
// PMX stores pi in FLOAT, whose nearest value is slightly greater than Math.PI.
const sourceAngle = (v: number) =>
  Math.abs(v) <= Math.fround(Math.PI)
    ? Math.max(-Math.PI, Math.min(Math.PI, v))
    : v;
export function createSolver(model: PMXModel, pose: PoseModel, version: 1 | 2 = 1): SolverProfile {
  const bones: SolverBone[] = model.bones.map((b, i) => {
    const fail = (why: string): never => {
      throw new Error(`PMX bones[${i}]: ${why}`);
    };
    const flags = b.flag ?? 0;
    if (!!(flags & 0x300) !== !!b.grant || !!(flags & 0x20) !== !!b.ik)
      fail("solver flags and records disagree");
    const result: SolverBone = {
      ...structuredClone(pose.bones[i]),
      layer: b.transformationClass ?? 0,
      flags,
    };
    if (b.grant) {
      const a = b.grant;
      if (
        a.isLocal !== !!(flags & 0x80) ||
        a.affectRotation !== !!(flags & 0x100) ||
        a.affectPosition !== !!(flags & 0x200)
      )
        fail("append flags disagree");
      result.append = {
        source: a.parentIndex,
        rate: a.ratio,
        local: a.isLocal,
        rotation: a.affectRotation,
        translation: a.affectPosition,
      };
    }
    if (b.ik) {
      const ik = b.ik;
      if (
        !Array.isArray(ik.links) ||
        (ik.linkCount !== undefined && ik.linkCount !== ik.links.length)
      )
        fail("IK link count mismatch");
      const links: IKLink[] = ik.links.map((l, j) => {
        const link: IKLink = { index: l.index };
        if (l.angleLimitation !== 0 && l.angleLimitation !== 1)
          fail(`ik.links[${j}]: invalid limit flag`);
        if (l.angleLimitation) {
          const lo = l.lowerLimitationAngle,
            hi = l.upperLimitationAngle;
          if (
            !lo ||
            !hi ||
            lo.length !== 3 ||
            hi.length !== 3 ||
            ![...lo, ...hi].every(Number.isFinite)
          )
            fail(`ik.links[${j}]: invalid limits`);
          const axes = [0, 1, 2].filter((k) => lo![k] !== 0 || hi![k] !== 0);
          if (axes.length !== 1)
            fail(
              `ik.links[${j}]: general multi-axis/locked limits outside profile`,
            );
          const axis = axes[0] as 0 | 1 | 2;
          // Pinned parser reflects bone positions but leaves IK limits in source coordinates.
          link.hinge =
            axis === 2
              ? {
                  axis,
                  min: sourceAngle(lo![axis]),
                  max: sourceAngle(hi![axis]),
                }
              : {
                  axis,
                  min: sourceAngle(-hi![axis] || 0),
                  max: sourceAngle(-lo![axis] || 0),
                };
        }
        return link;
      });
      result.ik = {
        effector: ik.effector,
        iterations: ik.iteration,
        angle: sourceAngle(ik.maxAngle),
        links,
      };
    }
    return result;
  });
  const profile: SolverProfile = { version, bones };
  validateSolver(profile);
  return profile;
}
export class SolverWriter extends Extension {
  static EXTENSION_NAME = EXTENSION_NAME;
  readonly extensionName = EXTENSION_NAME;
  profile?: SolverProfile;
  nodes: Node[] = [];
  read(): this {
    throw new Error("SolverWriter is converter-only");
  }
  write(context: WriterContext): this {
    if (this.profile) {
      const p = structuredClone(this.profile);
      p.bones.forEach((b) => {
        b.node = context.nodeIndexMap.get(this.nodes[b.index])!;
      });
      validateSolver(p, context.jsonDoc.json.nodes!.length);
      const json = context.jsonDoc.json;
      json.extensions = { ...json.extensions, [EXTENSION_NAME]: p };
    }
    return this;
  }
}
