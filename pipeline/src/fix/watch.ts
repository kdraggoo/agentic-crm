import { Octokit } from "@octokit/rest";
import { githubRepo, githubToken } from "../config.js";
import { finishedCi, rerunCi, type CiResult } from "../build/ci.js";

export interface MainFailure {
  sha: string;
  ci: CiResult;
}

/** Main commits whose CI result has been handled, so each failure is acted on once. */
const handled = new Set<string>();

/**
 * Checks GitHub CI on main's latest commit. Returns the failure when every run has
 * finished and a job still fails after one re-run (which rules out flaky tests and
 * infrastructure hiccups); null when CI passed, is still running, or this commit was
 * already handled.
 */
export async function failingMain(): Promise<MainFailure | null> {
  const octokit = new Octokit({ auth: githubToken() });
  const { data } = await octokit.repos.getBranch({
    ...githubRepo(),
    branch: "main",
  });
  const sha = data.commit.sha;
  if (handled.has(sha)) return null;

  const ci = await finishedCi(sha);
  if (!ci) return null;
  if (ci.passed) {
    handled.add(sha);
    return null;
  }
  const rerun = await rerunCi(ci, sha);
  handled.add(sha);
  return rerun.passed ? null : { sha, ci: rerun };
}
