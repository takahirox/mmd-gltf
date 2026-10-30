import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchUka } from './fetch-uka';
import { convertModel, parsePMX } from './pmx-to-gltf';
import { parseVMD } from '../packages/mmd-vmd';
import { inventoryUka } from './uka-inventory';
import manifest from './uka-manifest.json';
import { publicMotions, writePublicMotionMetadata } from './public-motion';

export const ukaAttribution = 'CG-CA Uka (c) 2023-2024 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society';
export async function prepareUka() {
  const directory = await fetchUka();
  const model = parsePMX(await readFile(`${directory}/MS_Uka.pmx`));
  const inventory = inventoryUka(model, parseVMD(await readFile(`${directory}/motion/03_smile.vmd`)));
  // No source filtering, altered solver limits, or model-specific converter path.
  const motions = await publicMotions(model, directory, '04_littlesmile');
  const { document, io, warnings } = await convertModel(model, directory, {mode:'bdef', solver:'none', physics:'none', vmds:motions.map(m=>({name:m.name,bytes:m.bytes})),vmdBinding:{morphTypes:[1]}});
  const changes = 'Unmodified PMX and three official VMDs converted with BDEF skin at 0.08 m/unit, exact retained VMD v6 and approximate core fallback. Downloadable animations are solver-free. Public preview optionally evaluates the six source sleeve IK chains symmetrically after raw bones and vertex expressions; no foot IK, grants or physics; active morph buffers and manual blink/smile keep original identities. Full conversion retains all supported vertex/group/bone morph data. Material/UV morphs, unresolved names and VMD scene controls are not executed. Source textures unchanged; preview limited to 1024 px.';
  document.getRoot().setExtras({...document.getRoot().getExtras(),
    source:`https://github.com/${manifest.repository}/tree/${manifest.commit}`, sourceManifest:manifest,
    attribution:ukaAttribution, license:'CC BY 4.0',
    notices:['README.md','README.ja.md'], rights:'CC BY 4.0; preserve attribution, source and change notice. Original usage guidelines apply; see both accompanying READMEs. No endorsement implied.', changes,
  });
  // Standard lossless sparse serialization avoids writing zeros for every
  // vertex of every facial target. The converter model and target data are unchanged.
  for (const mesh of document.getRoot().listMeshes())
    for (const primitive of mesh.listPrimitives())
      for (const target of primitive.listTargets()) target.getAttribute('POSITION')?.setSparse(true);
  // External images are the exact allowlisted source files, shared by both views.
  for (const texture of document.getRoot().listTextures()) texture.setURI(texture.getName().replaceAll('\\','/'));
  await rm('public/uka',{recursive:true,force:true});
  await mkdir('public/uka',{recursive:true});
  await io.write('public/uka/model.gltf',document);
  await writePublicMotionMetadata(motions, document, 'public/uka');
  for (const {path} of manifest.files) {
    await mkdir(dirname(`public/uka/${path}`),{recursive:true});
    await copyFile(`${directory}/${path}`,`public/uka/${path}`);
  }
  await copyFile('tools/uka-manifest.json','public/uka/source-manifest.json');
  await writeFile('public/uka/inventory.json',JSON.stringify(inventory,null,2)+'\n');
  const artifacts = [];
  for (const path of ['model.gltf','model.bin']) {
    const bytes=await readFile(`public/uka/${path}`);
    artifacts.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  await writeFile('public/uka/conversion.json',JSON.stringify({sourceCommit:manifest.commit,attribution:ukaAttribution,changes,mode:'bdef',metersPerPMXUnit:.08,artifacts,warnings},null,2)+'\n');
  console.log('Generated Uka glTF with shared source textures:',artifacts);
}
