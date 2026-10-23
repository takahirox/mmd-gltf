import { WebGPURenderer, Scene, Color, OrthographicCamera, DirectionalLight, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDToonPlugin } from '../packages/three-mmd-toon';
import { MMDOutlinePlugin, MMDOutlineEffect } from '../packages/three-mmd-outline';
import { setBDEFPreset } from './bdef-preset';

async function start() {
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: new URLSearchParams(location.search).get('backend') !== 'webgpu' });
  await renderer.init();
  const viewport = document.querySelector<HTMLElement>('#rig-viewport')!;
  viewport.append(renderer.domElement);
  const scene = new Scene(); scene.background = new Color(0xd0d0d0);
  const light = new DirectionalLight(0xffffff, 2); light.position.set(1, 2, 4); scene.add(light);
  const camera = new OrthographicCamera(-1.3, 1.3, 1.3, -1.3, 0.1, 30);
  camera.position.set(2.5, 2, 4); camera.lookAt(0.5, 0.65, -1);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0.5, 0.65, -1); controls.update();
  const loader = new GLTFLoader().register(parser => new MMDToonPlugin(parser)).register(parser => new MMDOutlinePlugin(parser));
  const url = `${import.meta.env.BASE_URL}bdef/model.glb`;
  const [toon, pbr] = await Promise.all([loader.loadAsync(url), new GLTFLoader().register(parser => new MMDOutlinePlugin(parser)).loadAsync(url)]);
  pbr.scene.visible = false; scene.add(toon.scene, pbr.scene);
  const effect = new MMDOutlineEffect(renderer);
  const material = document.querySelector<HTMLSelectElement>('#rig-material')!;
  const outline = document.querySelector<HTMLSelectElement>('#rig-outlines')!;
  const preset = document.querySelector<HTMLButtonElement>('#rig-preset')!;
  const reset = document.querySelector<HTMLButtonElement>('#rig-reset')!;
  const info = { ready: true, deformed: false, mode: 'toon', frames: 0 };
  Object.assign(window, { mmdRig: info });
  function pose(deformed: boolean) {
    for (const asset of [toon, pbr]) setBDEFPreset(asset.scene, deformed);
    info.deformed = deformed;
    document.querySelector('#rig-state')!.textContent = deformed ? 'Deformation preset: 90° joint rotation and translations' : 'Rest state';
  }
  preset.onclick = () => pose(true); reset.onclick = () => pose(false);
  material.onchange = () => { toon.scene.visible = material.value === 'toon'; pbr.scene.visible = !toon.scene.visible; info.mode = material.value; };
  outline.onchange = () => { effect.enabled = outline.value === 'on'; };
  for (const control of [material, outline, preset, reset]) control.disabled = false;
  const resize = () => {
    const width = viewport.clientWidth, height = viewport.clientHeight;
    renderer.setSize(width, height);
    camera.left = -1.3 * width / height; camera.right = 1.3 * width / height; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(viewport); resize(); pose(false);
  renderer.setAnimationLoop(() => { controls.update(); effect.render(scene, camera); info.frames++; });
  document.querySelector('#status')!.textContent = 'Ready · Synthetic BDEF conformance';
}
start().catch(error => { console.error(error); document.querySelector('#status')!.textContent = `Rig failed: ${String(error)}`; });
