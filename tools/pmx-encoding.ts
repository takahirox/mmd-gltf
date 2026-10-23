/** Text-only compatibility adapter for mmd-parser 1.1.4, whose TextBuf reader
 * always uses UTF-16LE. PMX 2.0 record layout and encoding flags:
 * https://raw.githubusercontent.com/hirakuni45/glfw3_app/master/glfw3_app/docs/PMX_spec.txt
 * Numeric records are copied verbatim; parsing and handedness stay with the parser.
 */
export function pmxParserBytes(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Leave invalid magic/unsupported versions to the parser's existing diagnostics.
  if (bytes.length < 17 || Buffer.from(bytes.subarray(0, 4)).toString('ascii') !== 'PMX ' || view.getFloat32(4, true) !== 2) return bytes;
  if (bytes[9] === 0) return bytes;
  if (bytes[9] !== 1) throw new Error(`Unsupported PMX text encoding ${bytes[9]}`);
  if (bytes[8] !== 8) throw new Error('Expected PMX 2.0 header size 8');
  const [auvs, vertex, texture, material, bone, morph, body] = bytes.subarray(10, 17);
  if (auvs > 4 || ![vertex, texture, material, bone, morph, body].every(n => [1, 2, 4].includes(n))) throw new Error('Invalid PMX header sizes');
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const take = (size: number) => {
    if (!Number.isSafeInteger(size) || size < 0 || size > bytes.length - offset) throw new Error(`Truncated/invalid PMX record at byte ${offset}`);
    const data = bytes.subarray(offset, offset + size);
    offset += size;
    return data;
  };
  const copy = (size: number) => { chunks.push(take(size)); };
  const uint = (size: 1 | 2 | 4) => {
    const start = offset;
    copy(size);
    return size === 1 ? view.getUint8(start) : size === 2 ? view.getUint16(start, true) : view.getUint32(start, true);
  };
  const records = (read: () => void) => {
    const count = uint(4);
    if (count > bytes.length - offset) throw new Error(`Invalid PMX record count at byte ${offset - 4}`);
    for (let i = 0; i < count; i++) read();
  };
  // ignoreBOM preserves an initial U+FEFF as part of the exact source string.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const text = () => {
    const start = offset;
    take(4);
    const value = Buffer.from(decoder.decode(take(view.getUint32(start, true))), 'utf16le');
    const length = Buffer.alloc(4); length.writeUInt32LE(value.length);
    chunks.push(length, value);
  };
  const names = () => { text(); text(); };
  const header = Buffer.from(take(17)); header[9] = 0; chunks.push(header);
  names(); names(); // model names and comments
  records(() => {
    copy(32 + auvs * 16);
    const type = uint(1);
    const size = [bone, bone * 2 + 4, bone * 4 + 16, bone * 2 + 40][type];
    if (size === undefined) throw new Error(`unsupport bone type ${type} exception.`);
    copy(size + 4); // skinning record and edge ratio
  });
  copy(uint(4) * vertex); // face vertex references
  records(text); // texture paths
  records(() => {
    names(); copy(66 + texture * 2); // material factors, edge, texture/sphere slots
    const toonFlag = uint(1);
    if (toonFlag !== 0 && toonFlag !== 1) throw new Error(`Unknown PMX toon flag ${toonFlag}`);
    copy(toonFlag === 0 ? texture : 1); text(); copy(4);
  });
  records(() => {
    names(); copy(16 + bone);
    const flags = uint(2);
    copy(flags & 1 ? bone : 12);
    if (flags & 0x300) copy(bone + 4);
    if (flags & 0x400) copy(12);
    if (flags & 0x800) copy(24);
    if (flags & 0x2000) copy(4);
    if (flags & 0x20) {
      copy(bone + 8);
      records(() => { copy(bone); if (uint(1) === 1) copy(24); });
    }
  });
  records(() => {
    names(); copy(1); const type = uint(1);
    const size = [morph + 4, vertex + 12, bone + 28, ...Array(5).fill(vertex + 16), material + 113][type];
    if (size === undefined) throw new Error(`Unsupported PMX 2.0 morph type ${type}`);
    copy(uint(4) * size);
  });
  records(() => {
    names(); copy(1);
    records(() => { copy(uint(1) === 0 ? bone : morph); });
  });
  records(() => { names(); copy(bone + 61); }); // rigid bodies
  records(() => { names(); copy(1 + body * 2 + 96); }); // joints
  copy(bytes.length - offset);
  return Buffer.concat(chunks);
}
