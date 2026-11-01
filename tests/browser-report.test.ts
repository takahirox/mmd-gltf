import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import BrowserReport from '../tools/browser-report';

test('browser evidence preserves phase attachments, suite status counts and retries; listing cannot overwrite it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mmd-browser-report-'));
  const original = process.cwd();
  try {
    process.chdir(directory);
    await mkdir('test-results');
    const phase = { conformance: { 'vertex-readback': { count: 2, totalMs: 30, maximumMs: 20 } } };
    await writeFile('phase.json', JSON.stringify(phase));
    const reporter = new BrowserReport();
    reporter.onBegin({ workers: 1 } as FullConfig);
    const fakeTest = (suite: string, expectedStatus = 'passed') => ({
      id: suite, titlePath: () => [suite, 'example'], location: { file: `/tests/${suite}` }, expectedStatus,
    }) as TestCase;
    const fakeResult = (status: string, retry: number, duration: number, attachments: unknown[] = []) =>
      ({ status, retry, duration, attachments, errors: status === 'failed' ? [{ message: 'oracle assertion' }] : [], stdout: ['diagnostic'], stderr: [] }) as unknown as TestResult;
    reporter.onTestEnd(fakeTest('solver.spec.ts'), fakeResult('failed', 0, 80, [{ name: 'phase-timing.json', path: 'phase.json' }]));
    reporter.onTestEnd(fakeTest('solver.spec.ts'), fakeResult('passed', 1, 50, [{ name: 'oracle.json', contentType: 'application/json', body: Buffer.from('{"positionError":0}') }]));
    reporter.onTestEnd(fakeTest('vmd.spec.ts', 'skipped'), fakeResult('skipped', 0, 0));
    const result = { status: 'passed', duration: 150 } as FullResult;
    await reporter.onEnd(result);
    const contents = await readFile('test-results/browser-summary.json', 'utf8');
    const summary = JSON.parse(contents);
    assert.equal(await readFile('test-results/attachments/solver_spec_ts-1-oracle.json', 'utf8'), '{"positionError":0}');
    assert.equal(summary.schemaVersion, 2);
    assert.equal(summary.cases[0].id, 'solver.spec.ts');
    assert.equal(summary.cases[1].attachments[0].path, 'attachments/solver_spec_ts-1-oracle.json');
    assert.equal(summary.cases[0].errors[0].message, 'oracle assertion');
    assert.deepEqual(summary.cases[0].outputs, ['diagnostic']);
    assert.equal(summary.testCount, 2);
    assert.equal(summary.attemptCount, 3);
    assert.deepEqual(summary.statuses, { failed: 1, passed: 1, skipped: 1 });
    assert.deepEqual(summary.suites['solver.spec.ts'], { durationMs: 130, attempts: 2, statuses: { failed: 1, passed: 1 } });
    assert.deepEqual(summary.cases[0].phases, phase);
    assert.equal(summary.cases[2].expectedStatus, 'skipped');
    assert.equal(summary.durationMs, 150);
    assert.equal(summary.environment.workers, 1);
    assert.equal(summary.baselines[1].durationMs, 2_059_749.807);
    const previousListPath = process.env.BROWSER_LIST_PATH;
    try {
      process.argv.push('--list');
      process.env.BROWSER_LIST_PATH = 'test-results/manifest.json';
      const listing = new BrowserReport();
      listing.onBegin({ workers: 1 } as FullConfig, { allTests: () => [fakeTest('solver.spec.ts')] } as unknown as Suite);
      await listing.onEnd(result);
      assert.equal(JSON.parse(await readFile('test-results/manifest.json', 'utf8')).tests[0].id, 'solver.spec.ts');
    } finally {
      process.argv.pop();
      if (previousListPath === undefined) delete process.env.BROWSER_LIST_PATH;
      else process.env.BROWSER_LIST_PATH = previousListPath;
    }
    assert.equal(await readFile('test-results/browser-summary.json', 'utf8'), contents);
  } finally {
    process.chdir(original);
    await rm(directory, { recursive: true, force: true });
  }
});
