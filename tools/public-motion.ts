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

/** Keep the original downloadable expression asset. Body clips share byte-identical
 * static buffers and original external images; only fallback samples vary. */
export async function prepareBodyMotions(model: PMXModel, directory: string, output: string, extras: Record<string, unknown>) {
  const { convertModel } = await import('./pmx-to-gltf');
  const { writeFile } = await import('node:fs/promises');
  for (const id of ['02_laugh', '22_apology']) {
    const motion = await publicMotion(model, directory, `motion/${id}.vmd`);
    if (!motion.audit.bones.some(t=>t.status==='matched' && t.changing)) throw new Error(`${id}: no changing bound bone tracks`);
    const {document, io, warnings} = await convertModel(model, directory, {mode:'bdef',solver:'none',physics:'none',vmd:motion.bytes,vmdBinding:{morphTypes:[1]}});
    const {source,sourceManifest,attribution,rights,license,notices}=extras;
    document.getRoot().setExtras({...document.getRoot().getExtras(), source,sourceManifest,attribution,rights,license,notices,
      changes:`Original ${motion.path} retained byte-for-byte; BDEF skin and approximate core fallback. Raw bones and vertex expressions only; no IK, append/grant or physics. Unresolved names and unsupported morph families remain unexecuted. Source images shared unchanged.`,
    });
    for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives())
      for (const target of primitive.listTargets()) target.getAttribute('POSITION')?.setSparse(true);
    for (const texture of document.getRoot().listTextures()) texture.setURI(texture.getName().replaceAll('\\','/'));
    const animationBuffer=document.createBuffer('motion');
    for (const animation of document.getRoot().listAnimations()) for (const sampler of animation.listSamplers()) {
      sampler.getInput()!.setBuffer(animationBuffer); sampler.getOutput()!.setBuffer(animationBuffer);
    }
    const data=await io.writeJSON(document);
    const artifacts=[];
    for (const buffer of data.json.buffers ?? []) {
      const bytes=data.resources[buffer.uri!];
      const sha256=createHash('sha256').update(bytes).digest('hex');
      buffer.uri=`${sha256}.bin`;
      await writeFile(`${output}/${buffer.uri}`,bytes);
      artifacts.push({path:buffer.uri,bytes:bytes.length,sha256});
    }
    await writeFile(`${output}/${id}.gltf`,JSON.stringify(data.json));
    await writeFile(`${output}/motion-${id}.json`,JSON.stringify({...publicMotionMetadata(motion,document),artifact:`${id}.gltf`,artifacts,warnings},null,2)+'\n');
  }
}
