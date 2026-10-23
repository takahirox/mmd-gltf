import type { Object3D } from 'three';
// Bone and morph containers are siblings in converted models. Normalize both
// mesh-rooted and wrapper-rooted handles to the same per-instance bone container.
const scopes = new WeakMap<Object3D, Object3D>();
function scope(root: Object3D) {
  let result = scopes.get(root);
  if (result) return result;
  const models: Object3D[] = [], morphs: Object3D[] = [];
  root.traverse((n) => {
    if (n.userData.mmdPose) models.push(n);
    if (n.userData.pmxMorph) morphs.push(n);
  });
  result = models.length === 1 ? models[0] : root;
  if (!models.length && morphs.length === 1) {
    result = morphs[0];
    for (let ancestor = root.parent; ancestor; ancestor = ancestor.parent) {
      const matches: Object3D[] = [];
      ancestor.traverse(n => {
        if (n.userData.mmdPose?.modelId === morphs[0].userData.pmxMorph.modelId) matches.push(n);
      });
      if (matches.length) {
        if (matches.length === 1) result = matches[0];
        break;
      }
    }
  }
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
