import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDVMDPlugin, getVMDPlayers } from '../packages/three-mmd-vmd';
import { MMDSolverPlugin, getSolverModel } from '../packages/three-mmd-solver';
import { MMDDiagnosticError } from '../packages/mmd-diagnostics';
export async function runSourceTransportBrowser(json:unknown) {
  const asset=await new GLTFLoader().register(p=>new MMDSolverPlugin(p)).register(p=>new MMDVMDPlugin(p)).parseAsync(JSON.stringify(json),'');
  const player=getVMDPlayers(asset)[0],source=player.source!;
  let category='';
  try {player.seek(0.5);}catch(error){if(!(error instanceof MMDDiagnosticError))throw error;category=error.diagnostic.category;}
  const result={category,version:getSolverModel(asset.scene)!.profile.version,externalParent:getSolverModel(asset.scene)!.profile.bones[0].externalParent,
    ordinaryTracks:asset.animations[0].tracks.map(t=>t.name),sourceBytes:source.source,diagnostics:player.diagnostics};
  player.dispose();return result;
}
