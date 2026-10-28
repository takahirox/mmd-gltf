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

export async function startComparison(model: 'uka' | 'gene' = 'gene') {
  const isUka = model === 'uka';
  const previewImages = new Map<object, HTMLCanvasElement>();
  function shrinkTexture(value: import('three').Texture) {
    const original = value.image as (CanvasImageSource & {width:number;height:number}) | undefined;
    if (!original || original.width <= 1024) return value;
    if (!previewImages.has(original)) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = Math.round(original.height * 1024 / original.width);
      canvas.getContext('2d')!.drawImage(original, 0, 0, canvas.width, canvas.height);
      previewImages.set(original, canvas);
    }
    value.image = previewImages.get(original)!; value.needsUpdate = true;
    return value;
  }
  const expression = document.querySelector<HTMLSelectElement>('#expression')!;
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: new URLSearchParams(location.search).get('backend') !== 'webgpu' });
  const events = new AbortController();
  const scenes = [new Scene(), new Scene()];
  const plugins: (MMDToonPlugin | MMDOutlinePlugin)[] = [];
  const captures: {resolve(value:{png:string;frame:number}):void;reject(error:Error):void}[] = [];
  let disposed = false;
  let controls: OrbitControls | undefined;
  let observer: ResizeObserver | undefined;
  let effects: [ReferenceOutlineEffect, MMDOutlineEffect] | undefined;
  const dispose = async () => {
    disposed = true;
    captures.splice(0).forEach(capture => capture.reject(new Error('Comparison disposed')));
    renderer.setAnimationLoop(null);
    events.abort();
    observer?.disconnect();
    controls?.dispose();
    effects?.forEach(effect => effect.dispose());
    scenes.forEach(disposeScene);
    await Promise.all(plugins.map(plugin => plugin.dispose()));
    renderer.dispose();
    renderer.domElement.remove();
    previewImages.clear();
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
    const base = `${import.meta.env.BASE_URL}${isUka ? 'uka' : 'gene-light'}/`;
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
    async function preparePreview(root: Object3D, converted: boolean) {
      const prepared = new Set<Mesh['geometry']>();
      root.traverse(object => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        // Gene has no deformation controls: zero-weight targets need no GPU buffers.
        // The complete converter artifact remains unchanged and downloadable.
        if (!isUka) {
          mesh.geometry.morphAttributes = {};
          mesh.morphTargetInfluences = []; mesh.morphTargetDictionary = {};
          return;
        }
        const dictionary = mesh.morphTargetDictionary ?? {};
        const names = converted ? ['PMX morph 11', 'PMX morph 12'] : ['まばたき', '笑い'];
        const indices = names.map(name => dictionary[name]);
        if (indices.some(i => i === undefined)) throw new Error('Uka preview: required source expression missing');
        if (!prepared.has(mesh.geometry)) {
          for (const [key, targets] of Object.entries(mesh.geometry.morphAttributes))
            mesh.geometry.morphAttributes[key as 'position'] = indices.map(i => targets[i]);
          prepared.add(mesh.geometry);
        }
        mesh.morphTargetInfluences = [0, 0];
        mesh.morphTargetDictionary = {blink:0, smile:1};
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          // Reference texture properties are resized here; glTF textures are resized by the loader hook.
          for (const value of Object.values(material)) if (value?.isTexture && value.image?.width > 1024) {
            shrinkTexture(value);
          }
        }
      });
    }
    const referencePromise = tracked(0, async () => {
      // MMDLoader.loadAsync resolves the mesh before its images. Wait for the manager too.
      const manager = new LoadingManager();
      const imagesReady = new Promise<void>((resolve, reject) => {
        manager.onLoad = resolve;
        manager.onError = (url) => reject(new Error(`PMX resource failed: ${url}`));
      });
      const results = await Promise.allSettled([
        new MMDLoader(manager).loadAsync(`${base}${isUka ? 'MS_Uka.pmx' : 'Gene_light.pmx'}`).then(mesh => { scenes[0].add(mesh); return mesh; }), imagesReady,
      ]);
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      const reference = (results[0] as PromiseFulfilledResult<Awaited<ReturnType<MMDLoader['loadAsync']>>>).value;
      // MMDLoader already reflects PMX Z and winding, exactly as the converter's parser does.
      reference.scale.setScalar(0.08);
      // No helper, mixer, IK or physics. Uka vertex expressions are set explicitly below.
      reference.material.forEach((material) => {
        material.toneMapped = false;
      });
      await preparePreview(reference, false);
      scenes[0].add(reference);
      return reference;
    });
    const gltfPromise = tracked(1, async () => {
      const loader = new GLTFLoader();
      loader.register((parser) => { const plugin = new MMDToonPlugin(parser, { lighting }); plugins.push(plugin); return plugin; });
      const outlinePlugin = (parser: ConstructorParameters<typeof MMDOutlinePlugin>[0]) => { const plugin = new MMDOutlinePlugin(parser); plugins.push(plugin); return plugin; };
      loader.register(outlinePlugin);
      const previewTextures = (parser: ConstructorParameters<typeof MMDOutlinePlugin>[0]) => ({
        name:'UkaPreviewTextures',
        loadTexture: (index: number) => parser.loadTexture(index).then(shrinkTexture),
      });
      if (isUka) loader.register(previewTextures);
      const fallbackLoader = new GLTFLoader().register(outlinePlugin);
      if (isUka) fallbackLoader.register(previewTextures);
      const results = await Promise.allSettled([loader, fallbackLoader].map(async source => {
        const loaded = await source.loadAsync(`${base}model.${isUka ? 'gltf' : 'glb'}`);
        await preparePreview(loaded.scene, true);
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
    function resize() {
      if (viewport.clientWidth > 0 && viewport.clientHeight > 0) renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    }
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
    const info = { model, expression: 'rest', backend, frames: 0, mode: 'toon', meshes: 0, ready: true,
      reference: { loader: 'MMDLoader', materials: reference.material.length, scale: reference.scale.x, bounds: describeBounds(reference),
        outlines: true, morphsActive: reference.morphTargetInfluences?.some((value) => value !== 0) ?? false },
      gltf: { bounds: describeBounds(toon.scene) }, cameras: [] as number[][] };
    toon.scene.traverse((object: Object3D) => { if ((object as Mesh).isMesh) info.meshes++; });
    Object.assign(window, { mmdExample: info,
      captureMMDComparisonCanvas: () => disposed ? Promise.reject(new Error('Comparison disposed'))
        : new Promise<{png:string;frame:number}>((resolve,reject) => captures.push({resolve,reject})),
    });
    if (isUka) {
      expression.disabled = false;
      expression.addEventListener('change', () => {
        for (const root of [reference, toon.scene, fallback.scene]) root.traverse(object => {
          const mesh = object as Mesh;
          if (mesh.morphTargetInfluences) mesh.morphTargetInfluences = [expression.value === 'blink' ? 1 : 0, expression.value === 'smile' ? 1 : 0];
        });
        info.expression = expression.value;
        info.reference.morphsActive = expression.value !== 'rest';
      }, {signal:events.signal});
    }
    function report() { status.textContent = `Ready · ${backend} · ${select.value === 'toon' ? 'MMD toon' : 'PBR fallback'}`; }
    report();
    statuses.forEach((element) => { element.textContent = isUka ? 'Ready · Solver-free BDEF / vertex expressions' : 'Ready · Static base pose'; element.dataset.ready = 'true'; });
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
      if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;
      orbit.update();
      const container = viewport.getBoundingClientRect();
      renderer.setScissorTest(true);
      info.cameras = [];
      panes.forEach((pane, index) => {
        const rect = pane.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
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
      // Read after both real draws, before WebGL discards its drawing buffer.
      if (captures.length) {
        const value = {png:renderer.domElement.toDataURL('image/png'),frame:info.frames};
        captures.splice(0).forEach(capture => capture.resolve(value));
      }
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
    return { setActive, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
