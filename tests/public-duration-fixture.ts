import { Format } from '@gltf-transform/core';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parsePMX, convertModel } from '../tools/pmx-to-gltf';
import { auditMotion } from '../tools/audit-public-motions';
import { publicMotionMetadata } from '../tools/public-motion';
import { parseVMD } from '../packages/mmd-vmd';
import { durationVMD } from './duration-fixture';

/** Test routes replace both source and conversion together; production validation stays intact. */
export async function publicDurationFixture() {
  const model=parsePMX(await readFile('public/uka/MS_Uka.pmx'));
  const motions=[['04_littlesmile',91],['02_laugh',1],['22_apology',0]] as const;
  const sources=motions.map(([name,frame])=>({name,bytes:durationVMD(frame)}));
  const {document,io}=await convertModel(model,'public/uka',{
    mode:'bdef',solver:'none',physics:'none',vmds:sources,vmdBinding:{morphTypes:[1]},
  });
  const original=JSON.parse(await readFile('public/uka/model.gltf','utf8'));
  document.getRoot().setExtras({...document.getRoot().getExtras(),publicPhysics:original.extras.publicPhysics});
  for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives())
    for(const target of primitive.listTargets())target.getAttribute('POSITION')?.setSparse(true);
  const files=new Map<string,Buffer>();
  const metadata=sources.map(({name,bytes},i)=>{
    const audit=auditMotion(model,parseVMD(bytes)),path=`motion/${name}.vmd`;
    const motion={bytes,audit,path,sha256:createHash('sha256').update(bytes).digest('hex'),active:audit.morphs.filter(t=>t.active && t.status==='matched' && t.type===1)};
    const metadata={...publicMotionMetadata(motion,document),animation:name};
    files.set(`${i===0?'motion':`motion-${name}`}.json`,Buffer.from(JSON.stringify(metadata)));
    files.set(path,bytes);return metadata;
  });
  // Keep original images external, as the public Uka asset does. A huge embedded
  // GLB would exceed Chromium's DevTools route-message limit before loading.
  for(const texture of document.getRoot().listTextures())texture.setURI(texture.getName().replaceAll('\\','/'));
  const asset=await io.writeJSON(document,{format:Format.GLTF,basename:'duration'});
  files.set('model.gltf',Buffer.from(JSON.stringify(asset.json)));
  for(const buffer of asset.json.buffers ?? [])files.set(buffer.uri!,Buffer.from(asset.resources[buffer.uri!]));
  return {files,metadata};
}


const output=process.argv[2];
if(output) {
  const {files,metadata}=await publicDurationFixture();
  await mkdir(`${output}/motion`,{recursive:true});
  for(const [path,body] of files)await writeFile(`${output}/${path}`,body);
  await writeFile(`${output}/metadata.json`,JSON.stringify({metadata,paths:[...files.keys()]}));
}
