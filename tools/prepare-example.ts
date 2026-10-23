import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchGene } from './fetch-gene';
import { convertModel, parsePMX } from './pmx-to-gltf';
import manifest from './gene-light-manifest.json';

const directory = await fetchGene();
const { document, io, warnings } = await convertModel(parsePMX(await readFile(`${directory}/Gene_light.pmx`)), directory);
document.getRoot().setExtras({ ...document.getRoot().getExtras(),
  source: `https://github.com/${manifest.repository}/tree/${manifest.commit}`,
  sourceManifest: manifest,
  attribution: 'CG-CA Gene (c) 2023 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society',
  rights: 'CC BY 4.0 plus original usage guidelines and retained trademark/design rights. Academic/personal noncommercial use; contact authors for other commercial use. See accompanying English/Japanese notices.',
  changes: 'Static base-pose PMX converted to glTF geometry and MMD_materials_toon and MMD_materials_outline; independent core PBR approximation; source textures unchanged. No animation, morphs or physics.',
});
// Rebuild the reviewed allowlist; stale/private files must never survive packaging.
await rm('public/gene-light', { recursive: true, force: true });
await mkdir('public/gene-light', { recursive: true });
await io.write('public/gene-light/model.glb', document);
for (const { path } of manifest.files) {
  await mkdir(dirname(`public/gene-light/${path}`), { recursive: true });
  await copyFile(`${directory}/${path}`, `public/gene-light/${path}`);
}
await copyFile('tools/gene-light-manifest.json', 'public/gene-light/source-manifest.json');
const bytes = await readFile('public/gene-light/model.glb');
await writeFile('public/gene-light/conversion.json', JSON.stringify({ sourceCommit: manifest.commit, metersPerPMXUnit: 0.08, reference: 'Unchanged Gene_light.pmx and ten original PNGs; see source-manifest.json for byte hashes.', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), warnings }, null, 2) + '\n');
console.log(`Generated ${bytes.length} byte Gene Light GLB. ${warnings.join('\n')}`);

// The rig goes through the same binary parser and converter API as user models.
const rigSource = await readFile('tests/fixtures/bdef.pmx');
const rig = await convertModel(parsePMX(rigSource), '.', { mode: 'bdef', scale: 0.5 });
rig.document.getRoot().setExtras({ ...rig.document.getRoot().getExtras(),
  attribution: 'Original synthetic BDEF conformance fixture by mmd-gltf contributors; no third-party model assets.',
  changes: 'PMX parent hierarchy and BDEF1/2/4 to core glTF. No VPD/VMD playback or original-MMD equivalence.',
});
await rm('public/bdef', { recursive: true, force: true });
await mkdir('public/bdef', { recursive: true });
await copyFile('tests/fixtures/bdef.pmx', 'public/bdef/source.pmx');
await rig.io.write('public/bdef/model.glb', rig.document);
const rigBytes = await readFile('public/bdef/model.glb');
await writeFile('public/bdef/conversion.json', JSON.stringify({ mode: 'bdef', metersPerPMXUnit: 0.5,
  attribution: rig.document.getRoot().getExtras().attribution,
  source: { path: 'source.pmx', sha256: createHash('sha256').update(rigSource).digest('hex') },
  bytes: rigBytes.length, sha256: createHash('sha256').update(rigBytes).digest('hex'), warnings: rig.warnings,
}, null, 2) + '\n');
console.log(`Generated ${rigBytes.length} byte synthetic BDEF GLB.`);

// Two original solver-free rigs × two attributed byte poses, including posed reloads.
await rm('public/vpd', { recursive: true, force: true });
await mkdir('public/vpd', { recursive: true });
for (const pose of ['a', 'b']) for (const suffix of ['.vpd', '-map.json']) await copyFile(`tests/fixtures/pose-${pose}${suffix}`, `public/vpd/pose-${pose}${suffix}`);
const poseEvidence: object[] = [];
for (const [name, source, scale] of [['box', 'bdef.pmx', 0.2], ['wedge', 'vpd-wedge.pmx', 0.125]] as const) {
  const output = `public/vpd/${name}`;
  await mkdir(output, { recursive: true });
  await copyFile(`tests/fixtures/${source}`, `${output}/source.pmx`);
  for (const pose of ['rest', 'a', 'b'] as const) {
    const vpd = pose === 'rest' ? undefined : await readFile(`tests/fixtures/pose-${pose}.vpd`);
    const mapping = pose === 'rest' ? undefined : JSON.parse(await readFile(`tests/fixtures/pose-${pose}-map.json`, 'utf8'));
    const result = await convertModel(parsePMX(await readFile(`tests/fixtures/${source}`)), '.', {
      mode: 'bdef', scale, vpd, vpdEncoding: pose === 'b' ? 'utf-8' : 'shift_jis', vpdBinding: { mapping },
    });
    result.document.getRoot().setExtras({ ...result.document.getRoot().getExtras(),
      attribution: 'Original synthetic PMX geometry/rig and VPD poses by mmd-gltf contributors, Issues #25/#27; authored in this repository. No third-party assets.',
      changes: 'Solver-free VPD bone offsets resolved into core joint transforms; original inverse binds and rest metadata retained. No original-MMD parity claim.',
    });
    for (const extension of ['glb', 'gltf']) await result.io.write(`${output}/${pose}.${extension}`, result.document);
    const data = await readFile(`${output}/${pose}.glb`);
    poseEvidence.push({ rig: name, pose, scale, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), warnings: result.warnings });
  }
}
await writeFile('public/vpd/conversion.json', JSON.stringify({ attribution: 'Original synthetic assets by mmd-gltf contributors; authored in this repository.', cases: poseEvidence }, null, 2) + '\n');
console.log('Generated two VPD rigs × rest/two poses in GLB and unpacked glTF.');
