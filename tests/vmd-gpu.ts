import {
  WebGPURenderer,
  Scene,
  OrthographicCamera,
  Color,
  DirectionalLight,
  Vector3,
  Mesh,
  Group,
  type SkinnedMesh,
  type Material,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDToonPlugin } from '../packages/three-mmd-toon';
import {
  MMDOutlinePlugin,
  MMDOutlineEffect,
  getOutlineRecords,
  setOutlineRecords,
} from '../packages/three-mmd-outline';
import { createVPDRig } from '../packages/three-mmd-vpd';
import { parseVMD, bindVMD, createVMDPlayer, MMDVMDPlugin, getVMDPlayers } from '../packages/three-mmd-vmd';
import { scalarPosition, scalarNormal, scalarLocal } from './vmd-oracle';
import { morphPoint, morphWeights } from './morph-oracle';
import { rigScale } from './vpd-oracle';
async function run() {
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
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 160;
  const context = canvas.getContext('2d')!;
  const pixels = () => {
    context.drawImage(renderer.domElement, 0, 0);
    return context.getImageData(0, 0, 160, 160).data;
  };
  const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let count = 0;
    for (let i = 0; i < a.length; i += 4)
      if ([0, 1, 2].some((j) => Math.abs(a[i + j] - b[i + j]) > 2)) count++;
    return count;
  };
  const evidence: object[] = [];
  const morph = new URLSearchParams(location.search).has('morph');
  for (const rig of ['box', 'wedge'] as const)
    for (const motion of ['a', 'b'] as const)
      for (const mode of ['toon', 'pbr'])
        for (const source of ['bytes', 'glb', 'gltf']) {
          let toon: MMDToonPlugin | undefined, outlines: MMDOutlinePlugin | undefined;
          const loader = new GLTFLoader()
            .register((p) => new MMDVMDPlugin(p))
            .register((p) => (outlines = new MMDOutlinePlugin(p)));
          if (mode === 'toon') loader.register((p) => (toon = new MMDToonPlugin(p)));
          const base = import.meta.env.BASE_URL,
            asset = await loader.loadAsync(
              source === 'bytes' ? `${base}${morph ? 'morph' : 'vpd'}/${rig}/rest.glb` : `${base}${morph ? 'morph' : 'vmd'}/${rig}/${motion}.${source}`,
            );
          const motionBytes =
            source === 'bytes'
              ? parseVMD(new Uint8Array(await (await fetch(`${base}${morph ? 'morph/combined-' : 'vmd/motion-'}${motion}.vmd`)).arrayBuffer()))
              : undefined;
          const handle = createVPDRig(asset.scene);
          const player = motionBytes
            ? createVMDPlayer(
                handle,
                bindVMD(handle, motionBytes, {
                  morphUnmatched: morph ? 'error' : 'ignore',
                  morphMapping: morph ? await (await fetch(`${base}morph/morph-map.json`)).json() : undefined,
                  mapping: await (await fetch(`${base}vmd/motion-${motion}-map.json`)).json(),
                }),
              )
            : getVMDPlayers(asset)[0];
          const scale = rigScale[rig];
          camera.left = camera.bottom = -2.2 * scale;
          camera.right = camera.top = 2.2 * scale;
          camera.position.set(2.5 + scale, 2 + scale, 4 - 2 * scale);
          camera.lookAt(scale, scale, -2 * scale);
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld();
          const meshes: SkinnedMesh[] = [];
          asset.scene.traverse((n) => {
            if ((n as SkinnedMesh).isSkinnedMesh) meshes.push(n as SkinnedMesh);
          });
          if (meshes.length !== 2) throw new Error('Expected both material primitives');
          const initial: Record<string, Uint8ClampedArray> = {};
          for (const [state, time] of [
            ['initial', 0.371],
            ['other', 0.719],
            ['reseek', 0.371],
          ] as const) {
            player.seek(time);
            let rotationError = 0;
            asset.scene.traverse((n) => {
              if (n.userData.pmxBone) {
                const expected = scalarLocal(rig, motion, n.userData.pmxBone.index, time).rotation,
                  actual = n.quaternion.toArray(),
                  dot = Math.abs(
                    expected.reduce((sum, v, i) => sum + v * actual[i], 0) /
                      (Math.hypot(...actual) * Math.hypot(...expected)),
                  );
                rotationError = Math.max(rotationError, 2 * Math.acos(Math.min(1, dot)));
              }
            });
            if (rotationError > 1e-7) throw new Error(`rotation ${rotationError}`);
            let maximumWeightError = 0;
            if (morph) for (const mesh of meshes) mesh.morphTargetInfluences!.forEach((w,i) => { maximumWeightError = Math.max(maximumWeightError, Math.abs(w-morphWeights(motion,time)[i])); });
            if (maximumWeightError > 1e-6) throw new Error(`weight ${maximumWeightError}`);
            for (const pass of ['surface', 'outline']) {
              const hull = pass === 'outline',
                oracle = new Group();
              let error = 0;
              for (const mesh of meshes) {
                mesh.frustumCulled = false;
                const geometry = mesh.geometry.clone(),
                  position = geometry.getAttribute('position'),
                  normal = geometry.getAttribute('normal');
                for (let i = 0; i < position.count; i++) {
                  const basePoint = [position.getX(i),position.getY(i),position.getZ(i)],
                    p = scalarPosition(rig, motion, i, time, morph ? morphPoint(rig,motion,i,time,basePoint) : basePoint),
                    n = scalarNormal(
                      rig,
                      motion,
                      i,
                      time,
                      [normal.getX(i), normal.getY(i), normal.getZ(i)],
                      hull,
                    ),
                    actual = mesh.getVertexPosition(i, new Vector3()).toArray();
                  p.forEach((v, j) => {
                    error = Math.max(error, Math.abs(v - actual[j]));
                  });
                  position.setXYZ(i, ...(p as [number, number, number]));
                  normal.setXYZ(i, ...(n as [number, number, number]));
                }
                geometry.morphAttributes = {};
                geometry.deleteAttribute('skinIndex');
                geometry.deleteAttribute('skinWeight');
                const materials = (
                  Array.isArray(mesh.material) ? mesh.material : [mesh.material]
                ) as Material[];
                materials.forEach((m) => {
                  m.colorWrite = m.depthWrite = !hull;
                });
                const baked = new Mesh(geometry, mesh.material);
                baked.frustumCulled = false;
                setOutlineRecords(
                  baked,
                  getOutlineRecords(mesh).map((r) => ({ ...r, skinAttributes: undefined })),
                );
                oracle.add(baked);
              }
              if (error > 2e-6) throw new Error(`${rig}/${motion}/${source}/${mode}: skin ${error}`);
              effect.enabled = hull;
              scene.add(asset.scene);
              effect.render(scene, camera);
              const actual = pixels();
              scene.remove(asset.scene);
              scene.add(oracle);
              effect.render(scene, camera);
              const predicted = pixels();
              scene.remove(oracle);
              const mismatch = difference(actual, predicted);
              if (mismatch > 128)
                throw new Error(
                  `${rig}/${motion}/${source}/${mode}/${pass}: oracle pixel mismatches ${mismatch}`,
                );
              const foreground = Array.from({ length: 160 * 160 }, (_, i) => i * 4).filter(
                (i) => actual[i] < 180 || actual[i + 1] < 180 || actual[i + 2] < 180,
              ).length;
              if (foreground < 100) throw new Error('Empty rendering');
              if (state === 'initial') initial[pass] = actual;
              if (state === 'reseek' && difference(actual, initial[pass]) !== 0)
                throw new Error('Seek order changed rendering');
              evidence.push({
                rig,
                motion,
                source,
                mode,
                state,
                pass,
                maximumPositionError: error,
                maximumWeightError,
                maximumRotationError: rotationError,
                oraclePixelMismatches: mismatch,
              });
              effect.release(oracle);
              oracle.traverse((n) => {
                if ((n as Mesh).isMesh) (n as Mesh).geometry.dispose();
              });
            }
          }
          player.dispose();
          effect.release(asset.scene);
          outlines?.dispose();
          asset.scene.traverse((n) => {
            const mesh = n as Mesh;
            if (mesh.isMesh) {
              mesh.geometry.dispose();
              (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
            }
          });
          await toon?.dispose();
        }
  effect.dispose();
  renderer.dispose();
  return { passed: evidence.length, evidence };
}
run()
  .then((result) => Object.assign(window, { vmdConformance: result }))
  .catch((error) => {
    console.error(error);
    Object.assign(window, { vmdConformanceError: String(error) });
  });
