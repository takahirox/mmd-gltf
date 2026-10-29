import { mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cpus, release } from 'node:os';
import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
/** Portable evidence for the complete single-worker run and targeted phase measurements. */
export default class BrowserReport implements Reporter {
  private config!: FullConfig;
  private cases: { title: string; suite: string; status: string; expectedStatus: string;
    retry: number; durationMs: number; phases?: unknown }[] = [];
  onBegin(config: FullConfig) { this.config = config; }
  onTestEnd(test: TestCase, result: TestResult) {
    // The list reporter does not persist body attachments. Keep oracle/phase
    // evidence in the existing CI artifact, including when an assertion fails.
    for (const a of result.attachments) if (a.body && a.contentType === 'application/json') {
      mkdirSync('test-results/attachments', { recursive: true });
      const name = `${test.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${result.retry}-${basename(a.name)}`;
      writeFileSync(join('test-results/attachments', name), a.body);
    }
    const attachment = result.attachments.find(a => a.name === 'phase-timing.json');
    const body = attachment?.body ?? (attachment?.path ? readFileSync(attachment.path) : undefined);
    this.cases.push({ title: test.titlePath().filter(Boolean).join(' / '), suite: basename(test.location.file),
      status: result.status, expectedStatus: test.expectedStatus, retry: result.retry, durationMs: result.duration,
      phases: body ? JSON.parse(body.toString()) : undefined });
  }
  async onEnd(result: FullResult) {
    if (!this.cases.length) return; // Listing tests must not overwrite measured evidence.
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
      environment: { ci: !!process.env.CI, platform: process.platform, release: release(), node: process.version,
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
