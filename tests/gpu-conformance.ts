import { WebGPURenderer, Scene, OrthographicCamera, Mesh, PlaneGeometry, DataTexture, RGBAFormat, FloatType, NearestFilter, LinearFilter, ClampToEdgeWrapping, RepeatWrapping, RenderTarget, Vector3, NoBlending, LinearSRGBColorSpace } from 'three/webgpu';
import { vec2, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createToonMaterial, createToonLighting } from '../packages/three-mmd-toon/shading';
import { encodedTextureView, MMDToonPlugin } from '../packages/three-mmd-toon';
import vectors from '../extensions/MMD_materials_toon/tests/shading.json';
import type { ToonPayload } from '../packages/three-mmd-toon';
import subtexture from '../extensions/MMD_materials_toon/examples/subtexture.gltf?raw';

const decode = (x: number) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
async function run() {
  const renderer = new WebGPURenderer({ forceWebGL: true, antialias: false });
  await renderer.init();
  renderer.setSize(8, 8);
  document.body.append(renderer.domElement);
  const target = new RenderTarget(8, 8, { type: FloatType });
  target.texture.colorSpace = LinearSRGBColorSpace;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const geometry = new PlaneGeometry(2, 2);
  const mesh = new Mesh(geometry);
  scene.add(mesh);
  const textures = vectors.textures.map((definition) => {
    const def = definition as typeof definition & { encoding?: string; wrapS?: string; wrapT?: string };
    const pixels = def.pixels.flat(2).map((x) => def.encoding === 'unorm8' ? x / 255 : x);
    const t = new DataTexture(new Float32Array(pixels), def.pixels[0].length, def.pixels.length, RGBAFormat, FloatType);
    t.magFilter = t.minFilter = def.filter === 'nearest' ? NearestFilter : LinearFilter;
    t.wrapS = def.wrapS === 'repeat' ? RepeatWrapping : ClampToEdgeWrapping;
    t.wrapT = def.wrapT === 'repeat' ? RepeatWrapping : ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return encodedTextureView(t);
  });
  let checked = 0;
  for (const input of vectors.cases) {
    // Fixture inputs are heterogeneous JSON; expectations stay independent of production math.
    const c = input as any;
    const m: ToonPayload = c.material.extensions.MMD_materials_toon;
    const uvSet = m.baseTexture?.texCoord ?? 0;
    const material = createToonMaterial(m, c.material, {
      base: m.baseTexture ? textures[m.baseTexture.index] : undefined,
      sphere: m.sphereTexture ? textures[m.sphereTexture.index] : undefined,
      toon: m.sharedToonIndex !== undefined ? textures[c.sharedSyntheticTexture] : m.toonTexture ? textures[m.toonTexture.index] : undefined,
    }, createToonLighting(new Vector3(...(c.light ?? [0, 0, 1]) as [number, number, number]), new Vector3(...(c.lightRGB ?? [1, 1, 1]) as [number, number, number])), {
      normal: vec3(...(c.normal ?? [0, 0, 1]) as [number, number, number]),
      light: vec3(...(c.light ?? [0, 0, 1]) as [number, number, number]),
      view: vec3(...(c.view ?? [0, 0, 1]) as [number, number, number]),
      normalView: vec3(...(c.normalView ?? c.normal ?? [0, 0, 1]) as [number, number, number]),
      baseUV: vec2(...(c.uvs?.[uvSet] ?? [0.5, 0.5]) as [number, number]),
      uv1: vec2(...(c.uvs?.[1] ?? [0.5, 0.5]) as [number, number]),
    });
    material.blending = NoBlending; // inspect straight source result; blending is checked separately below
    mesh.material = material;
    renderer.render(scene, camera);
    const data = await renderer.readRenderTargetPixelsAsync(target, 4, 4, 1, 1) as Float32Array;
    const expected = c.expected;
    const close = (actual: number, value: number, label: string, tolerance = 2e-6) => {
      if (!Number.isFinite(actual) || Math.abs(actual - value) > tolerance) throw new Error(`${c.name} ${label}: ${actual} != ${value}`);
    };
    if (expected.discard) close(data[3], 0, 'discard');
    else {
      if (expected.rgb) expected.rgb.forEach((x: number, i: number) => close(data[i], decode(x), `linearRGB[${i}]`));
      if (expected.linearRGB) expected.linearRGB.forEach((x: number, i: number) => close(data[i], x, `output boundary[${i}]`));
      if (expected.coverage !== undefined) close(data[3], expected.coverage, 'coverage');
      else if (expected.alpha !== undefined && c.material.alphaMode === 'BLEND') close(data[3], expected.alpha, 'blend alpha');
      if (expected.blendedLinearRGB) {
        material.blending = 1; // NormalBlending, straight alpha over the fixture's linear black background
        renderer.render(scene, camera);
        const blended = await renderer.readRenderTargetPixelsAsync(target, 4, 4, 1, 1) as Float32Array;
        expected.blendedLinearRGB.forEach((x: number, i: number) => close(blended[i], x, `blend[${i}]`));
      }
      if (expected.encodedRGB) {
        // Exercise the renderer's actual sRGB output transfer, including no double encoding.
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
        const context = canvas.getContext('2d')!;
        context.drawImage(renderer.domElement, 0, 0);
        const encoded = context.getImageData(4, 4, 1, 1).data;
        expected.encodedRGB.forEach((x: number, i: number) => close(encoded[i] / 255, x, `encoded output[${i}]`, 2 / 255));
        renderer.setRenderTarget(target);
      }
    }
    checked++;
    material.dispose();
  }
  // Full GLTFLoader path: independent PBR texture/factors plus UV1 and subTexture in the existing fixture.
  const loader = new GLTFLoader();
  loader.register((parser) => new MMDToonPlugin(parser));
  const asset = await loader.parseAsync(subtexture, '');
  scene.clear(); scene.add(asset.scene);
  renderer.render(scene, camera);
  await renderer.readRenderTargetPixelsAsync(target, 4, 4, 1, 1);
  // An extension with deliberately contradictory PBR/emissive/normal inputs must still use its own graph.
  const parsed = JSON.parse(subtexture);
  const m = parsed.materials[0];
  m.pbrMetallicRoughness = { baseColorFactor: [0, 1, 0, 0], metallicFactor: 1, roughnessFactor: 0 };
  m.emissiveFactor = [1, 0, 0];
  // Concurrent core PBR use of the exact same glTF image must not decode the MMD sampling view.
  parsed.materials.push({ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } });
  parsed.meshes.push({ primitives: [{ ...parsed.meshes[0].primitives[0], material: 1 }] });
  parsed.nodes.push({ mesh: 1, translation: [5, 0, 0] });
  parsed.scenes[0].nodes.push(1);
  const second = await new GLTFLoader().register((parser) => new MMDToonPlugin(parser)).parseAsync(JSON.stringify(parsed), '');
  scene.clear(); scene.add(second.scene);
  renderer.render(scene, camera);
  const secondPixel = await renderer.readRenderTargetPixelsAsync(target, 4, 4, 1, 1) as Float32Array;
  scene.clear(); scene.add(asset.scene); renderer.render(scene, camera);
  const firstPixel = await renderer.readRenderTargetPixelsAsync(target, 4, 4, 1, 1) as Float32Array;
  if (firstPixel[3] <= 0) throw new Error('GLTFLoader fixture did not cover the sampled pixel');
  const coverage = 0.8 * (204 / 255) * (128 / 255);
  const expectedRGB = [128 / 255, 128 / 255, (64 / 255) * (128 / 255)];
  expectedRGB.forEach((x, i) => {
    if (Math.abs(firstPixel[i] - decode(x) * coverage) > 2e-6) throw new Error(`GLTFLoader image/source arithmetic ${i}: ${firstPixel[i]}`);
  });
  for (let i = 0; i < 4; i++) if (Math.abs(secondPixel[i] - firstPixel[i]) > 1e-6) throw new Error('GLTFLoader PBR cross-wiring');
  Object.assign(window, { conformance: { passed: checked, loader: true, pixel: [...firstPixel] } });
  renderer.dispose();
}
run().catch((error) => { console.error(error); Object.assign(window, { conformanceError: String(error) }); });
