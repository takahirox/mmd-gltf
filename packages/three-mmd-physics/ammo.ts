import type Ammo from "ammojs-typed";
export type AmmoAPI = typeof Ammo & {
  getPointer(object: unknown): number;
  getClass(object: unknown): unknown;
  getCache(type: unknown): Record<number, unknown>;
};
export const BACKEND_SHA256 =
  "422b87333fec6272a592088f96bd672dc8f62b9649b12d44e493fd427e89fff8";
// Matching upstream build: its ammo.js is byte-identical to ammojs-typed 1.0.6.
// Keep the Node JavaScript reference; browsers execute the same Bullet in Wasm.
export const WASM_BACKEND = {
  commit: '3d490c2b5d9f8414a888313bee4e05529e55c86c',
  scriptSHA256: '772bb6bf4e2ad2fe2926cdb4fd5219b88eedd24e2a40aeb9da5a81377d472f27',
  binarySHA256: '16be07b989963bddebfef66eab28a4387536eb37014d9df1531dab380bd96a93',
} as const;
const integrity = (hash:string) => 'sha256-' + btoa(String.fromCharCode(...hash.match(/../g)!.map(v=>parseInt(v,16))));
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
      "updateInertiaTensor",
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
  script.integrity = integrity(WASM_BACKEND.scriptSHA256);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout=setTimeout(()=>reject(new Error('Ammo resource loading timed out')),15000);
      script.onload = () => {clearTimeout(timeout);resolve();};
      script.onerror = () => {clearTimeout(timeout);reject(new Error("Ammo resource loading failed (missing or integrity mismatch)"));};
      document.head.append(script);
    });
    const factory = (
      globalThis as unknown as {
        Ammo: (options:{wasmBinary:ArrayBuffer}) => Promise<AmmoAPI>;
      }
    ).Ammo;
    if (typeof factory !== "function")
      throw new Error("Ammo resource did not expose factory");
    // Verify the binary before instantiation too; do not let the Emscripten
    // factory fetch an unchecked or cross-origin companion artifact.
    const binary = await fetch(new URL('ammo.wasm.wasm', source), {
      integrity: integrity(WASM_BACKEND.binarySHA256),
      signal: AbortSignal.timeout(15000),
    });
    if (!binary.ok) throw new Error(`Ammo Wasm loading failed: HTTP ${binary.status}`);
    return { api: checkAmmo(await factory({wasmBinary:await binary.arrayBuffer()})) };
  } finally {
    script.remove();
  }
}
