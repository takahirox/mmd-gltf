import { publicMotions, writePublicMotionMetadata } from './public-motion';
import { prepareUka } from './prepare-uka';
import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fetchGene } from './fetch-gene';
import { convertModel, parsePMX } from './pmx-to-gltf';
import manifest from './gene-light-manifest.json';
import { groupPMX } from './synthetic-group';

await prepareUka();

const directory = await fetchGene();
const model = parsePMX(await readFile(`${directory}/Gene_light.pmx`));
const motions = await publicMotions(model, directory, '01_happy');
const { document, io, warnings } = await convertModel(model, directory, {mode:'bdef', solver:'none', physics:'none', vmds:motions.map(m=>({name:m.name,bytes:m.bytes})),vmdBinding:{morphTypes:[1]}});
document.getRoot().setExtras({ ...document.getRoot().getExtras(),
  source: `https://github.com/${manifest.repository}/tree/${manifest.commit}`,
  sourceManifest: manifest,
  attribution: 'CG-CA Gene (c) 2023 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society',
  license: 'CC BY 4.0', notices: ['README.md','README.ja.md'],
  rights: 'CC BY 4.0 plus original usage guidelines and retained trademark/design rights. Academic/personal noncommercial use; contact authors for other commercial use. See accompanying English/Japanese notices.',
  changes: 'BDEF skinned PMX with three original official VMDs, exact retained VMD v6 and approximate core fallback converted to glTF geometry and MMD_materials_toon and MMD_materials_outline; independent core PBR approximation; source textures unchanged. All supported targets retained; public preview uploads only active vertex expressions. Gene preview IK is unavailable for all six chains because controller 38 depends on append bone 35; no IK/grant/physics, material/UV morph or visibility execution. Original textures unchanged.',
});
// Rebuild the reviewed allowlist; stale/private files must never survive packaging.
await rm('public/gene-light', { recursive: true, force: true });
await mkdir('public/gene-light', { recursive: true });
// Lossless sparse POSITION targets preserve complete downloads without dense zero padding.
for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives())
  for (const target of primitive.listTargets()) target.getAttribute('POSITION')?.setSparse(true);
await io.write('public/gene-light/model.glb', document);
await writePublicMotionMetadata(motions, document, 'public/gene-light');
for (const { path } of manifest.files) {
  await mkdir(dirname(`public/gene-light/${path}`), { recursive: true });
  await copyFile(`${directory}/${path}`, `public/gene-light/${path}`);
}
await copyFile('tools/gene-light-manifest.json', 'public/gene-light/source-manifest.json');
const bytes = await readFile('public/gene-light/model.glb');
await writeFile('public/gene-light/conversion.json', JSON.stringify({ sourceCommit: manifest.commit, metersPerPMXUnit: 0.08, reference: 'Unchanged Gene_light.pmx and ten original PNGs; see source-manifest.json for byte hashes.', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), warnings }, null, 2) + '\n');
console.log(`Generated ${bytes.length} byte Gene Light GLB. ${warnings.join('\n')}`);

// The rig goes through the same binary parser and converter API as user models.
const rigSource = await readFile('tests/fixtures/bdef.pmx');
const rig = await convertModel(parsePMX(rigSource), '.', { mode: 'bdef', scale: 0.5 });
rig.document.getRoot().setExtras({ ...rig.document.getRoot().getExtras(),
  attribution: 'Original synthetic BDEF conformance fixture by mmd-gltf contributors; no third-party model assets.',
  changes: 'PMX parent hierarchy and BDEF1/2/4 to core glTF. No VPD/VMD playback or original-MMD equivalence.',
});
await rm('public/bdef', { recursive: true, force: true });
await mkdir('public/bdef', { recursive: true });
await copyFile('tests/fixtures/bdef.pmx', 'public/bdef/source.pmx');
await rig.io.write('public/bdef/model.glb', rig.document);
const rigBytes = await readFile('public/bdef/model.glb');
await writeFile('public/bdef/conversion.json', JSON.stringify({ mode: 'bdef', metersPerPMXUnit: 0.5,
  attribution: rig.document.getRoot().getExtras().attribution,
  source: { path: 'source.pmx', sha256: createHash('sha256').update(rigSource).digest('hex') },
  bytes: rigBytes.length, sha256: createHash('sha256').update(rigBytes).digest('hex'), warnings: rig.warnings,
}, null, 2) + '\n');
console.log(`Generated ${rigBytes.length} byte synthetic BDEF GLB.`);

// Two original solver-free rigs × two attributed byte poses, including posed reloads.
await rm('public/vpd', { recursive: true, force: true });
await mkdir('public/vpd', { recursive: true });
for (const pose of ['a', 'b']) for (const suffix of ['.vpd', '-map.json']) await copyFile(`tests/fixtures/pose-${pose}${suffix}`, `public/vpd/pose-${pose}${suffix}`);
const poseEvidence: object[] = [];
for (const [name, source, scale] of [['box', 'bdef.pmx', 0.2], ['wedge', 'vpd-wedge.pmx', 0.125]] as const) {
  const output = `public/vpd/${name}`;
  await mkdir(output, { recursive: true });
  await copyFile(`tests/fixtures/${source}`, `${output}/source.pmx`);
  for (const pose of ['rest', 'a', 'b'] as const) {
    const vpd = pose === 'rest' ? undefined : await readFile(`tests/fixtures/pose-${pose}.vpd`);
    const mapping = pose === 'rest' ? undefined : JSON.parse(await readFile(`tests/fixtures/pose-${pose}-map.json`, 'utf8'));
    const result = await convertModel(parsePMX(await readFile(`tests/fixtures/${source}`)), '.', {
      mode: 'bdef', scale, vpd, vpdEncoding: pose === 'b' ? 'utf-8' : 'shift_jis', vpdBinding: { mapping },
    });
    result.document.getRoot().setExtras({ ...result.document.getRoot().getExtras(),
      attribution: 'Original synthetic PMX geometry/rig and VPD poses by mmd-gltf contributors, Issues #25/#27; authored in this repository. No third-party assets.',
      changes: 'Solver-free VPD bone offsets resolved into core joint transforms; original inverse binds and rest metadata retained. No original-MMD parity claim.',
    });
    for (const extension of ['glb', 'gltf']) await result.io.write(`${output}/${pose}.${extension}`, result.document);
    const data = await readFile(`${output}/${pose}.glb`);
    poseEvidence.push({ rig: name, pose, scale, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), warnings: result.warnings });
  }
}
await writeFile('public/vpd/conversion.json', JSON.stringify({ attribution: 'Original synthetic assets by mmd-gltf contributors; authored in this repository.', cases: poseEvidence }, null, 2) + '\n');
console.log('Generated two VPD rigs × rest/two poses in GLB and unpacked glTF.');

// Original VMD byte fixtures and both GLB/unpacked glTF curve-preserving conversions.
await rm('public/vmd', { recursive: true, force: true });
await mkdir('public/vmd', { recursive: true });
const motionEvidence: object[] = [];
for (const motion of ['a','b']) for (const suffix of ['.vmd','-map.json']) await copyFile(`tests/fixtures/motion-${motion}${suffix}`,`public/vmd/motion-${motion}${suffix}`);
for (const [name,source,scale] of [['box','morph-box.pmx',0.2],['wedge','morph-wedge.pmx',0.125]] as const) {
  await mkdir(`public/vmd/${name}`,{recursive:true});
  for(const motion of ['a','b']) {
    const result=await convertModel(parsePMX(await readFile(`tests/fixtures/${source}`)),'.',{mode:'bdef',scale,vmd:await readFile(`tests/fixtures/motion-${motion}.vmd`),vmdBinding:{morphUnmatched:'ignore',mapping:JSON.parse(await readFile(`tests/fixtures/motion-${motion}-map.json`,'utf8'))}});
    result.document.getRoot().setExtras({...result.document.getRoot().getExtras(),attribution:'Original synthetic rigs and VMD motions by mmd-gltf contributors, Issue #29; no third-party assets.',changes:'Solver-free bone motion with retained curves and approximate core TRS fallback; original rest and binds retained. No original-MMD parity claim.'});
    for(const extension of ['glb','gltf']) await result.io.write(`public/vmd/${name}/${motion}.${extension}`,result.document);
    motionEvidence.push({rig:name,motion,scale,warnings:result.warnings,sha256:createHash('sha256').update(await readFile(`public/vmd/${name}/${motion}.glb`)).digest('hex')});
  }
}
await writeFile('public/vmd/conversion.json',JSON.stringify({attribution:'Original synthetic fixtures by mmd-gltf contributors; no third-party assets.',cases:motionEvidence},null,2)+'\n');
console.log('Generated two VMD motions × two rigs, retaining curves with approximate core TRS fallback.');

// Issue #31: attributed morph variants; legacy PMX and VMD files above remain byte-identical.
await rm('public/morph', {recursive:true,force:true});
await mkdir('public/morph', {recursive:true});
await copyFile('tests/fixtures/morph-map.json','public/morph/morph-map.json');
for (const motion of ['a','b']) {
  await copyFile(`tests/fixtures/combined-${motion}.vmd`,`public/morph/combined-${motion}.vmd`);
  await copyFile(`tests/fixtures/motion-${motion}-map.json`,`public/morph/motion-${motion}-map.json`);
}
await copyFile('tests/fixtures/morph-only.vmd','public/morph/morph-only.vmd');
const morphEvidence: object[] = [];
for (const [name,scale] of [['box',0.2],['wedge',0.125]] as const) {
  await mkdir(`public/morph/${name}`,{recursive:true});
  await copyFile(`tests/fixtures/morph-${name}.pmx`,`public/morph/${name}/source.pmx`);
  for (const motion of ['rest','a','b','only']) {
    const vmd=motion==='rest'?undefined:await readFile(`tests/fixtures/${motion==='only'?'morph-only':`combined-${motion}`}.vmd`);
    const mapping=motion==='rest'||motion==='only'?undefined:JSON.parse(await readFile(`tests/fixtures/motion-${motion}-map.json`,'utf8'));
    const result=await convertModel(parsePMX(await readFile(`tests/fixtures/morph-${name}.pmx`)),'.',{
      mode:'bdef',scale,vmd,vmdBinding:{mapping,morphMapping:JSON.parse(await readFile('tests/fixtures/morph-map.json','utf8'))},
      vmdSampling:{translationTolerance:2e-8,rotationTolerance:2e-7},
    });
    result.document.getRoot().setExtras({...result.document.getRoot().getExtras(),
      attribution:'Original synthetic morph variants by mmd-gltf contributors, Issue #31; no third-party assets.',
      changes:'Additive PMX vertex morphs, synchronized VMD bones and linear weights; authored normals retained. No original-MMD parity claim.',
    });
    for (const extension of ['glb','gltf']) await result.io.write(`public/morph/${name}/${motion}.${extension}`,result.document);
    morphEvidence.push({rig:name,motion,scale,warnings:result.warnings,sha256:createHash('sha256').update(await readFile(`public/morph/${name}/${motion}.glb`)).digest('hex')});
  }
}
await writeFile('public/morph/conversion.json',JSON.stringify({attribution:'Original synthetic Issue #31 fixtures by mmd-gltf contributors.',cases:morphEvidence},null,2)+'\n');
console.log('Generated morph variants of both rigs, combined motions and morph-only motion in GLB and unpacked glTF.');

// Issues #33/#37: mixed SDEF/QDEF variants retain both combined motions and both VPD poses.
for (const profile of ['sdef', 'qdef'] as const) {
  await rm(`public/${profile}`, { recursive: true, force: true });
  const skinningEvidence: object[] = [];
  for (const [name, scale] of [['box', 0.2], ['wedge', 0.125]] as const) {
    const output = `public/${profile}/${name}`;
    await mkdir(output, { recursive: true });
    const source = await readFile(`tests/fixtures/${profile}-${name}.pmx`);
    await writeFile(`${output}/source.pmx`, source);
    for (const sample of ['rest', 'a', 'b', 'only', 'legacy-a', 'legacy-b', 'pose-a', 'pose-b']) {
      const pose = sample.startsWith('pose-') ? sample.slice(-1) : undefined;
      const motion = sample === 'rest' || pose ? undefined : sample.slice(-1);
      const legacy = sample.startsWith('legacy-');
      const result = await convertModel(parsePMX(source), '.', {
        mode: profile, scale,
        vpd: pose ? await readFile(`tests/fixtures/pose-${pose}.vpd`) : undefined,
        vpdEncoding: pose === 'b' ? 'utf-8' : 'shift_jis',
        vpdBinding: { mapping: pose ? JSON.parse(await readFile(`tests/fixtures/pose-${pose}-map.json`, 'utf8')) : undefined },
        vmd: motion ? await readFile(`tests/fixtures/${sample === 'only' ? 'morph-only' : `${legacy ? 'motion' : 'combined'}-${motion}`}.vmd`) : undefined,
        vmdBinding: { mapping: motion && sample !== 'only' ? JSON.parse(await readFile(`tests/fixtures/motion-${motion}-map.json`, 'utf8')) : undefined,
          morphMapping: legacy ? undefined : { '8fce82a2': 1 }, morphUnmatched: legacy ? 'ignore' : 'error' },
        vmdSampling: { translationTolerance: 2e-8, rotationTolerance: 2e-7 },
      });
      result.document.getRoot().setExtras({ ...result.document.getRoot().getExtras(), attribution: profile === 'sdef' ? 'Original synthetic SDEF derivatives by mmd-gltf contributors, Issue #33. Based on the repository box/wedge rigs; no third-party model assets. No original-MMD fidelity claim.' : 'Original synthetic QDEF derivatives by mmd-gltf contributors, Issue #37. Based on the repository box/wedge rigs; no third-party model assets. No original-MMD fidelity claim.' });
      for (const extension of ['glb', 'gltf']) await result.io.write(`${output}/${sample}.${extension}`, result.document);
      skinningEvidence.push({ rig: name, sample, scale, warnings: result.warnings, sha256: createHash('sha256').update(await readFile(`${output}/${sample}.glb`)).digest('hex') });
    }
  }
  await writeFile(`public/${profile}/conversion.json`, JSON.stringify({ cases: skinningEvidence }, null, 2) + '\n');
  console.log(`Generated both mixed ${profile.toUpperCase()} rigs, combined motions and VPD poses in GLB/glTF.`);
}

// Issue #41: independent group targets and complete dependency metadata.
await rm('public/group',{recursive:true,force:true});
await mkdir('public/group',{recursive:true});
await copyFile('tests/fixtures/group-map.json','public/group/group-map.json');
for(const motion of ['a','b']) await copyFile(`tests/fixtures/group-${motion}.vmd`,`public/group/group-${motion}.vmd`);
for(const [rig,scale] of [['box',0.2],['wedge',0.125]] as const) {
  await mkdir(`public/group/${rig}`,{recursive:true});
  for(const mode of ['sdef','qdef'] as const) {
    const result=await convertModel(parsePMX(groupPMX(rig,mode==='sdef'?'mixed-sdef':'mixed-qdef')),'.',{mode,scale});
    await result.io.write(`public/group/${rig}/${mode}.glb`,result.document);
  }
  for(const motion of ['rest','a','b'] as const) {
    const result=await convertModel(parsePMX(await readFile(`tests/fixtures/group-${rig}.pmx`)),'.',{
      mode:'bdef',scale,vmd:motion==='rest'?undefined:await readFile(`tests/fixtures/group-${motion}.vmd`),
      vmdBinding:motion==='rest'?undefined:{mapping:JSON.parse(await readFile(`tests/fixtures/motion-${motion}-map.json`,'utf8')),
        morphMapping:JSON.parse(await readFile('tests/fixtures/group-map.json','utf8'))},
      vmdSampling:{translationTolerance:2e-8,rotationTolerance:2e-7},
    });
    result.document.getRoot().getAsset().extras={attribution:'Original synthetic Issue #41 group fixtures by mmd-gltf contributors; no third-party bytes. No original-MMD parity claim.'};
    for(const ext of ['glb','gltf']) await result.io.write(`public/group/${rig}/${motion}.${ext}`,result.document);
  }
}
console.log('Generated Issue #41 group rigs and motions in GLB and unpacked glTF.');

// Issue #43: the same solver-bearing sources drive conversion, Demo and probes.
await rm('public/solver',{recursive:true,force:true});
await mkdir('public/solver',{recursive:true});
const solverEvidence:object[]=[];
for(const id of ['a','b'])for(const suffix of ['vmd','vpd'])await copyFile(`tests/fixtures/solver-${id}.${suffix}`,`public/solver/solver-${id}.${suffix}`);
for(const rig of ['box','wedge'])for(const mode of ['bdef','sdef','qdef'] as const){
  const output=`public/solver/${rig}-${mode}`;await mkdir(output,{recursive:true});
  const source=await readFile(`tests/fixtures/solver-${rig}-${mode}.pmx`);await writeFile(`${output}/source.pmx`,source);
  for(const state of ['rest','a','b','pose-a','pose-b']){
    const pose=state.startsWith('pose-')?state.slice(-1):undefined;
    const result=await convertModel(parsePMX(source),'.',{mode,scale:.2,solver:'pre-physics-v1',
      vmd:state==='a'||state==='b'?await readFile(`tests/fixtures/solver-${state}.vmd`):undefined,
      vpd:pose?await readFile(`tests/fixtures/solver-${pose}.vpd`):undefined,vpdEncoding:'utf-8',vmdSampling:{translationTolerance:1e-7,rotationTolerance:2e-7},
    });
    for(const ext of ['glb','gltf'])await result.io.write(`${output}/${state}.${ext}`,result.document);
    solverEvidence.push({rig,mode,state,sourceSHA256:createHash('sha256').update(source).digest('hex'),warnings:result.warnings});
  }
}
await writeFile('public/solver/conversion.json',JSON.stringify({attribution:'Original synthetic works by mmd-gltf contributors, Issue #43. No third-party bytes; original-MMD unmeasured.',cases:solverEvidence},null,2)+'\n');
console.log('Generated Issue #43 solver rigs, motions and poses across all skinning/output modes.');

// Issue #45: pinned local backend and original physics variants, through the real converter.
const { physicsPMX } = await import('./synthetic-physics');
const backendBytes=await readFile('node_modules/ammojs-typed/ammo/ammo.js');
const { BACKEND_SHA256 }=await import('../packages/three-mmd-physics/ammo');
if(createHash('sha256').update(backendBytes).digest('hex')!==BACKEND_SHA256)throw new Error('Pinned Ammo artifact hash mismatch');
await mkdir('public/runtime',{recursive:true});await writeFile('public/runtime/ammo.js',backendBytes);
await copyFile('extensions/MMD_physics/BACKEND-LICENSE.txt','public/runtime/ammo-LICENSE.txt');
await rm('public/physics',{recursive:true,force:true});await mkdir('public/physics',{recursive:true});
const physicsEvidence:object[]=[];
for(const rig of ['box','wedge'] as const)for(const mode of ['bdef','sdef','qdef'] as const){
  const output=`public/physics/${rig}-${mode}`;await mkdir(output,{recursive:true});const source=physicsPMX(rig,mode);await writeFile(`${output}/source.pmx`,source);
  for(const state of ['rest','a','b','pose-a','pose-b']){
    const result=await convertModel(parsePMX(source),'.',{mode,scale:.2,physics:'rigid-body-v1',
      vmd:state==='a'||state==='b'?await readFile(`tests/fixtures/solver-${state}.vmd`):undefined,
      vpd:state.startsWith('pose-')?await readFile(`tests/fixtures/solver-${state.slice(-1)}.vpd`):undefined,vpdEncoding:'utf-8',physicsSettle:state.startsWith('pose-')?.25:0});
    for(const ext of ['glb','gltf'])await result.io.write(`${output}/${state}.${ext}`,result.document);
    physicsEvidence.push({rig,mode,state,sourceSHA256:createHash('sha256').update(source).digest('hex'),glbSHA256:createHash('sha256').update(await readFile(`${output}/${state}.glb`)).digest('hex'),warnings:result.warnings});
  }
}
await writeFile('public/physics/conversion.json',JSON.stringify({backendSHA256:BACKEND_SHA256,attribution:'Original synthetic Issue 45 variants by mmd-gltf contributors. No third-party fixture bytes; original-MMD unmeasured.',cases:physicsEvidence},null,2)+'\n');
console.log('Generated physics rigs, both motions and both VPD snapshots across BDEF/SDEF/QDEF and GLB/glTF.');
const {writePhysicsReferences}=await import('./physics-reference');await writePhysicsReferences();

// Issue #47: bone-only controls and one-hop mixed groups, both parser paths.
const {boneMorphPMX,boneMorphVMD}=await import('./synthetic-bone-morph');
await rm('public/bone',{recursive:true,force:true});await mkdir('public/bone',{recursive:true});
for(const motion of ['a','b'] as const)await writeFile(`public/bone/bone-morph-${motion}.vmd`,boneMorphVMD(motion));
for(const rig of ['box','wedge'] as const)for(const mode of ['bdef','sdef','qdef'] as const) {
  const output=`public/bone/${rig}${mode==='bdef'?'':`-${mode}`}`;await mkdir(output,{recursive:true});
  const source=boneMorphPMX(rig,mode==='bdef'?'bdef':mode==='sdef'?'mixed-sdef':'mixed-qdef');await writeFile(`${output}/source.pmx`,source);
  for(const state of ['rest','a','b'] as const) {
    const result=await convertModel(parsePMX(source),'.',{mode,scale:rig==='box'?0.2:0.125,
      vmd:state==='rest'?undefined:boneMorphVMD(state),vmdBinding:state==='rest'?undefined:{mapping:JSON.parse(await readFile(`tests/fixtures/motion-${state}-map.json`,'utf8'))}});
    result.document.getRoot().getAsset().extras={attribution:'Original Issue #47 synthetic bone/mixed morph fixtures by mmd-gltf contributors. Analytical project policy; original-MMD unmeasured.'};
    for(const ext of ['glb','gltf'])await result.io.write(`${output}/${state}.${ext}`,result.document);
  }
}
console.log('Generated Issue #47 bone/mixed morph rigs and motions across BDEF/SDEF/QDEF and GLB/glTF.');
