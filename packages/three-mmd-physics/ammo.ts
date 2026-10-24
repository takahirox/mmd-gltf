import type Ammo from "ammojs-typed";
export type AmmoAPI = typeof Ammo & {
  getPointer(object: unknown): number;
  getClass(object: unknown): unknown;
  getCache(type: unknown): Record<number, unknown>;
};
export const BACKEND_SHA256 =
  "422b87333fec6272a592088f96bd672dc8f62b9649b12d44e493fd427e89fff8";
export function checkAmmo(api: AmmoAPI) {
  for (const name of [
    "destroy",
    "getPointer",
    "getClass",
    "getCache",
    "btDefaultCollisionConfiguration",
    "btCollisionDispatcher",
    "btDbvtBroadphase",
    "btSequentialImpulseConstraintSolver",
    "btDiscreteDynamicsWorld",
    "btRigidBody",
    "btGeneric6DofSpringConstraint",
    "btTransform",
    "btVector3",
    "btQuaternion",
    "btMatrix3x3",
    "btSphereShape",
    "btBoxShape",
    "btCapsuleShape",
    "btDefaultMotionState",
    "btRigidBodyConstructionInfo",
  ] as const)
    if (typeof api?.[name] !== "function")
      throw new Error(`MMD_physics: missing Ammo binding ${name}`);
  const methods: Record<string, string[]> = {
    btTransform: [
      "getOrigin",
      "getBasis",
      "setIdentity",
      "setOrigin",
      "setRotation",
    ],
    btMatrix3x3: ["getRotation"],
    btGeneric6DofSpringConstraint: [
      "enableSpring",
      "setStiffness",
      "setDamping",
      "setEquilibriumPoint",
      "setLinearLowerLimit",
      "setLinearUpperLimit",
      "setAngularLowerLimit",
      "setAngularUpperLimit",
    ],
    btDiscreteDynamicsWorld: [
      "stepSimulation",
      "addRigidBody",
      "removeRigidBody",
      "addConstraint",
      "removeConstraint",
      "setGravity",
    ],
    btRigidBody: [
      "getWorldTransform",
      "setWorldTransform",
      "getMotionState",
      "setLinearVelocity",
      "setDamping",
      "setFriction",
      "setRestitution",
      "setActivationState",
      "getCollisionFlags",
      "setCollisionFlags",
      "activate",
    ],
  };
  const classes = api as unknown as Record<
    string,
    { prototype: Record<string, unknown> }
  >;
  for (const [name, names] of Object.entries(methods))
    for (const method of names)
      if (typeof classes[name]?.prototype?.[method] !== "function")
        throw new Error(`MMD_physics: missing Ammo binding ${name}.${method}`);
  return api;
}
/** Explicit same-origin classic script; caller owns the module, rigs own only native worlds. */
export async function loadAmmoBrowser(url: string): Promise<{
  api: AmmoAPI;
}> {
  if (!globalThis.document)
    throw new Error("Ammo browser loader requires document");
  const source = new URL(url, location.href);
  if (source.origin !== location.origin)
    throw new Error("Ammo browser resource must be same-origin");
  const script = document.createElement("script");
  script.src = source.href;
  try {
    await new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Ammo resource loading failed"));
      document.head.append(script);
    });
    const factory = (
      globalThis as unknown as {
        Ammo: () => Promise<AmmoAPI>;
      }
    ).Ammo;
    if (typeof factory !== "function")
      throw new Error("Ammo resource did not expose factory");
    return { api: checkAmmo(await factory()) };
  } finally {
    script.remove();
  }
}
