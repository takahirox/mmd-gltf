import { createMorphRig, resetMorphWeights } from "../packages/three-mmd-morph";
import {
  WebGPURenderer,
  Matrix4,
  Matrix3,
  Bone,
  Skeleton,
  Scene,
  Color,
  DirectionalLight,
  OrthographicCamera,
  Mesh,
  Group,
  BufferGeometry,
  BufferAttribute,
  NodeMaterial,
  RenderTarget,
  FloatType,
  NoColorSpace,
  NoBlending,
  DoubleSide,
  Vector3,
  type SkinnedMesh,
} from "three/webgpu";
import {
  Fn,
  vec4,
  float,
  vertexIndex,
  positionLocal,
  normalLocal,
  varyingProperty,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
  MMDQDEFPlugin,
  MMDQDEFExporterPlugin,
} from "../packages/three-mmd-qdef";
import { MMDSDEFExporterPlugin } from "../packages/three-mmd-sdef";
import { setupMMDPosition } from "../packages/three-mmd-sdef/nodes";
import { MMDToonPlugin } from "../packages/three-mmd-toon";
import {
  MMDOutlinePlugin,
  MMDOutlineEffect,
  getOutlineRecords,
  setOutlineRecords,
} from "../packages/three-mmd-outline";
import {
  createVPDRig,
  parseVPD,
  bindVPD,
  applyVPD,
  resetVPD,
} from "../packages/three-mmd-vpd";
import {
  createVMDPlayer,
  parseVMD,
  bindVMD,
  MMDVMDPlugin,
  getVMDPlayers,
} from "../packages/three-mmd-vmd";
import { MMDSolverPlugin } from "../packages/three-mmd-solver";
import { MMDVPDExporterPlugin } from "../packages/three-mmd-vpd";
import { solverVertex, solverExpected } from "./solver-oracle";
import {
  MMDPhysicsPlugin,
  PhysicsRig,
  loadAmmoBrowser,
} from "../packages/three-mmd-physics";
import { MMDPhysicsExporterPlugin } from "../packages/three-mmd-physics/exporter";
import { getVPDModel } from "../packages/three-mmd-vpd";
const base = import.meta.env.BASE_URL;
async function run() {
  const mode = (new URLSearchParams(location.search).get("mode") ?? "bdef") as
    | "bdef"
    | "sdef"
    | "qdef";
  const renderer = new WebGPURenderer({ forceWebGL: true, antialias: false });
  await renderer.init();
  renderer.setSize(160, 160);
  document.body.append(renderer.domElement);
  const effect = new MMDOutlineEffect(renderer),
    scene = new Scene();
  scene.background = new Color(0xd0d0d0);
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(1, 2, 4);
  scene.add(light);
  const camera = new OrthographicCamera(-0.65, 0.65, 0.65, -0.65, 0.1, 20);
  camera.position.set(2, 1.8, 3);
  camera.lookAt(0.1, 0.1, 0);
  camera.updateMatrixWorld();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  const context = canvas.getContext("2d")!;
  const pixels = () => {
    context.drawImage(renderer.domElement, 0, 0);
    return context.getImageData(0, 0, 160, 160).data;
  };
  const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4)
      if ([0, 1, 2].some((j) => Math.abs(a[i + j] - b[i + j]) > 2)) n++;
    return n;
  };
  const target = new RenderTarget(24, 1, { type: FloatType });
  target.texture.colorSpace = NoColorSpace;
  const probe = async (mesh: SkinnedMesh, normal: boolean) => {
    const source = mesh.geometry,
      g = new BufferGeometry();
    for (const [key, a] of Object.entries(source.attributes)) {
      const data = new Float32Array(a.count * 6 * a.itemSize);
      for (let i = 0; i < a.count; i++)
        for (let k = 0; k < 6; k++)
          for (let c = 0; c < a.itemSize; c++)
            data[(i * 6 + k) * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(key, new BufferAttribute(data, a.itemSize));
    }
    g.morphTargetsRelative = true;
    for (const [key, targets] of Object.entries(source.morphAttributes))
      g.morphAttributes[key as "position"] = targets!.map((a) => {
        const data = new Float32Array(a.count * 18);
        for (let i = 0; i < a.count; i++)
          for (let k = 0; k < 6; k++)
            for (let c = 0; c < 3; c++)
              data[(i * 6 + k) * 3 + c] = a.getComponent(i, c);
        return new BufferAttribute(data, 3);
      });
    const material = new NodeMaterial();
    material.side = DoubleSide;
    material.blending = NoBlending;
    material.depthTest = material.depthWrite = material.toneMapped = false;
    const output = varyingProperty("vec3", "qdefProbe");
    material.setupPosition = () => positionLocal;
    material.vertexNode = Fn((builder) => {
      setupMMDPosition(material, builder);
      output.assign(normal ? normalLocal.normalize() : positionLocal);
      const corner = vertexIndex.mod(6),
        x = corner
          .equal(1)
          .or(corner.equal(3))
          .or(corner.equal(4))
          .select(1, 0),
        y = corner
          .equal(2)
          .or(corner.equal(4))
          .or(corner.equal(5))
          .select(1, 0);
      return vec4(
        float(vertexIndex.div(6)).add(x).div(24).mul(2).sub(1),
        float(y).mul(2).sub(1),
        0,
        1,
      );
    })();
    material.fragmentNode = vec4(output, 1);
    const savedGeometry = mesh.geometry,
      savedMaterial = mesh.material;
    mesh.geometry = g;
    mesh.material = material;
    const savedVisibility = new Map<Mesh, boolean>();
    mesh.parent!.traverse((n) => {
      if ((n as Mesh).isMesh) {
        savedVisibility.set(n as Mesh, n.visible);
        n.visible = n === mesh;
      }
    });
    const probeScene = new Scene();
    // Keep source parents/bones intact; renderer can draw the actual mesh through
    // a temporary scene child list without reparenting it.
    probeScene.children = [mesh];
    mesh.frustumCulled = false;
    renderer.setRenderTarget(target);
    renderer.render(probeScene, camera);
    const values = (await renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      24,
      1,
    )) as Float32Array;
    renderer.setRenderTarget(null);
    mesh.geometry = savedGeometry;
    mesh.material = savedMaterial;
    savedVisibility.forEach((v, m) => (m.visible = v));
    g.dispose();
    material.dispose();
    return values;
  };
  const { api } = await loadAmmoBrowser(`${base}runtime/ammo.js`);
  const reference = await (await fetch(`${base}physics/reference.json`)).json();
  const evidence: object[] = [],
    images: {
      name: string;
      data: string;
    }[] = [],
    exports: object[] = [];
  let maximumPosition = 0,
    maximumNormal = 0,
    maximumCPU = 0,
    maximumRaster = 0;
  for (const rig of ["box", "wedge"] as const)
    for (const material of ["toon", "pbr"])
      for (const state of ["a", "b", "pose-a", "pose-b"]) {
        Object.assign(window, {
          physicsProgress: { rig, mode, material, state },
        });
        let skinning!: MMDQDEFPlugin, toon: MMDToonPlugin | undefined;
        const loader = new GLTFLoader()
          .register((p) => new MMDSolverPlugin(p))
          .register((p) => new MMDPhysicsPlugin(p))
          .register((p) => new MMDVMDPlugin(p))
          .register((p) => (skinning = new MMDQDEFPlugin(p)))
          .register((p) => new MMDOutlinePlugin(p));
        if (material === "toon")
          loader.register((p) => (toon = new MMDToonPlugin(p)));
        const asset = await loader.loadAsync(
            `${base}physics/${rig}-${mode}/rest.glb`,
          ),
          handle = createVPDRig(asset.scene),
          physics = new PhysicsRig(asset.scene, api),
          posed = state.startsWith("pose-"),
          id = state.slice(-1) as "a" | "b",
          time = posed ? 0 : 0.5,
          expected = reference.poses[`${rig}-${state}`];
        let player;
        if (posed) {
          const data = new Uint8Array(
            await (await fetch(`${base}solver/solver-${id}.vpd`)).arrayBuffer(),
          );
          applyVPD(handle, bindVPD(handle, parseVPD(data, "utf-8")));
          physics.step(0.25);
        } else {
          const data = new Uint8Array(
            await (await fetch(`${base}solver/solver-${id}.vmd`)).arrayBuffer(),
          );
          player = createVMDPlayer(handle, bindVMD(handle, parseVMD(data)));
          player.seek(0.5);
        }
        asset.scene.updateMatrixWorld(true);
        const meshes: SkinnedMesh[] = [];
        asset.scene.traverse((n) => {
          if ((n as SkinnedMesh).isSkinnedMesh) meshes.push(n as SkinnedMesh);
        });
        for (const mesh of meshes) {
          const positions = await probe(mesh, false),
            normals = await probe(mesh, true);
          for (let i = 0; i < 24; i++) {
            const e = solverVertex(
              rig,
              id,
              true,
              i,
              mode,
              !posed,
              false,
              false,
              time,
              false,
              expected,
            );
            maximumCPU = Math.max(
              maximumCPU,
              mesh.getVertexPosition(i, new Vector3()).distanceTo(e.p),
            );
            for (let c = 0; c < 3; c++) {
              maximumPosition = Math.max(
                maximumPosition,
                Math.abs(positions[i * 4 + c] - e.p.getComponent(c)),
              );
              maximumNormal = Math.max(
                maximumNormal,
                Math.abs(normals[i * 4 + c] - e.n.getComponent(c)),
              );
            }
            if (positions[i * 4 + 3] !== 1 || normals[i * 4 + 3] !== 1)
              throw new Error("Missing GPU probe coverage");
          }
        }
        for (const pass of ["surface", "outline"]) {
          const baked = new Group();
          for (const mesh of meshes) {
            mesh.frustumCulled = false;
            const geometry = mesh.geometry.clone();
            geometry.morphAttributes = {};
            for (let i = 0; i < 24; i++) {
              const e = solverVertex(
                rig,
                id,
                true,
                i,
                mode,
                !posed,
                false,
                pass === "outline",
                time,
                false,
                expected,
              );
              geometry.getAttribute("position").setXYZ(i, ...e.p.toArray());
              geometry.getAttribute("normal").setXYZ(i, ...e.n.toArray());
            }
            geometry.deleteAttribute("skinIndex");
            geometry.deleteAttribute("skinWeight");
            const m = new Mesh(geometry, mesh.material);
            m.frustumCulled = false;
            setOutlineRecords(
              m,
              getOutlineRecords(mesh).map((r) => ({
                ...r,
                skinAttributes: undefined,
              })),
            );
            baked.add(m);
            (Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material]
            ).forEach((m) => {
              m.colorWrite = m.depthWrite = pass === "surface";
            });
          }
          effect.enabled = pass === "outline";
          scene.add(asset.scene);
          effect.render(scene, camera);
          const actual = pixels();
          if (!actual.some((v, i) => i % 4 < 3 && v < 180))
            throw new Error("Empty physics raster");
          images.push({
            name: `${rig}-${mode}-${material}-${state}-${pass}`,
            data: renderer.domElement.toDataURL(),
          });
          scene.remove(asset.scene);
          scene.add(baked);
          effect.render(scene, camera);
          const expectedPixels = pixels(),
            different = difference(actual, expectedPixels);
          maximumRaster = Math.max(maximumRaster, different);
          evidence.push({
            rig,
            mode,
            material,
            state,
            pass,
            different,
            revision: "post-physics nodes/palette used by the measured render",
          });
          scene.remove(baked);
          baked.traverse((n) => {
            if ((n as Mesh).isMesh) (n as Mesh).geometry.dispose();
          });
          meshes
            .flatMap((m) =>
              Array.isArray(m.material) ? m.material : [m.material],
            )
            .forEach((m) => {
              m.colorWrite = m.depthWrite = true;
            });
        }
        if (material === "pbr" && (state === "pose-a" || state === "a"))
          for (const format of ["glb", "gltf"]) {
            const before = expected,
              encoded = await new GLTFExporter()
                .register((w) => new MMDVPDExporterPlugin(w))
                .register((w) => new MMDPhysicsExporterPlugin(w))
                .register((w) => new MMDSDEFExporterPlugin(w))
                .register((w) => new MMDQDEFExporterPlugin(w))
                .parseAsync(asset.scene, {
                  binary: format === "glb",
                  onlyVisible: false,
                  includeCustomExtensions: true,
                });
            exports.push(
              encoded instanceof ArrayBuffer
                ? {
                    rig,
                    mode,
                    state,
                    format,
                    bytes: Array.from(new Uint8Array(encoded)),
                  }
                : { rig, mode, state, format, json: JSON.stringify(encoded) },
            );
            const reloaded = await new GLTFLoader()
              .register((p) => new MMDSolverPlugin(p))
              .register((p) => new MMDPhysicsPlugin(p))
              .register((p) => new MMDQDEFPlugin(p))
              .parseAsync(
                encoded instanceof ArrayBuffer
                  ? encoded
                  : JSON.stringify(encoded),
                "",
              );
            const current: any[] = [];
            reloaded.scene.traverse((n) => {
              if (n.userData.pmxBone)
                current[n.userData.pmxBone.index] = {
                  translation: n.position.toArray(),
                  rotation: n.quaternion.toArray(),
                };
            });
            for (const b of before) {
              if (
                Math.hypot(
                  ...b.translation.map(
                    (v: number, i: number) =>
                      v - current[b.index].translation[i],
                  ),
                ) > 3e-6
              )
                throw new Error("Snapshot changed on export/reload");
            }
            const restored = createVPDRig(reloaded.scene);
            if (
              JSON.stringify(getVPDModel(restored).bones) !==
              JSON.stringify(getVPDModel(handle).bones)
            )
              throw new Error("Original rest changed on export");
            reloaded.scene.traverse((node) => {
              const mesh = node as SkinnedMesh;
              if (!mesh.isSkinnedMesh) return;
              for (let i = 0; i < 24; i++) {
                const oracle = solverVertex(
                  rig,
                  id,
                  true,
                  i,
                  mode,
                  !posed,
                  false,
                  false,
                  time,
                  false,
                  expected,
                );
                if (
                  mesh
                    .getVertexPosition(i, new Vector3())
                    .distanceTo(oracle.p) > 2e-6
                )
                  throw new Error(
                    "Exported physics deformation changed on reload",
                  );
              }
              mesh.geometry.dispose();
              (Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material]
              ).forEach((m) => m.dispose());
            });
          }
        player?.dispose();
        physics.dispose();
        effect.release(asset.scene);
        skinning.dispose();
        await toon?.dispose();
        for (const mesh of meshes) {
          mesh.geometry.dispose();
          (Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
          ).forEach((m) => m.dispose());
        }
      }
  if (
    maximumCPU > 2e-6 ||
    maximumPosition > 1e-4 ||
    maximumNormal > 5e-4 ||
    maximumRaster > 128
  )
    throw new Error(
      `Physics CPU/position/normal/raster ${maximumCPU}/${maximumPosition}/${maximumNormal}/${maximumRaster}`,
    );
  Object.assign(window, {
    physicsResult: {
      mode,
      maximumCPU,
      maximumPosition,
      maximumNormal,
      maximumRaster,
      evidence,
    },
    physicsImages: images,
    physicsExports: exports,
  });
  target.dispose();
  effect.dispose();
  renderer.dispose();
}
run().catch((error) => {
  Object.assign(window, { physicsError: String(error) });
  console.error(error);
});
