/** Resolve PMX/PMD resource names without changing the source records or bytes. */
export function resolveMMDResourcePath(resourcePath: string | undefined, filePath: string): string {
  const invalid = () => new Error(`THREE.MMDLoader: Unsafe relative texture path ${JSON.stringify(filePath)}`);
  if (!filePath || /[\u0000-\u001f\u007f]/.test(filePath) || /^[a-z]:[\\/]/i.test(filePath) || filePath.startsWith('\\')) throw invalid();

  // Explicit URL references are already URLs, not Windows resource filenames.
  if (/^[a-z][a-z\d+.-]*:/i.test(filePath) || filePath.startsWith('//')) {
    try {
      const url = filePath.startsWith('//') ? new URL(filePath, 'https://mmd.invalid/') : new URL(filePath);
      if (url.protocol !== 'data:' && filePath.includes('\\')) throw invalid();
      return filePath;
    } catch { throw invalid(); }
  }

  const rooted = filePath.startsWith('/');
  const segments: string[] = [];
  for (const segment of filePath.replaceAll('\\', '/').split('/')) {
    if (!segment) continue;
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { throw invalid(); }
    // Reject encoded separators and nested encodings which a server could decode
    // into traversal. Literal Unicode and valid percent-encoded names stay intact.
    let checked = decoded;
    while (true) {
      if (/[\\/\u0000-\u001f\u007f]/.test(checked)) throw invalid();
      if (checked === '.' || checked === '..') break;
      if (!/%[\da-f]{2}/i.test(checked)) break;
      // Inspect nested escapes as bytes: a decoded literal percent may be
      // followed by non-UTF-8 bytes (e.g. %25FF) in a valid filename. Only the
      // first decoding above validates the URL's UTF-8/escape syntax.
      const next = checked.replace(/%([\da-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      if (next === checked) break;
      checked = next;
    }
    if (checked === '.' || checked === '..') {
      // Double-encoded dot segments must never acquire a different server meaning.
      if (decoded !== checked) throw invalid();
      if (checked === '..' && !segments.pop()) throw invalid();
      continue;
    }
    // Encode spaces, Unicode and query/fragment delimiters once. Decoding above
    // also gives equivalent escaped/unescaped names a single cache key.
    segments.push(encodeURIComponent(decoded));
  }
  if (!segments.length) throw invalid();
  const relative = segments.join('/');
  if (rooted) return `/${relative}`;
  return resourcePath ? `${resourcePath.replace(/\/+$/, '')}/${relative}` : relative;
}
