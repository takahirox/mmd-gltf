import { WebGPURenderer, Scene, OrthographicCamera, Color, DirectionalLight, Vector3, Mesh, Group, type SkinnedMesh, type Material } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDToonPlugin } from '../packages/three-mmd-toon';
import { MMDOutlinePlugin, MMDOutlineEffect, getOutlineRecords, setOutlineRecords } from '../packages/three-mmd-outline';
import { setBDEFPreset } from '../examples/bdef-preset';

// Independent fixture oracle. The four authored influence patterns repeat per face;
// no emitted skin matrices, JOINTS/WEIGHTS attributes or production outline equation
// are used to calculate these expected positions and normals.
function prediction(p: number[], n: number[], vertex: number, deformed: boolean, hull: boolean) {
  if (!deformed) return { p, n };
  const patterns = [ [[259, 1]], [[0, 0.25], [2, 0.75]], [[0, 0.1], [1, 0.2], [2, 0.3], [259, 0.4]], [[259, 0.75], [2, 0.25]] ];
  const influences = patterns[vertex % 4];
  const out = [0, 0, 0]; let a = 0;
  for (const [joint, weight] of influences) {
    const q = joint === 0 || joint === 259 ? [1 - p[1], p[0] + 0.25 + (joint === 259 ? 0.25 : 0), p[2]]
      : joint === 1 ? [p[0], p[1] + 0.25, p[2]] : [p[0] - 0.125, p[1], p[2]];
    q.forEach((v, axis) => { out[axis] += v * weight; });
    if (joint === 0 || joint === 259) a += weight;
  }
  const b = 1 - a;
  // Surface normals follow Three.js's weighted matrix; hulls follow the draft's
  // inverse transpose. Their distinct contracts are deliberately retained.
  const d = hull ? a * a + b * b : 1;
  return { p: out, n: [(b * n[0] - a * n[1]) / d, (a * n[0] + b * n[1]) / d, n[2]] };
}

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
  for (const mode of ['toon', 'pbr']) {
    const loader = new GLTFLoader().register(parser => new MMDOutlinePlugin(parser));
    if (mode === 'toon') loader.register(parser => new MMDToonPlugin(parser));
    const asset = await loader.loadAsync(`${import.meta.env.BASE_URL}bdef/model.glb`);
    const meshes: SkinnedMesh[] = [];
    asset.scene.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh); });
    if (meshes.length !== 2) throw new Error(`Expected two converter material primitives: ${meshes.length}`);
    const bones = meshes[0].skeleton.bones;
    for (let i = 0; i < bones.length; i++) {
      if (bones[i].userData.pmxBone?.index !== i) throw new Error('Source index identity lost');
    }
    if (bones[0].name === bones[259].name || bones[0].userData.pmxBone.name !== bones[259].userData.pmxBone.name) throw new Error('Duplicate source identity did not survive loader name changes');
    const rest: Record<string, Uint8ClampedArray> = {};
    for (const [state, deformed] of [['rest', false], ['deformed', true], ['reset', false]] as const) {
      setBDEFPreset(asset.scene, deformed);
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
            const result = prediction(originalPosition, [normal.getX(i), normal.getY(i), normal.getZ(i)], i, deformed, hull);
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
        if (state === 'rest') rest[pass] = actual;
        const movement = difference(actual, rest[pass]);
        if (state === 'deformed' && movement < 300) throw new Error(`${mode}/${pass}: predicted movement absent (${movement})`);
        if (state === 'reset' && movement !== 0) throw new Error(`${mode}/${pass}: reset differs from rest`);
        evidence.push({ mode, state, pass, maximumPositionError: error, oraclePixelMismatches: mismatch, changedFromRest: movement });
        oracle.traverse(object => { if ((object as Mesh).isMesh) (object as Mesh).geometry.dispose(); });
      }
    }
  }
  effect.dispose(); renderer.dispose();
  return { passed: evidence.length, evidence };
}
run().then(result => Object.assign(window, { bdefConformance: result })).catch(error => {
  console.error(error); Object.assign(window, { bdefConformanceError: String(error) });
});
