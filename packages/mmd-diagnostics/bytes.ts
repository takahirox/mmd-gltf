import { diagnosticError } from './index';
/** Browser/Node codec; bounds are checked before allocating decoded source bytes. */
export function encodeSource(bytes: Uint8Array): string {
  let binary='';
  for(let start=0;start<bytes.length;start+=8192) binary+=String.fromCharCode(...bytes.subarray(start,start+8192));
  return btoa(binary);
}
export function decodeSource(value: string): Uint8Array {
  if(typeof value!=='string') diagnosticError('malformed-data','invalid-source-encoding','MMD source','invalid base64 source');
  if(value.length>Math.ceil(64*1024*1024/3)*4) diagnosticError('resource-exhaustion','source-input-budget','MMD source','retained source exceeds 64 MiB parser budget');
  if(value.length%4 || /[^A-Za-z0-9+/=]/.test(value) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    diagnosticError('malformed-data','invalid-source-encoding','MMD source','invalid base64 source');
  return Uint8Array.from(atob(value),c=>c.charCodeAt(0));
}
