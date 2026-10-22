import { WebGPURenderer, Scene, OrthographicCamera, PerspectiveCamera, Mesh, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial,
  NodeMaterial, RenderTarget, FloatType, NoBlending, QuadMesh, Vector2, Vector3, Vector4, Matrix4, Color, SRGBColorSpace,
  Bone, Skeleton, SkinnedMesh, InstancedMesh, Uint16BufferAttribute, MeshPhysicalMaterial, DoubleSide } from 'three/webgpu';
import { uniform, vec3, vec4, texture, float } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDOutlinePlugin, MMDOutlineEffect, setOutlineRecords, getOutlineRecords } from '../packages/three-mmd-outline';
import { MMDToonPlugin } from '../packages/three-mmd-toon';
import { outlineClip } from '../packages/three-mmd-outline/nodes';
import positions from '../extensions/MMD_materials_outline/tests/positions.json';
import fragments from '../extensions/MMD_materials_outline/tests/fragments.json';
import signed from '../extensions/MMD_materials_outline/examples/signed-scale.gltf?raw';
const close = (a: number, b: number, label: string, tolerance = 2 / 255) => {
  if (!Number.isFinite(a) || Math.abs(a - b) > tolerance) throw new Error(`${label}: ${a} != ${b} (tolerance ${tolerance})`);
};
const matrix = (rows?: number[][]) => rows ? new Matrix4().set(...rows.flat() as Parameters<Matrix4['set']>) : new Matrix4();
async function run() {
  const renderer = new WebGPURenderer({ forceWebGL: new URLSearchParams(location.search).get('backend') !== 'webgpu', antialias: false, alpha: true });
  await renderer.init(); renderer.setSize(64, 64); document.body.append(renderer.domElement);
  const effect = new MMDOutlineEffect(renderer);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 2); camera.position.z = 1;
  const read = () => {
    const canvas = document.createElement('canvas'); canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
    const context = canvas.getContext('2d')!; context.drawImage(renderer.domElement, 0, 0);
    return [...context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data].map(x => x / 255);
  };
  let checked = 0;
  // Independent literal clip vectors, computed on the GPU with the production equation.
  const target = new RenderTarget(1, 1, { type: FloatType });
  const probe = new NodeMaterial(); probe.blending = NoBlending; probe.depthTest = false;
  const quad = new QuadMesh(probe);
  for (const input of positions.cases) {
    const c = { ...positions.defaults, ...input } as any;
    if (c.expected.skipped) continue;
    let d = matrix(c.world);
    if (c.joints) {
      const sum = new Array(16).fill(0);
      for (const joint of c.joints) {
        const m = matrix(joint.world).multiply(matrix(joint.inverseBind));
        m.elements.forEach((x, i) => { sum[i] += x * joint.weight; });
      }
      d.fromArray(sum);
    }
    const t = matrix(c.view).multiply(d);
    const p = new Vector3(...c.position as [number, number, number]).add(new Vector3(...(c.positionDelta ?? [0, 0, 0]) as [number, number, number]));
    const n = new Vector3(...c.normal as [number, number, number]).add(new Vector3(...(c.normalDelta ?? [0, 0, 0]) as [number, number, number]));
    probe.fragmentNode = outlineClip(uniform(p), uniform(n), uniform(t), uniform(matrix(c.projection)), float(c.material?.sizeFactor ?? 1), float(c.edgeScale ?? 1), uniform(new Vector2(...c.viewport as [number, number])));
    probe.needsUpdate = true;
    renderer.setRenderTarget(target); quad.render(renderer);
    const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1) as Float32Array;
    c.expected.clip?.forEach((x: number, i: number) => close(data[i], x, `${c.name} clip ${i}`, 3e-6));
    if (c.expected.pixel) for (let i = 0; i < 2; i++) close((c.origin?.[i] ?? 0) + (data[i] / data[3] + 1) * c.viewport[i] / 2, c.expected.pixel[i], `${c.name} pixel ${i}`, 3e-4);
    checked++;
  }
  renderer.setRenderTarget(null); target.dispose(); probe.dispose();
  const geometry = (ccw = false) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
    g.setAttribute('normal', new Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
    g.setIndex(ccw ? [0, 1, 2] : [0, 2, 1]); return g;
  };
  const diffuseAlpha = (c: any) => {
    const model = c.integration?.activeMaterial ?? 'core';
    if (model === 'core') return c.baseMaterial?.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1;
    if (model === 'toon') return c.baseMaterial?.extensions?.MMD_materials_toon?.diffuseFactor?.[3] ?? 1;
    if (c.integration && 'diffuseAlpha' in c.integration) return c.integration.diffuseAlpha;
    throw new Error('unsupported material-alpha integration');
  };
  const add = (c: any, order = 0) => {
    const m = new MeshBasicMaterial(); m.colorWrite = false; m.depthWrite = false;
    const mesh = new Mesh(geometry(c.ccw), m); mesh.position.z = -(c.ndcDepth ?? 0); mesh.renderOrder = order;
    if (c.reflected) mesh.scale.x = -1;
    const alpha = () => diffuseAlpha(c);
    setOutlineRecords(mesh, [{ payload: c.material ?? {}, materialIndex: 0, getDiffuseAlpha: alpha }]);
    scene.add(mesh); return mesh;
  };
  const clear = () => { scene.traverse(o => { if ((o as Mesh).isMesh) { const mesh = o as Mesh; mesh.geometry.dispose(); (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose()); } }); scene.clear(); };
  const background = (c: any) => {
    const a = c.destination?.alpha ?? 1;
    const rgb = (c.destination?.premultipliedRGB ?? [0, 0, 0]).map((x: number) => a > 0 ? x / a : 0);
    renderer.setClearColor(new Color().setRGB(...rgb as [number, number, number], SRGBColorSpace), a);
  };
  const occluder = (depth: number) => {
    const m = new MeshBasicMaterial(); m.colorWrite = false;
    const mesh = new Mesh(geometry(true), m); mesh.position.z = 1 - 2 * depth; scene.add(mesh);
  };
  for (const c of fragments.cases as any[]) {
    clear(); background(c);
    if (c.sceneDepth !== undefined && c.sceneDepth < 1) occluder(c.sceneDepth);
    add(c);
    if (c.expectedError) {
      let threw = false; try { effect.render(scene, camera); } catch { threw = true; }
      if (!threw) throw new Error(`${c.name}: expected integration failure`);
    } else {
      effect.render(scene, camera); const pixel = read();
      const expectedAlpha = c.expected.discard ? c.destination?.alpha ?? 1 : c.expected.alpha ?? 1;
      const premult = c.expected.discard ? c.destination?.premultipliedRGB ?? [0, 0, 0] : c.expected.premultipliedRGB;
      if (premult) premult.forEach((x: number, i: number) => close(pixel[i], expectedAlpha ? x / expectedAlpha : 0, `${c.name} RGB ${i}`));
      close(pixel[3], expectedAlpha, `${c.name} alpha`);
    }
    checked++;
  }
  const depthOutput = new RenderTarget(64, 64, { type: FloatType });
  depthOutput.depthTexture = new (await import('three')).DepthTexture(64, 64);
  const depthReadback = new RenderTarget(1, 1, { type: FloatType });
  const depthProbe = new NodeMaterial(); depthProbe.depthTest = false; depthProbe.blending = NoBlending;
  depthProbe.fragmentNode = vec4(vec3(texture(depthOutput.depthTexture)), 1);
  const depthQuad = new QuadMesh(depthProbe);
  for (const c of fragments.sequences as any[]) {
    clear(); background(c);
    if (c.sceneDepth < 1) occluder(c.sceneDepth);
    c.samples.forEach((s: any, i: number) => add(s, i));
    effect.render(scene, camera); const pixel = read();
    c.expected.premultipliedRGB.forEach((x: number, i: number) => close(pixel[i], x / c.expected.alpha, `${c.name} sequence RGB ${i}`));
    renderer.setRenderTarget(depthOutput); effect.render(scene, camera);
    renderer.setRenderTarget(depthReadback); depthQuad.render(renderer);
    const depth = await renderer.readRenderTargetPixelsAsync(depthReadback, 0, 0, 1, 1) as Float32Array;
    close(depth[0], c.expected.depth, `${c.name} retained depth`, 2e-6);
    renderer.setRenderTarget(null);
    checked++;
  }
  depthOutput.dispose(); depthReadback.dispose(); depthProbe.dispose();
  // Mandatory discriminating result from the production effect, including its final canvas transfer.
  clear(); renderer.setClearColor(0, 1); add({ material: { colorFactor: [0.5, 0.5, 0.5, 0.5] } });
  let forwarded = 0;
  const previousHook: NonNullable<ReturnType<typeof renderer.getRenderObjectFunction>> = (...args) => { forwarded++; renderer.renderObject(...args); };
  renderer.setRenderObjectFunction(previousHook);
  effect.render(scene, camera);
  if (renderer.getRenderObjectFunction() !== previousHook || !forwarded || !renderer.autoClear || renderer.getRenderTarget() !== null) throw new Error('effect leaked renderer state');
  renderer.setRenderObjectFunction(null);
  const gray = read(); close(gray[0], 0.25, 'encoded gray over black');
  if (gray[0] > 0.3) throw new Error('linear-light outline blend');
  // Active viewport render-target pixel dimensions and signed/default/zero scale silhouette displacement.
  for (const width of [64, 128]) for (const perspective of [false, true]) for (const scale of [-2, 0, 1, 2]) {
    clear(); renderer.setSize(width, 64); renderer.setViewport(width / 2, 0, width / 2, 64); renderer.setScissor(width / 2, 0, width / 2, 64); renderer.setScissorTest(true);
    const g = geometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('normal', new Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    g.setAttribute('_MMD_EDGE_SCALE', new Float32BufferAttribute([scale, scale, scale, scale], 1));
    const m = new MeshBasicMaterial(); m.colorWrite = m.depthWrite = false;
    const mesh = new Mesh(g, m); mesh.scale.set(perspective ? width / 256 : 0.5, 0.5, 0.25);
    setOutlineRecords(mesh, [{ payload: { sizeFactor: 3, colorFactor: [1, 0, 0, 1] }, materialIndex: 0, getDiffuseAlpha: () => 1 }]); scene.add(mesh);
    const pc = new PerspectiveCamera(90, width / 128, 0.1, 10); pc.position.z = 1;
    effect.render(scene, perspective ? pc : camera);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 64;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(renderer.domElement, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, 64).data;
    let minX = width;
    for (let x = width / 2; x < width; x++) if (pixels[(32 * width + x) * 4] > 128) minX = Math.min(minX, x);
    // At y=-.5 in orthographic the bottom edge starts at pane X=.25 + signed displacement.
    // Use a row inside the triangle; signed shifts must agree exactly across scales.
    if (scale === 0) { if (minX !== width) throw new Error('all-zero scale must suppress the entire draw'); }
    else close(minX, width / 2 + width / 8 + 3 * scale, `viewport ${width} perspective ${perspective} signed scale ${scale}`, 0);
    checked++;
  }
  renderer.setScissorTest(false); renderer.setSize(64, 64); renderer.setViewport(0, 0, 64, 64);
  clear(); renderer.setClearColor(0, 1);
  const groupedGeometry = geometry(); groupedGeometry.setIndex([0, 2, 1, 0, 2, 1]);
  groupedGeometry.addGroup(0, 3, 0); groupedGeometry.addGroup(3, 3, 1);
  const groupedMaterials = [new MeshBasicMaterial(), new MeshBasicMaterial()];
  groupedMaterials.forEach(m => { m.colorWrite = m.depthWrite = false; });
  const grouped = new Mesh(groupedGeometry, groupedMaterials);
  setOutlineRecords(grouped, [
    { payload: { colorFactor: [1, 0, 0, 0.5] }, materialIndex: 0, getDiffuseAlpha: () => 1 },
    { payload: { colorFactor: [0, 0, 1, 0.5] }, materialIndex: 1, getDiffuseAlpha: () => 1 },
  ]);
  scene.add(grouped); effect.render(scene, camera);
  [0.25, 0, 0.5].forEach((x, i) => close(read()[i], x, `material group layering ${i}`)); checked++;
  scene.remove(grouped); groupedGeometry.dispose(); groupedMaterials.forEach(m => m.dispose());
  // Transmission submits DoubleSide groups twice. Each group must contribute only
  // once, in ordinary list order, including distinct groups reusing material 0.
  const transmissionPixels: number[][] = [];
  for (const transmission of [0, 1]) for (const multipleGroups of [false, true]) {
    clear(); renderer.setClearColor(0, 1);
    const g = geometry();
    const materials = [0, 1].map(() => {
      const m = new MeshPhysicalMaterial({ transmission, side: DoubleSide });
      m.colorWrite = m.depthWrite = false;
      return m;
    });
    if (multipleGroups) {
      g.setIndex([0, 2, 1, 0, 2, 1, 0, 2, 1]);
      [0, 1, 0].forEach((materialIndex, i) => g.addGroup(i * 3, 3, materialIndex));
    }
    const mesh = new Mesh(g, multipleGroups ? materials : materials[0]);
    setOutlineRecords(mesh, [
      { payload: { colorFactor: [1, 0, 0, 0.5] }, materialIndex: 0, getDiffuseAlpha: () => 1 },
      { payload: { colorFactor: [0, 0, 1, 0.5] }, materialIndex: 1, getDiffuseAlpha: () => 1 },
    ]);
    scene.add(mesh);
    // Repeat to ensure per-render state cannot suppress later frames.
    for (let frame = 0; frame < 2; frame++) {
      effect.render(scene, camera);
      const pixel = read(), expected = multipleGroups ? [0.625, 0, 0.25, 1] : [0.5, 0, 0, 1];
      expected.forEach((x, i) => close(pixel[i], x, `transmission ${transmission} groups ${multipleGroups} frame ${frame} channel ${i}`));
      transmissionPixels.push(pixel); checked++;
    }
    scene.remove(mesh); g.dispose(); materials.forEach(m => m.dispose());
  }
  // Nonuniform inverse-transpose normals verified through actual silhouette coverage.
  const ng = geometry();
  ng.setAttribute('position', new Float32BufferAttribute([-0.2, -0.2, 0, 0.2, -0.2, 0, 0.2, 0.2, 0, -0.2, 0.2, 0], 3));
  ng.setAttribute('normal', new Float32BufferAttribute(new Array(4).fill([0.6, 0.8, 0]).flat(), 3)); ng.setIndex([0, 2, 1, 0, 3, 2]);
  const nm = new MeshBasicMaterial(); nm.colorWrite = nm.depthWrite = false;
  const normalMesh = new Mesh(ng, nm); normalMesh.scale.set(2, 1, 0.5);
  setOutlineRecords(normalMesh, [{ payload: { colorFactor: [1, 0, 0, 1], sizeFactor: 8 }, materialIndex: 0, getDiffuseAlpha: () => 1 }]);
  scene.add(normalMesh); effect.render(scene, camera);
  const coverageCanvas = document.createElement('canvas'); coverageCanvas.width = coverageCanvas.height = 64;
  const coverageContext = coverageCanvas.getContext('2d')!; coverageContext.drawImage(renderer.domElement, 0, 0);
  const coveragePixels = coverageContext.getImageData(0, 0, 64, 64).data;
  let minX = 64, minY = 64;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (coveragePixels[(y * 64 + x) * 4] > 128) { minX = Math.min(minX, x); minY = Math.min(minY, y); }
  close(minX, Math.ceil(19.2 + 8 * 3 / Math.sqrt(73) - 0.5), 'nonuniform raster X', 0);
  close(minY, Math.ceil(25.6 - 8 * 8 / Math.sqrt(73) - 0.5), 'nonuniform raster Y', 0); checked++;
  clear();
  // Loader instances, custom attributes, optional fallback and independent active Toon alpha.
  const plugins: MMDOutlinePlugin[] = [];
  const load = async (toon: boolean, coreAlpha: number, toonAlpha: number) => {
    const json = JSON.parse(signed);
    // Reverse the source triangle: the hull must cover the center as a back face.
    const bytes = Uint8Array.from(atob(json.buffers[0].uri.split(',')[1]), c => c.charCodeAt(0));
    const first = bytes.slice(0, 12); bytes.copyWithin(0, 12, 24); bytes.set(first, 12);
    json.buffers[0].uri = 'data:application/octet-stream;base64,' + btoa(String.fromCharCode(...bytes));
    json.materials[0].extensions.MMD_materials_outline = { colorFactor: [1, 0, 0, 0.5] };
    json.nodes.push({ mesh: 0, translation: [5, 0, 0] }); json.scenes[0].nodes.push(2);
    json.materials[0].pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, coreAlpha] };
    json.materials[0].extensions.MMD_materials_toon = { diffuseFactor: [1, 1, 1, toonAlpha] };
    json.extensionsUsed.push('MMD_materials_toon');
    const loader = new GLTFLoader();
    if (toon) loader.register(parser => new MMDToonPlugin(parser));
    loader.register(parser => { const plugin = new MMDOutlinePlugin(parser); plugins.push(plugin); return plugin; });
    return loader.parseAsync(JSON.stringify(json), '');
  };
  for (const toon of [false, true]) {
    const asset = await load(toon, 0, 0.5); const meshes: Mesh[] = [];
    asset.scene.traverse(o => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
    if (meshes.length !== 2) throw new Error('primitive instance association missing');
    for (const mesh of meshes) {
      const record = getOutlineRecords(mesh)[0];
      if (!record) throw new Error('missing outline record');
      close(record.getDiffuseAlpha(mesh.material as MeshBasicMaterial), toon ? 0.5 : 0, 'active material alpha', 0);
      const scales = mesh.geometry.getAttribute('_mmd_edge_scale');
      if (!scales || scales.getX(0) !== -1 || scales.getX(1) !== 0) throw new Error('loader lost signed scales');
    }
    scene.add(asset.scene); effect.render(scene, camera);
    close(read()[0], toon ? 0.5 : 0, 'loaded active alpha controls actual hull');
    scene.remove(asset.scene);
    checked++;
    plugins.at(-1)!.dispose();
    if (meshes.some(mesh => getOutlineRecords(mesh).length)) throw new Error('stale plugin metadata');
  }
  // Real EXT_mesh_gpu_instancing loading: r186 drops primitive associations on
  // replacement InstancedMeshes. Cover single/grouped meshes, reused nodes and
  // custom instance attributes that shallow-clone the source geometry.
  const loadedInstancePixels: number[][] = [];
  for (const multiplePrimitives of [false, true]) for (const customAttribute of [false, true]) {
    clear(); renderer.setClearColor(0, 1);
    const json = JSON.parse(signed);
    const original = Uint8Array.from(atob(json.buffers[0].uri.split(',')[1]), c => c.charCodeAt(0));
    const first = original.slice(0, 12); original.copyWithin(0, 12, 24); original.set(first, 12);
    const translations = new Float32Array([0, 0, 0, 5, 0, 0]);
    const bytes = new Uint8Array(original.length + translations.byteLength);
    bytes.set(original); bytes.set(new Uint8Array(translations.buffer), original.length);
    const bufferView = json.bufferViews.length, accessor = json.accessors.length;
    json.bufferViews.push({ buffer: 0, byteOffset: original.length, byteLength: translations.byteLength });
    json.accessors.push({ bufferView, componentType: 5126, type: 'VEC3', count: 2 });
    json.buffers = [{ byteLength: bytes.length, uri: 'data:application/octet-stream;base64,' + btoa(String.fromCharCode(...bytes)) }];
    json.extensionsUsed.push('EXT_mesh_gpu_instancing');
    const attributes = customAttribute ? { TRANSLATION: accessor, _CUSTOM: accessor } : { TRANSLATION: accessor };
    json.nodes = [
      { mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes } } },
      { mesh: 0, translation: [5, 0, 0], extensions: { EXT_mesh_gpu_instancing: { attributes } } },
    ];
    json.scenes = [{ nodes: [0, 1] }];
    json.materials[0].extensions.MMD_materials_outline = { colorFactor: [1, 0, 0, 0.5] };
    if (multiplePrimitives) {
      json.materials.push(structuredClone(json.materials[0]), structuredClone(json.materials[0]));
      json.materials[1].extensions.MMD_materials_outline = { colorFactor: [0, 0, 1, 0.5] };
      delete json.materials[2].extensions.MMD_materials_outline;
      const primitive = json.meshes[0].primitives[0];
      json.meshes[0].primitives.push({ ...primitive, material: 1 }, { ...primitive, material: 2 });
    }
    let plugin!: MMDOutlinePlugin;
    const asset = await new GLTFLoader().register(parser => (plugin = new MMDOutlinePlugin(parser))).parseAsync(JSON.stringify(json), '');
    const meshes: InstancedMesh[] = [];
    asset.scene.traverse(object => { if ((object as InstancedMesh).isInstancedMesh) meshes.push(object as InstancedMesh); });
    if (meshes.length !== (multiplePrimitives ? 6 : 2)) throw new Error('loaded GPU instance count');
    meshes.forEach((mesh, i) => {
      if (mesh.count !== 2) throw new Error('loaded hardware instance count');
      const record = getOutlineRecords(mesh)[0], primitiveIndex = multiplePrimitives ? i % 3 : 0;
      if (primitiveIndex === 2) {
        if (record) throw new Error('outline attached to a disabled primitive');
      } else {
        const expected = primitiveIndex === 0 ? [1, 0, 0, 0.5] : [0, 0, 1, 0.5];
        if (JSON.stringify(record?.payload.colorFactor) !== JSON.stringify(expected)) throw new Error('loaded GPU primitive association lost');
      }
      const scales = mesh.geometry.getAttribute('_mmd_edge_scale');
      if (scales.getX(0) !== -1 || scales.getX(1) !== 0 || scales.getX(2) !== 2) throw new Error('loaded GPU signed scales lost');
      const m = mesh.material as MeshPhysicalMaterial;
      if (!m.isMeshStandardMaterial) throw new Error('outline replaced core material');
      m.colorWrite = m.depthWrite = false;
    });
    scene.add(asset.scene); effect.render(scene, camera);
    const pixel = read(), expected = multiplePrimitives ? [0.25, 0, 0.5, 1] : [0.5, 0, 0, 1];
    expected.forEach((x, i) => close(pixel[i], x, `loaded GPU instances multi ${multiplePrimitives} custom ${customAttribute} channel ${i}`));
    loadedInstancePixels.push(pixel); checked++;
    plugin.dispose();
    if (meshes.some(mesh => getOutlineRecords(mesh).length)) throw new Error('stale GPU instance metadata');
  }
  // GLTFLoader normalizes WEIGHTS_0 for its base material. The outline retains raw
  // decoded factors and all influence sets: .25*translation(-1) + .75*translation(1) = .5.
  clear(); renderer.setClearColor(0, 1);
  const skinnedJSON = JSON.parse(signed);
  const original = Uint8Array.from(atob(skinnedJSON.buffers[0].uri.split(',')[1]), c => c.charCodeAt(0));
  const firstPosition = original.slice(0, 12); original.copyWithin(0, 12, 24); original.set(firstPosition, 12);
  const pieces: Uint8Array[] = [original]; let offset = original.length;
  const append = (values: Uint8Array | Float32Array, componentType: number) => {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    const bufferView = skinnedJSON.bufferViews.length;
    skinnedJSON.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); offset += bytes.length; pieces.push(bytes);
    const index = skinnedJSON.accessors.length;
    skinnedJSON.accessors.push({ bufferView, componentType, type: 'VEC4', count: 3 }); return index;
  };
  const attr = skinnedJSON.meshes[0].primitives[0].attributes;
  attr.JOINTS_0 = append(new Uint8Array(12), 5121);
  attr.WEIGHTS_0 = append(new Float32Array([0.25, 0, 0, 0, 0.25, 0, 0, 0, 0.25, 0, 0, 0]), 5126);
  attr.JOINTS_1 = append(new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 5121);
  attr.WEIGHTS_1 = append(new Float32Array([0.75, 0, 0, 0, 0.75, 0, 0, 0, 0.75, 0, 0, 0]), 5126);
  const packed = new Uint8Array(offset); let cursor = 0; pieces.forEach(piece => { packed.set(piece, cursor); cursor += piece.length; });
  skinnedJSON.buffers = [{ byteLength: packed.length, uri: 'data:application/octet-stream;base64,' + btoa(String.fromCharCode(...packed)) }];
  skinnedJSON.nodes = [{ mesh: 0, skin: 0 }, { translation: [-1, 0, 0] }, { translation: [1, 0, 0] }];
  skinnedJSON.skins = [{ joints: [1, 2] }]; skinnedJSON.scenes = [{ nodes: [0, 1, 2] }];
  skinnedJSON.materials[0].extensions.MMD_materials_outline = { colorFactor: [1, 0, 0, 0.5] };
  const skinAsset = await new GLTFLoader().register(parser => new MMDOutlinePlugin(parser)).parseAsync(JSON.stringify(skinnedJSON), '');
  scene.add(skinAsset.scene); effect.render(scene, camera);
  const sc = document.createElement('canvas'); sc.width = sc.height = 64; const sctx = sc.getContext('2d')!; sctx.drawImage(renderer.domElement, 0, 0);
  close(sctx.getImageData(10, 32, 1, 1).data[0] / 255, 0, 'raw weighted skin left sample');
  close(sctx.getImageData(49, 32, 1, 1).data[0] / 255, 0.5, 'all joint sets right sample'); checked++;
  // Mixed reflected/singular hardware instances use corrected winding independently.
  clear(); renderer.setClearColor(0, 1);
  const im = new MeshBasicMaterial(); im.colorWrite = im.depthWrite = false;
  const instanced = new InstancedMesh(geometry(), im, 3);
  instanced.setMatrixAt(0, new Matrix4().makeScale(0.2, 0.2, 1).setPosition(-0.5, 0, 0));
  instanced.setMatrixAt(1, new Matrix4().makeScale(-0.2, 0.2, 1).setPosition(0.5, 0, 0));
  instanced.setMatrixAt(2, new Matrix4().makeScale(0, 1, 1));
  setOutlineRecords(instanced, [{ payload: { colorFactor: [1, 0, 0, 1] }, materialIndex: 0, getDiffuseAlpha: () => 1 }]);
  scene.add(instanced); effect.render(scene, camera);
  const ic = document.createElement('canvas'); ic.width = ic.height = 64; const ictx = ic.getContext('2d')!; ictx.drawImage(renderer.domElement, 0, 0);
  for (const x of [17, 49]) close(ictx.getImageData(x, 32, 1, 1).data[0] / 255, 1, `reflected instance ${x}`, 0);
  close(ictx.getImageData(32, 32, 1, 1).data[0] / 255, 0, 'singular instance', 0); checked++;
  // Core morph/skin deformation stays independent of mesh-node transforms, including singular M.
  clear(); renderer.setClearColor(0, 1);
  const g = geometry();
  g.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.morphAttributes.position = [new Float32BufferAttribute(new Array(9).fill(0), 3)]; g.morphTargetsRelative = true;
  const material = new MeshBasicMaterial(); material.colorWrite = material.depthWrite = false;
  const skin = new SkinnedMesh(g, material), bone = new Bone(); scene.add(bone, skin); skin.bind(new Skeleton([bone]));
  setOutlineRecords(skin, [{ payload: { colorFactor: [1, 0, 0, 0.5] }, materialIndex: 0, getDiffuseAlpha: () => 1 }]);
  for (const x of [1, -1, 0]) {
    skin.scale.x = x; effect.render(scene, camera); close(read()[0], 0.5, `skin ignores mesh M=${x}`); checked++;
  }
  const deltas = g.morphAttributes.position[0];
  for (let i = 0; i < deltas.count; i++) deltas.setX(i, 3);
  deltas.needsUpdate = true;
  // Use a fresh geometry so Three's cached morph texture sees the new authored deltas.
  const morphedGeometry = g.clone(); skin.geometry = morphedGeometry; skin.updateMorphTargets();
  skin.morphTargetInfluences![0] = 1; effect.render(scene, camera); close(read()[0], 0, 'nonzero core position morph'); checked++;
  skin.morphTargetInfluences![0] = 0; bone.position.x = 3; effect.render(scene, camera); close(read()[0], 0, 'joint-world animation'); checked++;
  clear(); g.dispose(); effect.dispose(); renderer.dispose();
  Object.assign(window, { outlineConformance: { passed: checked, gray, transmissionPixels, loadedInstancePixels, tolerance: 2 / 255, clipTolerance: 3e-6, backend: ('isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend) ? 'WebGPU' : 'WebGL2' } });
}
run().catch(error => { console.error(error); Object.assign(window, { outlineConformanceError: String(error) }); });
