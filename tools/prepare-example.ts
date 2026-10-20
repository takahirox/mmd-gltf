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
  changes: 'Static base-pose PMX converted to glTF geometry and MMD_materials_toon; independent core PBR approximation; source textures unchanged. No animation, morphs, physics, or outlines.',
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
