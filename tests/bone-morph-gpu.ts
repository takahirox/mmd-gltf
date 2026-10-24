import { probe } from './gpu-vertex-probe';
import {
  WebGPURenderer, RenderTarget, FloatType, NoColorSpace,
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
import { bindVPD, applyVPD, parseVPD, createVPDRig } from '../packages/three-mmd-vpd';
import { parseVMD, bindVMD, createVMDPlayer, MMDVMDPlugin, getVMDPlayers } from '../packages/three-mmd-vmd';
import { scalarPosition, scalarNormal, scalarLocal } from './vmd-oracle';
import { bonePrediction, boneControls, boneLocal, poseBoneLocal } from './bone-morph-oracle';
import { getMorphWeights, createMorphRig } from '../packages/three-mmd-morph';
import { runBoneExports } from './bone-morph-export';
import { mappings } from './vpd-oracle';
import { morphPoint, morphWeights } from './morph-oracle';
import { rigScale } from './vpd-oracle';
async function run() {
  const renderer = new WebGPURenderer({ forceWebGL: true, antialias: false });
  await renderer.init();
  renderer.setSize(160, 160);
  document.body.append(renderer.domElement);
  const target=new RenderTarget(24,1,{type:FloatType});target.texture.colorSpace=NoColorSpace;
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
  const morph=true;
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
              source === 'bytes' ? `${base}bone/${rig}/rest.glb` : `${base}bone/${rig}/${motion}.${source}`,
            );
          const motionBytes =
            source === 'bytes'
              ? parseVMD(new Uint8Array(await (await fetch(`${base}bone/bone-morph-${motion}.vmd`)).arrayBuffer()))
              : undefined;
          const handle = createVPDRig(asset.scene);
          const player = motionBytes
            ? createVMDPlayer(
                handle,
                bindVMD(handle, motionBytes, {
                  morphUnmatched: morph ? 'error' : 'ignore',
                  morphMapping: undefined,
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
            ['pose-a',0.719],
            ['pose-b',0.719],
          ] as const) {
            player.seek(time);
            const posed=state.startsWith('pose-'),poseId=state.slice(-1) as 'a'|'b';
            const controls=boneControls(motion,time);
            if(posed) {
              const vpd=parseVPD(new Uint8Array(await(await fetch(`${base}vpd/pose-${poseId}.vpd`)).arrayBuffer()),poseId==='a'?'shift_jis':'utf-8');
              applyVPD(handle,bindVPD(handle,vpd,{mapping:mappings[poseId]}));
            }
            let rotationError = 0;
            asset.scene.traverse((n) => {
              if (n.userData.pmxBone) {
                const expected:number[] = (posed?poseBoneLocal(rig,poseId,n.userData.pmxBone.index,controls):boneLocal(rig,motion,n.userData.pmxBone.index,time)).rotation,
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
            if (morph) for (const mesh of meshes) getMorphWeights(createMorphRig(asset.scene)).forEach((w,i) => { maximumWeightError = Math.max(maximumWeightError, Math.abs(w-controls[i])); });
            if (maximumWeightError > 1e-6) throw new Error(`weight ${maximumWeightError}`);
            let gpuPositionError=0,gpuNormalError=0;
            if(source==='bytes' && mode==='toon')for(const mesh of meshes) {
              const positions=await probe(renderer,target,camera,mesh,false),normals=await probe(renderer,target,camera,mesh,true);
              for(let i=0;i<24;i++) {
                const expected=bonePrediction(rig,posed?`pose-${poseId}`:motion,i,time,'bdef',false,controls);
                for(let c=0;c<3;c++) {
                  gpuPositionError=Math.max(gpuPositionError,Math.abs(positions[i*4+c]-expected.p.getComponent(c)));
                  gpuNormalError=Math.max(gpuNormalError,Math.abs(normals[i*4+c]-expected.n.getComponent(c)));
                }
                if(positions[i*4+3]!==1||normals[i*4+3]!==1)throw new Error('Missing BDEF GPU probe coverage');
              }
            }
            if(gpuPositionError>1e-4||gpuNormalError>5e-4)throw new Error(`Bone GPU ${gpuPositionError} / ${gpuNormalError}`);
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
                  const expected=bonePrediction(rig,posed?`pose-${poseId}`:motion,i,time,'bdef',hull,controls),
                    p=expected.p.toArray(),n=expected.n.toArray(),
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
                gpuPositionError,gpuNormalError,
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
  target.dispose();
  effect.dispose();
  renderer.dispose();
  return { passed: evidence.length, evidence, exports: await runBoneExports(import.meta.env.BASE_URL) };
}
run()
  .then((result) => Object.assign(window, { boneMorph: result }))
  .catch((error) => {
    console.error(error);
    Object.assign(window, { boneMorphError: String(error) });
  });
