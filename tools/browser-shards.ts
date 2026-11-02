import { readdirSync } from 'node:fs';
import plan from './browser-shards.json' with { type: 'json' };

export const browserGroups = plan.groups;
export function validateBrowserGroups(files: string[], groups = browserGroups) {
  const assigned = groups.flatMap(group => group.files);
  if (new Set(assigned).size !== assigned.length) throw new Error('Duplicate browser suite assignment');
  const missing = files.filter(file => !assigned.includes(file));
  const stale = assigned.filter(file => !files.includes(file));
  if (missing.length || stale.length) throw new Error(`Browser shard mapping needs update: unassigned=${missing}; stale=${stale}`);
}
export function shardFiles(shard: string | undefined): string[] | undefined {
  if (!shard) return undefined;
  validateBrowserGroups(readdirSync('tests/browser', { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.spec.ts')));
  if (!/^[1-4]$/.test(shard)) throw new Error(`Invalid BROWSER_SHARD: ${shard}`);
  return browserGroups[Number(shard) - 1].files.map(file => `**/${file}`);
}
export const optionalNativeTests = [
  { suite: 'example.spec.ts', title: 'matched PMX and glTF load, render, navigate and toggle on built webgpu site' },
  { suite: 'outline.spec.ts', title: 'production outline equation, encoded compositing, depth, loader and viewport conformance on webgpu' },
];
