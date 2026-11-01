import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { aggregateBrowser, type BrowserManifest, type ShardSummary } from '../tools/browser-aggregate';
import { browserGroups, optionalNativeTests, shardFiles, validateBrowserGroups } from '../tools/browser-shards';

function fixture() {
  const tests = browserGroups.flatMap(group => group.files.map(suite => ({ id: suite, suite, title: suite })));
  const manifest: BrowserManifest = { commit: process.env.GITHUB_SHA, tests };
  const summaries: ShardSummary[] = browserGroups.map((group, index) => ({ schemaVersion: 2,
    shard: String(index + 1), commit: manifest.commit, runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT, status: 'passed', durationMs: 100, errors: [],
    testCount: group.files.length, attemptCount: group.files.length,
    cases: group.files.map(id => ({ id, suite: id, status: 'passed', expectedStatus: 'passed', retry: 0, durationMs: 10 })),
  }));
  return { manifest, summaries };
}

test('all current suites are assigned exactly once; new Physics suites require an explicit assignment', () => {
  const files = readdirSync('tests/browser').filter(file => file.endsWith('.spec.ts'));
  validateBrowserGroups(files);
  assert.throws(() => validateBrowserGroups([...files, 'public-physics.spec.ts']), /unassigned=public-physics/);
  const updated = structuredClone(browserGroups);
  updated[3].files.push('public-physics.spec.ts');
  validateBrowserGroups([...files, 'public-physics.spec.ts'], updated);
  assert.throws(() => validateBrowserGroups(files, [...browserGroups, browserGroups[0]]), /Duplicate/);
  assert.throws(() => shardFiles('0'), /Invalid/);
  assert.throws(() => shardFiles('1\/4'), /Invalid/);
  assert.equal(shardFiles('1')?.length, browserGroups[0].files.length);
});

test('aggregate retains retry failures and output while accepting complete eventual success', () => {
  const { manifest, summaries } = fixture();
  const first = summaries[0].cases[0];
  summaries[0].cases.unshift({ ...first, status: 'failed', errors: ['intentional assertion failure'], outputs: ['diagnostic'] });
  summaries[0].cases[1].retry = 1;
  summaries[0].attemptCount++;
  const result = aggregateBrowser(manifest, summaries);
  assert.equal(result.status, 'passed');
  assert.equal(result.testCount, manifest.tests.length);
  assert.deepEqual(result.testStatuses, { passed: manifest.tests.length });
  assert.equal(result.attemptCount, manifest.tests.length + 1);
  assert.deepEqual(result.cases[0].outputs, ['diagnostic']);
  assert.equal(result.browserWallMs, 100);
  assert.equal(result.browserRunnerMs, 400);
});

test('aggregate rejects missing/duplicate IDs, missing shards, wrong assignments, failures and mismatched commits', () => {
  const mutations: ((s: ShardSummary[]) => void)[] = [
    s => { s.pop(); },
    s => { s[0].cases.pop(); },
    s => { s[0].cases.push(s[1].cases[0]); s[0].attemptCount++; s[0].testCount++; },
    s => { [s[0].cases[0], s[1].cases[0]] = [s[1].cases[0], s[0].cases[0]]; },
    s => { s[0].cases[0].status = 'failed'; s[0].status = 'failed'; },
    s => { s[0].cases[0].status = 'skipped'; s[0].cases[0].expectedStatus = 'skipped'; },
    s => { s[0].cases[0].expectedStatus = 'failed'; },
    s => { s[0].commit = 'other-commit'; },
    s => { s[0].errors = ['web server failure']; },
    s => { s[0].shard = '2'; },
    s => { s[0].cases[0].retry = 1; },
    s => { s[0].schemaVersion = 1; },
    s => { s[0].durationMs = NaN; },
  ];
  for (const mutate of mutations) {
    const { manifest, summaries } = fixture();
    mutate(summaries);
    assert.equal(aggregateBrowser(manifest, summaries).status, 'failed');
  }
});

test('only the two named optional native WebGPU cases may skip; both may also pass', () => {
  const { manifest, summaries } = fixture();
  for (const optional of optionalNativeTests) {
    const expected = manifest.tests.find(t => t.suite === optional.suite)!;
    expected.title = optional.title;
    const attempt = summaries.flatMap(s => s.cases).find(c => c.id === expected.id)!;
    attempt.status = 'skipped'; attempt.expectedStatus = 'skipped';
  }
  assert.equal(aggregateBrowser(manifest, summaries).status, 'passed');
  manifest.tests.find(t => t.suite === optionalNativeTests[0].suite)!.title = 'an unrelated test';
  assert.equal(aggregateBrowser(manifest, summaries).status, 'failed');
});
