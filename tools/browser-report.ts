import { mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { cpus, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult } from '@playwright/test/reporter';
/** Portable evidence for single-worker suite/shard runs and targeted phase measurements. */
export default class BrowserReport implements Reporter {
  private config!: FullConfig;
  private errors: TestError[] = [];
  private suite?: Suite;
  private cases: { id: string; outcome?: string; errors: TestError[]; outputs: unknown[]; annotations: unknown[]; attachments: unknown[]; title: string; suite: string; status: string; expectedStatus: string;
    retry: number; durationMs: number; phases?: unknown }[] = [];
  onBegin(config: FullConfig, suite?: Suite) {
    this.config = config;
    this.suite = suite;
    if (process.env.BROWSER_LIST_PATH && suite) {
      const path = process.env.BROWSER_LIST_PATH;
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, JSON.stringify({ schemaVersion: 1, commit: process.env.GITHUB_SHA,
        tests: suite.allTests().map(test => ({ id: test.id, suite: basename(test.location.file), title: test.title })) }, null, 2) + '\n');
    }
  }
  onError(error: TestError) { this.errors.push(error); }
  onTestEnd(test: TestCase, result: TestResult) {
    // The list reporter does not persist body attachments. Keep oracle/phase
    // evidence in the existing CI artifact, including when an assertion fails.
    const attachments = result.attachments.map(a => {
      let path = a.path;
      if (a.body && a.contentType === 'application/json') {
        mkdirSync('test-results/attachments', { recursive: true });
        const name = `${test.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${result.retry}-${basename(a.name)}`;
        path = join('test-results/attachments', name);
        writeFileSync(path, a.body);
      }
      return { name: a.name, contentType: a.contentType,
        path: path ? relative(resolve('test-results'), resolve(path)) : undefined };
    });
    const attachment = result.attachments.find(a => a.name === 'phase-timing.json');
    const body = attachment?.body ?? (attachment?.path ? readFileSync(attachment.path) : undefined);
    this.cases.push({ id: test.id, outcome: test.outcome?.(), errors: result.errors ?? [],
      annotations: result.annotations ?? test.annotations ?? [], attachments,
      outputs: [...(result.stdout ?? []), ...(result.stderr ?? [])].map(value => String(value)), title: test.titlePath().filter(Boolean).join(' / '), suite: basename(test.location.file),
      status: result.status, expectedStatus: test.expectedStatus, retry: result.retry, durationMs: result.duration,
      phases: body ? JSON.parse(body.toString()) : undefined });
  }
  async onEnd(result: FullResult) {
    if (!this.cases.length && (!this.config || process.argv.includes('--list'))) return; // Listing must not overwrite measured evidence.
    // Outcomes are final only after all retries finish.
    for (const test of this.suite?.allTests() ?? []) for (const attempt of this.cases.filter(c => c.id === test.id)) attempt.outcome = test.outcome();
    const suites: Record<string, { durationMs: number; attempts: number; statuses: Record<string, number> }> = {};
    const statuses: Record<string, number> = {};
    for (const c of this.cases) {
      statuses[c.status] = (statuses[c.status] ?? 0) + 1;
      const suite = suites[c.suite] ??= { durationMs: 0, attempts: 0, statuses: {} };
      suite.durationMs += c.durationMs; suite.attempts++;
      suite.statuses[c.status] = (suite.statuses[c.status] ?? 0) + 1;
    }
    const baselines = [
      { run: 69, durationMs: 2_145_078.161, testCount: 73 },
      { run: 70, durationMs: 2_059_749.807, browserStepMs: 2_061_000, testCount: 73 },
    ];
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/browser-summary.json', JSON.stringify({
      schemaVersion: 2, commit: process.env.GITHUB_SHA, workflowSHA: process.env.GITHUB_WORKFLOW_SHA,
      runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      shard: process.env.BROWSER_SHARD ?? null, errors: this.errors,
      environment: { image: process.env.ImageOS, imageVersion: process.env.ImageVersion,
        runnerName: process.env.RUNNER_NAME, runnerArch: process.env.RUNNER_ARCH,
        chromiumVersion: chromiumVersion(), playwrightVersion: createRequire(import.meta.url)('@playwright/test/package.json').version, ci: !!process.env.CI, platform: process.platform, release: release(), node: process.version,
        cpu: cpus()[0]?.model, logicalCPUs: cpus().length, workers: this.config.workers,
        channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || 'chrome',
        conformanceMatrix: process.env.BROWSER_CONFORMANCE_MATRIX || 'representative', renderer: 'ANGLE SwiftShader (CPU)' },
      status: result.status, durationMs: result.duration, testCount: this.cases.filter(c => c.retry === 0).length,
      attemptCount: this.cases.length, statuses, suites,
      selection: { grep: String(this.config.grep), grepInvert: String(this.config.grepInvert) },
      // Historical references only: filtered or non-Ubuntu runs are not comparable CI speed measurements.
      baselines,
      cases: this.cases,
    }, null, 2) + '\n');
  }
}

function chromiumVersion(): string {
  try {
    // The installed, supported browser is used even when no page launched.
    return execFileSync(chromium.executablePath(), ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch { return 'unavailable'; }
}
