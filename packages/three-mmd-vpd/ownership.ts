import type { Object3D } from 'three';
// Normalize wrapper subtrees to the actual model container so independently created
// handles for the same skeleton share ownership as well.
const scopes = new WeakMap<Object3D, Object3D>();
function scope(root: Object3D) {
  let result = scopes.get(root);
  if (result) return result;
  const models: Object3D[] = [];
  root.traverse((n) => {
    if (n.userData.mmdPose) models.push(n);
  });
  result = models.length === 1 ? models[0] : root;
  scopes.set(root, result);
  return result;
}
const owners = new WeakMap<Object3D, { token: object; pause: () => void }>();
export function claimMotion(root: Object3D, token: object, pause: () => void) {
  const previous = owners.get(scope(root));
  if (previous?.token !== token) previous?.pause();
  owners.set(scope(root), { token, pause });
}
export function releaseMotion(root: Object3D, token?: object) {
  const previous = owners.get(scope(root));
  if (previous && (token === undefined || previous.token === token)) {
    previous.pause();
    owners.delete(scope(root));
  }
}
