import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

// Read-only Actions timing collection. Run twice on an unchanged workflow/source SHA.
const ids = process.argv.slice(2);
if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !/^\d+$/.test(id))) throw new Error('Usage: npx tsx tools/browser-ci-metrics.ts RUN_ID [RUN_ID ...]');
const repository = process.env.GITHUB_REPOSITORY ?? 'takahirox/mmd-gltf';
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
function api(path: string) { return JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${path}`], { encoding: 'utf8' })); }
function minutes(start: string, end: string) { return (Date.parse(end) - Date.parse(start)) / 60_000; }
const runs = ids.map(id => {
  const run = api(`actions/runs/${id}`);
  if (run.status !== 'completed') throw new Error(`Run ${id} is not complete`);
  const jobs = api(`actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100`).jobs;
  if (jobs.length >= 100) throw new Error('Job pagination required');
  const executed = jobs.filter((job: any) => job.started_at && job.completed_at && job.conclusion !== 'skipped');
  if (!executed.length) throw new Error(`Run ${id} has no executed jobs to measure`);
  const browserJobs = executed.filter((job: any) => /^browser \([1-4]\)$/.test(job.name));
  const required = executed.filter((job: any) => !['deploy', 'browser-performance'].includes(job.name));
  return { id, headCommit: run.head_sha, workflow: run.path, attempt: run.run_attempt, event: run.event,
    createdAt: run.created_at, startedAt: run.run_started_at, conclusion: run.conclusion,
    workflowWallMinutes: minutes(run.created_at, run.updated_at),
    requiredFeedbackMinutes: minutes(run.created_at, new Date(Math.max(...required.map((job: any) => Date.parse(job.completed_at)))).toISOString()),
    initialQueueMinutes: minutes(run.created_at, new Date(Math.min(...executed.map((job: any) => Date.parse(job.started_at)))).toISOString()),
    worstBrowserJobMinutes: browserJobs.length ? Math.max(...browserJobs.map((job: any) => minutes(job.started_at, job.completed_at))) : null,
    // Unrounded execution time, not a billing estimate. Include setup and cleanup.
    totalRunnerMinutes: executed.reduce((sum: number, job: any) => sum + minutes(job.started_at, job.completed_at), 0),
    requiredRunnerMinutes: required.reduce((sum: number, job: any) => sum + minutes(job.started_at, job.completed_at), 0),
    jobs: jobs.map((job: any) => ({ name: job.name, conclusion: job.conclusion, createdAt: job.created_at, startedAt: job.started_at, completedAt: job.completed_at,
      queueMinutes: job.created_at && job.started_at ? minutes(job.created_at, job.started_at) : null,
      runnerMinutes: job.started_at && job.completed_at ? minutes(job.started_at, job.completed_at) : null,
      steps: (job.steps ?? []).map((step: any) => ({ name: step.name, conclusion: step.conclusion,
        minutes: step.started_at && step.completed_at ? minutes(step.started_at, step.completed_at) : null })) })) };
});
const comparable = new Set(runs.map(run => run.headCommit)).size === 1;
const values = runs.filter(run => run.conclusion === 'success').map(run => run.requiredFeedbackMinutes).sort((a, b) => a - b);
const median = !values.length ? null : values.length % 2 ? values[Math.floor(values.length / 2)] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
const report = { collectedAt: new Date().toISOString(), comparableHeadCommit: comparable,
  unchangedCommitRepeated: comparable && values.length >= 2 && runs.every(run => run.event !== 'pull_request'),
  comparisonNote: 'PR metadata identifies the head, not necessarily the tested merge SHA. Compare summary commit/workflow SHA, case IDs and environments before treating runs as equivalent.',
  successfulRequiredFeedbackMinutes: { samples: values.length, median, minimum: values[0] ?? null, maximum: values.at(-1) ?? null }, runs };
await mkdir('.cache', { recursive: true });
await writeFile('.cache/browser-ci-metrics.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
