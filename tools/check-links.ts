import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import assert from 'node:assert/strict';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'], { encoding: 'utf8' }).trim().split('\n');
const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
let checked = 0;
async function check(file: string, href: string, html = false) {
  if (/^(https?:|mailto:|data:)/.test(href)) return;
  const [path, hash] = href.split('#');
  const target = html ? resolve('dist', path.replace(/^\/mmd-gltf\//, '')) : path ? resolve(dirname(file), decodeURIComponent(path)) : resolve(file);
  const entry = await stat(target);
  assert.ok(entry.isFile() || entry.isDirectory(), `${file}: missing ${href}`);
  if (hash && extname(target) === '.md') {
    const markdown = await readFile(target, 'utf8');
    const headings = [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slug(match[1]));
    assert.ok(headings.includes(hash), `${file}: missing anchor ${href}`);
  }
  checked++;
}
for (const file of files) {
  const content = (await readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '');
  for (const link of content.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) await check(file, link[1]);
}
for (const name of ['index', 'rig', 'vpd-conformance', 'vmd-conformance', 'sdef-conformance']) {
  const html = await readFile(`dist/${name}.html`, 'utf8');
  for (const link of html.matchAll(/(?:href|src)="([^"]+)"/g)) await check(`dist/${name}.html`, link[1], true);
  assert.match(html, /\/mmd-gltf\/assets\//, 'built application must use the repository prefix');
}
for (const name of ['conformance', 'outline-conformance', 'bdef-conformance']) {
  await assert.rejects(stat(`dist/${name}.html`), /ENOENT/, 'conformance entry must not ship');
}
console.log(`PASS: ${checked} local documentation links, anchors and built example asset links checked.`);
