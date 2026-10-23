import { Vector3, type Object3D, type SkinnedMesh } from 'three/webgpu';

/** Bind by retained source index, never GLTFLoader's sanitized display names. */
export function setBDEFPreset(root: Object3D, deformed: boolean) {
  root.traverse(object => {
    const index = object.userData.pmxBone?.index;
    if (index === 0) object.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), deformed ? Math.PI / 2 : 0);
    if (index === 1) object.position.set(0.5, deformed ? 0.25 : 0, -1);
    if (index === 2) object.position.set(deformed ? -0.625 : -0.5, 0, -0.5);
    if (index === 259) object.position.set(deformed ? 0.25 : 0, 0.5, 0);
  });
  root.updateMatrixWorld(true);
  root.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) (object as SkinnedMesh).skeleton.update(); });
}
