import { createPhysics, PhysicsWriter } from './pmx-physics';
import { loadAmmoNode } from '../packages/three-mmd-physics/node';
import { PhysicsTimeline } from '../packages/three-mmd-physics/world';
import { evaluateMotion, evaluateIK } from '../packages/mmd-vmd';
import { resolveRawPose } from '../packages/mmd-vpd';
import { createSolver, SolverWriter, type SourceGrant, type SourceIK } from './pmx-solver';
import { solvePose } from '../packages/mmd-solver';
import { Document, Extension, NodeIO, TextureInfo, type Material, type Texture, type WriterContext } from '@gltf-transform/core';
import { Parser } from 'mmd-parser';
import { PNG } from 'pngjs';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, extname, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTENSION_NAME, validatePayload, type ToonPayload } from '../packages/three-mmd-toon/payload';
import { EXTENSION_NAME as OUTLINE, EDGE_ATTRIBUTE, validatePayload as validateOutline, type OutlinePayload } from '../packages/three-mmd-outline/payload';
import { createBDEFSkin } from './pmx-bdef';
import { parseVPD, bindPose, resolvePose, type VPDEncoding, type BindingOptions } from '../packages/mmd-vpd';
import { parseVMD, bindMotion, type VMDBindingOptions } from '../packages/mmd-vmd';
import { addVMDAnimation, VMDWriter, type SamplingOptions } from './vmd-animation';
import { createMorphTargets, type PMXMorph } from './pmx-morph';
import { parsePMX21, PMX21, assertPMX21Profile } from './pmx21';
import { pmxParserBytes } from './pmx-encoding';
import { createQDEFSelector, QDEFWriter } from './pmx-qdef';
import { createSDEFAttributes, SDEFWriter } from './pmx-sdef';

export interface Vertex { type?: number; skinIndices?: number[]; skinWeights?: number[]; skinC?: number[]; skinR0?: number[]; skinR1?: number[]; edgeRatio?: number; position: number[]; normal: number[]; uv: number[]; auvs: number[][] }
export interface PMXBone { name: string; englishName: string; position: number[]; parentIndex: number; transformationClass?: number; flag?: number; grant?: SourceGrant; ik?: SourceIK; fixAxis?:number[]; localXVector?:number[]; localZVector?:number[]; key?:number }
export interface ConversionOptions { physics?: 'none' | 'rigid-body-v1'; physicsSettle?: number; solver?: 'pre-physics-v1' | 'none'; scale?: number; mode?: 'static' | 'bdef' | 'sdef' | 'qdef'; vpd?: Uint8Array; vpdEncoding?: VPDEncoding; vpdBinding?: BindingOptions; vmd?: Uint8Array; vmdBinding?: VMDBindingOptions; vmdSampling?: SamplingOptions }
interface PMXMaterial {
  name: string; diffuse: number[]; ambient: number[]; specular: number[]; shininess: number;
  flag: number; textureIndex: number; envTextureIndex: number; envFlag: number;
  toonFlag: number; toonIndex: number; faceCount: number; edgeColor?: number[]; edgeSize?: number;
}
export interface PMXModel {
  metadata: { modelName: string; comment: string; englishComment: string; version?: number; coordinateSystem?: string; rigidBodyCount?: number; constraintCount?: number; encoding?: number; boneCount?: number; morphCount?: number; softBodyCount?: number };
  vertices: Vertex[]; faces: { indices: number[] }[]; materials: PMXMaterial[]; textures: string[];
  bones: PMXBone[]; morphs: PMXMorph[]; rigidBodies: unknown[]; constraints: unknown[];
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
  if (bytes.length >= 8 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(4, true) === PMX21) return parsePMX21(bytes);
  // mmd-parser reflects position/normal Z and reverses triangle order together.
  // PMX and glTF both use top-left UVs, so no V flip is applied.
  try {
    const input = pmxParserBytes(bytes);
    const model = new Parser().parsePmx(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer, true);
    if (input !== bytes) model.metadata.encoding = bytes[9];
    return model;
  } catch (error) {
    if (/unsupport bone type/.test(String(error))) {
      throw new Error(`PMX parsing failed: ${String(error)} Pinned mmd-parser 1.1.4 cannot parse QDEF (type 4); no vertex index is available. No skinning approximation is performed.`, { cause: error });
    }
    throw error;
  }
}
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const decode = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
export async function convertModel(model: PMXModel, textureDirectory: string, options: ConversionOptions | number = {}) {
  const { scale = 0.08, mode = 'static', physics = 'none', physicsSettle = 0, solver = 'none', vpd, vpdEncoding, vpdBinding, vmd, vmdBinding, vmdSampling } = typeof options === 'number' ? { scale: options } : options;
  assertPMX21Profile(model);
  if (!['none','rigid-body-v1'].includes(physics)) throw new Error(`Unknown physics profile ${physics}`);
  if (physics !== 'none' && mode === 'static') throw new Error('Physics requires bdef, sdef or qdef');
  if (!Number.isFinite(physicsSettle) || physicsSettle < 0 || physicsSettle > 30 || physics === 'none' && physicsSettle !== 0) throw new Error('Invalid physicsSettle (0..30 seconds; requires physics)');
  if((solver !== 'none' || physics !== 'none') && model.metadata.boneCount!==undefined && model.metadata.boneCount!==model.bones.length)throw new Error('PMX bones: declared count differs from records');
  if (!['none','pre-physics-v1'].includes(solver)) throw new Error(`Unknown solver profile ${solver}`);
  if (solver !== 'none' && mode === 'static') throw new Error('Solver requires mode bdef, sdef or qdef');
  if (!['static', 'bdef', 'sdef', 'qdef'].includes(mode)) throw new Error(`Unknown conversion mode ${mode}`);
  if (mode === 'qdef' && model.vertices.some(v => v.type === 4) && model.metadata.version !== PMX21) throw new Error('QDEF records require actual PMX 2.1 source metadata; do not relabel PMX 2.0 records.');
  if (vpd && vmd) throw new Error('Simultaneous VPD/VMD conversion is unsupported; composition is not implemented');
  if (vmd && mode === 'static') throw new Error('VMD requires mode bdef, sdef or qdef');
  if (vpd && mode === 'static') throw new Error('VPD requires mode bdef, sdef or qdef');
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('scale must be finite and positive');
  if (!model.vertices.length || !model.faces.length) throw new Error('PMX has no geometry');
  if (mode === 'sdef' || mode === 'qdef' || solver !== 'none') model.vertices.forEach((v, i) => {
    for (const [field, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
      if (!Array.isArray(v[field]) || v[field].length !== size || ![...v[field]].every(Number.isFinite)) throw new Error(`Vertex ${i}: invalid ${field} layout`);
    }
  });
  const warnings = [mode === 'static' ? `Static base pose only: omitting ${model.bones.length} bones, ${model.rigidBodies.length} bodies, ${model.constraints.length} joints; no skinning, IK, grants or animation.`
    : `BDEF core skin only: retaining ${model.bones.length} bones and parent hierarchy; omitting ${model.rigidBodies.length} bodies, ${model.constraints.length} joints. SDEF/QDEF, deformation layers, IK, append/grants, fixed/local axes, external parents, physics are unsupported. VMD executes solver-free bone tracks and vertex morph weights. VPD applies raw bone offsets only; IK/append/physics are not evaluated.`,
    'Shadow flags are retained in material extras, but are not rendered. Additional UV ZW and unused additional UV channels are omitted.'];
  const doc = new Document();
  if (mode === 'sdef') warnings[0] = warnings[0].replace('BDEF core skin only', 'Mixed BDEF/SDEF skin (MMD_skinning_sdef)').replace('SDEF/QDEF', 'QDEF/PMX 2.1');
  const buffer = doc.createBuffer();
  const extension = doc.createExtension(ToonWriter);
  const outline = model.materials.some(m => m.flag & 0x10) ? doc.createExtension(OutlineWriter) : null;
  const mesh = doc.createMesh(model.metadata.modelName);
  const meshNode = doc.createNode(model.metadata.modelName).setMesh(mesh);
  const scene = doc.createScene(mode === 'static' ? 'Static PMX base pose' : mode === 'qdef' ? 'PMX mixed BDEF/SDEF/QDEF rest pose' : mode === 'sdef' ? 'PMX mixed BDEF/SDEF rest pose' : 'PMX BDEF rest pose').addChild(meshNode);
  const skin = mode !== 'static' ? createBDEFSkin(doc, buffer, scene, meshNode, model, scale, warnings, mode === 'sdef' || mode === 'qdef', mode === 'qdef') : null;
  if (skin && (solver !== 'none' || physics !== 'none')) {
    skin.poseModel.solver = createSolver(model, skin.poseModel, physics === 'none' ? 1 : 2);
    const writer = doc.createExtension(SolverWriter); writer.profile = skin.poseModel.solver; writer.nodes = skin.nodes;
    skin.root.setExtras({ ...skin.root.getExtras(), mmdSolver: skin.poseModel.solver });
    warnings[0] = `Pre-physics-v1 ordered IK and rotation/translation append enabled. Physics bodies (${model.rigidBodies.length}) and joints (${model.constraints.length}) retained only as counts; simulation and scene controls do not execute.`;
    solvePose(skin.poseModel.solver, skin.poseModel.bones).forEach(b => skin.nodes[b.index].setTranslation(b.translation).setRotation(b.rotation));
  }
  const physicsProfile = skin && physics !== 'none' ? createPhysics(model, skin.poseModel.solver!, scale) : undefined;
  let physicsBackend: Awaited<ReturnType<typeof loadAmmoNode>> | undefined;
  if (physicsProfile) {
    physicsBackend = await loadAmmoNode();
    const writer=doc.createExtension(PhysicsWriter); writer.profile=physicsProfile;writer.solver=skin!.poseModel.solver;
    warnings[0]='Rigid-body-v1: sphere/box/capsule, modes 0/1/2, complemented raw PMX exclusion bits, spring-6DOF; ordered pre/post solver v2. Synthetic project policy; original-MMD fidelity unmeasured.';
  }
  const sdef = mode === 'sdef' || mode === 'qdef' ? createSDEFAttributes(doc, buffer, model, scale) : null;
  const qdef = mode === 'qdef' ? createQDEFSelector(doc, buffer, model) : null;
  const qdefWriter = qdef ? doc.createExtension(QDEFWriter) : null;
  if (mode === 'qdef') warnings[0] = warnings[0].replace('BDEF core skin only', 'Mixed BDEF/SDEF/QDEF rigid-dq-v1 skin').replace('SDEF/QDEF, ', '');
  if (qdef) warnings.push('MMD_skinning_qdef is optional: ordinary loaders use explicitly approximate BDEF4. Rigid-dq-v1 is a synthetic project profile; original-MMD deformation is unmeasured.');
  const sdefWriter = sdef ? doc.createExtension(SDEFWriter) : null;
  if (sdef) warnings.push('MMD_skinning_sdef is optional: ordinary loaders approximate SDEF with BDEF2. Rigid joint palettes only; scale/shear is unsupported. Original-MMD positions/normals are unmeasured.');
  if (vpd && skin) {
    const pose = parseVPD(vpd, vpdEncoding);
    const binding = bindPose(skin.poseModel, pose, vpdBinding);
    const timeline=physicsProfile ? new PhysicsTimeline(physicsBackend!.api,physicsProfile,skin.poseModel.solver!) : undefined;
    let resolved;try {resolved=timeline ? timeline.seek(physicsSettle,()=>resolveRawPose(skin.poseModel,binding)) : resolvePose(skin.poseModel, binding);}finally{timeline?.dispose();}
    resolved.forEach(b => skin.nodes[b.index].setTranslation(b.translation).setRotation(b.rotation));
    scene.setName(mode === 'qdef' ? 'PMX mixed BDEF/SDEF/QDEF VPD bone offsets' : mode === 'sdef' ? 'PMX mixed BDEF/SDEF VPD bone offsets' : 'PMX BDEF VPD bone offsets');
    warnings.push(`VPD: applied ${binding.assignments.length} bone offsets; parent filename ${JSON.stringify(pose.parentFile)} is informational. Unmatched: ${binding.unmatched.join(', ') || 'none'}. ${physicsProfile ? `Rigid-body-v1 evaluated at ${physicsSettle} seconds; restart on explicit enable.` : solver === 'none' ? 'No IK/append/physics.' : 'Pre-physics-v1 solved; no physics.'}`);
  }
  const morph = createMorphTargets(doc, buffer, mesh, meshNode, model, scale, skin?.poseModel.modelId);
  const unsupportedMorphs = morph.metadata.morphs.filter(m => m.target === null);
  warnings.push(`Morphs: retained ${morph.targets.length} vertex/group POSITION targets; omitted unsupported source families ${JSON.stringify(unsupportedMorphs.map(m => ({ index: m.index, name: m.name, type: m.type, group: m.group, unsupported: m.unsupported })))}. Authored normals retained; no recomputation or morph normal targets.`);
  if (vmd && skin) {
    const motion = parseVMD(vmd), binding = bindMotion(skin.poseModel, motion, vmdBinding, morph.metadata);
    const timeline=physicsProfile ? new PhysicsTimeline(physicsBackend!.api,physicsProfile,skin.poseModel.solver!) : undefined;
    let samples;try {samples=addVMDAnimation(doc,buffer,binding,skin.nodes,vmdSampling,meshNode,timeline);}finally{timeline?.dispose();}
    warnings.push(`VMD: bound ${binding.tracks.length} bone tracks and ${binding.morphs?.[0]?.tracks.length ?? 0} morph tracks; unmatched morph byte keys: ${binding.unmatchedMorphs.join(', ') || 'none'}; unmatched byte keys: ${binding.unmatched.join(', ') || 'none'}. Omitted execution counts: ${JSON.stringify(binding.omitted)}. Informational model name: ${JSON.stringify(motion.modelName.text)}. Continuous-curve-v1 project policy, no original-MMD parity claim. Approximate fallback: ${samples} samples; ${physicsProfile ? 'fixed physics ticks with approximate LINEAR interpolation between ticks' : 'finite adaptive probes, no continuous error proof'}.`);
  }
  if(physicsProfile && skin && !vpd && !vmd){const timeline=new PhysicsTimeline(physicsBackend!.api,physicsProfile,skin.poseModel.solver!);try{timeline.seek(physicsSettle,()=>skin.poseModel.bones).forEach(b=>skin.nodes[b.index].setTranslation(b.translation).setRotation(b.rotation));}finally{timeline.dispose();}}
  doc.getRoot().setDefaultScene(scene).setExtras({ sourceComment: model.metadata.comment, sourceEnglishComment: model.metadata.englishComment, conversionMode: mode, sourcePMXVersion: model.metadata.version, sourcePMXEncoding: model.metadata.encoding, metersPerPMXUnit: scale, sourceSolvers: structuredClone(model.bones.map((b,index) => ({index,name:b.name,flags:b.flag,phase:(b.flag??0)&0x1000?'postPhysics':'prePhysics',layer:b.transformationClass,grant:b.grant,ik:b.ik,fixAxis:b.fixAxis,localXVector:b.localXVector,localZVector:b.localZVector,key:b.key}))),
    conversion: mode === 'static' ? 'Static PMX to glTF; reflected Z and winding; vertex POSITION morphs; no animation, skin or physics.' : `PMX ${mode === 'qdef' ? 'mixed BDEF/SDEF/QDEF to optional skinning extensions plus approximate core' : mode === 'sdef' ? 'mixed BDEF/SDEF to MMD_skinning_sdef plus approximate core' : 'BDEF to core glTF'} skin; reflected Z and winding; ${physicsProfile ? 'rigid-body-v1, pre/post-physics-v2' : solver === 'none' ? 'solver-free' : 'pre-physics-v1'} VPD/VMD bones and vertex morph weights; ${physicsProfile ? 'physics retained with resolved core fallback' : 'no physics'}.`, warnings });
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
    if (sdef) sdefWriter!.records.set(primitive, sdef);
    if (qdef) qdefWriter!.records.set(primitive, qdef);
    if (m.envFlag === 3 && m.envTextureIndex >= 0) primitive.setAttribute('TEXCOORD_1', uv1!);
    morph.targets.forEach(target => primitive.addTarget(target));
    mesh.addPrimitive(primitive);
  }
  if (faceOffset !== model.faces.length) throw new Error('Material face counts do not cover all PMX faces');
  return { document: doc, io: new NodeIO().registerExtensions([ToonWriter, OutlineWriter, VMDWriter, SDEFWriter, QDEFWriter, SolverWriter, PhysicsWriter]), warnings };
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
  if (!input || !output || args.length % 2 || args.some((v, i) => i % 2 === 0 && !['--physics', '--physics-settle', '--vmd-ik-map', '--vmd-ik-unmatched', '--vmd-control-time-tolerance', '--solver', '--textures', '--scale', '--mode', '--vpd', '--vpd-encoding', '--vpd-map', '--vpd-unmatched', '--vmd', '--vmd-map', '--vmd-unmatched', '--vmd-morph-map', '--vmd-morph-unmatched', '--vmd-translation-tolerance', '--vmd-rotation-tolerance', '--vmd-max-samples'].includes(v))) {
    console.error('Usage: npm run convert -- input.pmx output.glb|output.gltf [--physics none|rigid-body-v1] [--physics-settle seconds] [--solver none|pre-physics-v1] [--textures directory] [--scale meters-per-unit] [--mode static|bdef|sdef|qdef] [--vpd pose.vpd] [--vpd-encoding shift_jis|utf-8] [--vpd-map record-map.json] [--vpd-unmatched error|ignore] [--vmd motion.vmd] [--vmd-map byte-key-map.json] [--vmd-unmatched error|ignore] [--vmd-morph-map byte-key-map.json] [--vmd-morph-unmatched error|ignore] [--vmd-translation-tolerance meters] [--vmd-rotation-tolerance radians] [--vmd-max-samples count] [--vmd-ik-map byte-key-map.json] [--vmd-ik-unmatched error|ignore] [--vmd-control-time-tolerance seconds]'); process.exitCode = 1;
  } else {
    const opts = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
    const numeric = (key: string) => opts[key] === undefined ? undefined : Number(opts[key]);
    Promise.all([
      opts['--vpd'] ? readFile(opts['--vpd']) : undefined,
      opts['--vpd-map'] ? readFile(opts['--vpd-map'], 'utf8').then(JSON.parse) : undefined,
      opts['--vmd'] ? readFile(opts['--vmd']) : undefined,
      opts['--vmd-map'] ? readFile(opts['--vmd-map'], 'utf8').then(JSON.parse) : undefined,
      opts['--vmd-morph-map'] ? readFile(opts['--vmd-morph-map'], 'utf8').then(JSON.parse) : undefined,
      opts['--vmd-ik-map'] ? readFile(opts['--vmd-ik-map'], 'utf8').then(JSON.parse) : undefined,
    ]).then(([vpd, mapping, vmd, vmdMapping, morphMapping, ikMapping]) => convertPMX(input, output, {
      physics: opts['--physics'] as ConversionOptions['physics'], physicsSettle: numeric('--physics-settle'), solver: opts['--solver'] as ConversionOptions['solver'], textureDirectory: opts['--textures'], scale: numeric('--scale'),
      mode: opts['--mode'] as ConversionOptions['mode'],
      vpd, vpdEncoding: opts['--vpd-encoding'] as VPDEncoding,
      vpdBinding: { mapping, unmatched: opts['--vpd-unmatched'] as BindingOptions['unmatched'] },
      vmd, vmdBinding: { ikMapping, ikUnmatched: opts['--vmd-ik-unmatched'] as VMDBindingOptions['ikUnmatched'], morphMapping, morphUnmatched: opts['--vmd-morph-unmatched'] as VMDBindingOptions['morphUnmatched'], mapping: vmdMapping, unmatched: opts['--vmd-unmatched'] as VMDBindingOptions['unmatched'] },
      vmdSampling: {
        controlTimeTolerance: numeric('--vmd-control-time-tolerance'), translationTolerance: numeric('--vmd-translation-tolerance'),
        rotationTolerance: numeric('--vmd-rotation-tolerance'), maxSamples: numeric('--vmd-max-samples'),
      },
    })).then(({ warnings }) => warnings.forEach(w => console.warn(w)))
      .catch(error => { console.error(error); process.exitCode = 1; });
  }
}
