import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserGroups, optionalNativeTests, validateBrowserGroups } from './browser-shards';

export interface BrowserManifest {
  commit?: string;
  tests: { id: string; suite: string; title: string }[];
}
export interface ShardSummary {
  schemaVersion: number; shard: string; commit?: string; runId?: string; runAttempt?: string;
  status: string; durationMs: number; testCount: number; attemptCount: number; errors: unknown[];
  cases: { id: string; suite: string; status: string; expectedStatus: string; retry: number;
    durationMs: number; errors?: unknown[]; outputs?: unknown[] }[];
}
export function aggregateBrowser(manifest: BrowserManifest, summaries: ShardSummary[]) {
  const errors: string[] = [];
  const expected = new Map(manifest.tests.map(test => [test.id, test]));
  if (!expected.size || expected.size !== manifest.tests.length) errors.push('Empty or duplicate unsharded test list');
  validateBrowserGroups([...new Set(manifest.tests.map(test => test.suite))]);
  if (summaries.length !== browserGroups.length) errors.push('Expected exactly four shard summaries');
  const seen = new Set<string>();
  const testStatuses: Record<string, number> = {};
  const shards = new Set<string>();
  for (const summary of summaries) {
    if (!/^[1-4]$/.test(summary.shard) || shards.has(summary.shard)) {
      errors.push(`Invalid or duplicate shard ${summary.shard}`); continue;
    }
    shards.add(summary.shard);
    if (summary.schemaVersion !== 2 || summary.status !== 'passed' || summary.errors.length) errors.push(`Shard ${summary.shard} failed or has invalid evidence`);
    if (summary.commit !== manifest.commit || (process.env.GITHUB_SHA && summary.commit !== process.env.GITHUB_SHA)) errors.push('Commit mismatch');
    if (process.env.GITHUB_RUN_ID && (summary.runId !== process.env.GITHUB_RUN_ID || summary.runAttempt !== process.env.GITHUB_RUN_ATTEMPT)) errors.push('Run/attempt mismatch');
    const grouped = new Map<string, typeof summary.cases>();
    for (const attempt of summary.cases) {
      const attempts = grouped.get(attempt.id) ?? [];
      attempts.push(attempt); grouped.set(attempt.id, attempts);
    }
    if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0 || summary.cases.some(attempt => !Number.isFinite(attempt.durationMs) || attempt.durationMs < 0)) errors.push('Invalid durations');
    if (summary.testCount !== grouped.size || summary.attemptCount !== summary.cases.length) errors.push('Invalid test/attempt counts');
    for (const [id, attempts] of grouped) {
      const test = expected.get(id);
      if (!test || seen.has(id)) errors.push(`Unexpected or duplicate test ID ${id}`);
      seen.add(id);
      if (!test || !browserGroups[Number(summary.shard) - 1].files.includes(test.suite) || attempts.some(a => a.suite !== test.suite)) errors.push(`Wrong shard for ${id}`);
      if (attempts.some((a, index) => a.retry !== index)) errors.push(`Invalid retry sequence for ${id}`);
      const last = attempts.at(-1)!;
      testStatuses[last.status] = (testStatuses[last.status] ?? 0) + 1;
      // Expected failures and arbitrary skips must not make a regression green.
      const optional = optionalNativeTests.some(item => item.suite === test?.suite && item.title === test?.title);
      if (last.status !== 'passed' && !(optional && last.status === 'skipped' && last.expectedStatus === 'skipped')) errors.push(`Test ${id}: ${last.status}`);
      if (last.status === 'passed' && last.expectedStatus !== 'passed') errors.push(`Unexpected expected status for ${id}`);
    }
  }
  for (const id of expected.keys()) if (!seen.has(id)) errors.push(`Missing test ID ${id}`);
  const cases = summaries.flatMap(summary => summary.cases.map(attempt => ({ ...attempt, shard: summary.shard })));
  return { schemaVersion: 1, commit: manifest.commit, status: errors.length ? 'failed' : 'passed', errors,
    testCount: seen.size, attemptCount: cases.length, testStatuses,
    // Playwright times exclude installation, build and queueing; their sum is not total job/runner cost.
    browserWallMs: Math.max(0, ...summaries.map(s => s.durationMs)),
    browserRunnerMs: summaries.reduce((total, s) => total + s.durationMs, 0),
    shards: summaries, cases };
}

async function main() {
  const directory = process.argv[2] ?? '.cache/browser-shards';
  const manifest: BrowserManifest = JSON.parse(await readFile(`${directory}/browser-manifest.json`, 'utf8'));
  const summaries: ShardSummary[] = [];
  const missing: string[] = [];
  for (let shard = 1; shard <= browserGroups.length; shard++) {
    try { summaries.push(JSON.parse(await readFile(`${directory}/browser-evidence-${shard}/browser-summary.json`, 'utf8'))); }
    catch (error) { missing.push(`Cannot read shard ${shard}: ${String(error)}`); }
  }
  const result = aggregateBrowser(manifest, summaries);
  result.errors.push(...missing);
  if (result.errors.length) result.status = 'failed';
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/browser-aggregate.json', JSON.stringify(result, null, 2) + '\n');
  console.log(`${result.testCount}/${manifest.tests.length} tests, ${result.attemptCount} attempts; ${JSON.stringify(result.testStatuses)}; ${result.status}`);
  for (const error of result.errors) console.error(error);
  if (result.status !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
