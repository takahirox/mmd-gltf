import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WASM_BACKEND } from '../packages/three-mmd-physics/ammo';

/** Same Bullet source revision as the retained JavaScript reference backend. */
export async function prepareAmmo() {
  await mkdir('.cache/ammo', {recursive:true});
  await mkdir('public/runtime', {recursive:true});
  for (const [name,hash,output] of [
    ['ammo.wasm.js',WASM_BACKEND.scriptSHA256,'ammo.js'],
    ['ammo.wasm.wasm',WASM_BACKEND.binarySHA256,'ammo.wasm.wasm'],
  ]) {
    const cached=`.cache/ammo/${name}`;
    let bytes:Buffer;
    try {bytes=await readFile(cached);}
    catch(error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      const response=await fetch(`https://raw.githubusercontent.com/kripken/ammo.js/${WASM_BACKEND.commit}/builds/${name}`,{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error(`${name}: HTTP ${response.status}`);
      bytes=Buffer.from(await response.arrayBuffer());
    }
    if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error(`${name}: pinned Ammo Wasm hash mismatch`);
    await writeFile(cached,bytes);
    await writeFile(`public/runtime/${output}`,bytes);
  }
}
