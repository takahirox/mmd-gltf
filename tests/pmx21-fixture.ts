/** Original minimal PMX 2.1 binary writer for reader boundary tests. Deliberately
 * independent of the reader and large animated-rig writer. Offsets name records
 * so corruption cases never locate numeric bytes by incidental byte searches. */
export function pmx21Fixture(encoding: 'utf8'|'utf16le', vertexWidth:1|2|4, otherWidth:1|2|4, retainedFeatures=false) {
  const chunks:Buffer[]=[],offsets:Record<string,number>={};let length=0;
  const put=(b:Buffer)=>{chunks.push(b);length+=b.length;};
  const mark=(name:string)=>{offsets[name]=length;};
  const u8=(n:number)=>put(Buffer.from([n]));
  const int=(n:number,width=4,unsigned=false)=>{const b=Buffer.alloc(width);if(unsigned)b.writeUIntLE(n,0,width);else b.writeIntLE(n,0,width);put(b);};
  const f=(n:number)=>{const b=Buffer.alloc(4);b.writeFloatLE(n);put(b);};
  const fs=(values:number[])=>values.forEach(f);
  const text=(s:string)=>{const b=Buffer.from(s,encoding);int(b.length);put(b);};
  const names=()=>{text('record');text('record EN');};
  put(Buffer.from('PMX '));f(2.1);u8(8);u8(encoding==='utf8'?1:0);u8(0);
  [vertexWidth,...Array(5).fill(otherWidth)].forEach(u8);
  mark('text');text('\uFEFF骨😀e\u0301');text('Exact names');text('Original Issue #37 synthetic fixture.');text('No third-party bytes.');
  mark('vertexCount');int(3);
  for(let v=0;v<3;v++) {
    fs(v===0?[0,0,1]:v===1?[1,0,1]:[0,1,1]);fs([0,0,-1]);fs([v===1?1:0,v===2?1:0]);u8(4);
    if(!v)mark('jointReference');[0,1,2,3].forEach(n=>int(n,otherWidth));fs([0.1,0.2,0.3,0.4]);f(1);
  }
  mark('faceCount');int(3);mark('vertexReference');[0,1,2].forEach(n=>int(n,vertexWidth,true));
  int(0);int(1);names();fs([1,1,1,1]);fs([0,0,0]);f(1);fs([0.1,0.1,0.1]);mark('drawingFlag');u8(0x10);fs([0,0,0,1]);f(1);
  int(-1,otherWidth);int(-1,otherWidth);u8(0);mark('toonFlag');u8(0);mark('toonIndex');int(-1,otherWidth);text('material');int(3);
  mark('boneCount');int(4);
  for(let b=0;b<4;b++){names();fs([0,b,0]);int(-1,otherWidth);int(0);int(0,2);fs([0,1,0]);}
  int(1);names();u8(1);mark('morphType');u8(retainedFeatures?10:1);int(1);
  if(retainedFeatures){int(0,otherWidth);u8(1);fs([1,2,3,0.1,0.2,0.3]);}
  else {int(0,vertexWidth,true);fs([0.1,0.2,0.3]);}
  int(0);int(retainedFeatures?1:0);
  if(retainedFeatures){names();int(0,otherWidth);u8(0);int(0,2);u8(0);fs([0.2,0,0]);fs(Array(6).fill(0));fs([1,0,0,0,0]);u8(1);}
  int(1);names();mark('jointType');u8(0);int(-1,otherWidth);int(-1,otherWidth);fs(Array(24).fill(0));
  mark('softBodies');int(retainedFeatures?1:0);
  if(retainedFeatures){names();u8(0);int(0,otherWidth);u8(0);int(0,2);u8(0);int(0);int(0);f(1);f(0.01);int(0);fs(Array(18).fill(0));[1,1,1,1].forEach(v=>int(v));fs([0.5,0.5,0.5]);int(1);int(0,otherWidth);int(0,vertexWidth,true);u8(1);int(1);int(1,vertexWidth,true);}
  return {bytes:Buffer.concat(chunks),offsets};
}
