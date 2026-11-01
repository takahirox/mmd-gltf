import { validatePhysics } from '../packages/mmd-physics';
import { ComparisonPhysics, verifyDirectPhysics, type PublicPhysicsBinding } from './comparison-physics';
import { loadAmmoBrowser } from '../packages/three-mmd-physics/ammo';
import { PhysicsWorld } from '../packages/three-mmd-physics/world';
let comparisonAmmo:ReturnType<typeof loadAmmoBrowser>|undefined;
function ammoBackend() {
  comparisonAmmo ??= loadAmmoBrowser(`${import.meta.env.BASE_URL}runtime/ammo.js`).catch(error=>{comparisonAmmo=undefined;throw error;});
  return comparisonAmmo;
}
import { AnimationMixer, LoopOnce, type SkinnedMesh, type AnimationClip, type AnimationAction } from 'three';
import { MMDVMDPlugin, getVMDPlayers, parseVMD, type VMDPlayer } from '../packages/three-mmd-vmd';
import { bindMotion, evaluateMotion } from '../packages/mmd-vmd';
import { comparisonIK, comparisonIKCompatible } from './comparison-ik';
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
const viewport = document.querySelector<HTMLElement>('#viewport')!;
const panes = ['pmx', 'gltf'].map((id) => document.querySelector<HTMLElement>(`#${id}-pane`)!);
const statuses = ['pmx', 'gltf'].map((id) => document.querySelector<HTMLElement>(`#${id}-status`)!);

export type PublicMotion = 'rest' | 'sample' | '02_laugh' | '22_apology';
export async function startComparison(model: 'uka' | 'gene' = 'gene', initialMotion: PublicMotion = 'rest') {
  const isUka = model === 'uka';
  const motionSelect = document.querySelector<HTMLSelectElement>('#comparison-motion')!;
  const play = document.querySelector<HTMLButtonElement>('#comparison-play')!;
  const restart = document.querySelector<HTMLButtonElement>('#comparison-restart')!;
  const timeline = document.querySelector<HTMLInputElement>('#comparison-time')!;
  const loop = document.querySelector<HTMLInputElement>('#comparison-loop')!;
  const ikControl = document.querySelector<HTMLInputElement>('#comparison-ik')!;
  ikControl.checked=true;ikControl.disabled=true;
  const physicsControl=document.querySelector<HTMLInputElement>('#comparison-physics')!;
  const physicsStatus=document.querySelector<HTMLElement>('#comparison-physics-status')!;
  physicsControl.checked=false;physicsControl.disabled=true;physicsStatus.textContent='';
  let physics:ComparisonPhysics|undefined,physicsBusy=false,physicsEnabled=false,physicsRequest=0,physicsError='',requestedTime=0;

  const timeLabel = document.querySelector<HTMLOutputElement>('#comparison-time-label')!;
  const motionControls=[motionSelect,play,restart,timeline,loop];
  motionControls.forEach(c=>c.disabled=true);
  motionSelect.value=initialMotion;play.textContent='Play';timeline.value='0';loop.checked=false;
  const previews: ReturnType<typeof motionPreview>[]=[];
  const players: VMDPlayer[]=[];
  let mixer: AnimationMixer | undefined;
  const blobURLs: string[] = [];
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
  [expression,select,outlines].forEach(control=>control.disabled=true);
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
    disposed = true;physicsRequest++;physics?.dispose();physicsEnabled=false;physicsControl.disabled=true;
    for(const [key,value] of Object.entries(diagnostics??{}))
      if(Reflect.get(window,key)===value)Reflect.deleteProperty(window,key);
    diagnostics=undefined;
    motionControls.forEach(c=>c.disabled=true);ikControl.disabled=true;
    mixer?.stopAllAction(); if(mixer)mixer.uncacheRoot(mixer.getRoot()); players.forEach(p=>p.dispose());
    previews.forEach(p=>p.dispose());
    blobURLs.forEach(url=>URL.revokeObjectURL(url));
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
    orbit.enableDamping = !matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    const motionIDs = ['sample','02_laugh','22_apology'] as const;
    const motionResults = await Promise.allSettled(motionIDs.map(async id=>{
      const metadataResponse=await fetch(`${base}${id==='sample'?'motion':`motion-${id}`}.json`);
      if(!metadataResponse.ok)throw new Error(`Motion metadata: HTTP ${metadataResponse.status}`);
      const metadata=await metadataResponse.json() as {
        animation:string;path:string;sha256:string;bytes:number;duration:number;
        preview:{name:string;sourceIndex:number;target:number}[];
        bones:{name:string;status:string;active:boolean;changing?:boolean}[];
        morphs:{name:string;status:string;active:boolean;type?:number}[];
      };
      const response=await fetch(`${base}${metadata.path}`);
      if(!response.ok)throw new Error(`VMD unavailable: HTTP ${response.status}`);
      const bytes=await response.arrayBuffer();
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(bytes.byteLength!==metadata.bytes || digest!==metadata.sha256)throw new Error('VMD: pinned hash/size mismatch');
      const source=parseVMD(new Uint8Array(bytes));
      if(!metadata.morphs.some(t=>t.active && t.status==='matched' && t.type===1))throw new Error('VMD: no useful bound vertex tracks');
      if(metadata.morphs.some(t=>t.active && t.status==='matched' && t.type===1 && !metadata.preview.some(p=>p.name===t.name)))
        throw new Error('Motion preview: missing active vertex track');
      const url=URL.createObjectURL(new Blob([bytes]));blobURLs.push(url);
      return {id,metadata,source,url};
    }));
    const motions=motionResults.map(result=>{
      if(result.status==='rejected')throw result.reason;
      return result.value;
    });
    if(new Set(motions.map(m=>m.metadata.animation)).size!==3)throw new Error('VMD: duplicate motion identity');
    let metadata=motions[0].metadata;
    const previewTargets=[...new Map(motions.flatMap(m=>m.metadata.preview).map(t=>[t.sourceIndex,t])).values()];
    motionSelect.options[1].textContent=isUka?'Little smile · 04':'Happy · 01';
    function preparePreview(root: Object3D, converted: boolean) {
      root.traverse(object=>{
        const mesh=object as Mesh;if(!mesh.isMesh)return;
        // Full CPU layouts stay valid for retained playback and source identity checks.
        // Disable conservative animated culling; the fixed shared framing remains stable.
        mesh.frustumCulled=false;
        for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])
          for(const value of Object.values(material))if(value?.isTexture)shrinkTexture(value);
      });
      previews.push(motionPreview(root, mesh=>previewTargets.map(t=>converted?t.target:mesh.morphTargetDictionary![t.name])));
    }
    const referencePromise = tracked(0, async () => {
      // MMDLoader.loadAsync resolves the mesh before its images. Wait for the manager too.
      const manager = new LoadingManager();
      const imagesReady = new Promise<void>((resolve, reject) => {
        manager.onLoad = resolve;
        manager.onError = (url) => reject(new Error(`PMX resource failed: ${url} (request or image decode failed; inspect the network response)`));
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
      // Loading creates no physics world. Default playback uses the raw mixer
      // and IK prerequisites; Physics On supplies an explicit ordered host below.
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
        const loaded = await source.loadAsync(`${base}model.${isUka ? 'gltf' : 'glb'}`);
        scenes[1].add(loaded.scene);
        const retained=getVMDPlayers(loaded);
        players.push(...retained);
        if(retained.length!==3 || motions.some(m=>retained.filter(p=>p.name===m.metadata.animation && p.source?.source===m.source.source && p.duration===m.metadata.duration).length!==1))throw new Error('VMD: retained source differs from pinned motion');
        if(loaded.parser.json.animations.some((a:any)=>a.extensions.MMD_animation_vmd.solver))throw new Error('Public raw VMD must not own a second solver');
        const binding=loaded.parser.json.extras.publicPhysics as PublicPhysicsBinding;
        if(binding?.version!==1)throw new Error('Missing public physics source binding');
        validatePhysics(binding.physics,binding.solver);
        for(const [name,value] of Object.entries({MMD_physics:binding.physics,MMD_skeleton_solver:binding.solver}))
          if(loaded.parser.json.extensions?.[name] && JSON.stringify(loaded.parser.json.extensions[name])!==JSON.stringify(value))
            throw new Error(`Conflicting ${name} runtime binding`);
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
    // Restore retained rest before capturing adapters. Core glTF serializers may
    // omit near-zero TRS; PMX source identities and rest metadata stay exact.
    [toon,fallback].forEach(gltf=>getVMDPlayers(gltf)[0].stop());
    const ikSolvers=[
      comparisonIK(reference, reference.geometry.userData.MMD.bones.map((b)=>({
        index:b.index,name:b.name,flags:b.flag,layer:b.transformationClass,grant:b.grant,
        ik:b.ik ? {...b.ik,iteration:b.ik.iteration!,maxAngle:b.ik.maxAngle!,links:b.ik.links.map(l=>({
          index:l.index,angleLimitation:l.rotationMin || l.rotationMax ? 1 : 0,
          // Reverse the loader's limit reflection into the retained PMX convention.
          lowerLimitationAngle:l.rotationMin && l.rotationMax ? [-l.rotationMax.x,-l.rotationMax.y,l.rotationMin.z] : undefined,
          upperLimitationAngle:l.rotationMin && l.rotationMax ? [-l.rotationMin.x,-l.rotationMin.y,l.rotationMax.z] : undefined,
        }))} : undefined,
      })), true),
      ...[toon,fallback].map(gltf=>comparisonIK(gltf.scene,gltf.parser.json.extras.sourceSolvers)),
    ];
    if(!comparisonIKCompatible(ikSolvers))ikSolvers.forEach(s=>{
      s.state.available=false;s.state.reason='PMX/glTF IK metadata or dependency mismatch';
    });
    const ikAvailable=ikSolvers.every(s=>s.state.available);
    ikControl.disabled=!ikAvailable;ikControl.checked=ikAvailable;
    ikControl.title=ikAvailable?'All source IK chains; follows motion switches':[...new Set(ikSolvers.map(s=>s.state.reason).filter(Boolean))].join('; ');
    try {
      const binding=toon.parser.json.extras.publicPhysics as PublicPhysicsBinding;
      if(JSON.stringify(binding)!==JSON.stringify(fallback.parser.json.extras.publicPhysics))throw new Error('Toon/PBR physics mismatch');
      await verifyDirectPhysics(reference,binding);
      physics=new ComparisonPhysics(binding,[reference,toon.scene,fallback.scene]);
      physicsControl.disabled=false;
    } catch(error) {physicsError=error instanceof Error?error.message:String(error);physicsStatus.textContent=`Physics unavailable: ${physicsError}`;}
    const actions = new Map<string,AnimationAction>();
    const referenceRest=reference.skeleton.bones.map(b=>({bone:b,position:b.position.clone(),rotation:b.quaternion.clone(),scale:b.scale.clone()}));
    const rawReferenceMotions=new Map(motions.map(m=>[m.id,bindMotion({version:1,modelId:'direct-public-physics',metersPerPMXUnit:.08,
      bones:referenceRest.map(({bone,position,rotation,scale},index)=>({index,name:reference.geometry.userData.MMD.bones[index].name,
        parentIndex:reference.skeleton.bones.indexOf(bone.parent as typeof bone),translation:position.toArray().map(v=>v*.08) as [number,number,number],rotation:rotation.toArray(),scale:scale.toArray()}))},m.source,{preserveUnbound:true})]));
    mixer=new AnimationMixer(reference);
    for(const motion of motions) {
      const clip=await new Promise<AnimationClip>((resolve,reject)=>new MMDLoader().loadAnimation(motion.url,reference,resolve,undefined,reject));
      const names=new Set(motion.metadata.bones.filter(t=>t.status==='matched').map(t=>t.name));
      const indices=new Set(motion.metadata.morphs.filter(t=>t.status==='matched' && t.type===1).map(t=>reference.morphTargetDictionary![t.name]));
      clip.tracks=clip.tracks.filter(t=>{
        const bone=/^\.bones\[(.*)\]\./.exec(t.name);
        const morph=/^\.morphTargetInfluences\[(\d+)\]/.exec(t.name);
        return bone?names.has(bone[1]):!!morph && indices.has(Number(morph[1]));
      });
      if(!clip.tracks.length)throw new Error('VMD: no bound reference tracks');
      // Filtered/unexecuted tracks may outlast skeletal keys: hold the final pose
      // until the canonical retained-source duration, rather than truncating time.
      clip.duration=motion.metadata.duration;
      const action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;
      actions.set(motion.id,action);
    }
    blobURLs.splice(0).forEach(url=>URL.revokeObjectURL(url));
    let action=actions.get('sample')!;
    const retained=[getVMDPlayers(toon),getVMDPlayers(fallback)];
    let activePlayers=retained.map(list=>list.find(p=>p.name===metadata.animation)!);
    let duration=activePlayers[0].duration;
    const bindingInfo=()=>({boneTracks:metadata.bones.filter(t=>t.status==='matched').length,
      changingBones:metadata.bones.filter(t=>t.status==='matched' && t.changing).map(t=>t.name),
      morphTracks:metadata.morphs.filter(t=>t.status==='matched' && t.type===1).length,referenceTracks:action.getClip().tracks.length,
      unmatchedBones:metadata.bones.filter(t=>t.status!=='matched'),unmatchedMorphs:metadata.morphs.filter(t=>t.status!=='matched' || t.type!==1),
      activeMorphs:metadata.morphs.filter(t=>t.active && t.status==='matched' && t.type===1).map(t=>t.name)});
    // Every player shares the same rest and root. Only the selected pair may seek.
    activePlayers.forEach(player=>player.stop());
    // Camera framing uses the current zero-weight pose, not the geometry's conservative morph envelope.
    const bounds = new Box3().setFromObject(toon.scene, true);
    const center = bounds.getCenter(new Vector3());
    const height = bounds.getSize(new Vector3()).y;
    orbit.minDistance = height * 0.4;
    orbit.maxDistance = height * 5;
    orbit.target.copy(center);
    camera.position.copy(center).add(new Vector3(0, 0.04, 1).multiplyScalar(height * 1.95));
    orbit.update();
    function resize() {
      if (viewport.clientWidth > 0 && viewport.clientHeight > 0) renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    }
    observer = new ResizeObserver(() => { if (!viewport.closest('[hidden]')) resize(); });
    observer.observe(viewport);
    resize();
    previews.forEach(p=>p.begin());
    try { for (const scene of scenes) await renderer.compileAsync(scene, camera); }
    finally { previews.forEach(p=>p.end()); }
    select.disabled = outlines.disabled = false;
    const backend = ('isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend) ? 'WebGPU' : 'WebGL2';
    const describeBounds = (object: Object3D) => {
      const box = new Box3().setFromObject(object, true);
      return { min: box.min.toArray(), max: box.max.toArray() };
    };
    const info = { motion: initialMotion, time: 0, referenceTime: 0, gltfTimes: activePlayers.map(()=>0), duration, playing:false, loop:false,
      execution:{ik:false,ikState:'off',chains:ikSolvers.map(s=>s.state),grant:false,physics:false,physicsState:physics?'off':'unavailable',physicsStats:physics?.stats,physicsChains:physics?.adapters.map(a=>a.state),helper:false,fallbackMixer:false},
      binding:bindingInfo(),
      preview:{targets:previews.map(p=>p.targets),bytes:previews.reduce((n,p)=>n+p.bytes,0)}, model, expression: 'rest', backend, frames: 0, mode: select.value, meshes: 0, ready: true,
      reference: { loader: 'MMDLoader', materials: reference.material.length, scale: reference.scale.x, bounds: describeBounds(reference),
        outlines: outlines.value==='on', morphsActive: reference.morphTargetInfluences?.some((value) => value !== 0) ?? false },
      gltf: { bounds: describeBounds(toon.scene) }, cameras: [] as number[][] };
    toon.scene.traverse((object: Object3D) => { if ((object as Mesh).isMesh) info.meshes++; });
    // Read-only acceptance evidence: local/world bones plus skin-only positions.
    // Start from base POSITION, deliberately excluding all facial morph weights.
    const diagnosticNumber=(value:number)=>value===0?0:value; // Canonicalize equivalent IEEE signed zeros.
    function readPose(root: Object3D, direct: boolean) {
      root.updateMatrixWorld(true);
      const bones: Record<string,{index:number;local:number[];rotation:number[];world:number[]}>={};
      const vertices:number[][]=[];
      root.traverse(object=>{
        const name=direct?object.name:object.userData.pmxBone?.name;
        if(object.type==='Bone' && name)bones[name]={index:direct?reference.skeleton.bones.findIndex(b=>b===object):object.userData.pmxBone.index,local:object.position.toArray().map(v=>diagnosticNumber(v*(direct ? .08 : 1))),
          rotation:object.quaternion.toArray().map(diagnosticNumber),world:object.getWorldPosition(new Vector3()).toArray().map(diagnosticNumber)};
        const mesh=object as SkinnedMesh;
        if(!mesh.isSkinnedMesh)return;
        mesh.skeleton.update();
        const positions=mesh.geometry.getAttribute('position');
        for(let i=0;i<positions.count;i+=Math.max(1,Math.floor(positions.count/128))) {
          const vertex=new Vector3().fromBufferAttribute(positions,i);
          mesh.applyBoneTransform(i,vertex).applyMatrix4(mesh.matrixWorld);
          vertices.push(vertex.toArray().map(diagnosticNumber));
        }
      });
      return {bones,vertices};
    }
    Object.assign(window, diagnostics = { mmdExample: info,
      readMMDComparisonPose:()=>[readPose(reference,true),readPose(toon.scene,false),readPose(fallback.scene,false)],
      readMMDComparisonPhysics:()=>structuredClone({bodies:physics?.bodyTransforms(),inputs:physics?.inputs,binding:toon.parser.json.extras.publicPhysics}),
      readMMDComparisonResources:()=>({referenceTextures:reference.material.filter(m=>m.map).map(m=>({
        sourceName:m.userData.MMD.mapFileName as string,
        width:(m.map!.image as {width:number}).width,height:(m.map!.image as {height:number}).height,
      })),memory:{...renderer.info.memory},roots:[reference.id,toon.scene.id,fallback.scene.id],
        physics:{native:PhysicsWorld.allocations,stats:physics?.stats},
        heap:(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize,
        weights:[reference,...[toon.scene,fallback.scene].flatMap(root=>{const meshes:Mesh[]=[];root.traverse(n=>{if((n as Mesh).isMesh)meshes.push(n as Mesh);});return meshes;})].map(m=>[...(m.morphTargetInfluences??[])])}),
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
    function sampleRaw(time:number) {
      if(physicsEnabled || info.motion==='rest')referenceRest.forEach(({bone,position,rotation,scale})=>{bone.position.copy(position);bone.quaternion.copy(rotation);bone.scale.copy(scale);});
      if(info.motion==='rest') {activePlayers.forEach(p=>p.stop());manualExpression();}
      else {
        action.reset().play();mixer!.setTime(time);activePlayers.forEach(p=>p.seek(time));
        if(physicsEnabled)for(const b of evaluateMotion(rawReferenceMotions.get(info.motion as Exclude<PublicMotion,'rest'>)!,time)) {
          const bone=reference.skeleton.bones[b.index];bone.position.fromArray(b.translation).multiplyScalar(12.5);bone.quaternion.fromArray(b.rotation);
        }
      }
      reference.updateMatrixWorld(true);
    }
    function publishTime(time:number) {
      info.time=time;info.referenceTime=info.motion==='rest'?0:action.time;info.gltfTimes=activePlayers.map(p=>info.motion==='rest'?0:p.time);
      info.reference.morphsActive=reference.morphTargetInfluences?.some(w=>w!==0)??false;
      reportExecution();updateControls();
    }
    function physicsOff(error='') {
      physicsRequest++;physicsEnabled=false;physicsControl.checked=false;physicsBusy=false;
      physics?.reset(undefined,false);
      // Release mixer caches before restoring bones written by simulation.
      // Otherwise unchanged track values may be skipped on the Off handoff.
      mixer!.stopAllAction();
      referenceRest.forEach(({bone,position,rotation,scale})=>{bone.position.copy(position);bone.quaternion.copy(rotation);bone.scale.copy(scale);});
      physicsError=error;physicsStatus.textContent=error?`Physics off: ${error}`:'';
      info.execution.physics=false;info.execution.physicsState=error?'error':'off';
    }
    async function applyTime(time:number) {
      if(physicsEnabled && physics) {
        if(physicsBusy)return;
        const token=++physicsRequest;requestedTime=time;physicsBusy=true;info.execution.physicsState='simulating';
        try {
          if(await physics.seek(time,sampleRaw) && token===physicsRequest && !disposed) {
            info.execution.physics=true;info.execution.physicsState='on';publishTime(time);
            if(info.playing) {anchor=performance.now();anchorTime=time;}
          }
        } catch(error) {
          if(token===physicsRequest && !disposed) {physicsOff(error instanceof Error?error.message:String(error));applyRawTime(time);}
        } finally {if(token===physicsRequest)physicsBusy=false;}
      } else applyRawTime(time);
    }
    function applyRawTime(time:number) {
      ikSolvers.forEach(s=>s.restore());sampleRaw(time);
      ikSolvers.forEach(s=>s.remember());
      if(ikAvailable && ikControl.checked && ikSolvers.map(s=>s.validatePose()).every(Boolean)) {
        const source=info.motion==='rest'?undefined:motions.find(m=>m.metadata===metadata)!.source;
        ikSolvers.forEach(solver=>solver.apply(source,time));recoverIKFailure();
      }
      publishTime(time);
    }
    function resetPhysics() {
      if(!physicsEnabled && info.execution.physicsState==='loading') {
        physicsControl.checked=false;physicsStatus.textContent='';info.execution.physicsState='off';
      }
      physicsRequest++;physicsBusy=false;
      physics?.reset(info.motion==='rest'?undefined:motions.find(m=>m.metadata===metadata)!.source,ikControl.checked);
    }
    function pause() {info.playing=false;anchorTime=info.time;if(physicsBusy){resetPhysics();void applyTime(info.time);}updateControls();}
    function seek(time:number) {anchor=performance.now();anchorTime=Math.max(0,Math.min(duration,time));if(physicsBusy && requestedTime===anchorTime)return;if(physicsBusy)resetPhysics();void applyTime(anchorTime);}
    function manualExpression() {
      for(const [i,root] of [reference,toon.scene,fallback.scene].entries())root.traverse(object=>{
        const mesh=object as Mesh;if(!mesh.isMesh || !mesh.morphTargetInfluences)return;
        mesh.morphTargetInfluences.fill(0);
        const name=expression.value==='blink'?'まばたき':expression.value==='smile'?'笑い':undefined;
        if(name) {
          const target=previewTargets.find(t=>t.name===name)!;
          mesh.morphTargetInfluences[i===0?mesh.morphTargetDictionary![name]:target.target]=1;
        }
      });
      info.expression=expression.value;info.reference.morphsActive=expression.value!=='rest';
    }
    ikControl.addEventListener('change',()=>{
      resetPhysics();void applyTime(info.time);
    },{signal:events.signal});
    physicsControl.addEventListener('change',async()=>{
      const time=info.time;
      if(!physicsControl.checked) {physicsOff();applyRawTime(time);return;}
      const token=++physicsRequest;
      physicsError='';physicsStatus.textContent='Loading physics…';info.execution.physicsState='loading';
      pause();
      try {
        const {api}=await ammoBackend();
        if(disposed || token!==physicsRequest || !physicsControl.checked)return;
        physics!.setBackend(api);physicsEnabled=true;physicsStatus.textContent='';resetPhysics();
        await applyTime(time);
      } catch(error) {
        if(token===physicsRequest && !disposed) {physicsOff(error instanceof Error?error.message:String(error));applyRawTime(time);}
      }
    },{signal:events.signal});
    expression.addEventListener('change',manualExpression,{signal:events.signal});
    motionSelect.addEventListener('change',()=>{
      pause();resetPhysics();
      ikSolvers.forEach(s=>s.restore());
      mixer!.stopAllAction();activePlayers.forEach(p=>p.stop());
      referenceRest.forEach(({bone,position,rotation,scale})=>{bone.position.copy(position);bone.quaternion.copy(rotation);bone.scale.copy(scale);});
      ikSolvers.forEach(s=>s.remember());
      expression.value='rest';manualExpression();info.motion=motionSelect.value as PublicMotion;
      const motion=motions.find(m=>m.id===info.motion) ?? motions[0];
      metadata=motion.metadata;action=actions.get(motion.id)!;
      activePlayers=retained.map(list=>list.find(p=>p.name===metadata.animation)!);
      duration=activePlayers[0].duration;info.duration=duration;timeline.max=String(duration);
      info.binding=bindingInfo();describeBinding();
      info.time=info.referenceTime=0;info.gltfTimes=activePlayers.map(()=>0);
      reference.updateMatrixWorld(true);
      resetPhysics();seek(0);
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
    motionSelect.dispatchEvent(new Event('change'));
    updateControls();
    function describeBinding() {
      document.querySelector('#comparison-binding')!.textContent=`${info.binding.boneTracks} bone tracks · ${info.binding.changingBones.length} changing · ${info.binding.activeMorphs.length} vertex expressions · ${metadata.morphs.filter(t=>t.active && (t.status!=='matched' || t.type!==1)).length} active morphs omitted`;
    }

    function report() { status.textContent = `Ready · ${backend} · ${select.value === 'toon' ? 'MMD toon' : 'PBR fallback'}`; }
    report();
    function recoverIKFailure() {
      const error=ikSolvers.find(s=>s.state.error)?.state.error;
      if(error)ikSolvers.forEach(s=>{s.restore();s.state.error=error;});
    }
    function reportExecution() {
      const executing=physicsEnabled && physics?physics.adapters:ikSolvers;
      info.execution.chains=executing.map(s=>s.state);
      info.execution.grant=executing.some(s=>s.state.appliedGrants.length>0);
      info.execution.ik=executing.some(s=>s.state.executed.length>0);
      info.execution.ikState=!ikAvailable || ikSolvers.some(s=>s.state.error)?'unavailable':ikControl.checked?'on':'off';
      const text=info.execution.ikState==='unavailable'?'IK unavailable':ikControl.checked?'IK on':'IK off';
      statuses.forEach((element,i)=>{
        const state=executing[i].state;
        const content=`Ready · ${physicsEnabled?'VMD + Physics':'Raw VMD'} / BDEF · ${text}${ikControl.checked?` · ${state.executed.length}/${state.controllers.length} chains`:''} · physics ${physicsEnabled?'on':'off'}`;
        if(element.textContent!==content)element.textContent=content;
        element.dataset.ready='true';
      });
      const details=document.querySelector('#comparison-ik-diagnostics')!;
      const content=JSON.stringify({state:info.execution.ikState,panes:executing.map(s=>s.state),physics:{state:info.execution.physicsState,error:physicsError,stats:physics?.stats}},null,2);
      if(details.textContent!==content)details.textContent=content;
    }
    reportExecution();
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
    const render = async () => {
      if(disposed || physicsBusy)return;
      if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;
      // A requested capture must use current layout even before ResizeObserver runs.
      if (captures.length) resize();
      if(info.playing && !physicsBusy) {
        const elapsed=anchorTime+(performance.now()-anchor)/1000;
        await applyTime(info.loop && duration>0?elapsed%duration:Math.min(elapsed,duration));
        if(!info.loop && elapsed>=duration)pause();
      }
      if(disposed || physicsBusy)return;
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
