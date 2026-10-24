import type { Object3D } from "three";
import type { GLTFWriter } from "three/addons/exporters/GLTFExporter.js";
import { getPhysicsModel } from "./index";
import { EXTENSION_NAME, validatePhysics } from "../mmd-physics";
import { validateSolver } from "../mmd-solver";
/** Snapshot only: immutable rest retained; velocities/forces and continuation are not serialized. */
export class MMDPhysicsExporterPlugin {
  readonly name = EXTENSION_NAME;
  constructor(private writer: GLTFWriter) {}
  afterParse(input: Object3D | Object3D[]) {
    const writer = this.writer as unknown as {
      nodeMap: Map<Object3D, number>;
      extensionsUsed: Record<string, boolean>;
      json: {
        extensions?: Record<string, unknown>;
        nodes: any[];
      };
    };
    for (const root of Array.isArray(input) ? input : [input])
      root.traverse((object) => {
        const m = getPhysicsModel(object);
        if (!m) return;
        if (writer.json.extensions?.[EXTENSION_NAME])
          throw new Error("MMD_physics export: one model per asset required");
        for (const b of m.solver.bones) {
          const node = m.nodes.get(b.index)!;
          b.node = writer.nodeMap.get(node);
          if (b.node === undefined)
            throw new Error(
              `MMD_physics export bones[${b.index}]: missing node`,
            );
          const def = writer.json.nodes[b.node];
          delete def.matrix;
          def.translation = node.position.toArray();
          def.rotation = node.quaternion.toArray();
          def.scale = [1, 1, 1];
        }
        validateSolver(m.solver, writer.json.nodes.length);
        validatePhysics(m.profile, m.solver);
        writer.json.extensions = {
          ...writer.json.extensions,
          MMD_skeleton_solver: m.solver,
          [EXTENSION_NAME]: m.profile,
        };
        writer.extensionsUsed.MMD_skeleton_solver = true;
        writer.extensionsUsed[EXTENSION_NAME] = true;
      });
  }
}
