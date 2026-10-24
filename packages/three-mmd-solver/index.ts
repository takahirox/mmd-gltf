import type { Object3D } from "three";
import type {
  GLTF,
  GLTFLoaderPlugin,
  GLTFParser,
} from "three/addons/loaders/GLTFLoader.js";
import {
  EXTENSION_NAME,
  validateSolver,
  type SolverProfile,
} from "../mmd-solver";
const models = new WeakMap<
  Object3D,
  { profile: SolverProfile; nodes: Map<number, Object3D> }
>();
export function getSolverModel(root: Object3D) {
  const state = models.get(root);
  return state
    ? { profile: structuredClone(state.profile), nodes: new Map(state.nodes) }
    : undefined;
}
/** Registers retained solver data without changing core resolved TRS on load. */
export class MMDSolverPlugin implements GLTFLoaderPlugin {
  readonly name = EXTENSION_NAME;
  constructor(private parser: GLTFParser) {}
  beforeRoot() {
    const json = this.parser.json,
      p = json.extensions?.[EXTENSION_NAME];
    if (p === undefined) return null;
    validateSolver(p, json.nodes?.length ?? 0);
    const parents = new Map<number, number>();
    for (const [i, n] of (json.nodes ?? []).entries())
      for (const c of n.children ?? []) {
        if (parents.has(c))
          throw new Error(`${EXTENSION_NAME}: multiple parents`);
        parents.set(c, i);
      }
    const byIndex = new Map(p.bones.map((b) => [b.index, b]));
    const targets = new Set(p.bones.map((b) => b.node));
    const rootParents = new Set(
      p.bones
        .filter((b) => b.parentIndex === -1)
        .map((b) => parents.get(b.node!)),
    );
    if (rootParents.size !== 1)
      throw new Error(
        `${EXTENSION_NAME}: roots require one common model frame`,
      );
    for (const b of p.bones) {
      const def = json.nodes[b.node!];
      if (def.matrix || (def.scale ?? [1, 1, 1]).some((v: number) => v !== 1))
        throw new Error(`${EXTENSION_NAME}: unit-scale TRS required`);
      const parent = parents.get(b.node!);
      if (
        b.parentIndex === -1
          ? targets.has(parent)
          : parent !== byIndex.get(b.parentIndex)!.node
      )
        throw new Error(
          `${EXTENSION_NAME}: hierarchy mismatch at bones[${b.index}]`,
        );
    }
    return null;
  }
  async afterRoot(result: GLTF) {
    const p = this.parser.json.extensions?.[EXTENSION_NAME];
    if (p === undefined) return;
    const nodes = new Map<number, Object3D>();
    for (const b of p.bones) {
      const node = await this.parser.getDependency("node", b.node);
      if (!result.scene.getObjectById(node.id))
        throw new Error(`${EXTENSION_NAME}: joint outside default scene`);
      nodes.set(b.index, node);
    }
    models.set(result.scene, { profile: structuredClone(p), nodes });
  }
}
