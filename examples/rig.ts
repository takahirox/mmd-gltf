import { WebGPURenderer, Scene, Color, OrthographicCamera, DirectionalLight, type Group, type Mesh, type Material } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDToonPlugin } from '../packages/three-mmd-toon';
import { MMDOutlinePlugin, MMDOutlineEffect } from '../packages/three-mmd-outline';
import { parseVPD, createVPDRig, bindVPD, applyVPD, resetVPD, type VPDRig, type VPDEncoding, type BindingOptions } from '../packages/three-mmd-vpd';

async function start() {
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: new URLSearchParams(location.search).get('backend') !== 'webgpu' });
  await renderer.init();
  const viewport = document.querySelector<HTMLElement>('#rig-viewport')!; viewport.append(renderer.domElement);
  const scene = new Scene(); scene.background = new Color(0xd0d0d0);
  const light = new DirectionalLight(0xffffff, 2); light.position.set(1, 2, 4); scene.add(light);
  const camera = new OrthographicCamera(-0.6, 0.6, 0.6, -0.6, 0.1, 30);
  camera.position.set(2.2, 1.8, 3.6);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0.2, 0.25, -0.4); controls.update();
  const effect = new MMDOutlineEffect(renderer);
  const select = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!;
  const material = select('rig-material'), outline = select('rig-outlines'), model = select('rig-model'), sample = select('rig-pose'), encoding = select('rig-encoding');
  const mapping = document.querySelector<HTMLTextAreaElement>('#rig-map')!, file = document.querySelector<HTMLInputElement>('#rig-file')!;
  const preset = document.querySelector<HTMLButtonElement>('#rig-preset')!, reset = document.querySelector<HTMLButtonElement>('#rig-reset')!;
  const status = document.querySelector('#status')!, label = document.querySelector('#rig-state')!;
  const info = { ready: false, deformed: false, mode: 'toon', frames: 0, rig: 'box', pose: 'rest', bones: [] as object[], error: '' };
  Object.assign(window, { mmdRig: info });
  let assets: { scene: Group; rig: VPDRig }[] = [], local: File | undefined;
  const report = (message: string) => { status.textContent = `Ready · ${message} · Bone offsets only; IK/append/physics and VMD unsupported`; };
  const snapshot = () => {
    info.bones = [];
    assets[0]?.scene.traverse(n => { if (n.userData.pmxBone) info.bones.push({ index: n.userData.pmxBone.index, translation: n.position.toArray(), rotation: n.quaternion.toArray() }); });
  };
  const appearance = () => { assets.forEach((a, i) => { a.scene.visible = material.value === 'toon' ? i === 0 : i === 1; }); info.mode = material.value; };
  async function loadRig() {
    info.ready = false; preset.disabled = reset.disabled = true;
    status.textContent = 'Loading converter-produced rig…';
    const url = `${import.meta.env.BASE_URL}vpd/${model.value}/rest.glb`;
    const loader = new GLTFLoader().register(parser => new MMDToonPlugin(parser)).register(parser => new MMDOutlinePlugin(parser));
    const loaded = await Promise.all([loader.loadAsync(url), new GLTFLoader().register(parser => new MMDOutlinePlugin(parser)).loadAsync(url)]);
    const next = loaded.map(a => ({ scene: a.scene, rig: createVPDRig(a.scene) }));
    assets.forEach(a => {
      effect.release(a.scene); scene.remove(a.scene);
      a.scene.traverse(n => { const mesh = n as Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m: Material) => m.dispose()); } });
    });
    assets = next; assets.forEach(a => scene.add(a.scene)); appearance();
    info.rig = model.value; info.pose = 'rest'; info.deformed = false; info.ready = true; info.error = '';
    snapshot(); label.textContent = 'Rest state'; report('Rig loaded'); preset.disabled = reset.disabled = false;
  }
  async function apply() {
    let data: Uint8Array;
    if (sample.value === 'local') {
      if (!local) throw new Error('Select a local VPD file first');
      data = new Uint8Array(await local.arrayBuffer());
    } else {
      const response = await fetch(`${import.meta.env.BASE_URL}vpd/pose-${sample.value}.vpd`);
      if (!response.ok) throw new Error(`VPD fetch failed: ${response.status}`);
      data = new Uint8Array(await response.arrayBuffer());
    }
    const pose = parseVPD(data, encoding.value as VPDEncoding);
    const options: BindingOptions = { mapping: JSON.parse(mapping.value), unmatched: select('rig-unmatched').value as BindingOptions['unmatched'] };
    // Resolve BOTH representations before mutating either one.
    const bound = assets.map(a => bindVPD(a.rig, pose, options));
    bound.forEach((b, i) => applyVPD(assets[i].rig, b));
    info.deformed = true; info.pose = sample.value; info.error = ''; snapshot();
    label.textContent = `Pose ${sample.value.toUpperCase()} · ${bound[0].appliedRecords} bone offsets · parent filename ${pose.parentFile} (informational)`;
    report(`Applied VPD. Unmatched: ${bound[0].unmatched.join(', ') || 'none'}`);
  }
  const poseControls = [model, sample, encoding, file, mapping, select('rig-unmatched'), preset, reset];
  const guarded = (action: () => Promise<void> | void) => async () => {
    poseControls.forEach(control => { control.disabled = true; }); status.textContent = 'Working…';
    try { await action(); }
    catch (error) { info.error = String(error); info.ready = assets.length > 0; report(info.error); }
    finally { poseControls.forEach(control => { control.disabled = !info.ready; }); }
  };
  preset.onclick = guarded(apply);
  reset.onclick = guarded(() => { assets.forEach(a => resetVPD(a.rig)); info.deformed = false; info.pose = 'rest'; info.error = ''; snapshot(); label.textContent = 'Rest state'; report('Reset to original rest'); });
  sample.onchange = () => {
    if (sample.value !== 'local') {
      encoding.value = sample.value === 'a' ? 'shift_jis' : 'utf-8';
      mapping.value = sample.value === 'a' ? '{"2": 0, "3": 259}' : '{"0": 259}';
    }
  };
  file.onchange = () => { local = file.files?.[0]; sample.value = 'local'; mapping.value = '{}'; };
  model.onchange = guarded(loadRig); material.onchange = appearance; outline.onchange = () => { effect.enabled = outline.value === 'on'; };
  for (const control of [material, outline, model, sample, encoding, file, mapping, select('rig-unmatched')]) control.disabled = false;
  const resize = () => { const width = viewport.clientWidth, height = viewport.clientHeight; renderer.setSize(width, height); camera.left = -0.6 * width / height; camera.right = 0.6 * width / height; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(viewport); resize(); await loadRig();
  renderer.setAnimationLoop(() => { controls.update(); effect.render(scene, camera); info.frames++; });
}
start().catch(error => { console.error(error); document.querySelector('#status')!.textContent = `Rig failed: ${String(error)}`; });
