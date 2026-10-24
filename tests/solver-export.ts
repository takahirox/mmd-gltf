import { Vector3, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MMDSolverPlugin, getSolverModel } from '../packages/three-mmd-solver';
import { MMDVPDExporterPlugin, createVPDRig, resetVPD, applyVPD, bindVPD, parseVPD } from '../packages/three-mmd-vpd';

/** Exercise the runtime-independent solver contract without converter extras. */
export async function runSolverExports(base: string) {
  const records: object[] = [];
  let maximumError = 0;
  const snapshot = (root: Object3D) => {
    root.updateMatrixWorld(true);
    const values: number[] = [];
    for (const node of getSolverModel(root)!.nodes.values())
      values.push(...node.position.toArray(), ...node.quaternion.toArray());
    root.traverse(n => {
      const mesh = n as SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        mesh.skeleton.update();
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++)
          values.push(...mesh.getVertexPosition(i, new Vector3()).toArray());
      }
    });
    return values;
  };
  const check = (actual: number[], expected: number[]) => {
    if (actual.length !== expected.length) throw new Error('Solver export lost joints or vertices');
    actual.forEach((v, i) => { maximumError = Math.max(maximumError, Math.abs(v - expected[i])); });
    if (!Number.isFinite(maximumError) || maximumError > 2e-6)
      throw new Error(`Solver export transform error: ${maximumError}`);
  };
  for (const shape of ['box', 'wedge']) {
    const url = `${base}solver/${shape}-bdef/rest.gltf`;
    const input = JSON.parse(JSON.stringify(await (await fetch(url)).json(), (key, value) => key === 'extras' ? undefined : value));
    for (const material of input.materials ?? []) delete material.extensions;
    input.extensionsUsed = ['MMD_skeleton_solver'];
    delete input.extensionsRequired;
    for (const buffer of input.buffers ?? []) {
      const bytes = new Uint8Array(await (await fetch(new URL(buffer.uri, new URL(url, location.href)))).arrayBuffer());
      buffer.uri = `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}`;
    }
    const json = JSON.stringify(input);
    records.push({ shape, format: 'gltf', state: 'input', json });
    const loader = new GLTFLoader().register(p => new MMDSolverPlugin(p));
    const asset = await loader.parseAsync(json, ''), rig = createVPDRig(asset.scene);
    resetVPD(rig);
    const rest = snapshot(asset.scene);
    const pose = parseVPD(new Uint8Array(await (await fetch(`${base}solver/solver-a.vpd`)).arrayBuffer()), 'utf-8');
    const originalRest = getSolverModel(asset.scene)!.profile.bones.map(({node, ...bone}) => bone);
    for (const state of ['reset', 'pose']) for (const binary of [true, false]) {
      if (state === 'reset') resetVPD(rig);
      else applyVPD(rig, bindVPD(rig, pose));
      const expected = snapshot(asset.scene);
      const encoded = await new GLTFExporter().register(w => new MMDVPDExporterPlugin(w))
        .parseAsync(asset.scene, { binary, includeCustomExtensions: true });
      records.push(encoded instanceof ArrayBuffer
        ? { shape, state, format: 'glb', bytes: Array.from(new Uint8Array(encoded)) }
        : { shape, state, format: 'gltf', json: JSON.stringify(encoded) });
      const reloaded = await loader.parseAsync(encoded instanceof ArrayBuffer ? encoded : JSON.stringify(encoded), '');
      check(snapshot(reloaded.scene), expected);
      const retainedRest = getSolverModel(reloaded.scene)!.profile.bones.map(({node, ...bone}) => bone);
      if (JSON.stringify(retainedRest) !== JSON.stringify(originalRest)) throw new Error('Solver export lost original rest');
      const handle = createVPDRig(reloaded.scene);
      if (state === 'pose') {
        const binding = bindVPD(handle, pose);
        applyVPD(handle, binding); check(snapshot(reloaded.scene), expected);
        applyVPD(handle, binding); check(snapshot(reloaded.scene), expected);
      }
      resetVPD(handle); check(snapshot(reloaded.scene), rest);
    }
  }
  return { records, maximumError };
}
