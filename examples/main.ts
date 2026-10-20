import { WebGPURenderer, Scene, Color, PerspectiveCamera, HemisphereLight, DirectionalLight, Box3, Vector3, Mesh, type Object3D } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDToonPlugin, createToonLighting } from '../packages/three-mmd-toon';

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const select = document.querySelector<HTMLSelectElement>('#material')!;
const viewport = document.querySelector<HTMLElement>('#viewport')!;
async function start() {
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl';
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  viewport.append(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color(0x202b3b);
  const camera = new PerspectiveCamera(36, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const direction = new Vector3(-0.3, 0.8, 1).normalize();
  // PBR uses ordinary linear scene lighting; MMD receives its own explicit source-component adapter.
  scene.add(new HemisphereLight(0xddeeff, 0x667080, 2));
  const light = new DirectionalLight(0xffffff, 3);
  light.position.copy(direction);
  scene.add(light);
  const lighting = createToonLighting(direction, new Vector3(0.8, 0.8, 0.8));
  const url = `${import.meta.env.BASE_URL}gene-light/model.glb`;
  const loader = new GLTFLoader();
  loader.register((parser) => new MMDToonPlugin(parser, { lighting }));
  const toon = await loader.loadAsync(url);
  const fallback = await new GLTFLoader().loadAsync(url);
  fallback.scene.visible = false;
  scene.add(toon.scene, fallback.scene);
  const bounds = new Box3().setFromObject(toon.scene);
  const center = bounds.getCenter(new Vector3());
  const height = bounds.getSize(new Vector3()).y;
  controls.target.copy(center);
  camera.position.copy(center).add(new Vector3(0, height * 0.04, height * 1.95));
  controls.minDistance = height * 0.4;
  controls.maxDistance = height * 5;
  function resize() {
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    camera.aspect = viewport.clientWidth / viewport.clientHeight;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(viewport);
  resize();
  await renderer.compileAsync(scene, camera);
  select.disabled = false;
  const backend = ('isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend) ? 'WebGPU' : 'WebGL2';
  status.textContent = `Ready · ${backend} · MMD toon`;
  let frames = 0;
  // Small read-only diagnostic surface used by the browser integration tests.
  const info = { backend, frames, mode: 'toon', meshes: 0, ready: true };
  toon.scene.traverse((object: Object3D) => { if ((object as Mesh).isMesh) info.meshes++; });
  Object.assign(window, { mmdExample: info });
  select.addEventListener('change', () => {
    toon.scene.visible = select.value === 'toon';
    fallback.scene.visible = !toon.scene.visible;
    info.mode = select.value;
    status.textContent = `Ready · ${backend} · ${select.value === 'toon' ? 'MMD toon' : 'PBR fallback'}`;
  });
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    info.frames = ++frames;
  });
}
start().catch((error: unknown) => {
  console.error(error);
  status.dataset.error = 'true';
  status.textContent = `Could not load/render the model: ${String(error)}`;
});
