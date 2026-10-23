import { MMDSDEFPlugin } from '../packages/three-mmd-sdef';
import {
  WebGPURenderer,
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

import { validWeight } from '../packages/mmd-morph';
import { createMorphRig, getMorphModel, getMorphWeights, applyMorphWeights, resetMorphWeights, refreshDeformation, type MorphRig } from '../packages/three-mmd-morph';

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
    error: '',
    motion: '',
    time: 0,
    playing: false,
    disposedPlayers: 0,
  };
  Object.assign(window, { mmdRig: info });
  interface Asset {
    scene: Group;
    rig: VPDRig;
    morph: MorphRig;
    player?: VMDPlayer;
    toon?: MMDToonPlugin;
    outlines: MMDOutlinePlugin;
    sdef?: MMDSDEFPlugin;
    diagnostics?: { unmatched: string[]; omitted: object };
  }
  let assets: Asset[] = [],
    local: File | undefined,
    localMotion: File | undefined,
    busy = false;
  const report = (message: string) => {
    status.textContent = `Ready · ${message} · Solver-free bones + vertex morphs; IK/append/physics and other morph families unsupported`;
  };
  const snapshot = () => {
    info.bones = [];
    assets[0]?.scene.traverse((n) => {
      if (n.userData.pmxBone)
        info.bones.push({
          index: n.userData.pmxBone.index,
          translation: n.position.toArray(),
          rotation: n.quaternion.toArray(),
        });
    });
    info.weights = assets[0] ? getMorphWeights(assets[0].morph) : [];
    document.querySelector('#morph-state')!.textContent = `Weights: ${info.weights.map(w => w.toFixed(4)).join(', ')} · source identity retained; sum is not normalized`;
    document.querySelectorAll<HTMLInputElement>('#morph-controls input').forEach((control,i) => { control.value = String(info.weights[i]); });
    info.time = assets[0]?.player?.time ?? 0;
    info.playing = assets[0]?.player?.playing ?? false;
    seek.value = String(info.time);
    motionLabel.textContent = `${info.motion || 'No motion'} · ${info.time.toFixed(4)} s · ${info.playing ? 'Playing' : 'Paused'}`;
  };
  const comparison = input('sdef-comparison');
  const updateComparison = () => {
    for (const a of assets) {
      let changed = false;
      a.scene.traverse(n => {
        const mesh = n as Mesh;
        const attr = mesh.geometry?.getAttribute('mmdSkinningType');
        if (!attr) return;
        changed = true;
        if (!mesh.userData.sdefSelection) mesh.userData.sdefSelection = Array.from({length: attr.count}, (_, i) => attr.getX(i));
        for (let i = 0; i < attr.count; i++) attr.setX(i, comparison.checked ? 0 : mesh.userData.sdefSelection[i]);
        attr.needsUpdate = true;
      });
      if (changed) refreshDeformation(a.scene);
    }
    document.querySelector('#sdef-state')!.textContent = model.value.startsWith('sdef-') ? `Mixed BDEF/SDEF · ordered pairs · rigid joints · ${comparison.checked ? 'BDEF2 approximation' : 'SDEF enabled'} · original-MMD unmeasured` : 'Core BDEF rig';
  };
  comparison.onchange = updateComparison;
  const appearance = () => {
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
      .register((p) => new MMDVMDPlugin(p))
      .register((p) => (sdefPlugin = new MMDSDEFPlugin(p)))
      .register((p) => (outlinePlugin = new MMDOutlinePlugin(p)));
    if (toon) loader.register((p) => (toonPlugin = new MMDToonPlugin(p)));
    const loaded = await loader.loadAsync(url);
    try {
      return {
        scene: loaded.scene,
        rig: createVPDRig(loaded.scene),
        morph: createMorphRig(loaded.scene),
        player: getVMDPlayers(loaded)[0],
        toon: toonPlugin,
        outlines: outlinePlugin!,
        sdef: sdefPlugin,
        diagnostics: loaded.parser.json.animations?.[0]?.extras?.vmd,
      };
    } catch (error) {
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
    const next = await loadPair(`${import.meta.env.BASE_URL}${model.value.startsWith('sdef-') ? `sdef/${model.value.slice(5)}` : `morph/${model.value}`}/rest.glb`);
    await replace(next);
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
      const response = await fetch(`${import.meta.env.BASE_URL}vpd/pose-${sample.value}.vpd`);
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
    const motionId = motionSample.value.replace('combined-', '');
    if (motionSource.value === 'bytes') {
      let data: Uint8Array;
      if (motionSample.value === 'local') {
        if (!localMotion) throw new Error('Select a local VMD file first');
        data = new Uint8Array(await localMotion.arrayBuffer());
      } else {
        const r = await fetch(`${import.meta.env.BASE_URL}${combined ? `morph/${motionId === 'only' ? 'morph-only' : `combined-${motionId}`}` : `vmd/motion-${motionId}`}.vmd`);
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
        `${import.meta.env.BASE_URL}${model.value.startsWith('sdef-') ? `sdef/${model.value.slice(5)}/${combined ? motionId : `legacy-${motionId}`}` : `${combined ? 'morph' : 'vmd'}/${model.value}/${motionId}`}.${motionSource.value}`,
      );
      next.forEach((a) => a.player!.seek(0));
      await replace(next);
      diagnostic = `Retained curves loaded; approximate fallback replaced. Unmatched: ${next[0].diagnostics?.unmatched.join(', ') || 'none'}. Omitted execution counts: ${JSON.stringify(next[0].diagnostics?.omitted ?? {})}`;
    }
    assets.forEach((a) => {
      a.player!.loop = loop.checked;
    });
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
    button('motion-load'),
    button('motion-play'),
    button('motion-pause'),
    button('motion-reset'),
    seek,
    loop,
  ];
  const guarded = (action: () => Promise<void> | void) => async () => {
    busy = true;
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
    }
  };
  function rebuildMorphControls() {
    const container = document.querySelector('#morph-controls')!;
    container.replaceChildren();
    for (const m of getMorphModel(assets[0].morph).morphs) {
      if (m.target === null) continue;
      const label = document.createElement('label'), control = document.createElement('input');
      label.textContent = `${m.index}: ${m.name} `;
      control.type = 'number'; control.step = '0.05'; control.value = '0';
      control.dataset.target = String(m.target);
      control.onchange = guarded(() => {
        const values = getMorphWeights(assets[0].morph); values[m.target!] = Number(control.value);
        // Validate the complete requested weight vector on both independent instances first.
        if (!values.every(validWeight)) throw new Error('Morph: invalid FLOAT weight');
        assets.forEach(a => applyMorphWeights(a.morph, values));
        info.error = ''; snapshot(); report('Manual morph weights applied. Motion paused');
      });
      label.append(control); container.append(label);
    }
  }
  button('morph-reset').onclick = guarded(() => {
    assets.forEach(a => resetMorphWeights(a.morph)); snapshot(); report('Morph weights reset. Motion paused');
  });
  const transport = (action: (player: VMDPlayer) => void) =>
    guarded(() => {
      if (!assets[0]?.player) throw new Error('Load a VMD motion first');
      assets.forEach((a) => action(a.player!));
      info.error = '';
      snapshot();
      report('VMD transport updated');
    });
  preset.onclick = guarded(apply);
  const resetAll = () => {
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
    snapshot(); info.pose = 'rest'; info.error = ''; label.textContent = 'Rest state';
    report('VPD reset to original bone rest. Motion paused; morph weights preserved');
  });
  button('motion-reset').onclick = guarded(resetAll);
  button('motion-load').onclick = guarded(loadMotion);
  button('motion-play').onclick = transport((p) => p.play());
  button('motion-pause').onclick = transport((p) => p.pause());
  seek.oninput = transport((p) => p.seek(Number(seek.value)));
  loop.onchange = () =>
    assets.forEach((a) => {
      if (a.player) a.player.loop = loop.checked;
    });
  sample.onchange = () => {
    if (sample.value !== 'local') {
      encoding.value = sample.value === 'a' ? 'shift_jis' : 'utf-8';
      mapping.value = JSON.stringify(sample.value === 'a' ? { '2': 0, '3': 259 } : { '0': 259 });
    }
  };
  motionSample.onchange = guarded(async () => {
    if (motionSample.value !== 'local') {
      // A subsequent selection of the same local file must emit change again.
      motionFile.value = '';
      localMotion = undefined;
      const id = motionSample.value.replace('combined-', '');
      motionMap.value = id === 'only' ? '{}' : await (await fetch(`${import.meta.env.BASE_URL}vmd/motion-${id}-map.json`)).text();
      const legacy = motionSample.value === 'a' || motionSample.value === 'b';
      select('motion-morph-unmatched').value = legacy ? 'ignore' : 'error';
      document.querySelector<HTMLTextAreaElement>('#motion-morph-map')!.value = legacy ? '{}' : '{"8fce82a2":1}';
    }
  });
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
  };
  material.disabled = outline.disabled = false;
  const resize = () => {
    const width = viewport.clientWidth,
      height = viewport.clientHeight;
    renderer.setSize(width, height);
    camera.left = (-0.6 * width) / height;
    camera.right = (0.6 * width) / height;
    camera.updateProjectionMatrix();
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
    if (!busy && assets.some((a) => a.player?.playing)) {
      assets.forEach((a) => a.player?.update(delta));
      snapshot();
    }
    controls.update();
    effect.render(scene, camera);
    info.frames++;
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
