import { disposeScene } from './scene-resources';
import { WebGPURenderer, Scene, Color, PerspectiveCamera, DirectionalLight, Box3, Vector3, Mesh, LoadingManager, NoToneMapping, SRGBColorSpace, type Object3D } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDLoader } from '@takahirox/three-mmd/loaders/MMDLoader.js';
import { MMDOutlineEffect as ReferenceOutlineEffect } from '@takahirox/three-mmd/effects/MMDOutlineEffect.js';
import { MMDOutlinePlugin, MMDOutlineEffect } from '../packages/three-mmd-outline';
import { MMDToonPlugin, createToonLighting } from '../packages/three-mmd-toon';

const status = document.querySelector<HTMLParagraphElement>('#gene-status')!;
const select = document.querySelector<HTMLSelectElement>('#material')!;
const outlines = document.querySelector<HTMLSelectElement>('#outlines')!;
const viewpoint = document.querySelector<HTMLSelectElement>('#viewpoint')!;
const viewport = document.querySelector<HTMLElement>('#viewport')!;
const panes = ['pmx', 'gltf'].map((id) => document.querySelector<HTMLElement>(`#${id}-pane`)!);
const statuses = ['pmx', 'gltf'].map((id) => document.querySelector<HTMLElement>(`#${id}-status`)!);

export async function startComparison() {
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: new URLSearchParams(location.search).get('backend') !== 'webgpu' });
  const events = new AbortController();
  const scenes = [new Scene(), new Scene()];
  const plugins: (MMDToonPlugin | MMDOutlinePlugin)[] = [];
  let controls: OrbitControls | undefined;
  let observer: ResizeObserver | undefined;
  let effects: [ReferenceOutlineEffect, MMDOutlineEffect] | undefined;
  const dispose = async () => {
    renderer.setAnimationLoop(null);
    events.abort();
    observer?.disconnect();
    controls?.dispose();
    effects?.forEach(effect => effect.dispose());
    scenes.forEach(disposeScene);
    await Promise.all(plugins.map(plugin => plugin.dispose()));
    renderer.dispose();
    renderer.domElement.remove();
  };
  try {
    await renderer.init();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.autoClear = true;
    viewport.prepend(renderer.domElement);
    effects = [new ReferenceOutlineEffect(renderer), new MMDOutlineEffect(renderer)];
    const renderEffects = effects;
    const direction = new Vector3(-0.3, 0.8, 1).normalize();
    for (const scene of scenes) {
      scene.background = new Color(0xd0d0d0);
      const light = new DirectionalLight(0xffffff, 0.8);
      light.position.copy(direction);
      scene.add(light);
    }
    // Same directional source RGB/direction; each independent material model evaluates it differently.
    const lighting = createToonLighting(direction, new Vector3(0.8, 0.8, 0.8));
    const camera = new PerspectiveCamera(36, 1, 0.01, 100);
    // One camera and control instance drives both scissored views, including orbit, pan and zoom.
    const orbit = controls = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    const base = `${import.meta.env.BASE_URL}gene-light/`;
    async function tracked<T>(index: number, load: () => Promise<T>) {
      try {
        const result = await load();
        statuses[index].textContent = 'Loaded';
        return result;
      } catch (error) {
        statuses[index].dataset.error = 'true';
        statuses[index].textContent = `Load failed: ${String(error)}`;
        throw error;
      }
    }
    const referencePromise = tracked(0, async () => {
      // MMDLoader.loadAsync resolves the mesh before its images. Wait for the manager too.
      const manager = new LoadingManager();
      const imagesReady = new Promise<void>((resolve, reject) => {
        manager.onLoad = resolve;
        manager.onError = (url) => reject(new Error(`PMX resource failed: ${url}`));
      });
      const results = await Promise.allSettled([
        new MMDLoader(manager).loadAsync(`${base}Gene_light.pmx`).then(mesh => { scenes[0].add(mesh); return mesh; }), imagesReady,
      ]);
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      const reference = (results[0] as PromiseFulfilledResult<Awaited<ReturnType<MMDLoader['loadAsync']>>>).value;
      // MMDLoader already reflects PMX Z and winding, exactly as the converter's parser does.
      reference.scale.setScalar(0.08);
      // Static reference: no helper, mixer, IK, physics or morph updates.
      reference.material.forEach((material) => {
        material.toneMapped = false;
      });
      scenes[0].add(reference);
      return reference;
    });
    const gltfPromise = tracked(1, async () => {
      const loader = new GLTFLoader();
      loader.register((parser) => { const plugin = new MMDToonPlugin(parser, { lighting }); plugins.push(plugin); return plugin; });
      const outlinePlugin = (parser: ConstructorParameters<typeof MMDOutlinePlugin>[0]) => { const plugin = new MMDOutlinePlugin(parser); plugins.push(plugin); return plugin; };
      loader.register(outlinePlugin);
      const results = await Promise.allSettled([loader, new GLTFLoader().register(outlinePlugin)].map(async source => {
        const loaded = await source.loadAsync(`${base}model.glb`);
        scenes[1].add(loaded.scene);
        return loaded;
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      const [toon, fallback] = results.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<GLTFLoader['loadAsync']>>>).value);
      fallback.scene.visible = false;
      scenes[1].add(toon.scene, fallback.scene);
      return { toon, fallback };
    });
    const results = await Promise.allSettled([referencePromise, gltfPromise] as const);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const reference = (results[0] as PromiseFulfilledResult<Awaited<typeof referencePromise>>).value;
    const { toon, fallback } = (results[1] as PromiseFulfilledResult<Awaited<typeof gltfPromise>>).value;
    // Camera framing uses the current zero-weight pose, not the geometry's conservative morph envelope.
    const bounds = new Box3().setFromObject(toon.scene, true);
    const center = bounds.getCenter(new Vector3());
    const height = bounds.getSize(new Vector3()).y;
    orbit.minDistance = height * 0.4;
    orbit.maxDistance = height * 5;
    function preset() {
      // Consume any residual orbit damping before applying a reproducible fixed view.
      orbit.enableDamping = false;
      orbit.update();
      const offset = viewpoint.value === 'side' ? new Vector3(1, 0.04, 0) : new Vector3(0, 0.04, viewpoint.value === 'back' ? -1 : 1);
      orbit.target.copy(center);
      camera.position.copy(center).add(offset.multiplyScalar(height * 1.95));
      camera.up.set(0, 1, 0);
      orbit.update();
      orbit.enableDamping = true;
    }
    preset();
    viewpoint.addEventListener('change', preset, { signal: events.signal });
    function resize() { renderer.setSize(viewport.clientWidth, viewport.clientHeight); }
    observer = new ResizeObserver(() => { if (!viewport.closest('[hidden]')) resize(); });
    observer.observe(viewport);
    resize();
    for (const scene of scenes) await renderer.compileAsync(scene, camera);
    select.disabled = viewpoint.disabled = outlines.disabled = false;
    const backend = ('isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend) ? 'WebGPU' : 'WebGL2';
    const describeBounds = (object: Object3D) => {
      const box = new Box3().setFromObject(object, true);
      return { min: box.min.toArray(), max: box.max.toArray() };
    };
    const info = { backend, frames: 0, mode: 'toon', meshes: 0, ready: true,
      reference: { loader: 'MMDLoader', materials: reference.material.length, scale: reference.scale.x, bounds: describeBounds(reference),
        outlines: true, morphsActive: reference.morphTargetInfluences?.some((value) => value !== 0) ?? false },
      gltf: { bounds: describeBounds(toon.scene) }, cameras: [] as number[][] };
    toon.scene.traverse((object: Object3D) => { if ((object as Mesh).isMesh) info.meshes++; });
    Object.assign(window, { mmdExample: info });
    function report() { status.textContent = `Ready · ${backend} · ${select.value === 'toon' ? 'MMD toon' : 'PBR fallback'}`; }
    report();
    statuses.forEach((element) => { element.textContent = 'Ready · Static base pose'; element.dataset.ready = 'true'; });
    outlines.addEventListener('change', () => {
      renderEffects.forEach(effect => { effect.enabled = outlines.value === 'on'; });
      info.reference.outlines = outlines.value === 'on';
    }, { signal: events.signal });
    select.addEventListener('change', () => {
      toon.scene.visible = select.value === 'toon';
      fallback.scene.visible = !toon.scene.visible;
      info.mode = select.value;
      report();
    }, { signal: events.signal });
    const render = () => {
      orbit.update();
      const container = viewport.getBoundingClientRect();
      renderer.setScissorTest(true);
      info.cameras = [];
      panes.forEach((pane, index) => {
        const rect = pane.getBoundingClientRect();
        const x = rect.left - container.left, y = rect.top - container.top;
        camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix();
        renderer.setViewport(x, y, rect.width, rect.height);
        renderer.setScissor(x, y, rect.width, rect.height);
        renderEffects[index].render(scenes[index], camera);
        info.cameras.push([...camera.position.toArray(), ...orbit.target.toArray(), camera.aspect, camera.fov]);
      });
      renderer.setScissorTest(false);
      info.frames++;
    };
    let active = false, suspended = false;
    const setActive = (enabled: boolean) => {
      active = enabled;
      orbit.enabled = active && !suspended;
      renderer.setAnimationLoop(null);
      if (active && !suspended) { resize(); renderer.setAnimationLoop(render); }
    };
    // Cached documents keep their GPU resources and resume only the selected viewer.
    window.addEventListener('pagehide', event => {
      if (event.persisted) { suspended = true; setActive(active); }
      else void dispose();
    }, { signal: events.signal });
    window.addEventListener('pageshow', event => {
      if (event.persisted) { suspended = false; setActive(active); }
    }, { signal: events.signal });
    return { setActive };
  } catch (error) {
    await dispose();
    throw error;
  }
}
