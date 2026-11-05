/** Original generated VMD: bound keys end before a retained, unexecuted camera key. */
export function durationVMD(lastFrame:number) {
  const header=Buffer.alloc(50);header.write('Vocaloid Motion Data 0002');header.write('duration fixture',30);
  const count=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
  const boundFrame=Math.max(0,lastFrame-1),frames=boundFrame?[0,boundFrame]:[0];
  const bones=frames.map((frame,i)=>{
    const b=Buffer.alloc(111);
    // Shift_JIS 上半身, an exact unique name on both public models.
    Buffer.from('8fe394bc9067','hex').copy(b);b.writeUInt32LE(frame,15);
    b.writeFloatLE(i*.2,19);b.writeFloatLE(1,43);
    return b;
  });
  const morphs=frames.map((frame,i)=>{
    const b=Buffer.alloc(23);Buffer.from('8fce82a2','hex').copy(b); // 笑い
    b.writeUInt32LE(frame,15);b.writeFloatLE(frames.length===1?.8:i*.8,19);return b;
  });
  const camera=Buffer.alloc(61);camera.writeUInt32LE(lastFrame);camera.writeUInt32LE(45,56);
  return Buffer.concat([header,count(bones.length),...bones,count(morphs.length),...morphs,count(1),camera,count(0),count(0),count(0)]);
}
