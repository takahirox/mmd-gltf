import {
  WebGPURenderer, NodeMaterial, RenderTarget, DepthTexture, QuadMesh, BackSide, DoubleSide, DataTexture, RGBAFormat, FloatType,
  LessEqualDepth, AlwaysDepth, NoBlending, NormalBlending, NoToneMapping, SRGBColorSpace,
  NoColorSpace, HalfFloatType, NearestFilter, Vector2, Vector3, Vector4, Matrix4, Quaternion,
  type Scene, type Camera, type Object3D, type Mesh, type SkinnedMesh, type InstancedMesh, type NodeBuilder, type UniformNode, type Node, type ArrayNode,
} from 'three/webgpu';
import { Fn, If, Discard, equal, determinant, mat3, mat4, frontFacing, float, vec4, texture, uniform, positionLocal, normalLocal, attribute, morphReference,
  buffer, element, cameraProjectionMatrix, textureLoad, int, ivec2, uvec4, vertexIndex, instanceIndex, sRGBTransferEOTF, renderOutput } from 'three/tsl';
import { getOutlineRecords, type OutlineRecord } from './metadata';
import { outlineClip } from './nodes';
import { validatePayload } from './payload';

/** Core morphs only; the draft requires inverse-transpose of the weighted skin transform,
 * whereas Three's ordinary skin-normal path multiplies normals by the skin matrix. */
class OutlineMaterial extends NodeMaterial {
  setupPosition(builder: NodeBuilder) {
    if (builder.geometry.morphAttributes.position || builder.geometry.morphAttributes.normal) morphReference(builder.object as Mesh);
    return positionLocal;
  }
}
/** Vertex/instance factors live in owned exact float textures, avoiding shared-geometry
 * attribute mutation and r186's lack of a public BufferAttribute.dispose(). */
function palette(values: ArrayLike<number>) {
  const texels = Math.ceil(values.length / 4), width = Math.min(1024, texels), height = Math.ceil(texels / width);
  if (height > 2048) throw new Error('MMD_materials_outline: unsupported palette size');
  const data = new Float32Array(width * height * 4); data.set(values);
  const map = new DataTexture(data, width, height, RGBAFormat, FloatType);
  map.magFilter = map.minFilter = NearestFilter; map.generateMipmaps = false; map.needsUpdate = true;
  const load = (index: Node<'uint'> | Node<'int'>) => {
    const i = int(index);
    return textureLoad(map, ivec2(i.mod(width), i.div(width))) as unknown as Node<'vec4'>;
  };
  return { map, data, load };
}
function createHull(mesh: Mesh, record: OutlineRecord, viewport: UniformNode<'vec2', Vector2>, view: UniformNode<'mat4', Matrix4>) {
  const material = new OutlineMaterial();
  const size = uniform(1), color = uniform(new Vector4());
  material.side = BackSide;
  material.depthFunc = LessEqualDepth;
  material.depthWrite = true;
  material.transparent = true;
  material.blending = NormalBlending;
  material.toneMapped = material.fog = false;
  material.name = 'MMD_materials_outline hull';
  const skinned = (mesh as SkinnedMesh).isSkinnedMesh && mesh.geometry.hasAttribute('skinIndex') && mesh.geometry.hasAttribute('skinWeight');
  const world = uniform(mesh.matrixWorld);
  const instancePalette = (mesh as InstancedMesh).isInstancedMesh ? palette((mesh as InstancedMesh).instanceMatrix.array) : null;
  const instance = instancePalette ? mat4(...[0, 1, 2, 3].map(i => instancePalette.load(instanceIndex.mul(4).add(i))) as [Node<'vec4'>, Node<'vec4'>, Node<'vec4'>, Node<'vec4'>]) : null;
  const sets = record.skinAttributes ?? [];
  let skinPalette: ReturnType<typeof palette> | null = null;
  if (skinned && sets.length) {
    const values = new Float32Array(sets[0].weights.count * sets.length * 8);
    for (let i = 0; i < sets[0].weights.count; i++) sets.forEach((set, j) => {
      for (let k = 0; k < 4; k++) {
        values[i * sets.length * 8 + j * 8 + k] = set.joints.getComponent(i, k);
        values[i * sets.length * 8 + j * 8 + 4 + k] = set.weights.getComponent(i, k);
      }
    });
    skinPalette = palette(values);
  }
  const instanceDet = instance ? determinant(mat3(instance)).toVarying('mmdOutlineInstanceDet').setInterpolation('flat') : null;
  if (instanceDet) {
    // Fixed-function frontFace is per draw, so mixed reflected instances need equivalent
    // fragment culling. The renderer already corrects the mesh-node determinant.
    material.side = DoubleSide;
    material.forceSinglePass = true;
  }
  material.vertexNode = Fn(() => {
    let deformation: Node<'mat4'> = world;
    if (skinned) {
      // r186 typings omit BufferNode's array-element interface.
      const bones = buffer((mesh as SkinnedMesh).skeleton.boneMatrices, 'mat4', (mesh as SkinnedMesh).skeleton.bones.length) as unknown as ArrayNode<'mat4'>;
      const influences = skinPalette ? sets.map((_, i) => ({
        joints: uvec4(skinPalette!.load(vertexIndex.mul(sets.length * 2).add(i * 2))),
        weights: skinPalette!.load(vertexIndex.mul(sets.length * 2).add(i * 2 + 1)),
      })) : [{ joints: attribute('skinIndex', 'uvec4'), weights: attribute('skinWeight', 'vec4') }];
      let weighted: Node<'mat4'> = mat4(vec4(0), vec4(0), vec4(0), vec4(0));
      for (const { joints, weights } of influences) {
        weighted = weighted.add((element(bones, joints.x) as Node<'mat4'>).mul(weights.x))
          .add((element(bones, joints.y) as Node<'mat4'>).mul(weights.y))
          .add((element(bones, joints.z) as Node<'mat4'>).mul(weights.z))
          .add((element(bones, joints.w) as Node<'mat4'>).mul(weights.w));
      }
      deformation = weighted;
    } else if (instance) {
      deformation = world.mul(instance);
    }
    const scale = mesh.geometry.hasAttribute('_mmd_edge_scale') ? attribute('_mmd_edge_scale', 'float')
      : mesh.geometry.hasAttribute('_MMD_EDGE_SCALE') ? attribute('_MMD_EDGE_SCALE', 'float') : float(1);
    return outlineClip(positionLocal, normalLocal, view.mul(deformation), cameraProjectionMatrix, size, scale, viewport);
  })();
  // Raw encoded straight source; NoColorSpace target disables sRGB framebuffer blending.
  material.fragmentNode = Fn(() => {
    if (instanceDet) {
      If(instanceDet.equal(0).or(equal(float(frontFacing), float(instanceDet.greaterThan(0)))), () => { Discard(); });
    }
    return color;
  })();
  return { material, size, color, skinned, record, instancePalette, textures: [instancePalette?.map, skinPalette?.map].filter((t): t is DataTexture => !!t), instanceVersion: -1, geometry: mesh.geometry };
}

/** Base in linear light → encoded premultiplied destination → straight-alpha hulls → output resolve.
 * Intermediate attachments and depth resolve resources are owned by the effect. */
export class MMDOutlineEffect {
  enabled = true;
  private disposed = false;
  private readonly base = new RenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter });
  private readonly encoded = new RenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter });
  private readonly encode = new NodeMaterial();
  private readonly resolve = new NodeMaterial();
  private readonly quad = new QuadMesh(this.encode);
  private readonly viewport = uniform(new Vector2(1, 1));
  private readonly view = uniform(new Matrix4());
  private readonly cache = new Map<Mesh, Map<OutlineRecord, ReturnType<typeof createHull>>>();
  private readonly releases = new Map<Mesh, () => void>();
  private toneMapping: number = -1;
  constructor(private readonly renderer: WebGPURenderer) {
    this.base.depthTexture = new DepthTexture(1, 1);
    this.encoded.depthTexture = new DepthTexture(1, 1);
    this.base.samples = this.encoded.samples = renderer.samples;
    this.encoded.texture.colorSpace = NoColorSpace;
    for (const material of [this.encode, this.resolve]) {
      material.blending = NoBlending;
      material.depthTest = false;
      material.depthWrite = false;
      material.toneMapped = material.fog = false;
    }
    this.resolve.fragmentNode = Fn(() => {
      const c = texture(this.encoded.texture).toVar();
      const straight = c.rgb.div(c.a.max(1e-30));
      // Renderer output processing will unpremultiply, encode and premultiply once.
      return vec4((sRGBTransferEOTF(straight) as Node<'vec3'>).mul(c.a), c.a);
    })();
    this.encode.depthTest = this.encode.depthWrite = true;
    this.encode.depthFunc = AlwaysDepth;
    this.encode.depthNode = texture(this.base.depthTexture);
    // Carry retained base + hull depth back to the caller's destination.
    this.resolve.depthTest = this.resolve.depthWrite = true;
    this.resolve.depthFunc = AlwaysDepth;
    this.resolve.depthNode = texture(this.encoded.depthTexture!);
  }
  render(scene: Scene, camera: Camera) {
    if (this.disposed) throw new Error('MMDOutlineEffect has been disposed');
    const renderer = this.renderer;
    if (!this.enabled) { renderer.render(scene, camera); return; }
    if (!renderer.autoClear) throw new Error('MMDOutlineEffect requires autoClear=true (one complete base scene per render)');
    if (renderer.xr.isPresenting || renderer.logarithmicDepthBuffer || renderer.reversedDepthBuffer) throw new Error('MMDOutlineEffect: XR, logarithmic and reversed depth are unsupported');
    const destination = renderer.getRenderTarget();
    const vp = destination ? destination.viewport.clone().floor() : renderer.getViewport(new Vector4()).multiplyScalar(renderer.getPixelRatio()).floor();
    const width = vp.z, height = vp.w;
    if (width <= 0 || height <= 0) return;
    this.viewport.value.set(width, height);
    if (this.base.width !== width || this.base.height !== height) {
      this.base.setSize(width, height);
      this.encoded.setSize(width, height);
    }
    const baseToneMapping = destination ? NoToneMapping : renderer.toneMapping;
    if (this.toneMapping !== baseToneMapping) {
      this.encode.fragmentNode = renderOutput(texture(this.base.texture), baseToneMapping, SRGBColorSpace);
      this.encode.needsUpdate = true;
      this.toneMapping = baseToneMapping;
    }
    const scissorTest = renderer.getScissorTest();
    const previousHook = renderer.getRenderObjectFunction();
    const autoClear = renderer.autoClear, toneMapping = renderer.toneMapping;
    const background = scene.background, backgroundNode = scene.backgroundNode;
    const culled = new Map<Mesh, boolean>();
    try {
      renderer.setScissorTest(false);
      // Initialize the encoded attachment before copying retained base depth.
      renderer.setRenderTarget(this.encoded);
      renderer.clear(false, true, false);
      renderer.setRenderTarget(this.base);
      renderer.render(scene, camera);
      // Ignore camera scale, as required by core glTF camera coordinates.
      const p = new Vector3(), q = new Quaternion();
      camera.matrixWorld.decompose(p, q, new Vector3());
      this.view.value.compose(p, q, new Vector3(1, 1, 1)).invert();
      renderer.autoClear = false;
      renderer.toneMapping = NoToneMapping;
      renderer.setRenderObjectFunction(null);
      renderer.setRenderTarget(this.encoded);
      this.quad.material = this.encode;
      this.quad.render(renderer);
      scene.background = null;
      scene.backgroundNode = null;
      scene.traverse(object => {
        if (!(object as Mesh).isMesh || !getOutlineRecords(object as Mesh).length) return;
        const mesh = object as Mesh;
        culled.set(mesh, mesh.frustumCulled);
        mesh.frustumCulled = false; // Expansion precedes homogeneous clipping.
      });
      renderer.setRenderObjectFunction((object, scene, camera, geometry, source, group, lights, clipping) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh || !source.visible) return;
        for (const record of getOutlineRecords(mesh)) {
          if (record.materialIndex !== (group?.materialIndex ?? 0)) continue;
          validatePayload(record.payload);
          const m = record.payload, size = m.sizeFactor ?? 1, color = m.colorFactor ?? [0, 0, 0, 1];
          if (!Number.isFinite(Math.fround(size)) || Math.abs(size) > 1e8) throw new Error('MMD_materials_outline: unsupported numeric range for size');
          const alpha = record.getDiffuseAlpha(source);
          if (!Number.isFinite(alpha)) throw new Error('MMD_materials_outline: diffuse alpha must be finite');
          const scales = geometry.getAttribute('_mmd_edge_scale') ?? geometry.getAttribute('_MMD_EDGE_SCALE');
          let anyScale = !scales;
          if (scales) for (let i = 0; i < scales.count; i++) {
            const scale = scales.getX(i);
            if (!Number.isFinite(scale) || !Number.isFinite(Math.fround(size * scale)) || Math.abs(size * scale) > 1e8) throw new Error('MMD_materials_outline: unsupported numeric range');
            anyScale ||= scale !== 0;
          }
          if (size === 0 || color[3] <= 0 || alpha === 0 || !anyScale) continue;
          const skinned = (mesh as SkinnedMesh).isSkinnedMesh && geometry.hasAttribute('skinIndex') && geometry.hasAttribute('skinWeight');
          if (!skinned && mesh.matrixWorld.determinant() === 0) continue;
          const matrices = [...(skinned ? [] : mesh.matrixWorld.elements), ...this.view.value.elements, ...camera.projectionMatrix.elements];
          if (skinned) { (mesh as SkinnedMesh).skeleton.update(); matrices.push(...(mesh as SkinnedMesh).skeleton.boneMatrices!); }
          if ((mesh as InstancedMesh).isInstancedMesh) for (const x of (mesh as InstancedMesh).instanceMatrix.array) matrices.push(x);
          if (mesh.morphTargetInfluences?.some(x => !Number.isFinite(x) || Math.abs(x) > 1e4)) throw new Error('MMD_materials_outline: unsupported numeric range for morph weights');
          if (matrices.some(x => !Number.isFinite(x) || Math.abs(x) > 1e4)) throw new Error('MMD_materials_outline: unsupported numeric range for transform');
          let entries = this.cache.get(mesh);
          if (entries && [...entries.values()].some(entry => entry.geometry !== geometry)) {
            this.releases.get(mesh)!(); entries = undefined;
          }
          if (!entries) {
            entries = new Map(); this.cache.set(mesh, entries);
            const release = () => {
              for (const entry of this.cache.get(mesh)?.values() ?? []) { entry.material.dispose(); entry.textures.forEach(t => t.dispose()); }
              this.cache.delete(mesh); this.releases.delete(mesh);
              geometry.removeEventListener('dispose', release);
            };
            geometry.addEventListener('dispose', release); this.releases.set(mesh, release);
          }
          let entry = entries.get(record);
          if (!entry) { entry = createHull(mesh, record, this.viewport, this.view); entries.set(record, entry); }
          if (entry.instancePalette && entry.instanceVersion !== (mesh as InstancedMesh).instanceMatrix.version) {
            entry.instancePalette.data.set((mesh as InstancedMesh).instanceMatrix.array);
            entry.instancePalette.map.needsUpdate = true;
            entry.instanceVersion = (mesh as InstancedMesh).instanceMatrix.version;
          }
          entry.size.value = size;
          entry.color.value.fromArray(color.map(x => Math.min(1, Math.max(0, x))));
          // Core skin matrices already contain jointWorld * inverseBind; mesh M is ignored,
          // including the renderer's mesh determinant winding correction.
          const savedWorld = mesh.matrixWorld.clone();
          try {
            if (skinned) { (mesh as SkinnedMesh).skeleton.update(); mesh.matrixWorld.identity(); }
            renderer.renderObject(object, scene, camera, geometry, entry.material, group, lights, clipping, 'mmd-outline');
          } finally { if (skinned) mesh.matrixWorld.copy(savedWorld); }
        }
      });
      renderer.render(scene, camera);
      renderer.setRenderObjectFunction(null);
      renderer.setScissorTest(scissorTest);
      renderer.setRenderTarget(destination);
      this.quad.material = this.resolve;
      this.quad.render(renderer);
    } finally {
      renderer.setRenderObjectFunction(previousHook);
      renderer.setRenderTarget(destination);
      renderer.setScissorTest(scissorTest);
      renderer.autoClear = autoClear;
      renderer.toneMapping = toneMapping;
      scene.background = background;
      scene.backgroundNode = backgroundNode;
      for (const [mesh, value] of culled) mesh.frustumCulled = value;
    }
  }
  /** Release GPU materials for an unloaded subtree while continuing to use this effect. */
  release(root: Object3D) { root.traverse(object => { this.releases.get(object as Mesh)?.(); }); }
  dispose() {
    for (const release of [...this.releases.values()]) release();
    this.base.dispose(); this.encoded.dispose(); this.encode.dispose(); this.resolve.dispose();
    this.disposed = true;
  }
}
