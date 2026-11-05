import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Run the normal tsx converter in a temporary directory, outside Playwright's TS loader. */
export async function publicDurationFixture() {
  const directory=await mkdtemp(join(tmpdir(),'mmd-duration-'));
  try {
    await promisify(execFile)(process.execPath,['--import','tsx','tests/public-duration-fixture.ts',directory]);
    const {metadata,paths}=JSON.parse(await readFile(`${directory}/metadata.json`,'utf8')) as {metadata:{animation:string;duration:number;sha256:string;bytes:number;path:string}[];paths:string[]};
    const files=new Map<string,Buffer>();
    for(const path of paths)
      files.set(path,await readFile(`${directory}/${path}`));
    return {files,metadata};
  } finally {await rm(directory,{recursive:true,force:true});}
}
