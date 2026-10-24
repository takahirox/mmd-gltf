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
  const evidence: object[] = [];
  const captures = new Map<string, Uint8ClampedArray>();
  let maximumPosition = 0,
    maximumNormal = 0,
    maximumCPU = 0,
    disabledSeparation = 0,
    orderSeparation = 0;
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
  const query = new URLSearchParams(location.search);
  const rigs = (query.has("rig") ? [query.get("rig")!] : ["box", "wedge"]) as (
    | "box"
    | "wedge"
  )[];
  const materials = query.has("material")
    ? [query.get("material")!]
    : ["toon", "pbr"];
  for (const rig of rigs)
    for (const material of materials)
      for (const source of [
        "bytes",
        "glb",
        "gltf",
        "export-glb",
        "export-gltf",
      ])
        for (const state of ["a", "b", "pose-a", "pose-b"]) {
          Object.assign(window, {
            solverProgress: {
              rig,
              mode,
              material,
              source,
              state,
              comparisons: evidence.length,
            },
          });
          let skinning!: MMDQDEFPlugin, toon: MMDToonPlugin | undefined;
          const loader = new GLTFLoader()
            .register((p) => new MMDSolverPlugin(p))
            .register((p) => new MMDVMDPlugin(p))
            .register((p) => (skinning = new MMDQDEFPlugin(p)))
            .register((p) => new MMDOutlinePlugin(p));
          if (material === "toon")
            loader.register((p) => (toon = new MMDToonPlugin(p)));
          const id = state.slice(-1) as "a" | "b",
            posed = state.startsWith("pose-");
          const motion = parseVMD(
            new Uint8Array(
              await (
                await fetch(`${base}solver/solver-${id}.vmd`)
              ).arrayBuffer(),
            ),
          );
          const pose = parseVPD(
            new Uint8Array(
              await (
                await fetch(`${base}solver/solver-${id}.vpd`)
              ).arrayBuffer(),
            ),
            "utf-8",
          );
          let asset;
          if (source.startsWith("export-")) {
            const original = await new GLTFLoader()
                .register((p) => new MMDQDEFPlugin(p))
                .loadAsync(`${base}solver/${rig}-${mode}/rest.glb`),
              handle = createVPDRig(original.scene);
            if (posed) applyVPD(handle, bindVPD(handle, pose));
            else createVMDPlayer(handle, bindVMD(handle, motion)).seek(0.371);
            const encoded = await new GLTFExporter()
              .register((w) => new MMDVPDExporterPlugin(w))
              .register((w) => new MMDSDEFExporterPlugin(w))
              .register((w) => new MMDQDEFExporterPlugin(w))
              .parseAsync(original.scene, {
                binary: source === "export-glb",
                includeCustomExtensions: true,
              });
            const list = Array.isArray((window as any).solverExports)
              ? (window as any).solverExports
              : [];
            if (state === "pose-a") {
              const record =
                encoded instanceof ArrayBuffer
                  ? {
                      format: "glb",
                      bytes: Array.from(new Uint8Array(encoded)),
                    }
                  : { format: "gltf", json: JSON.stringify(encoded) };
              list.push(record);
              Object.assign(window, { solverExports: list });
            }
            asset = await loader.parseAsync(
              encoded instanceof ArrayBuffer
                ? encoded
                : JSON.stringify(encoded),
              "",
            );
          } else
            asset = await loader.loadAsync(
              `${base}solver/${rig}-${mode}/${source === "bytes" ? "rest.glb" : state + "." + source}`,
            );
          const handle = createVPDRig(asset.scene),
            meshes: SkinnedMesh[] = [];
          asset.scene.traverse((n) => {
            if ((n as SkinnedMesh).isSkinnedMesh) meshes.push(n as SkinnedMesh);
          });
          let player = getVMDPlayers(asset)[0];
          if (source === "bytes" && !posed)
            player = createVMDPlayer(handle, bindVMD(handle, motion));
          // Exported applied states must load as resolved poses, with no second solve.
          const times = posed
            ? [0]
            : source.startsWith("export-")
              ? [0.371]
              : [0.371, 0.719];
          for (const time of times) {
            if (posed && source === "bytes") {
              const binding = bindVPD(handle, pose);
              applyVPD(handle, binding);
              applyVPD(handle, binding);
            } else player?.seek(time);
            asset.scene.updateMatrixWorld(true);
            const enabled = posed || time < 0.5 || time >= 1;
            for (const mesh of meshes) {
              const positions = await probe(mesh, false),
                normals = await probe(mesh, true);
              for (let i = 0; i < 24; i++) {
                const expected = solverVertex(
                    rig,
                    id,
                    enabled,
                    i,
                    mode,
                    !posed,
                    false,
                    false,
                    time,
                  ),
                  actual = mesh.getVertexPosition(i, new Vector3());
                maximumCPU = Math.max(
                  maximumCPU,
                  actual.distanceTo(expected.p),
                );
                for (let c = 0; c < 3; c++) {
                  maximumPosition = Math.max(
                    maximumPosition,
                    Math.abs(positions[i * 4 + c] - expected.p.getComponent(c)),
                  );
                  maximumNormal = Math.max(
                    maximumNormal,
                    Math.abs(normals[i * 4 + c] - expected.n.getComponent(c)),
                  );
                }
                if (positions[i * 4 + 3] !== 1 || normals[i * 4 + 3] !== 1)
                  throw new Error("Missing GPU coverage");
                if (enabled) {
                  disabledSeparation = Math.max(
                    disabledSeparation,
                    actual.distanceTo(
                      solverVertex(
                        rig,
                        id,
                        false,
                        i,
                        mode,
                        !posed,
                        false,
                        false,
                        time,
                      ).p,
                    ),
                  );
                  if (!posed)
                    orderSeparation = Math.max(
                      orderSeparation,
                      actual.distanceTo(
                        solverVertex(
                          rig,
                          id,
                          true,
                          i,
                          mode,
                          true,
                          true,
                          false,
                          time,
                        ).p,
                      ),
                    );
                }
              }
            }
            if (
              maximumCPU > 2e-6 ||
              maximumPosition > 1e-4 ||
              maximumNormal > 5e-4
            )
              throw new Error(
                `Solver deformation errors CPU/GPU/normal ${maximumCPU}/${maximumPosition}/${maximumNormal}`,
              );
            for (const pass of ["surface", "outline"]) {
              const baked = new Group();
              for (const mesh of meshes) {
                mesh.frustumCulled = false;
                const g = mesh.geometry.clone();
                g.morphAttributes = {};
                for (let i = 0; i < 24; i++) {
                  const e = solverVertex(
                    rig,
                    id,
                    enabled,
                    i,
                    mode,
                    !posed,
                    false,
                    pass === "outline",
                    time,
                  );
                  g.getAttribute("position").setXYZ(i, ...e.p.toArray());
                  g.getAttribute("normal").setXYZ(i, ...e.n.toArray());
                }
                g.deleteAttribute("skinIndex");
                g.deleteAttribute("skinWeight");
                const m = new Mesh(g, mesh.material);
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
              captures.set(pass, new Uint8ClampedArray(actual));
              scene.remove(asset.scene);
              scene.add(baked);
              effect.render(scene, camera);
              const expected = pixels();
              scene.remove(baked);
              const mismatch = difference(actual, expected);
              if (mismatch > 128)
                throw new Error(
                  `Solver raster ${rig}/${mode}/${material}/${source}/${state}/${time}/${pass}: ${mismatch}`,
                );
              if (!actual.some((v, i) => i % 4 < 3 && v < 180))
                throw new Error("Empty solver raster");
              evidence.push({
                rig,
                mode,
                material,
                source,
                state,
                time,
                pass,
                oraclePixelMismatches: mismatch,
                maximumCPU,
                maximumPosition,
                maximumNormal,
              });
              baked.children.forEach((n) => (n as Mesh).geometry.dispose());
            }
          }
          // Reset retains original-rest identity, then applying the same pose is stable.
          resetVPD(handle);
          const binding = bindVPD(handle, pose);
          applyVPD(handle, binding);
          const before = meshes[0].getVertexPosition(0, new Vector3());
          applyVPD(handle, binding);
          if (
            before.distanceTo(meshes[0].getVertexPosition(0, new Vector3())) >
            2e-6
          )
            throw new Error("Export/reapplication accumulated solver output");
          player?.dispose();
          effect.release(asset.scene);
          skinning.dispose();
          await toon?.dispose();
        }
  if (disabledSeparation < 0.01 || orderSeparation < 0.001)
    throw new Error("Insufficient negative-control separation");
  for (const pass of ["surface", "outline"]) {
    const saved = document.createElement("canvas");
    saved.width = saved.height = 160;
    saved.dataset.pass = pass;
    saved
      .getContext("2d")!
      .putImageData(
        new ImageData(new Uint8ClampedArray(captures.get(pass)!), 160, 160),
        0,
        0,
      );
    document.body.append(saved);
  }
  renderer.domElement.remove();
  target.dispose();
  effect.dispose();
  renderer.dispose();
  return {
    passed: evidence.length,
    maximumCPU,
    maximumPosition,
    maximumNormal,
    disabledSeparation,
    orderSeparation,
    evidence,
  };
}
run()
  .then((result) => Object.assign(window, { solverConformance: result }))
  .catch((error) => {
    console.error(error);
    Object.assign(window, { solverConformanceError: String(error) });
  });
