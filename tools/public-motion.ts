import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { auditMotion } from './audit-public-motions';
import { parseVMD } from '../packages/mmd-vmd';
import type { PMXModel } from './pmx-to-gltf';
import type { Document } from '@gltf-transform/core';

export async function publicMotion(model: PMXModel, directory: string, path: string) {
  const bytes = await readFile(`${directory}/${path}`);
  const audit = auditMotion(model,parseVMD(bytes));
  const active = audit.morphs.filter(t=>t.active && t.status==='matched' && t.type===1);
  if (!active.length) throw new Error(`${path}: no active vertex expression tracks`);
  // Source is never filtered: both renderers explicitly execute vertex morphs only.
  return { bytes, audit, path, sha256:createHash('sha256').update(bytes).digest('hex'), active };
}
export function publicMotionMetadata(motion: Awaited<ReturnType<typeof publicMotion>>, document: Document) {
  const node=document.getRoot().listNodes().find(n=>n.getExtras().pmxMorph);
  const morphs=(node!.getExtras().pmxMorph as {morphs:{index:number;target:number|null}[]}).morphs;
  const previewNames = new Set([...motion.active.map(t=>t.name),'まばたき','笑い']);
  const extras=document.getRoot().getExtras();
  return { source:extras.source, attribution:extras.attribution, rights:extras.rights, license:extras.license,
    notices:['README.md','README.ja.md'], path:motion.path,sha256:motion.sha256,bytes:motion.bytes.length,duration:motion.audit.duration,
    policy:'Unique terminated exact names; unresolved tracks retained without execution. Raw bones and vertex expressions; no IK, grant, physics, material/group/bone/UV morph or visibility execution.',
    bones:motion.audit.bones,morphs:motion.audit.morphs,
    omittedActiveMorphs:motion.audit.morphs.filter(t=>t.active && (t.status!=='matched' || t.type!==1)),
    preview:motion.audit.morphs.filter(t=>t.status==='matched' && t.type===1 && previewNames.has(t.name)).map(t=>({name:t.name!,sourceIndex:t.matches[0],target:morphs.find(m=>m.index===t.matches[0])!.target!})),
  };
}

/** Build all motions against the same converted skeleton; no per-motion models. */
export async function publicMotions(model: PMXModel, directory: string, sample: string) {
  return Promise.all([sample, '02_laugh', '22_apology'].map(async name => {
    const motion=await publicMotion(model, directory, `motion/${name}.vmd`);
    if(name!==sample && !motion.audit.bones.some(t=>t.status==='matched' && t.changing))throw new Error(`${name}: no changing bound bone tracks`);
    return {name,...motion};
  }));
}
export async function writePublicMotionMetadata(motions: Awaited<ReturnType<typeof publicMotions>>, document: Document, output: string) {
  const { writeFile } = await import('node:fs/promises');
  for (const [index, motion] of motions.entries()) await writeFile(
    `${output}/${index===0?'motion':`motion-${motion.name}`}.json`,
    JSON.stringify({...publicMotionMetadata(motion,document),animation:motion.name},null,2)+'\n');
}
