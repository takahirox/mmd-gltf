import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import manifest from './gene-light-manifest.json';

export const sourceDirectory = resolve('.cache/gene-light');
export async function fetchGene() {
  for (const file of manifest.files) {
    const target = resolve(sourceDirectory, file.path);
    let bytes: Buffer;
    try { bytes = await readFile(target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const response = await fetch(`https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/${file.path}`);
      if (!response.ok) throw new Error(`${file.path}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== file.size || hash !== file.sha256) throw new Error(`${file.path}: pinned asset hash/size mismatch`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  console.log(`Verified ${manifest.files.length} Gene Light source files at ${manifest.commit}`);
  return sourceDirectory;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  fetchGene().catch((error) => { console.error(error); process.exitCode = 1; });
}
