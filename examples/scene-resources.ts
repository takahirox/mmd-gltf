import { type Object3D, type Mesh, type Material, type Texture, type SkinnedMesh } from 'three';

/** Release application-owned loader resources, including shared texture/skeleton instances. */
export function disposeScene(root: Object3D) {
  const geometries = new Set<Mesh['geometry']>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const skeletons = new Set<SkinnedMesh['skeleton']>();
  root.traverse(object => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
  });
  skeletons.forEach(value => value.dispose());
  geometries.forEach(value => value.dispose());
  materials.forEach(value => value.dispose());
  textures.forEach(value => value.dispose());
}
