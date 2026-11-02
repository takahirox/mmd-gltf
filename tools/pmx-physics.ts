import { Extension, type Node, type WriterContext } from '@gltf-transform/core';
import { EXTENSION_NAME, validatePhysics, type PhysicsProfile } from '../packages/mmd-physics';
import type { SolverProfile } from '../packages/mmd-solver';
export { createPhysics, type SourceBody, type SourceJoint } from '../packages/mmd-physics/source';
export class PhysicsWriter extends Extension {
  static EXTENSION_NAME = EXTENSION_NAME;
  readonly extensionName = EXTENSION_NAME;
  profile?: PhysicsProfile;
  solver?: SolverProfile;
  nodes: Node[] = [];
  read(): this {
    throw new Error("PhysicsWriter is converter-only");
  }
  write(context: WriterContext): this {
    if (this.profile) {
      validatePhysics(this.profile, this.solver!);
      context.jsonDoc.json.extensions = {
        ...context.jsonDoc.json.extensions,
        [EXTENSION_NAME]: structuredClone(this.profile),
      };
    }
    return this;
  }
}
