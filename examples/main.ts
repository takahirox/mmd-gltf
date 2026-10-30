import { AnimationMixer, LoopOnce, type SkinnedMesh, type AnimationClip } from 'three';
import { MMDVMDPlugin, getVMDPlayers, parseVMD, type VMDPlayer } from '../packages/three-mmd-vmd';
import { motionPreview } from './motion-preview';
import { disposeScene } from './scene-resources';
import { WebGPURenderer, Scene, Color, PerspectiveCamera, DirectionalLight, Box3, Vector3, Mesh, LoadingManager, NoToneMapping, SRGBColorSpace, type Object3D } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { updateMMDUVs } from '@takahirox/three-mmd';
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

export type PublicMotion = 'rest' | 'sample' | '02_laugh' | '22_apology';
export type ComparisonCamera = {position:number[];target:number[]};
export async function startComparison(model: 'uka' | 'gene' = 'gene', initialMotion: PublicMotion = 'rest',
  replaceMotion?: (motion: PublicMotion, camera: ComparisonCamera) => void, savedCamera?: ComparisonCamera) {
  const clipId=initialMotion==='rest'?'sample':initialMotion;
  const isUka = model === 'uka';
  const motionSelect = document.querySelector<HTMLSelectElement>('#comparison-motion')!;
  const play = document.querySelector<HTMLButtonElement>('#comparison-play')!;
  const restart = document.querySelector<HTMLButtonElement>('#comparison-restart')!;
  const timeline = document.querySelector<HTMLInputElement>('#comparison-time')!;
  const loop = document.querySelector<HTMLInputElement>('#comparison-loop')!;
  const timeLabel = document.querySelector<HTMLOutputElement>('#comparison-time-label')!;
  const motionControls=[motionSelect,play,restart,timeline,loop];
  motionControls.forEach(c=>c.disabled=true);
  motionSelect.value=initialMotion;play.textContent='Play';timeline.value='0';loop.checked=false;
  const previews: ReturnType<typeof motionPreview>[]=[];
  const players: VMDPlayer[]=[];
  let mixer: AnimationMixer | undefined;
  let blobURL: string | undefined;
  let diagnostics: Record<string, unknown> | undefined;

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
  expression.value='rest';
  [expression,select,outlines,viewpoint].forEach(control=>control.disabled=true);
  document.querySelector('#comparison-binding')!.textContent='';
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: new URLSearchParams(location.search).get('backend') !== 'webgpu' });
  const events = new AbortController();
  const scenes = [new Scene(), new Scene()];
  const plugins: (MMDToonPlugin | MMDOutlinePlugin)[] = [];
  type Capture = {png:string;frame:number;width:number;height:number};
  const captures: {resolve(value:Capture):void;reject(error:Error):void}[] = [];
  let disposed = false;
  let controls: OrbitControls | undefined;
  let observer: ResizeObserver | undefined;
  let effects: [ReferenceOutlineEffect, MMDOutlineEffect] | undefined;
  const dispose = async () => {
    disposed = true;
    for(const [key,value] of Object.entries(diagnostics??{}))
      if(Reflect.get(window,key)===value)Reflect.deleteProperty(window,key);
    diagnostics=undefined;
    motionControls.forEach(c=>c.disabled=true);
    mixer?.stopAllAction(); if(mixer)mixer.uncacheRoot(mixer.getRoot()); players.forEach(p=>p.dispose());
    previews.forEach(p=>p.dispose());
    if(blobURL)URL.revokeObjectURL(blobURL);
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
    renderEffects.forEach(effect=>effect.enabled=outlines.value==='on');
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
    const metadataResponse=await fetch(`${base}${clipId==='sample'?'motion':`motion-${clipId}`}.json`);
    if(!metadataResponse.ok)throw new Error(`Motion metadata: HTTP ${metadataResponse.status}`);
    const metadata=await metadataResponse.json() as {
      path:string;sha256:string;bytes:number;duration:number;artifact?:string;
      preview:{name:string;sourceIndex:number;target:number}[];
      bones:{name:string;status:string;active:boolean;changing?:boolean}[];
      morphs:{name:string;status:string;active:boolean;type?:number}[];
    };
    motionSelect.options[1].textContent=isUka?'Little smile · 04':'Happy · 01';
    const motionResponse=await fetch(`${base}${metadata.path}`);
    if(!motionResponse.ok)throw new Error(`VMD unavailable: HTTP ${motionResponse.status}`);
    const bytes=await motionResponse.arrayBuffer();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(bytes.byteLength!==metadata.bytes || digest!==metadata.sha256)throw new Error('VMD: pinned hash/size mismatch');
    const sourceMotion=parseVMD(new Uint8Array(bytes));
    if(!metadata.morphs.some(t=>t.active && t.status==='matched' && t.type===1))throw new Error('VMD: no useful bound vertex tracks');
    if(metadata.morphs.some(t=>t.active && t.status==='matched' && t.type===1 && !metadata.preview.some(p=>p.name===t.name)))
      throw new Error('Motion preview: missing active vertex track');
    blobURL=URL.createObjectURL(new Blob([bytes]));
    function preparePreview(root: Object3D, converted: boolean) {
      root.traverse(object=>{
        const mesh=object as Mesh;if(!mesh.isMesh)return;
        // Full CPU layouts stay valid for retained playback and source identity checks.
        // Disable conservative animated culling; the fixed shared framing remains stable.
        mesh.frustumCulled=false;
        for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])
          for(const value of Object.values(material))if(value?.isTexture)shrinkTexture(value);
      });
      previews.push(motionPreview(root, mesh=>metadata.preview.map(t=>converted?t.target:mesh.morphTargetDictionary![t.name])));
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
      // Gene installs UV callbacks at load time. Explicitly disable this extra family.
      updateMMDUVs(reference, false);
      // Raw animation mixer only: no helper, IK, grant controller or physics world.
      reference.material.forEach((material) => {
        material.toneMapped = false;
      });
      await preparePreview(reference, false);
      scenes[0].add(reference);
      return reference;
    });
    const gltfPromise = tracked(1, async () => {
      const loader = new GLTFLoader();
      loader.register(parser=>new MMDVMDPlugin(parser,{updateBounds:false}));
      loader.register((parser) => { const plugin = new MMDToonPlugin(parser, { lighting }); plugins.push(plugin); return plugin; });
      const outlinePlugin = (parser: ConstructorParameters<typeof MMDOutlinePlugin>[0]) => { const plugin = new MMDOutlinePlugin(parser); plugins.push(plugin); return plugin; };
      loader.register(outlinePlugin);
      const previewTextures = (parser: ConstructorParameters<typeof MMDOutlinePlugin>[0]) => ({
        name:'UkaPreviewTextures',
        loadTexture: (index: number) => parser.loadTexture(index).then(shrinkTexture),
      });
      if (isUka) loader.register(previewTextures);
      const fallbackLoader = new GLTFLoader().register(outlinePlugin).register(parser=>new MMDVMDPlugin(parser,{updateBounds:false}));
      if (isUka) fallbackLoader.register(previewTextures);
      const results = await Promise.allSettled([loader, fallbackLoader].map(async source => {
        const loaded = await source.loadAsync(`${base}${metadata.artifact??`model.${isUka ? 'gltf' : 'glb'}`}`);
        scenes[1].add(loaded.scene);
        const retained=getVMDPlayers(loaded);
        players.push(...retained);
        if(retained.length!==1 || retained[0].source?.source!==sourceMotion.source)throw new Error('VMD: retained source differs from selected pinned motion');
        const payload=loaded.parser.json.animations[0].extensions.MMD_animation_vmd;
        if(payload.solver || loaded.parser.json.extensions?.MMD_skeleton_solver || loaded.parser.json.extensions?.MMD_physics)throw new Error('Public comparison must be solver/physics free');
        await preparePreview(loaded.scene, true);
        scenes[1].add(loaded.scene);
        return loaded;
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      const [toon, fallback] = results.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<GLTFLoader['loadAsync']>>>).value);
      fallback.scene.visible = select.value==='pbr';
      toon.scene.visible = !fallback.scene.visible;
      scenes[1].add(toon.scene, fallback.scene);
      return { toon, fallback };
    });
    const results = await Promise.allSettled([referencePromise, gltfPromise] as const);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const reference = (results[0] as PromiseFulfilledResult<Awaited<typeof referencePromise>>).value;
    const { toon, fallback } = (results[1] as PromiseFulfilledResult<Awaited<typeof gltfPromise>>).value;
    const clip=await new Promise<AnimationClip>((resolve,reject)=>new MMDLoader().loadAnimation(blobURL!,reference,resolve,undefined,reject));
    const boneNames=new Set(metadata.bones.filter(t=>t.status==='matched').map(t=>t.name));
    const morphIndices=new Set(metadata.morphs.filter(t=>t.status==='matched' && t.type===1).map(t=>reference.morphTargetDictionary![t.name]));
    clip.tracks=clip.tracks.filter(t=>{
      const bone=/^\.bones\[(.*)\]\./.exec(t.name);
      const morph=/^\.morphTargetInfluences\[(\d+)\]/.exec(t.name);
      return bone?boneNames.has(bone[1]):!!morph && morphIndices.has(Number(morph[1]));
    });
    if(!clip.tracks.length)throw new Error('VMD: no bound reference tracks');
    mixer=new AnimationMixer(reference);
    const action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;
    const duration=players[0].duration;
    if(players.some(p=>p.duration!==duration))throw new Error('VMD: inconsistent duration');
    // Use the retained original rest as the authority at startup and on Rest.
    players.forEach(player=>player.stop());
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
    if(savedCamera) {camera.position.fromArray(savedCamera.position);orbit.target.fromArray(savedCamera.target);orbit.update();}
    viewpoint.addEventListener('change', preset, { signal: events.signal });
    function resize() {
      if (viewport.clientWidth > 0 && viewport.clientHeight > 0) renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    }
    observer = new ResizeObserver(() => { if (!viewport.closest('[hidden]')) resize(); });
    observer.observe(viewport);
    resize();
    previews.forEach(p=>p.begin());
    try { for (const scene of scenes) await renderer.compileAsync(scene, camera); }
    finally { previews.forEach(p=>p.end()); }
    select.disabled = viewpoint.disabled = outlines.disabled = false;
    const backend = ('isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend) ? 'WebGPU' : 'WebGL2';
    const describeBounds = (object: Object3D) => {
      const box = new Box3().setFromObject(object, true);
      return { min: box.min.toArray(), max: box.max.toArray() };
    };
    const info = { motion: initialMotion, time: 0, referenceTime: 0, gltfTimes: players.map(()=>0), duration, playing:false, loop:false,
      execution:{ik:false,grant:false,physics:false,helper:false,fallbackMixer:false},
      binding:{boneTracks:boneNames.size,changingBones:metadata.bones.filter(t=>t.status==='matched' && t.changing).map(t=>t.name),morphTracks:morphIndices.size,referenceTracks:clip.tracks.length,
        unmatchedBones:metadata.bones.filter(t=>t.status!=='matched'),unmatchedMorphs:metadata.morphs.filter(t=>t.status!=='matched' || t.type!==1),
        activeMorphs:metadata.morphs.filter(t=>t.active && t.status==='matched' && t.type===1).map(t=>t.name)},
      preview:{targets:previews.map(p=>p.targets),bytes:previews.reduce((n,p)=>n+p.bytes,0)}, model, expression: 'rest', backend, frames: 0, mode: select.value, meshes: 0, ready: true,
      reference: { loader: 'MMDLoader', materials: reference.material.length, scale: reference.scale.x, bounds: describeBounds(reference),
        outlines: outlines.value==='on', morphsActive: reference.morphTargetInfluences?.some((value) => value !== 0) ?? false },
      gltf: { bounds: describeBounds(toon.scene) }, cameras: [] as number[][] };
    toon.scene.traverse((object: Object3D) => { if ((object as Mesh).isMesh) info.meshes++; });
    // Read-only acceptance evidence: local/world bones plus skin-only positions.
    // Start from base POSITION, deliberately excluding all facial morph weights.
    const bodyNames=new Set(['上半身','上半身2','頭','左肩','左腕','左ひじ','左手首','右肩','右腕','右ひじ','右手首']);
    function readPose(root: Object3D, direct: boolean) {
      root.updateMatrixWorld(true);
      const bones: Record<string,{local:number[];rotation:number[];world:number[]}>={};
      const vertices:number[][]=[];
      root.traverse(object=>{
        const name=direct?object.name:object.userData.pmxBone?.name;
        if(bodyNames.has(name))bones[name]={local:object.position.toArray().map(v=>v*(direct ? .08 : 1)),
          rotation:object.quaternion.toArray(),world:object.getWorldPosition(new Vector3()).toArray()};
        const mesh=object as SkinnedMesh;
        if(!mesh.isSkinnedMesh)return;
        mesh.skeleton.update();
        const positions=mesh.geometry.getAttribute('position');
        for(let i=0;i<positions.count;i+=Math.max(1,Math.floor(positions.count/128))) {
          const vertex=new Vector3().fromBufferAttribute(positions,i);
          mesh.applyBoneTransform(i,vertex).applyMatrix4(mesh.matrixWorld);
          vertices.push(vertex.toArray());
        }
      });
      return {bones,vertices};
    }
    Object.assign(window, diagnostics = { mmdExample: info,
      readMMDComparisonPose:()=>[readPose(reference,true),readPose(toon.scene,false),readPose(fallback.scene,false)],
      captureMMDComparisonCanvas: () => disposed ? Promise.reject(new Error('Comparison disposed'))
        : new Promise<Capture>((resolve,reject) => captures.push({resolve,reject})),
    });
    let anchor=0, anchorTime=0;
    function updateControls() {
      const hasMotion=motionSelect.value!=='rest';
      play.disabled=restart.disabled=timeline.disabled=loop.disabled=!hasMotion;
      expression.disabled=!isUka || hasMotion;
      play.textContent=info.playing?'Pause':'Play';
      timeline.value=String(info.time);timeLabel.value=`${info.time.toFixed(2)} / ${duration.toFixed(2)} s`;
    }
    function applyTime(time:number) {
      action.reset().play();mixer!.setTime(time);
      reference.updateMatrixWorld(true);
      players.forEach(p=>p.seek(time));
      info.time=time;info.referenceTime=action.time;info.gltfTimes=players.map(p=>p.time);
      info.reference.morphsActive=reference.morphTargetInfluences?.some(w=>w!==0)??false;
      updateControls();
    }
    function pause() {info.playing=false;anchorTime=info.time;updateControls();}
    function seek(time:number) {anchor=performance.now();anchorTime=Math.max(0,Math.min(duration,time));applyTime(anchorTime);}
    function manualExpression() {
      for(const [i,root] of [reference,toon.scene,fallback.scene].entries())root.traverse(object=>{
        const mesh=object as Mesh;if(!mesh.isMesh || !mesh.morphTargetInfluences)return;
        mesh.morphTargetInfluences.fill(0);
        const name=expression.value==='blink'?'まばたき':expression.value==='smile'?'笑い':undefined;
        if(name) {
          const target=metadata.preview.find(t=>t.name===name)!;
          mesh.morphTargetInfluences[i===0?mesh.morphTargetDictionary![name]:target.target]=1;
        }
      });
      info.expression=expression.value;info.reference.morphsActive=expression.value!=='rest';
    }
    expression.addEventListener('change',manualExpression,{signal:events.signal});
    motionSelect.addEventListener('change',()=>{
      pause();
      if(motionSelect.value!=='rest' && motionSelect.value!==clipId) {
        replaceMotion?.(motionSelect.value as PublicMotion,{position:camera.position.toArray(),target:orbit.target.toArray()});
        return;
      }
      mixer!.stopAllAction();players.forEach(p=>p.stop());
      expression.value='rest';manualExpression();info.motion=motionSelect.value as PublicMotion;
      info.time=info.referenceTime=0;info.gltfTimes=players.map(()=>0);
      if(info.motion!=='rest')seek(0);
      updateControls();
    },{signal:events.signal});
    play.addEventListener('click',()=>{
      if(info.playing)pause();else {if(info.time>=duration)seek(0);anchor=performance.now();anchorTime=info.time;info.playing=true;updateControls();}
    },{signal:events.signal});
    restart.addEventListener('click',()=>seek(0),{signal:events.signal});
    timeline.max=String(duration);
    timeline.addEventListener('input',()=>seek(Number(timeline.value)),{signal:events.signal});
    loop.addEventListener('change',()=>{info.loop=loop.checked;},{signal:events.signal});
    motionSelect.disabled=false;
    if(initialMotion!=='rest')seek(0);
    updateControls();
    document.querySelector('#comparison-binding')!.textContent=`${boneNames.size} bone tracks · ${info.binding.changingBones.length} changing · ${info.binding.activeMorphs.length} vertex expressions · ${metadata.morphs.filter(t=>t.active && (t.status!=='matched' || t.type!==1)).length} active morphs omitted`;
    function report() { status.textContent = `Ready · ${backend} · ${select.value === 'toon' ? 'MMD toon' : 'PBR fallback'}`; }
    report();
    statuses.forEach((element) => { element.textContent = 'Ready · Raw VMD / BDEF · IK & physics off'; element.dataset.ready = 'true'; });
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
      // A requested capture must use current layout even before ResizeObserver runs.
      if (captures.length) resize();
      if(info.playing) {
        const elapsed=anchorTime+(performance.now()-anchor)/1000;
        applyTime(info.loop && duration>0?elapsed%duration:Math.min(elapsed,duration));
        if(!info.loop && elapsed>=duration)pause();
      }
      orbit.update();
      previews.forEach(p=>p.begin());
      try {
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
      } finally {previews.forEach(p=>p.end());}
      renderer.setScissorTest(false);
      info.frames++;
      // Read after both real draws, before WebGL discards its drawing buffer.
      if (captures.length) {
        const value = {png:renderer.domElement.toDataURL('image/png'),frame:info.frames,
          width:renderer.domElement.width,height:renderer.domElement.height};
        captures.splice(0).forEach(capture => capture.resolve(value));
      }
    };
    let active = false, suspended = false;
    const setActive = (enabled: boolean) => {
      if(!enabled || suspended)pause();
      active = enabled;
      orbit.enabled = active && !suspended;
      renderer.setAnimationLoop(null);
      if (active && !suspended) { resize(); renderer.setAnimationLoop(render); }
    };
    document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();},{signal:events.signal});
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
