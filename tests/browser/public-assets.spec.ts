import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

for(const model of ['uka','gene-light'])test(`${model}: ordinary GLTFLoader reads three named core fallback clips on one real skin`,async({page})=>{
  test.setTimeout(120000);
  // The dev server resolves the real Three.js modules; this page creates no demo viewer.
  await page.goto('gene-light/README.md');
  const result=await page.evaluate(async ({model,loaderPath,threePath})=>{
    const {GLTFLoader}=await import(/* @vite-ignore */ loaderPath);
    const {AnimationMixer,Vector3}=await import(/* @vite-ignore */ threePath);
    const gltf=await new GLTFLoader().loadAsync(`/mmd-gltf/${model}/model.${model==='uka'?'gltf':'glb'}`);
    const metadata=await Promise.all(['motion','motion-02_laugh','motion-22_apology'].map(async id=>(await fetch(`/mmd-gltf/${model}/${id}.json`)).json()));
    const sources=await Promise.all(gltf.parser.json.animations.map(async(a:any)=>{
      const bytes=Uint8Array.from(atob(a.extensions.MMD_animation_vmd.source),c=>c.charCodeAt(0));
      return {name:a.name,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')};
    }));
    const bones:any[]=[];gltf.scene.traverse((n:any)=>{if(n.isBone)bones.push(n);});
    const mixer=new AnimationMixer(gltf.scene),clips=[];
    for(const clip of gltf.animations) {
      const action=mixer.clipAction(clip);action.play();mixer.setTime(.5);gltf.scene.updateMatrixWorld(true);
      clips.push({name:clip.name,tracks:clip.tracks.length,finite:bones.every(b=>b.getWorldPosition(new Vector3()).toArray().every(Number.isFinite))});
      mixer.stopAllAction();
    }
    mixer.uncacheRoot(gltf.scene);
    gltf.scene.traverse((n:any)=>{n.geometry?.dispose();for(const material of Array.isArray(n.material)?n.material:n.material?[n.material]:[]) {for(const v of Object.values(material) as any[])if(v?.isTexture)v.dispose();material.dispose();}});
    return {scenes:gltf.scenes.length,skins:gltf.parser.json.skins.length,meshes:gltf.parser.json.meshes.length,clips,sources,expected:metadata.map(m=>({name:m.animation,hash:m.sha256}))};
  },{model,loaderPath:`/mmd-gltf/@fs${resolve('node_modules/three/examples/jsm/loaders/GLTFLoader.js')}`,threePath:`/mmd-gltf/@fs${resolve('node_modules/three/build/three.module.js')}`});
  expect(result.scenes).toBe(1);expect(result.skins).toBe(1);expect(result.meshes).toBe(1);
  expect(result.clips).toHaveLength(3);expect(result.clips.every(c=>c.tracks>0 && c.finite)).toBe(true);
  expect(result.sources).toEqual(result.expected);
});
