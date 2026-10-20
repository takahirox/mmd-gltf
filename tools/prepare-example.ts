import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
await mkdir('public/gene-light', { recursive: true });
await io.write('public/gene-light/model.glb', document);
for (const name of ['README.md', 'README.ja.md']) await copyFile(`${directory}/${name}`, `public/gene-light/${name}`);
await copyFile('tools/gene-light-manifest.json', 'public/gene-light/source-manifest.json');
const bytes = await readFile('public/gene-light/model.glb');
await writeFile('public/gene-light/conversion.json', JSON.stringify({ sourceCommit: manifest.commit, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), warnings }, null, 2) + '\n');
console.log(`Generated ${bytes.length} byte Gene Light GLB. ${warnings.join('\n')}`);
