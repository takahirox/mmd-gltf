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
