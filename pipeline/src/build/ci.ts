import { Octokit } from "@octokit/rest";
import { CI_TIMEOUT_MS, githubRepo, githubToken } from "../config.js";
import { tail } from "./run.js";

export interface CiResult {
  passed: boolean;
  /** Jobs that ran, with their conclusion. */
  jobs: { name: string; conclusion: string }[];
  /** Failed jobs with the end of their log, for the build agent. */
  failures: { name: string; output: string }[];
  /** Workflow runs with a failed job, for `rerunFailedJobs`. */
  failedRunIds: number[];
}

const POLL_MS = 30_000;
/** Workflows can register a little apart; wait this long after all runs finish. */
const SETTLE_MS = 30_000;
const LOG_LINES = 150;
const RERUN_START_MS = 120_000;

/**
 * Waits for every GitHub Actions run on a commit to finish and reports the result.
 * This is the gate the local checks can't replace: CI runs the e2e suite against a
 * real Supabase database, which the demo build never touches.
 */
export async function waitForCi(sha: string): Promise<CiResult> {
  const octokit = new Octokit({ auth: githubToken() });
  const repo = githubRepo();
  const deadline = Date.now() + CI_TIMEOUT_MS;
  let finishedAt: number | undefined;

  while (Date.now() < deadline) {
    const { data } = await octokit.actions.listWorkflowRunsForRepo({
      ...repo,
      head_sha: sha,
      per_page: 50,
    });
    const runs = data.workflow_runs;
    const allDone =
      runs.length > 0 && runs.every((run) => run.status === "completed");
    if (!allDone) {
      finishedAt = undefined;
    } else if (finishedAt === undefined) {
      finishedAt = Date.now();
    } else if (Date.now() - finishedAt >= SETTLE_MS) {
      return collectResult(octokit, repo, runs);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(
    `GitHub CI did not finish on ${sha.slice(0, 7)} within ${Math.round(CI_TIMEOUT_MS / 60_000)} minutes`,
  );
}

async function collectResult(
  octokit: Octokit,
  repo: { owner: string; repo: string },
  runs: { id: number }[],
): Promise<CiResult> {
  const jobs: CiResult["jobs"] = [];
  const failures: CiResult["failures"] = [];
  const failedRunIds = new Set<number>();
  for (const run of runs) {
    const { data } = await octokit.actions.listJobsForWorkflowRun({
      ...repo,
      run_id: run.id,
      per_page: 100,
    });
    for (const job of data.jobs) {
      const conclusion = job.conclusion ?? "unknown";
      jobs.push({ name: job.name, conclusion });
      if (conclusion === "failure" || conclusion === "timed_out") {
        failedRunIds.add(run.id);
        failures.push({
          name: job.name,
          output: await jobLogTail(octokit, repo, job.id),
        });
      }
    }
  }
  return {
    passed: failures.length === 0,
    jobs,
    failures,
    failedRunIds: [...failedRunIds],
  };
}

/**
 * Re-runs the failed jobs of these workflow runs and returns once GitHub has started
 * every re-run, so a following `waitForCi` doesn't read the old result.
 */
export async function rerunFailedJobs(runIds: number[]): Promise<void> {
  const octokit = new Octokit({ auth: githubToken() });
  const repo = githubRepo();
  const attempts = new Map<number, number>();
  for (const runId of runIds) {
    const { data } = await octokit.actions.getWorkflowRun({
      ...repo,
      run_id: runId,
    });
    attempts.set(runId, data.run_attempt ?? 1);
    await octokit.actions.reRunWorkflowFailedJobs({ ...repo, run_id: runId });
  }
  const deadline = Date.now() + RERUN_START_MS;
  while (Date.now() < deadline) {
    const started = await Promise.all(
      runIds.map(async (runId) => {
        const { data } = await octokit.actions.getWorkflowRun({
          ...repo,
          run_id: runId,
        });
        return (data.run_attempt ?? 1) > attempts.get(runId)!;
      }),
    );
    if (started.every(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("GitHub did not start the CI re-run within 2 minutes");
}

/**
 * The tests that failed on CI when every failed job failed only on tests in one file,
 * read from the summary Playwright prints at the end ("2 failed" and the test lines
 * under it); null when a job failed for any other reason.
 */
export function failuresOnlyIn(
  result: CiResult,
  testFile: string,
): string[] | null {
  const failed = new Set<string>();
  for (const failure of result.failures) {
    // eslint-disable-next-line no-control-regex
    const lines = failure.output.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
    const start = lines.findIndex((line) => /^\s*\d+ failed\s*$/.test(line));
    if (start === -1) return null;
    for (const line of lines.slice(start + 1)) {
      if (!line.includes(" › ")) break;
      const [, file, ...title] = line.trim().split(" › ");
      if (!file?.startsWith(`${testFile}:`)) return null;
      failed.add(title.join(" › "));
    }
  }
  return failed.size > 0 ? [...failed] : null;
}

async function jobLogTail(
  octokit: Octokit,
  repo: { owner: string; repo: string },
  jobId: number,
): Promise<string> {
  try {
    const { data } = await octokit.actions.downloadJobLogsForWorkflowRun({
      ...repo,
      job_id: jobId,
    });
    const text = typeof data === "string" ? data : String(data);
    // Drop the timestamp GitHub puts on every line.
    const lines = text
      .split("\n")
      .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, ""));
    return tail(lines.join("\n"), LOG_LINES);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `(could not download the job log: ${message})`;
  }
}

export function formatCiResult(result: CiResult): string {
  return result.jobs
    .map(
      (job) =>
        `${job.conclusion === "success" ? "✅" : job.conclusion === "skipped" ? "⏭️" : "❌"} ${job.name} (GitHub CI)`,
    )
    .join("\n");
}
