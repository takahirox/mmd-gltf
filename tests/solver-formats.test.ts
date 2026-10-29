/** Renderer-independent half of the Solver format/state matrix (Issue #54).
 * Real shader probes and both raster passes remain in solver-gpu.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Vector3, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { validateBytes, validateString } from 'gltf-validator';
import { MMDSolverPlugin } from '../packages/three-mmd-solver';
import { MMDQDEFPlugin, MMDQDEFExporterPlugin } from '../packages/three-mmd-qdef';
import { MMDSDEFExporterPlugin } from '../packages/three-mmd-sdef';
import { createVPDRig, parseVPD, bindVPD, applyVPD, resetVPD, MMDVPDExporterPlugin } from '../packages/three-mmd-vpd';
import { parseVMD, bindVMD, createVMDPlayer, MMDVMDPlugin, getVMDPlayers } from '../packages/three-mmd-vmd';
import { solverVertex } from './solver-oracle';

globalThis.ProgressEvent ??= class extends Event {} as unknown as typeof ProgressEvent;
// Texture-free synthetic exports need only Blob IO, not a canvas or a renderer.
globalThis.FileReader ??= class {
  result: ArrayBuffer | string | null = null;
  onloadend?: () => void;
  readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(b => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then(b => {
      this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
    });
  }
} as unknown as typeof FileReader;

async function input(directory: string, name: string): Promise<string | ArrayBuffer> {
  const bytes = await readFile(join(directory, name));
  if (name.endsWith('.glb')) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const json = JSON.parse(bytes.toString());
  for (const b of json.buffers ?? [])
    b.uri = `data:application/octet-stream;base64,${(await readFile(join(directory, b.uri))).toString('base64')}`;
  return JSON.stringify(json);
}

for (const mode of ['bdef', 'sdef', 'qdef'] as const)
  test(`solver ${mode}: all rigs × byte/GLB/glTF/applied exports × both motions/poses against scalar vertices`, async () => {
    for (const rig of ['box', 'wedge'] as const)
      for (const source of ['bytes', 'glb', 'gltf', 'export-glb', 'export-gltf'])
        for (const state of ['a', 'b', 'pose-a', 'pose-b']) {
          const label = `${mode}/${rig}/${source}/${state}`;
          const directory = `public/solver/${rig}-${mode}`;
          const id = state.endsWith('a') ? 'a' : 'b', posed = state.startsWith('pose-');
          let skinning!: MMDQDEFPlugin;
          const loader = new GLTFLoader()
            .register(p => new MMDSolverPlugin(p)).register(p => new MMDVMDPlugin(p))
            .register(p => skinning = new MMDQDEFPlugin(p));
          const motion = parseVMD(await readFile(`tests/fixtures/solver-${id}.vmd`));
          const pose = parseVPD(await readFile(`tests/fixtures/solver-${id}.vpd`), 'utf-8');
          const exported = source.startsWith('export-');
          let asset = await loader.parseAsync(await input(directory,
            source === 'bytes' || exported ? 'rest.glb' : `${state}.${source}`), '');
          if (exported) {
            const handle = createVPDRig(asset.scene);
            if (posed) applyVPD(handle, bindVPD(handle, pose));
            else {
              const player = createVMDPlayer(handle, bindVMD(handle, motion));
              player.seek(0.371); player.dispose();
            }
            const encoded = await new GLTFExporter()
              .register(w => new MMDVPDExporterPlugin(w))
              .register(w => new MMDSDEFExporterPlugin(w))
              .register(w => new MMDQDEFExporterPlugin(w))
              .parseAsync(asset.scene, { binary: source === 'export-glb', includeCustomExtensions: true });
            const report = encoded instanceof ArrayBuffer
              ? await validateBytes(new Uint8Array(encoded)) : await validateString(JSON.stringify(encoded));
            assert.equal(report.issues.numErrors, 0, `${label}: ${JSON.stringify(report.issues.messages)}`);
            skinning.dispose();
            asset = await loader.parseAsync(encoded instanceof ArrayBuffer ? encoded : JSON.stringify(encoded), '');
          }
          const handle = createVPDRig(asset.scene);
          const player = source === 'bytes' && !posed
            ? createVMDPlayer(handle, bindVMD(handle, motion)) : getVMDPlayers(asset)[0];
          const times = posed ? [0] : exported ? [0.371] : [0.371, 0.719, 0.371];
          for (const time of times) {
            if (posed && source === 'bytes') applyVPD(handle, bindVPD(handle, pose));
            else player?.seek(time);
            asset.scene.updateMatrixWorld(true);
            let primitives = 0;
            asset.scene.traverse(n => {
              const mesh = n as SkinnedMesh;
              if (!mesh.isSkinnedMesh) return;
              primitives++; mesh.skeleton.update();
              assert.equal(mesh.geometry.attributes.position.count, 24, label);
              for (let i = 0; i < 24; i++) {
                const expected = solverVertex(rig, id, posed || time < 0.5 || time >= 1, i, mode, !posed, false, false, time);
                const actual = mesh.getVertexPosition(i, new Vector3());
                assert.ok(actual.distanceTo(expected.p) <= 2e-6, `${label}/${time}/vertex${i}: ${actual.toArray()} != ${expected.p.toArray()}`);
              }
            });
            assert.equal(primitives, 1, label);
          }
          // Reapplying after reset must not accumulate an already resolved solve.
          resetVPD(handle);
          const reapplied: number[][] = [];
          for (let repeat = 0; repeat < 2; repeat++) {
            applyVPD(handle, bindVPD(handle, pose));
            asset.scene.traverse(n => {
              const mesh = n as SkinnedMesh;
              if (!mesh.isSkinnedMesh) return;
              for (let i = 0; i < 24; i++) {
                const actual = mesh.getVertexPosition(i, new Vector3()).toArray();
                if (repeat === 0) reapplied.push(actual);
                else actual.forEach((v, c) => assert.ok(Math.abs(v - reapplied[i][c]) <= 2e-6, `${label}/reapply/${i}`));
              }
            });
          }
          player?.dispose(); skinning.dispose();
        }
  });
