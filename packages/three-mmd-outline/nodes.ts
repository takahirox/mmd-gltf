import type { Node } from 'three/webgpu';
import { Fn, If, vec2, vec3, vec4, mat3, determinant } from 'three/tsl';
/** The v0.1 equation. Also exercised directly against the independent numerical fixtures. */
export function outlineClip(position: Node<'vec3'>, normal: Node<'vec3'>, transform: Node<'mat4'>, projection: Node<'mat4'>, size: Node<'float'>, scale: Node<'float'>, viewport: Node<'vec2'>) {
  return Fn(() => {
    const c = projection.mul(transform.mul(vec4(position, 1))).toVar();
    const t = mat3(transform).toVar();
    const a = vec3(0).toVar();
    const x = t.mul(vec3(1, 0, 0)), y = t.mul(vec3(0, 1, 0)), z = t.mul(vec3(0, 0, 1));
    const magnitude = x.abs().max(y.abs()).max(z.abs()).toVar();
    const largest = magnitude.x.max(magnitude.y).max(magnitude.z);
    If(largest.greaterThan(0), () => { t.assign(mat3(x.div(largest), y.div(largest), z.div(largest))); });
    const det = determinant(t).toVar();
    If(det.notEqual(0), () => {
      const c0 = t.mul(vec3(1, 0, 0)), c1 = t.mul(vec3(0, 1, 0)), c2 = t.mul(vec3(0, 0, 1));
      // Normalizing inverse-transpose(T)*n equals normalizing cofactor(T)*n*sign(det).
      // Avoid division by a tiny determinant and squared-length overflow.
      a.assign(mat3(c1.cross(c2), c2.cross(c0), c0.cross(c1)).mul(normal).mul(det.lessThan(0).select(-1, 1)));
    });
    const n = vec3(0).toVar();
    const normalMagnitude = a.x.abs().max(a.y.abs()).max(a.z.abs());
    If(normalMagnitude.greaterThan(0), () => { n.assign(a.div(normalMagnitude).normalize()); });
    const direction = vec2(0).toVar();
    If(n.xy.length().greaterThan(1e-12), () => { direction.assign(n.xy.normalize()); });
    return vec4(c.xy.add(direction.mul(size).mul(scale).mul(2).mul(c.w).div(viewport)), c.zw);
  })();
}
