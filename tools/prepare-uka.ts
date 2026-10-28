import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchUka } from './fetch-uka';
import { convertModel, parsePMX } from './pmx-to-gltf';
import { parseVMD } from '../packages/mmd-vmd';
import { inventoryUka } from './uka-inventory';
import manifest from './uka-manifest.json';

export const ukaAttribution = 'CG-CA Uka (c) 2023-2024 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society';
export async function prepareUka() {
  const directory = await fetchUka();
  const model = parsePMX(await readFile(`${directory}/MS_Uka.pmx`));
  const inventory = inventoryUka(model, parseVMD(await readFile(`${directory}/motion/03_smile.vmd`)));
  // No source filtering, altered solver limits, or model-specific converter path.
  const { document, io, warnings } = await convertModel(model, directory, {mode:'bdef'});
  const changes = 'Unmodified PMX parsed and converted with normal BDEF mode at 0.08 m/unit; reflected Z/winding, core PBR approximation, Toon/Outline, 302 joints, supported vertex/group/bone morph data. No IK/append/physics or VMD execution. Unsupported material morphs and dependent group omitted with converter diagnostics; authored normals retained. Demo exposes only blink/smile vertex targets to bound GPU memory; all supported targets remain in the downloadable glTF. POSITION morph deltas serialized losslessly as standard sparse accessors. Preview textures resized to at most 1024 px on both views; source texture bytes unchanged and shared with PMX reference.';
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
