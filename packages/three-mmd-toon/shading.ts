import { MeshBasicNodeMaterial, DoubleSide, FrontSide, type Texture, type Node } from 'three/webgpu';
import { Fn, If, Discard, vec2, vec3, vec4, float, texture, uv, normalView, positionViewDirection, cameraViewMatrix, uniform, sRGBTransferEOTF } from 'three/tsl';
import { Vector3 } from 'three';
import { baseUVSet, validatePayload, type ToonPayload } from './payload';

/** Explicit source-component directional light adapter. Direction points toward the light, in world space. */
export function createToonLighting(direction = new Vector3(0, 0, 1), rgb = new Vector3(1, 1, 1)) {
  if (!direction.toArray().every(Number.isFinite) || direction.lengthSq() === 0) throw new Error('Invalid light direction');
  if (!rgb.toArray().every((v) => Number.isFinite(v) && v >= 0)) throw new Error('Invalid source-component light RGB');
  return { direction: uniform(direction.clone().normalize()), rgb: uniform(rgb.clone()) };
}
export type ToonLighting = ReturnType<typeof createToonLighting>;
export interface MaterialState { alphaMode?: string; alphaCutoff?: number; doubleSided?: boolean; name?: string }
export interface ToonTextures { base?: Texture; sphere?: Texture; toon?: Texture }
// Overrides permit conformance tests to feed the real production graph independent, exact directions/UVs.
export interface ShadingInputs {
  normal?: Node<'vec3'>;
  light?: Node<'vec3'>;
  view?: Node<'vec3'>;
  normalView?: Node<'vec3'>;
  baseUV?: Node<'vec2'>;
  uv1?: Node<'vec2'>;
}

export function createToonMaterial(m: ToonPayload, state: MaterialState, maps: ToonTextures, lighting: ToonLighting, inputs: ShadingInputs = {}) {
  validatePayload(m);
  if (m.baseTexture && !maps.base || m.sphereTexture && !maps.sphere || (m.toonTexture || m.sharedToonIndex !== undefined) && !maps.toon) throw new Error('Missing MMD texture resource');
  if (!['OPAQUE', 'MASK', 'BLEND'].includes(state.alphaMode ?? 'OPAQUE')) throw new Error('Invalid alphaMode');
  if (state.alphaCutoff !== undefined && (!Number.isFinite(state.alphaCutoff) || state.alphaCutoff < 0)) throw new Error('Invalid alphaCutoff');
  const material = new MeshBasicNodeMaterial();
  material.name = state.name ?? '';
  material.side = state.doubleSided ? DoubleSide : FrontSide;
  material.transparent = state.alphaMode === 'BLEND';
  material.depthWrite = !material.transparent;
  material.toneMapped = false;
  material.fog = false;
  material.vertexColors = false;
  // fragmentNode bypasses built-in PBR/basic lighting and its alpha-test equality rule.
  material.fragmentNode = Fn(() => {
    const d = m.diffuseFactor ?? [1, 1, 1, 1];
    const a = m.ambientFactor ?? [0, 0, 0];
    const p = m.specularFactor ?? [0, 0, 0];
    const n = inputs.normal ?? normalView;
    const nv = inputs.normalView ?? normalView;
    const l = inputs.light ?? cameraViewMatrix.mul(vec4(lighting.direction, 0)).xyz.normalize();
    const v = inputs.view ?? positionViewDirection;
    let baseUV: Node<'vec2'> = inputs.baseUV ?? uv(baseUVSet(m));
    const transform = m.baseTexture?.extensions?.KHR_texture_transform;
    if (transform) {
      const scaled = baseUV.mul(vec2(...(transform.scale ?? [1, 1]) as [number, number]));
      const c = Math.cos(transform.rotation ?? 0), s = Math.sin(transform.rotation ?? 0);
      baseUV = vec2(scaled.x.mul(c).sub(scaled.y.mul(s)), scaled.x.mul(s).add(scaled.y.mul(c)))
        .add(vec2(...(transform.offset ?? [0, 0]) as [number, number]));
    }
    const t = maps.base ? texture(maps.base, baseUV) : vec4(1);
    const surface = vec3(...d.slice(0, 3) as [number, number, number]).mul(lighting.rgb)
      .add(vec3(...a as [number, number, number])).clamp(0, 1).mul(t.rgb).toVar();
    const alpha = float(d[3]).mul(t.a).toVar();
    if (m.sphereMode && m.sphereMode !== 'none') {
      const sphereUV = m.sphereMode === 'subTexture' ? inputs.uv1 ?? uv(1)
        : vec2(nv.x.mul(0.5).add(0.5), nv.y.mul(-0.5).add(0.5));
      const s = texture(maps.sphere!, sphereUV);
      if (m.sphereMode === 'add') surface.addAssign(s.rgb);
      else surface.mulAssign(s.rgb);
      if (m.sphereMode === 'subTexture') alpha.mulAssign(s.a);
    }
    if (maps.toon) surface.mulAssign(texture(maps.toon, vec2(0, n.dot(l).add(0.5).clamp(0, 1))).rgb);
    const spec = vec3(0).toVar();
    if ((m.shininessFactor ?? 0) > 0) {
      const sum = l.add(v).toVar();
      If(sum.dot(sum).greaterThan(0), () => {
        spec.assign(vec3(...p as [number, number, number]).mul(lighting.rgb)
          .mul(n.dot(sum.normalize()).max(0).pow(m.shininessFactor!)));
      });
    }
    const rgb = surface.add(spec).clamp(0, 1);
    const finalAlpha = alpha.clamp(0, 1);
    if (state.alphaMode === 'MASK') If(finalAlpha.lessThan(state.alphaCutoff ?? 0.5), () => { Discard(); });
    // Only the FINAL encoded result is decoded. Renderer applies the output transfer once.
    // Texture views use NoColorSpace, keeping filtering/mipmap arithmetic on encoded components.
    return vec4(sRGBTransferEOTF(rgb) as Node<'vec3'>, state.alphaMode === 'BLEND' ? finalAlpha : float(1));
  })();
  return material;
}
