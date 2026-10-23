import { Document, Extension, NodeIO, TextureInfo, type Material, type Texture, type WriterContext } from '@gltf-transform/core';
import { Parser } from 'mmd-parser';
import { PNG } from 'pngjs';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, extname, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTENSION_NAME, validatePayload, type ToonPayload } from '../packages/three-mmd-toon/payload';
import { EXTENSION_NAME as OUTLINE, EDGE_ATTRIBUTE, validatePayload as validateOutline, type OutlinePayload } from '../packages/three-mmd-outline/payload';
import { createBDEFSkin } from './pmx-bdef';
import { pmxParserBytes } from './pmx-encoding';

export interface Vertex { type?: number; skinIndices?: number[]; skinWeights?: number[]; edgeRatio?: number; position: number[]; normal: number[]; uv: number[]; auvs: number[][] }
export interface PMXBone { name: string; englishName: string; position: number[]; parentIndex: number; transformationClass?: number; flag?: number }
export interface ConversionOptions { scale?: number; mode?: 'static' | 'bdef' }
interface PMXMaterial {
  name: string; diffuse: number[]; ambient: number[]; specular: number[]; shininess: number;
  flag: number; textureIndex: number; envTextureIndex: number; envFlag: number;
  toonFlag: number; toonIndex: number; faceCount: number; edgeColor?: number[]; edgeSize?: number;
}
export interface PMXModel {
  metadata: { modelName: string; comment: string; englishComment: string };
  vertices: Vertex[]; faces: { indices: number[] }[]; materials: PMXMaterial[]; textures: string[];
  bones: PMXBone[]; morphs: unknown[]; rigidBodies: unknown[]; constraints: unknown[];
}
type Slot = 'baseTexture' | 'toonTexture' | 'sphereTexture';
/** Writer-only adapter: glTF Transform writes all geometry, images, samplers and the GLB container. */
class ToonWriter extends Extension {
  static EXTENSION_NAME = EXTENSION_NAME;
  readonly extensionName = EXTENSION_NAME;
  records = new Map<Material, { payload: ToonPayload; textures: Partial<Record<Slot, Texture>> }>();
  read(): this { throw new Error('ToonWriter is a converter-only writer'); }
  write(context: WriterContext): this {
    for (const [material, record] of this.records) {
      const payload = structuredClone(record.payload);
      for (const slot of ['baseTexture', 'toonTexture', 'sphereTexture'] as const) {
        const texture = record.textures[slot];
        if (!texture) continue;
        const clampEdges = slot === 'toonTexture' || slot === 'sphereTexture' && payload.sphereMode !== 'subTexture';
        const info = new TextureInfo(this.document.getGraph(), slot)
          .setMagFilter(9729).setMinFilter(slot === 'toonTexture' ? 9729 : 9987)
          .setWrapS(clampEdges ? 33071 : 10497).setWrapT(clampEdges ? 33071 : 10497);
        payload[slot] = { index: context.createTextureInfoDef(texture, info).index };
      }
      validatePayload(payload);
      const def = context.jsonDoc.json.materials![context.materialIndexMap.get(material)!];
      def.extensions = { ...def.extensions, [EXTENSION_NAME]: payload };
    }
    return this;
  }
}
/** Independent writer: outlines remain optional alongside Toon and core PBR. */
class OutlineWriter extends Extension {
  static EXTENSION_NAME = OUTLINE;
  readonly extensionName = OUTLINE;
  records = new Map<Material, OutlinePayload>();
  read(): this { throw new Error('OutlineWriter is a converter-only writer'); }
  write(context: WriterContext): this {
    for (const [material, payload] of this.records) {
      validateOutline(payload);
      const def = context.jsonDoc.json.materials![context.materialIndexMap.get(material)!];
      def.extensions = { ...def.extensions, [OUTLINE]: structuredClone(payload) };
    }
    return this;
  }
}
export function parsePMX(bytes: Uint8Array): PMXModel {
  // mmd-parser reflects position/normal Z and reverses triangle order together.
  // PMX and glTF both use top-left UVs, so no V flip is applied.
  try {
    const input = pmxParserBytes(bytes);
    const model = new Parser().parsePmx(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer, true);
    if (input !== bytes) model.metadata.encoding = bytes[9];
    return model;
  } catch (error) {
    if (String(error) === 'PMX version 2.0999999046325684 is not supported.') {
      throw new Error('Pinned mmd-parser 1.1.4 rejects binary PMX 2.1 at its version check; QDEF is also unsupported. No vertex index is available and no approximation is performed.', { cause: error });
    }
    if (/unsupport bone type/.test(String(error))) {
      throw new Error(`PMX parsing failed: ${String(error)} Pinned mmd-parser 1.1.4 cannot parse QDEF (type 4); no vertex index is available. No skinning approximation is performed.`, { cause: error });
    }
    throw error;
  }
}
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const decode = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
export async function convertModel(model: PMXModel, textureDirectory: string, options: ConversionOptions | number = {}) {
  const { scale = 0.08, mode = 'static' } = typeof options === 'number' ? { scale: options } : options;
  if (mode !== 'static' && mode !== 'bdef') throw new Error(`Unknown conversion mode ${mode}`);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('scale must be finite and positive');
  if (!model.vertices.length || !model.faces.length) throw new Error('PMX has no geometry');
  const warnings = [mode === 'static' ? `Static base pose only: omitting ${model.bones.length} bones, ${model.morphs.length} morphs, ${model.rigidBodies.length} bodies, ${model.constraints.length} joints; no skinning, IK, grants or animation.`
    : `BDEF core skin only: retaining ${model.bones.length} bones and parent hierarchy; omitting ${model.morphs.length} morphs, ${model.rigidBodies.length} bodies, ${model.constraints.length} joints. SDEF/QDEF, deformation layers, IK, append/grants, fixed/local axes, external parents, physics and motion/pose loading are unsupported.`,
    'Shadow flags are retained in material extras, but are not rendered. Additional UV ZW and unused additional UV channels are omitted.'];
  const doc = new Document();
  const buffer = doc.createBuffer();
  const extension = doc.createExtension(ToonWriter);
  const outline = model.materials.some(m => m.flag & 0x10) ? doc.createExtension(OutlineWriter) : null;
  const mesh = doc.createMesh(model.metadata.modelName);
  const meshNode = doc.createNode(model.metadata.modelName).setMesh(mesh);
  const scene = doc.createScene(mode === 'static' ? 'Static PMX base pose' : 'PMX BDEF rest pose').addChild(meshNode);
  const skin = mode === 'bdef' ? createBDEFSkin(doc, buffer, scene, meshNode, model, scale, warnings) : null;
  doc.getRoot().setDefaultScene(scene).setExtras({ sourceComment: model.metadata.comment, sourceEnglishComment: model.metadata.englishComment, conversionMode: mode, metersPerPMXUnit: scale,
    conversion: mode === 'static' ? 'Static PMX to glTF; reflected Z and winding; no animation, skin, physics or morphs.' : 'PMX BDEF to core glTF skin; reflected Z and winding; no solvers, animation, physics or morphs.', warnings });
  const accessor = (name: string, type: 'SCALAR' | 'VEC2' | 'VEC3', values: number[]) => {
    if (!values.every(Number.isFinite)) throw new Error(`Non-finite ${name}`);
    const array = new Float32Array(values);
    if (!array.every(Number.isFinite)) throw new Error(`Unsupported numeric range for ${name}`);
    return doc.createAccessor(name).setBuffer(buffer).setType(type).setArray(array);
  };
  const positions = accessor('positions', 'VEC3', model.vertices.flatMap((v) => v.position.map((x) => x * scale)));
  const normals = accessor('normals', 'VEC3', model.vertices.flatMap((v) => {
    const length = Math.hypot(...v.normal);
    if (!Number.isFinite(length) || length === 0) throw new Error('Invalid PMX normal');
    return v.normal.map((x) => x / length);
  }));
  const uv = accessor('uv', 'VEC2', model.vertices.flatMap((v) => v.uv));
  const needsUV1 = model.materials.some((m) => m.envFlag === 3 && m.envTextureIndex >= 0);
  const uv1 = needsUV1 ? accessor('additional UV1 XY', 'VEC2', model.vertices.flatMap((v) => {
    if (!v.auvs[0]) throw new Error('subTexture requires PMX Additional UV1');
    return v.auvs[0].slice(0, 2);
  })) : null;
  const scales = model.vertices.map(v => v.edgeRatio === undefined ? 1 : v.edgeRatio);
  const edgeScales = outline && scales.some(x => x !== 1) ? accessor('PMX edge ratios', 'SCALAR', scales) : null;
  const textures = new Map<number, Texture>();
  const hasAlpha = new Map<Texture, boolean>();
  async function texture(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= model.textures.length) throw new Error(`Invalid PMX texture index ${index}`);
    if (textures.has(index)) return textures.get(index)!;
    const path = resolve(textureDirectory, model.textures[index].replaceAll('\\', '/'));
    const rel = relative(resolve(textureDirectory), path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Texture path escapes texture directory');
    const bytes = await readFile(path);
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : null;
    if (!mime) throw new Error(`Unsupported texture format: ${model.textures[index]}; transcode to PNG/JPEG first (including BMP/TGA sphere/toon images).`);
    const value = doc.createTexture(model.textures[index]).setImage(bytes).setMimeType(mime);
    // A texture reference alone does not imply transparency. Opaque surfaces need
    // depth writes, otherwise unsorted triangles show through hair, skin and clothes.
    const rgba = mime === 'image/png' ? PNG.sync.read(bytes).data : null;
    hasAlpha.set(value, rgba ? rgba.some((alpha, i) => i % 4 === 3 && alpha !== 255) : false);
    textures.set(index, value);
    return value;
  }
  let faceOffset = 0;
  for (const m of model.materials) {
    if (!Number.isInteger(m.faceCount) || m.faceCount < 0) throw new Error('Invalid material face count');
    const payload: ToonPayload = { diffuseFactor: m.diffuse, ambientFactor: m.ambient, specularFactor: m.specular, shininessFactor: m.shininess };
    validatePayload(payload);
    // Independent linear-light approximation for ordinary glTF viewers, never used by toon shading.
    const material = doc.createMaterial(m.name).setBaseColorFactor([...m.diffuse.slice(0, 3).map((v) => decode(clamp(v))), clamp(m.diffuse[3])] as [number, number, number, number])
      .setMetallicFactor(0).setRoughnessFactor(Math.max(0.15, Math.min(1, Math.sqrt(2 / (m.shininess + 2)))))
      .setDoubleSided(!!(m.flag & 1))
      .setExtras({ pmxFlags: m.flag, edgeColor: m.edgeColor, edgeSize: m.edgeSize, pmxSphereMode: m.envFlag });
    const refs: Partial<Record<Slot, Texture>> = {};
    if (m.textureIndex >= 0) {
      refs.baseTexture = await texture(m.textureIndex);
      material.setBaseColorTexture(refs.baseTexture);
      material.getBaseColorTextureInfo()!.setMagFilter(9729).setMinFilter(9987);
    }
    if (m.toonIndex >= 0) {
      if (m.toonFlag === 1) {
        // PMX stores a zero-based shared index: 0 -> toon01.bmp, ..., 9 -> toon10.bmp.
        payload.sharedToonIndex = m.toonIndex;
      } else if (m.toonFlag === 0) refs.toonTexture = await texture(m.toonIndex);
      else throw new Error(`Invalid toon flag ${m.toonFlag}`);
    }
    if (![0, 1, 2, 3].includes(m.envFlag)) throw new Error(`Unknown sphere mode ${m.envFlag}`);
    if (m.envTextureIndex >= 0) {
      refs.sphereTexture = await texture(m.envTextureIndex);
      payload.sphereMode = (['none', 'multiply', 'add', 'subTexture'] as const)[m.envFlag];
    } else if (m.envFlag !== 0) warnings.push(`${m.name}: sphere mode ${m.envFlag} has no source texture (-1); disabled.`);
    // Sphere multiply/add and toon RGB do not contribute alpha in this extension.
    const translucent = m.diffuse[3] < 1 || !!(refs.baseTexture && hasAlpha.get(refs.baseTexture))
      || payload.sphereMode === 'subTexture' && !!(refs.sphereTexture && hasAlpha.get(refs.sphereTexture));
    material.setAlphaMode(translucent ? 'BLEND' : 'OPAQUE');
    extension.records.set(material, { payload, textures: refs });
    if (m.flag & 0x10) {
      const edge = { colorFactor: m.edgeColor ?? [0, 0, 0, 1], sizeFactor: m.edgeSize ?? 1 };
      validateOutline(edge);
      outline!.records.set(material, edge);
    }
    const faces = model.faces.slice(faceOffset, faceOffset + m.faceCount);
    if (faces.length !== m.faceCount) throw new Error('Material face range exceeds PMX faces');
    faceOffset += m.faceCount;
    const indices = faces.flatMap((f) => f.indices);
    if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= model.vertices.length) || indices.length !== faces.length * 3) throw new Error('Invalid PMX indices');
    if (!indices.length) continue;
    const primitive = doc.createPrimitive().setAttribute('POSITION', positions).setAttribute('NORMAL', normals).setAttribute('TEXCOORD_0', uv).setMaterial(material)
      .setIndices(doc.createAccessor(`${m.name} indices`).setBuffer(buffer).setType('SCALAR').setArray(model.vertices.length <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices)));
    if (m.flag & 0x10 && edgeScales) primitive.setAttribute(EDGE_ATTRIBUTE, edgeScales);
    if (skin) primitive.setAttribute('JOINTS_0', skin.joints).setAttribute('WEIGHTS_0', skin.weights);
    if (m.envFlag === 3 && m.envTextureIndex >= 0) primitive.setAttribute('TEXCOORD_1', uv1!);
    mesh.addPrimitive(primitive);
  }
  if (faceOffset !== model.faces.length) throw new Error('Material face counts do not cover all PMX faces');
  return { document: doc, io: new NodeIO().registerExtensions([ToonWriter, OutlineWriter]), warnings };
}
export async function convertPMX(input: string, output: string, options: ConversionOptions & { textureDirectory?: string } = {}) {
  if (!['.glb', '.gltf'].includes(extname(output))) throw new Error('Output must end in .glb or .gltf');
  const result = await convertModel(parsePMX(await readFile(input)), options.textureDirectory ?? dirname(input), options);
  await mkdir(dirname(output), { recursive: true });
  await result.io.write(output, result.document);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, ...args] = process.argv.slice(2);
  if (!input || !output || args.length % 2 || args.some((v, i) => i % 2 === 0 && !['--textures', '--scale', '--mode'].includes(v))) {
    console.error('Usage: npm run convert -- input.pmx output.glb|output.gltf [--textures directory] [--scale meters-per-unit] [--mode static|bdef]'); process.exitCode = 1;
  } else {
    const opts = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
    convertPMX(input, output, { textureDirectory: opts['--textures'], scale: opts['--scale'] === undefined ? undefined : Number(opts['--scale']), mode: opts['--mode'] as ConversionOptions['mode'] })
      .then(({ warnings }) => warnings.forEach((w) => console.warn(w))).catch((error) => { console.error(error); process.exitCode = 1; });
  }
}
