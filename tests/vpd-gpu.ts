import { WebGPURenderer, Scene, OrthographicCamera, Color, DirectionalLight, Vector3, Mesh, Group, type SkinnedMesh, type Material } from 'three/webgpu';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDToonPlugin } from '../packages/three-mmd-toon';
import { MMDOutlinePlugin, MMDOutlineEffect, getOutlineRecords, setOutlineRecords } from '../packages/three-mmd-outline';

import { parseVPD, createVPDRig, bindVPD, applyVPD, resetVPD } from '../packages/three-mmd-vpd';
import { vpdPrediction, mappings, rigScale, type RigCase } from './vpd-oracle';

async function run() {
  const renderer = new WebGPURenderer({ forceWebGL: true, antialias: false });
  await renderer.init(); renderer.setSize(160, 160); document.body.append(renderer.domElement);
  const effect = new MMDOutlineEffect(renderer);
  const scene = new Scene(); scene.background = new Color(0xd0d0d0);
  const light = new DirectionalLight(0xffffff, 2); light.position.set(1, 2, 4); scene.add(light);
  const camera = new OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0.1, 20);
  camera.position.set(2.5, 2, 4); camera.lookAt(0.5, 0.65, -1); camera.updateMatrixWorld();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
  const context = canvas.getContext('2d')!;
  const pixels = () => { context.drawImage(renderer.domElement, 0, 0); return new Uint8ClampedArray(context.getImageData(0, 0, 160, 160).data); };
  const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let count = 0;
    for (let i = 0; i < a.length; i += 4) if ([0, 1, 2].some(j => Math.abs(a[i + j] - b[i + j]) > 2)) count++;
    return count;
  };
  const evidence: object[] = [];
  for (const rigCase of ['box', 'wedge'] as RigCase[]) for (const poseCase of ['a', 'b'] as const) for (const mode of ['toon', 'pbr']) for (const source of ['runtime', 'glb', 'gltf', 'export-glb', 'export-gltf']) {
    const loader = new GLTFLoader().register(parser => new MMDOutlinePlugin(parser));
    if (mode === 'toon') loader.register(parser => new MMDToonPlugin(parser));
    const base = `${import.meta.env.BASE_URL}vpd/`;
    const pose = parseVPD(new Uint8Array(await (await fetch(`${base}pose-${poseCase}.vpd`)).arrayBuffer()), poseCase === 'a' ? 'shift_jis' : 'utf-8');
    let asset;
    if (source.startsWith('export-')) {
      // Ordinary materials retain unknown draft payloads in userData.gltfExtensions.
      const original = await new GLTFLoader().loadAsync(`${base}${rigCase}/rest.glb`);
      const originalRig = createVPDRig(original.scene);
      applyVPD(originalRig, bindVPD(originalRig, pose, { mapping: mappings[poseCase] }));
      original.scene.userData = { ...original.scene.userData, ...original.userData };
      const exported = await new GLTFExporter().parseAsync(original.scene, { binary: source === 'export-glb', includeCustomExtensions: true });
      asset = await loader.parseAsync(exported instanceof ArrayBuffer ? exported : JSON.stringify(exported), '');
      for (const extension of ['MMD_materials_toon', 'MMD_materials_outline']) if (!asset.parser.json.extensionsUsed.includes(extension)) throw new Error(`Runtime serialization lost ${extension}`);
      let retainedAttribution = false;
      asset.scene.traverse(node => { if (node.userData.attribution === original.userData.attribution) retainedAttribution = true; });
      if (!retainedAttribution) throw new Error('Runtime serialization lost attribution');
    } else asset = await loader.loadAsync(`${base}${rigCase}/${source === 'runtime' ? 'rest.glb' : `${poseCase}.${source}`}`);
    const rig = createVPDRig(asset.scene), bound = bindVPD(rig, pose, { mapping: mappings[poseCase] });
    if (source === 'runtime') applyVPD(rig, bound);
    const scale = rigScale[rigCase];
    camera.left = camera.bottom = -2.2 * scale; camera.right = camera.top = 2.2 * scale;
    camera.position.set(2.5 + scale, 2 + scale, 4 - 2*scale); camera.lookAt(scale, scale, -2*scale); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const meshes: SkinnedMesh[] = [];
    asset.scene.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh); });
    if (meshes.length !== 2) throw new Error(`Expected two converter material primitives: ${meshes.length}`);
    const bones = meshes[0].skeleton.bones;
    for (let i = 0; i < bones.length; i++) {
      if (bones[i].userData.pmxBone?.index !== i) throw new Error('Source index identity lost');
    }
    if (bones[0].name === bones[259].name || bones[0].userData.pmxBone.name !== bones[259].userData.pmxBone.name) throw new Error('Duplicate source identity did not survive loader name changes');
    const initial: Record<string, Uint8ClampedArray> = {}, reset: Record<string, Uint8ClampedArray> = {};
    for (const [state, deformed] of [['posed', true], ['reset', false], ['reapply', true]] as const) {
      if (state === 'reset') resetVPD(rig);
      if (state === 'reapply') applyVPD(rig, bound);
      for (const pass of ['surface', 'outline']) {
        const hull = pass === 'outline';
        const oracle = new Group();
        let error = 0;
        for (const mesh of meshes) {
          mesh.frustumCulled = false;
          const geometry = mesh.geometry.clone();
          const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
          for (let i = 0; i < position.count; i++) {
            const originalPosition = [position.getX(i), position.getY(i), position.getZ(i)];
            const result = vpdPrediction(rigCase, deformed ? poseCase : 'rest', originalPosition, [normal.getX(i), normal.getY(i), normal.getZ(i)], i, hull);
            const actual = mesh.getVertexPosition(i, new Vector3()).toArray();
            result.p.forEach((value, axis) => { error = Math.max(error, Math.abs(actual[axis] - value)); });
            position.setXYZ(i, ...result.p as [number, number, number]);
            normal.setXYZ(i, ...result.n as [number, number, number]);
          }
          geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
          const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
          materials.forEach(material => { material.colorWrite = material.depthWrite = !hull; });
          const baked = new Mesh(geometry, mesh.material); baked.frustumCulled = false;
          setOutlineRecords(baked, getOutlineRecords(mesh).map(record => ({ ...record, skinAttributes: undefined })));
          oracle.add(baked);
        }
        if (error > 2e-6) throw new Error(`${mode}/${state}: surface position error ${error}`);
        effect.enabled = hull;
        scene.add(asset.scene); effect.render(scene, camera); const actual = pixels(); scene.remove(asset.scene);
        scene.add(oracle); effect.render(scene, camera); const predicted = pixels(); scene.remove(oracle);
        const mismatch = difference(actual, predicted);
        // Two encoded levels for half-float compositing; at most 0.5% raster
        // boundary pixels for independent FLOAT rounding at triangle edges.
        if (mismatch > 128) throw new Error(`${mode}/${state}/${pass}: ${mismatch} oracle pixel mismatches`);
        const foreground = Array.from({ length: 160 * 160 }, (_, i) => i * 4).filter(i => actual[i] < 180 || actual[i + 1] < 180 || actual[i + 2] < 180).length;
        if (foreground < 100) throw new Error(`${mode}/${state}/${pass}: empty rendering`);
        if (state === 'posed') initial[pass] = actual;
        if (state === 'reset') reset[pass] = actual;
        const movement = state === 'posed' ? 0 : difference(actual, reset[pass]);
        if (state === 'reapply' && movement < 300) throw new Error(`${rigCase}/${poseCase}/${mode}/${pass}: predicted movement absent (${movement})`);
        if (state === 'reapply' && difference(actual, initial[pass]) !== 0) throw new Error('Reapplication after reload/reset differs from initial resolved pose');
        evidence.push({ rig: rigCase, pose: poseCase, source, mode, state, pass, maximumPositionError: error, oraclePixelMismatches: mismatch, changedFromRest: movement });
        oracle.traverse(object => { if ((object as Mesh).isMesh) (object as Mesh).geometry.dispose(); });
      }
    }
    effect.release(asset.scene);
    asset.scene.traverse(object => { const mesh = object as Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose()); } });
  }
  effect.dispose(); renderer.dispose();
  return { passed: evidence.length, evidence };
}
run().then(result => Object.assign(window, { vpdConformance: result })).catch(error => {
  console.error(error); Object.assign(window, { vpdConformanceError: String(error) });
});
