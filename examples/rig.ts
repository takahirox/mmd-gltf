import { MMDPhysicsPlugin, PhysicsRig, getPhysicsModel, loadAmmoBrowser } from '../packages/three-mmd-physics';
import { MMDPhysicsExporterPlugin } from '../packages/three-mmd-physics/exporter';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MMDVPDExporterPlugin } from '../packages/three-mmd-vpd';
import { MMDSDEFExporterPlugin } from '../packages/three-mmd-sdef';
import { MMDQDEFExporterPlugin } from '../packages/three-mmd-qdef';
import { MMDSolverPlugin } from '../packages/three-mmd-solver';
import { MMDQDEFPlugin } from '../packages/three-mmd-qdef';
import type { MMDSDEFPlugin } from '../packages/three-mmd-sdef';
import {
  WebGPURenderer,
  Vector3,
  Scene,
  Color,
  OrthographicCamera,
  DirectionalLight,
  type Group,
  type Mesh,
  type Material,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDToonPlugin } from '../packages/three-mmd-toon';
import { MMDOutlinePlugin, MMDOutlineEffect } from '../packages/three-mmd-outline';
import {
  parseVPD,
  createVPDRig,
  bindVPD,
  applyVPD,
  resetVPD,
  type VPDRig,
  type VPDEncoding,
  type BindingOptions,
} from '../packages/three-mmd-vpd';
import {
  parseVMD,
  bindVMD,
  createVMDPlayer,
  MMDVMDPlugin,
  getVMDPlayers,
  type VMDPlayer,
  type VMDBindingOptions,
} from '../packages/three-mmd-vmd';

import { controlIndex, validWeight } from '../packages/mmd-morph';
import { MMDMorphExporterPlugin, createMorphRig, getMorphModel, getMorphWeights, applyMorphWeights, resetMorphWeights, refreshDeformation, type MorphRig } from '../packages/three-mmd-morph';

// Bounded diagnostics from real player updates, acknowledged only by the render
// that follows that update. A crossing survives subsequent ordinary frames.
interface PlaybackUpdate {
  generation: number; rig: string; source: string; motion: string;
  duration: number; before: number; delta: number; after: number;
  playingBefore: boolean; playing: boolean; loop: boolean; crossings: number;
  revision: number; frame: number; weights: number[];
}

async function start() {
  const renderer = new WebGPURenderer({
    antialias: true,
    forceWebGL: new URLSearchParams(location.search).get('backend') !== 'webgpu',
  });
  await renderer.init();
  const viewport = document.querySelector<HTMLElement>('#rig-viewport')!;
  viewport.append(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color(0xd0d0d0);
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(1, 2, 4);
  scene.add(light);
  const camera = new OrthographicCamera(-0.6, 0.6, 0.6, -0.6, 0.1, 30);
  camera.position.set(2.2, 1.8, 3.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.2, 0.25, -0.4);
  controls.update();
  const effect = new MMDOutlineEffect(renderer);
  const select = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!;
  const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
  const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!;
  const material = select('rig-material'),
    outline = select('rig-outlines'),
    model = select('rig-model'),
    sample = select('rig-pose'),
    encoding = select('rig-encoding');
  const mapping = document.querySelector<HTMLTextAreaElement>('#rig-map')!,
    file = input('rig-file');
  const motionSample = select('motion-sample'),
    motionSource = select('motion-source'),
    motionFile = input('motion-file'),
    motionMap = document.querySelector<HTMLTextAreaElement>('#motion-map')!;
  const seek = input('motion-time'),
    loop = input('motion-loop'),
    motionLabel = document.querySelector('#motion-state')!;
  const preset = button('rig-preset'),
    reset = button('rig-reset');
  const status = document.querySelector('#status')!,
    label = document.querySelector('#rig-state')!;
  const info = {
    ready: false,
    deformed: false,
    mode: 'toon',
    frames: 0,
    rig: 'box',
    pose: 'rest',
    bones: [] as object[],
    weights: [] as number[],
    vertices: [] as number[][],
    ik: {} as Record<string,boolean>,
    error: '',
    motion: '',
    source: '',
    playback: { generation: 0, updates: [] as PlaybackUpdate[], crossing: null as PlaybackUpdate | null },
    physics: null as null | {enabled:boolean;time:number;bodies:Record<string,number[]>},
    time: 0,
    playing: false,
    disposedPlayers: 0,
    revision: 0,
    rendered: null as null | {
      revision: number; frame: number; durationMs: number;
      rig: string; motion: string; pose: string; time: number;
      bones?: object[]; playing: boolean; mode: string; outlines: boolean; comparison: boolean; weights: number[]; vertices: number[][];
    },
  };
  Object.assign(window, { mmdRig: info });
  const captures: ((value: { png: string; revision: number; frame: number }) => void)[] = [];
  // Capture before WebGL presents/clears the buffer, with the same revision as diagnostics.
  Object.assign(window, { captureMMDRigCanvas: () => new Promise(resolve => captures.push(resolve)) });
  interface Asset {
    scene: Group;
    rig: VPDRig;
    morph: MorphRig;
    player?: VMDPlayer;
    physics?: PhysicsRig;
    toon?: MMDToonPlugin;
    outlines: MMDOutlinePlugin;
    sdef?: MMDSDEFPlugin;
    diagnostics?: { unmatched: string[]; omitted: object };
  }
  let physicsBackend: ReturnType<typeof loadAmmoBrowser> | undefined;
  const backend=()=>physicsBackend??=loadAmmoBrowser(`${import.meta.env.BASE_URL}runtime/ammo.js`).catch(error=>{physicsBackend=undefined;throw error;});
  const solverRig=()=>model.value.startsWith('solver-')||model.value.startsWith('physics-');
  let assets: Asset[] = [],
    local: File | undefined,
    localMotion: File | undefined,
    busy = false;
  const report = (message: string) => {
    status.textContent = `Ready · ${message} · ${model.value.startsWith('physics-') ? 'Rigid-body-v1 + pre/post solver; fixed ticks; original-MMD unmeasured' : solverRig() ? 'Pre-physics-v1 IK/append + morphs; visibility retained without execution; original-MMD unmeasured' : 'Bone and mixed morph controls; original-MMD unmeasured'}`;
  };
  const invalidate = () => { info.revision++; };
  const clearPlayback = () => {
    info.playback.generation++;
    info.playback.updates = [];
    info.playback.crossing = null;
  };
  const snapshot = () => {
    invalidate();
    info.bones = [];
    assets[0]?.scene.traverse((n) => {
      if (n.userData.pmxBone)
        info.bones.push({
          index: n.userData.pmxBone.index,
          translation: n.position.toArray(),
          rotation: n.quaternion.toArray(),
        });
    });
    info.vertices = [];
    if (model.value.startsWith('bone-') || model.value.startsWith('group-') || solverRig()) assets[0]?.scene.traverse(n => {
      const mesh = n as Mesh;
      if (mesh.isMesh && !info.vertices.length) info.vertices = [0,1,2,3,9,23].map(i => mesh.getVertexPosition(i,new Vector3()).toArray());
    });
    // A retained player's switches describe the bones only while its pose is applied.
    const player = assets[0]?.player;
    info.ik = info.pose === 'motion' ? player?.ikStates ?? {} : {};
    document.querySelector('#ik-state')!.textContent = player && info.pose !== 'motion'
      ? 'Motion IK controls inactive · override retained for resumed motion'
      : Object.entries(info.ik).map(([k,v])=>`Controller ${k}: ${v ? 'enabled' : 'disabled'}`).join(', ') || 'No active IK motion';
    info.weights = assets[0] ? getMorphWeights(assets[0].morph) : [];
    document.querySelector('#morph-state')!.textContent = `Weights: ${info.weights.map(w => w.toFixed(4)).join(', ')} · source identity retained; sum is not normalized`;
    document.querySelectorAll<HTMLInputElement>('#morph-controls input').forEach((control,i) => { control.value = String(info.weights[Number(control.dataset.target)]); });
    info.time = assets[0]?.player?.time ?? 0;
    info.physics = assets[0]?.physics ? { enabled:assets[0].physics.enabled,time:assets[0].physics.time,bodies:Object.fromEntries(assets[0].physics.timeline.bodyTransforms()) } : null;
    info.playing = assets[0]?.player?.playing ?? false;
    seek.value = String(info.time);
    motionLabel.textContent = `${info.motion || 'No motion'} · ${info.time.toFixed(4)} s · ${info.playing ? 'Playing' : 'Paused'}`;
  };
  const comparison = input('sdef-comparison');
  const updateComparison = () => {
    invalidate();
    for (const a of assets) {
      let changed = false;
      a.scene.traverse(n => {
        const mesh = n as Mesh;
        for (const key of ['mmdSkinningType', 'mmdQdefSelection']) {
          const attr = mesh.geometry?.getAttribute(key);
          if (!attr) continue;
          changed = true;
          if (!mesh.userData[`${key}Selection`]) mesh.userData[`${key}Selection`] = Array.from({length: attr.count}, (_, i) => attr.getX(i));
          for (let i = 0; i < attr.count; i++) attr.setX(i, comparison.checked ? 0 : mesh.userData[`${key}Selection`][i]);
          attr.needsUpdate = true;
        }
      });
      if (changed) refreshDeformation(a.scene);
    }
    document.querySelector('#sdef-state')!.textContent = model.value.startsWith('group-') ? 'Core BDEF with independent vertex-group targets' : (model.value.startsWith('qdef-') || model.value.endsWith('-qdef')) ? `Mixed BDEF/SDEF/QDEF · rigid-dq-v1 · ${comparison.checked ? 'BDEF4 approximation' : 'QDEF enabled'} · original-MMD unmeasured` : (model.value.startsWith('sdef-') || model.value.endsWith('-sdef')) ? `Mixed BDEF/SDEF · ordered pairs · rigid joints · ${comparison.checked ? 'BDEF2 approximation' : 'SDEF enabled'} · original-MMD unmeasured` : 'Core BDEF rig';
    snapshot(); // Publish vertices from the selected deformation path.
  };
  comparison.onchange = updateComparison;
  const appearance = () => {
    invalidate();
    assets.forEach((a, i) => {
      a.scene.visible = material.value === 'toon' ? i === 0 : i === 1;
    });
    info.mode = material.value;
  };
  const discardPlayer = (a: Asset) => {
    if (a.player) {
      a.player.dispose();
      info.disposedPlayers++;
      a.player = undefined;
    }
  };
  async function disposeAsset(a: Asset) {
    discardPlayer(a);
    a.physics?.dispose();
    effect.release(a.scene);
    scene.remove(a.scene);
    a.sdef?.dispose();
    a.outlines.dispose();
    a.scene.traverse((n) => {
      const mesh = n as Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m: Material) =>
          m.dispose(),
        );
      }
    });
    await a.toon?.dispose();
  }
  async function loadAsset(url: string, toon: boolean): Promise<Asset> {
    let toonPlugin: MMDToonPlugin | undefined, outlinePlugin: MMDOutlinePlugin | undefined, sdefPlugin: MMDSDEFPlugin | undefined;
    const loader = new GLTFLoader()
      .register((p) => new MMDPhysicsPlugin(p))
      .register((p) => new MMDSolverPlugin(p))
      .register((p) => new MMDVMDPlugin(p))
      .register((p) => (sdefPlugin = new MMDQDEFPlugin(p)))
      .register((p) => (outlinePlugin = new MMDOutlinePlugin(p)));
    if (toon) loader.register((p) => (toonPlugin = new MMDToonPlugin(p)));
    const loaded = await loader.loadAsync(url);
    let physics:PhysicsRig|undefined;
    try {
      const rig=createVPDRig(loaded.scene),morph=createMorphRig(loaded.scene);
      physics=getPhysicsModel(loaded.scene)?new PhysicsRig(loaded.scene,(await backend()).api):undefined;
      if(physics)physics.enabled=input('physics-enabled').checked;
      return {
        scene: loaded.scene,
        physics,
        rig,
        morph,
        player: getVMDPlayers(loaded)[0],
        toon: toonPlugin,
        outlines: outlinePlugin!,
        sdef: sdefPlugin,
        diagnostics: loaded.parser.json.animations?.[0]?.extras?.vmd,
      };
    } catch (error) {
      physics?.dispose();
      await toonPlugin?.dispose();
      sdefPlugin?.dispose();
      outlinePlugin?.dispose();
      throw error;
    }
  }
  async function loadPair(url: string) {
    const settled = await Promise.allSettled([loadAsset(url, true), loadAsset(url, false)]);
    if (settled.some((r) => r.status === 'rejected')) {
      for (const r of settled) if (r.status === 'fulfilled') await disposeAsset(r.value);
      throw (settled.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
    }
    return settled.map((r) => (r as PromiseFulfilledResult<Asset>).value);
  }
  async function replace(next: Asset[]) {
    const previous = assets;
    assets = next;
    assets.forEach((a) => scene.add(a.scene));
    appearance();
    rebuildMorphControls();
    updateComparison();
    for (const a of previous) await disposeAsset(a);
  }
  async function loadRig() {
    const next = await loadPair(`${import.meta.env.BASE_URL}${model.value.startsWith('bone-') ? `bone/${model.value.slice(5)}` : model.value.startsWith('physics-') ? `physics/${model.value.slice(8)}` : solverRig() ? `solver/${model.value.slice(7)}` : model.value.startsWith('group-') ? `group/${model.value.slice(6)}` : model.value.startsWith('qdef-') ? `qdef/${model.value.slice(5)}` : model.value.startsWith('sdef-') ? `sdef/${model.value.slice(5)}` : `morph/${model.value}`}/rest.glb`);
    await replace(next);
    select('ik-override').value = 'motion';
    configurePosePreset();
    if (solverRig()) motionSample.value = 'solver-a';
    else if (motionSample.value.startsWith('solver-')) motionSample.value = 'a';
    await configureMotionPreset();
    clearPlayback();
    info.source = '';
    info.motion = '';
    info.rig = model.value;
    info.pose = 'rest';
    info.deformed = false;
    info.ready = true;
    info.error = '';
    snapshot();
    label.textContent = 'Rest state';
    report('Rig loaded');
  }
  async function apply() {
    let data: Uint8Array;
    if (sample.value === 'local') {
      if (!local) throw new Error('Select a local VPD file first');
      data = new Uint8Array(await local.arrayBuffer());
    } else {
      const response = await fetch(`${import.meta.env.BASE_URL}${solverRig() ? 'solver/solver-' : 'vpd/pose-'}${sample.value}.vpd`);
      if (!response.ok) throw new Error(`VPD fetch failed: ${response.status}`);
      data = new Uint8Array(await response.arrayBuffer());
    }
    const pose = parseVPD(data, encoding.value as VPDEncoding),
      options: BindingOptions = {
        mapping: JSON.parse(mapping.value),
        unmatched: select('rig-unmatched').value as BindingOptions['unmatched'],
      };
    const bound = assets.map((a) => bindVPD(a.rig, pose, options));
    bound.forEach((b, i) => applyVPD(assets[i].rig, b));
    clearPlayback();
    info.deformed = true;
    info.pose = sample.value;
    info.error = '';
    snapshot();
    label.textContent = `Pose ${sample.value.toUpperCase()} · ${bound[0].appliedRecords} bone offsets · parent filename ${pose.parentFile} (informational)`;
    report(`Applied VPD. Motion paused. Unmatched: ${bound[0].unmatched.join(', ') || 'none'}`);
  }
  async function loadMotion() {
    let diagnostic = '';
    const combined = motionSample.value.startsWith('combined-') || motionSample.value === 'only';
    const grouped = motionSample.value.startsWith('group-');
    const boned = motionSample.value.startsWith('bone-');
    const solving = motionSample.value.startsWith('solver-');
    const motionId = motionSample.value.replace('combined-', '').replace('group-', '').replace('solver-', '').replace('bone-', '');
    if (motionSource.value === 'bytes') {
      let data: Uint8Array;
      if (motionSample.value === 'local') {
        if (!localMotion) throw new Error('Select a local VMD file first');
        data = new Uint8Array(await localMotion.arrayBuffer());
      } else {
        const r = await fetch(`${import.meta.env.BASE_URL}${boned ? `bone/bone-morph-${motionId}` : solving ? `solver/solver-${motionId}` : grouped ? `group/group-${motionId}` : combined ? `morph/${motionId === 'only' ? 'morph-only' : `combined-${motionId}`}` : `vmd/motion-${motionId}`}.vmd`);
        if (!r.ok) throw new Error(`VMD fetch failed: ${r.status}`);
        data = new Uint8Array(await r.arrayBuffer());
      }
      const motion = parseVMD(data),
        options: VMDBindingOptions = {
          morphUnmatched: select('motion-morph-unmatched').value as VMDBindingOptions['morphUnmatched'],
          morphMapping: JSON.parse(document.querySelector<HTMLTextAreaElement>('#motion-morph-map')!.value),
          mapping: JSON.parse(motionMap.value),
          unmatched: select('motion-unmatched').value as VMDBindingOptions['unmatched'],
        };
      const bindings = assets.map((a) => bindVMD(a.rig, motion, options)),
        players = bindings.map((b, i) => createVMDPlayer(assets[i].rig, b));
      players.forEach((p) => p.seek(0));
      assets.forEach((a, i) => {
        discardPlayer(a);
        a.player = players[i];
      });
      diagnostic = `Unmatched morphs: ${bindings[0].unmatchedMorphs.join(', ') || 'none'}. Unmatched: ${bindings[0].unmatched.join(', ') || 'none'}. Omitted execution counts: ${JSON.stringify(bindings[0].omitted)}`;
    } else {
      if (motionSample.value === 'local')
        throw new Error(
          'Converted GLB/glTF sources are available for sample motions; use byte source for local VMD',
        );
      const next = await loadPair(
        `${import.meta.env.BASE_URL}${boned ? `bone/${model.value.slice(5)}/${motionId}` : solving ? `${model.value.startsWith('physics-')?'physics':'solver'}/${model.value.slice(model.value.startsWith('physics-')?8:7)}/${motionId}` : grouped ? `group/${model.value.replace('group-', '')}/${motionId}` : model.value.startsWith('qdef-') ? `qdef/${model.value.slice(5)}/${combined ? motionId : `legacy-${motionId}`}` : model.value.startsWith('sdef-') ? `sdef/${model.value.slice(5)}/${combined ? motionId : `legacy-${motionId}`}` : `${combined ? 'morph' : 'vmd'}/${model.value}/${motionId}`}.${motionSource.value}`,
      );
      next.forEach((a) => a.player!.seek(0));
      await replace(next);
      diagnostic = `Retained curves loaded; approximate fallback replaced. Unmatched: ${next[0].diagnostics?.unmatched.join(', ') || 'none'}. Omitted execution counts: ${JSON.stringify(next[0].diagnostics?.omitted ?? {})}`;
    }
    assets.forEach((a) => {
      a.player!.loop = loop.checked;
    });
    // Replacement players start without overrides, so reflect their motion controls.
    select('ik-override').value = 'motion';
    clearPlayback();
    info.source = motionSource.value;
    seek.max = String(assets[0].player!.duration);
    info.motion = `Motion ${motionSample.value.toUpperCase()} (${motionSource.value})`;
    info.pose = 'motion';
    info.deformed = true;
    info.error = '';
    snapshot();
    label.textContent = info.motion;
    report(`VMD loaded. ${diagnostic}`);
  }
  const editable = [
    model,
    sample,
    encoding,
    file,
    mapping,
    select('rig-unmatched'),
    preset,
    reset,
    motionSample,
    motionSource,
    motionFile,
    motionMap,
    select('motion-unmatched'),
    select('motion-morph-unmatched'),
    document.querySelector<HTMLTextAreaElement>('#motion-morph-map')!,
    button('morph-reset'),
    button('physics-reset'),button('physics-step'),document.querySelector<HTMLInputElement>('#physics-enabled')!,
    button('rig-export-glb'),
    button('rig-export-gltf'),
    button('motion-load'),
    button('motion-play'),
    button('motion-pause'),
    button('motion-reset'),
    seek,
    loop,
    select('ik-override'),
  ];
  const guarded = (action: () => Promise<void> | void) => async () => {
    if (busy) return;
    busy = true;
    invalidate();
    editable.forEach((c) => {
      c.disabled = true;
    });
    status.textContent = 'Working…';
    try {
      await action();
    } catch (error) {
      info.error = String(error);
      info.ready = assets.length > 0;
      report(info.error);
    } finally {
      busy = false;
      editable.forEach((c) => {
        c.disabled = !info.ready;
      });
      invalidate();
    }
  };
  function rebuildMorphControls() {
    const container = document.querySelector('#morph-controls')!;
    container.replaceChildren();
    for (const m of getMorphModel(assets[0].morph).morphs.filter(m => controlIndex(m) !== null).sort((a,b) => controlIndex(a)! - controlIndex(b)!)) {
      const label = document.createElement('label'), control = document.createElement('input');
      label.textContent = `${m.index}: ${m.name} `;
      control.type = 'number'; control.step = '0.05'; control.value = '0';
      control.dataset.target = String(controlIndex(m));
      control.onchange = guarded(() => {
        const values = getMorphWeights(assets[0].morph); values[controlIndex(m)!] = Number(control.value);
        // Validate the complete requested weight vector on both independent instances first.
        if (!values.every(validWeight)) throw new Error('Morph: invalid FLOAT weight');
        assets.forEach(a => applyMorphWeights(a.morph, values));
        clearPlayback();
        info.error = ''; snapshot(); report('Manual morph weights applied. Motion paused');
      });
      label.append(control); container.append(label);
    }
  }
  button('morph-reset').onclick = guarded(() => {
    assets.forEach(a => resetMorphWeights(a.morph)); clearPlayback(); snapshot(); report('Morph weights reset. Motion paused');
  });
  const transport = (action: (player: VMDPlayer) => void, takesOwnership: boolean) =>
    guarded(() => {
      if (!assets[0]?.player) throw new Error('Load a VMD motion first');
      assets.forEach((a) => action(a.player!));
      if (takesOwnership) {
        clearPlayback();
        info.pose = 'motion';
        info.deformed = true;
        label.textContent = info.motion;
      }
      info.error = '';
      snapshot();
      report('VMD transport updated');
    });
  select('ik-override').onchange = transport(p=>{const value=select('ik-override').value;p.setIKEnabled(3,value==='motion'?undefined:value==='on');},true);
  button('physics-step').onclick=guarded(()=>{const seconds=Number(document.querySelector<HTMLInputElement>('#physics-seconds')!.value);assets.forEach(a=>{if(!a.physics)throw new Error('Select a physics rig');a.physics.timeline.validateDelta(seconds);});assets.forEach(a=>a.physics!.step(seconds));info.pose='settled';snapshot();report('Physics stepped; motion paused');});
  button('physics-reset').onclick=guarded(()=>{assets.forEach(a=>a.physics?.reset());snapshot();report('Physics reset from current raw pose; velocities cleared');});
  document.querySelector<HTMLInputElement>('#physics-enabled')!.onchange=guarded(()=>{const enabled=document.querySelector<HTMLInputElement>('#physics-enabled')!.checked;assets.forEach(a=>{if(a.physics){a.physics.enabled=enabled;if(a.player && info.pose==='motion')a.player.seek(a.player.time);else a.physics.reset();}});snapshot();report('Physics setting applied');});
  for(const format of ['glb','gltf']) button(`rig-export-${format}`).onclick=guarded(async()=>{
    const encoded=await new GLTFExporter().register(w=>new MMDVPDExporterPlugin(w)).register(w=>new MMDMorphExporterPlugin(w)).register(w=>new MMDPhysicsExporterPlugin(w)).register(w=>new MMDSDEFExporterPlugin(w)).register(w=>new MMDQDEFExporterPlugin(w)).parseAsync(assets[1].scene,{binary:format==='glb',onlyVisible:false,includeCustomExtensions:true});
    const data=encoded instanceof ArrayBuffer?encoded:JSON.stringify(encoded),blob=new Blob([data],{type:format==='glb'?'model/gltf-binary':'model/gltf+json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`${model.value}-applied.${format}`;link.click();URL.revokeObjectURL(url);report(`Exported applied ${format.toUpperCase()} state with original rest`);
  });
  preset.onclick = guarded(apply);
  const resetAll = () => {
    clearPlayback();
    assets.forEach((a) => {
      a.player?.stop();
      resetMorphWeights(a.morph);
      resetVPD(a.rig);
    });
    info.deformed = false;
    info.pose = 'rest';
    info.error = '';
    snapshot();
    label.textContent = 'Rest state';
    report('Reset to original rest');
  };
  reset.onclick = guarded(() => {
    assets.forEach(a => resetVPD(a.rig));
    clearPlayback();
    info.pose = 'rest'; info.error = ''; snapshot(); label.textContent = 'Rest state';
    report('VPD reset to original bone rest. Motion paused; morph weights preserved');
  });
  button('motion-reset').onclick = guarded(resetAll);
  button('motion-load').onclick = guarded(loadMotion);
  button('motion-play').onclick = transport((p) => p.play(), true);
  button('motion-pause').onclick = transport((p) => p.pause(), false);
  seek.oninput = transport((p) => p.seek(Number(seek.value)), true);
  loop.onchange = () => {
    clearPlayback();
    invalidate();
    assets.forEach((a) => {
      if (a.player) a.player.loop = loop.checked;
    });
  };
  function configurePosePreset() {
    if (sample.value !== 'local') {
      encoding.value = solverRig() ? 'utf-8' : sample.value === 'a' ? 'shift_jis' : 'utf-8';
      mapping.value = solverRig() ? '{}' : JSON.stringify(sample.value === 'a' ? { '2': 0, '3': 259 } : { '0': 259 });
    }
  }
  sample.onchange = configurePosePreset;
  async function configureMotionPreset() {
    if (motionSample.value !== 'local') {
      // A subsequent selection of the same local file must emit change again.
      motionFile.value = '';
      localMotion = undefined;
      const id = motionSample.value.replace('combined-', '').replace('group-', '').replace('solver-', '').replace('bone-', '');
      if(motionSample.value.startsWith('solver-')){motionMap.value='{}';document.querySelector<HTMLTextAreaElement>('#motion-morph-map')!.value='{}';select('motion-morph-unmatched').value='error';return;}
      motionMap.value = id === 'only' ? '{}' : await (await fetch(`${import.meta.env.BASE_URL}vmd/motion-${id}-map.json`)).text();
      const legacy = motionSample.value === 'a' || motionSample.value === 'b';
      select('motion-morph-unmatched').value = legacy ? 'ignore' : 'error';
      document.querySelector<HTMLTextAreaElement>('#motion-morph-map')!.value = legacy || motionSample.value.startsWith('bone-') ? '{}' : motionSample.value.startsWith('group-') ? '{"8fce82a2":1,"67726f7570":0}' : '{"8fce82a2":1}';
    }
  }
  motionSample.onchange = guarded(configureMotionPreset);
  file.onchange = () => {
    local = file.files?.[0];
    sample.value = 'local';
    mapping.value = '{}';
  };
  motionFile.onchange = () => {
    localMotion = motionFile.files?.[0];
    motionSample.value = 'local';
    motionSource.value = 'bytes';
    motionMap.value = '{}';
    document.querySelector<HTMLTextAreaElement>('#motion-morph-map')!.value = '{}';
  };
  model.onchange = guarded(loadRig);
  material.onchange = appearance;
  outline.onchange = () => {
    effect.enabled = outline.value === 'on';
    invalidate();
  };
  material.disabled = outline.disabled = false;
  const resize = () => {
    const width = viewport.clientWidth,
      height = viewport.clientHeight;
    renderer.setSize(width, height);
    camera.left = (-0.6 * width) / height;
    camera.right = (0.6 * width) / height;
    camera.updateProjectionMatrix();
    invalidate();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  resize();
  await guarded(loadRig)();
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(),
      delta = (now - last) / 1000;
    last = now;
    let update: PlaybackUpdate | undefined;
    if (!busy && assets.some((a) => a.player?.playing)) {
      const player = assets[0].player!, before = player.time, playingBefore = player.playing;
      try { assets.forEach((a) => a.player?.update(delta)); } catch(error) { assets.forEach(a=>a.player?.pause());info.error=String(error);report(info.error); }
      snapshot();
      update = {
        generation: info.playback.generation, rig: info.rig, source: info.source, motion: info.motion,
        duration: player.duration, before, delta, after: player.time,
        playingBefore, playing: player.playing, loop: player.loop,
        crossings: playingBefore && player.loop && player.duration > 0 ? Math.floor((before + delta) / player.duration) : 0,
        revision: info.revision, frame: info.frames + 1, weights: [...info.weights],
      };
    }
    controls.update();
    // Do not acknowledge a half-replaced asset while an asynchronous action is active.
    if (busy) return;
    const started = performance.now();
    effect.render(scene, camera);
    info.frames++;
    // render() is synchronous after renderer.init(). Publish only after the full
    // surface/outline/resolve pass has submitted this state to the canvas.
    info.rendered = {
      revision: info.revision, frame: info.frames, durationMs: performance.now() - started,
      rig: info.rig, motion: info.motion, pose: info.pose, time: info.time,
      ...(assets[0]?.physics ? {bones: structuredClone(info.bones)} : {}), playing: info.playing, mode: info.mode, outlines: effect.enabled,
      comparison: comparison.checked, weights: [...info.weights], vertices: info.vertices.map(v=>[...v]),
    };
    if(captures.length){const captured={png:renderer.domElement.toDataURL('image/png'),revision:info.rendered.revision,frame:info.rendered.frame};captures.splice(0).forEach(resolve=>resolve(captured));}
    if (update) {
      info.playback.updates.push(update);
      if (info.playback.updates.length > 8) info.playback.updates.shift();
      if (update.crossings > 0) info.playback.crossing = update;
    }
  });
  window.addEventListener(
    'pagehide',
    () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      controls.dispose();
      assets.forEach((a) => void disposeAsset(a));
      effect.dispose();
      renderer.dispose();
    },
    { once: true },
  );
}
start().catch((error) => {
  console.error(error);
  document.querySelector('#status')!.textContent = `Rig failed: ${String(error)}`;
});
