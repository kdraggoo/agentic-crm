import { Octokit } from "@octokit/rest";
import { CI_TIMEOUT_MS, githubRepo, githubToken } from "../config.js";
import { tail } from "./run.js";

export interface CiResult {
  passed: boolean;
  /** Jobs that ran, with their conclusion. */
  jobs: { name: string; conclusion: string }[];
  /** Failed jobs with the end of their log, for the build agent. */
  failures: { name: string; output: string }[];
}

const POLL_MS = 30_000;
/** Workflows can register a little apart; wait this long after all runs finish. */
const SETTLE_MS = 30_000;
const LOG_LINES = 150;

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
        failures.push({
          name: job.name,
          output: await jobLogTail(octokit, repo, job.id),
        });
      }
    }
  }
  return { passed: failures.length === 0, jobs, failures };
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
