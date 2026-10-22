declare module 'mmd-parser' {
  export class Parser { parsePmx(buffer: ArrayBuffer, leftToRight: boolean): any; }
}
declare module 'gltf-validator' {
  export function validateString(json: string, options?: any): Promise<any>;
  export function validateBytes(bytes: Uint8Array, options?: object): Promise<any>;
}
