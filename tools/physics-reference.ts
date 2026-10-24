/** Build-only reference data for rendered palette conformance; no browser adapter calls. */
import { readFile, writeFile } from "node:fs/promises";
import { loadAmmoNode } from "../packages/three-mmd-physics/node";
import { referenceRig } from "../tests/physics-backend";
import {
  parseVMD,
  bindMotion,
  evaluateMotion,
  evaluateIK,
} from "../packages/mmd-vmd";
import {
  parseVPD,
  bindPose,
  resolveRawPose,
  type PoseModel,
} from "../packages/mmd-vpd";
import type { PhysicsProfile } from "../packages/mmd-physics";
import type { SolverProfile } from "../packages/mmd-solver";
export async function writePhysicsReferences() {
  const { api } = await loadAmmoNode(),
    out: Record<string, unknown> = {};
  for (const rig of ["box", "wedge"]) {
    const json = JSON.parse(
        await readFile(`public/physics/${rig}-bdef/rest.gltf`, "utf8"),
      ),
      physics: PhysicsProfile = json.extensions.MMD_physics,
      solver: SolverProfile = json.extensions.MMD_skeleton_solver,
      model: PoseModel = {
        version: 1,
        modelId: "reference",
        metersPerPMXUnit: 0.2,
        bones: solver.bones,
        solver,
      };
    for (const id of ["a", "b"]) {
      const vmd = parseVMD(await readFile(`tests/fixtures/solver-${id}.vmd`)),
        motion = bindMotion(model, vmd, { morphUnmatched: "ignore" }),
        pose = resolveRawPose(
          model,
          bindPose(
            model,
            parseVPD(
              await readFile(`tests/fixtures/solver-${id}.vpd`),
              "utf-8",
            ),
          ),
        );
      out[`${rig}-${id}`] = referenceRig(
        api,
        physics,
        solver,
        (t) => evaluateMotion(motion, t, undefined, true),
        (t) => evaluateIK(motion, t),
        0.5,
      );
      out[`${rig}-pose-${id}`] = referenceRig(
        api,
        physics,
        solver,
        () => pose,
        () => new Map(),
        0.25,
      );
    }
  }
  await writeFile(
    "public/physics/reference.json",
    JSON.stringify(
      {
        kind: "independently authored direct-Ammo coupling; existing pre solver; explicit post append",
        time: 0.5,
        poseTime: 0.25,
        poses: out,
      },
      null,
      2,
    ) + "\n",
  );
}
