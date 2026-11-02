import { MAX_BUILD_ATTEMPTS } from "../config.js";
import { ClaudeTimeoutError } from "../claude.js";
import { installDependencies, runChecks } from "../build/checks.js";
import { generateRegistry, type CheckReport } from "../build/checks.js";
import { finishedCi, rerunCi, waitForCi, type CiResult } from "../build/ci.js";
import {
  commitAll,
  createWorktree,
  deleteFiles,
  existingWorktree,
  filesChangedSince,
  headCommit,
  push,
} from "../build/git.js";
import { restoreDemoConfig } from "../build/guardrails.js";
import { reviewSecurity } from "../build/security.js";
import {
  automaticFlags,
  diffSince,
  formatFinding,
  runReviewer,
  type Review,
  type ReviewFinding,
} from "../build/reviewer.js";
import { runOrThrow } from "../build/run.js";
import { fixCommitMessage, fixPullRequestBody } from "./report.js";
import { formatIncident, runFixAgent, type FixReport } from "./agent.js";

const HISTORY_COMMITS = 8;
const NEWEST_DIFF_LINES = 400;

export interface FixRequest {
  issueNumber: number;
  title: string;
  /** The main commit whose CI failed. */
  sha: string;
  progress: (message: string) => Promise<void>;
  /**
   * Continue from the kept worktree instead of starting from main: after a failed
   * fix (with the problem that stopped it), or with the owner's feedback on its PR.
   */
  continueWith?: { lastFailure?: string; feedback?: string[] };
  /** Opens or updates the pull request with this body and returns its URL. */
  publish: (branch: string, body: string) => Promise<string>;
}

interface Located {
  branch: string;
  worktree: string;
  costUsd: number;
}

/** What a fix's pull request describes. */
export interface PublishedFix {
  sha: string;
  failedJobs: string[];
  report: FixReport;
  checks: CheckReport;
  review: Review;
  ci?: CiResult;
  attempts: number;
  costUsd: number;
}

export type FixOutcome =
  | (Located & PublishedFix & { ok: true; pullRequestUrl: string })
  | (Located & { ok: false; reason: string });

/**
 * Fixes a failing CI run on main: the fixer agent changes the code, then the same
 * gates as an idea build apply (demo guardrails, full checks, reviewer, GitHub CI)
 * before the pull request is handed to the owner.
 */
export async function fixMain(request: FixRequest): Promise<FixOutcome> {
  const { issueNumber, title, sha, progress, continueWith } = request;
  const failing = await finishedCi(sha);
  if (!failing || failing.passed) {
    throw new Error(
      `GitHub CI on ${sha.slice(0, 7)} hasn't failed (or is still running); nothing to fix.`,
    );
  }
  const failedJobs = failing.failures.map((failure) => failure.name);
  const incident = formatIncident(sha, failing);

  let worktree;
  if (continueWith) {
    worktree = existingWorktree(issueNumber, title);
  } else {
    await progress(
      "🌱 Creating a branch from main and installing dependencies…",
    );
    worktree = await createWorktree(issueNumber, title);
    await installDependencies(worktree.dir);
  }
  const { dir, branch } = worktree;
  const base = (
    await runOrThrow("git", ["merge-base", "HEAD", "origin/main"], { cwd: dir })
  ).trim();
  const history = await recentHistory(dir, sha);

  let costUsd = 0;
  const fail = (reason: string): FixOutcome => ({
    branch,
    worktree: dir,
    costUsd,
    ok: false,
    reason,
  });
  let previousFailure = continueWith?.lastFailure
    ? `Your previous fix didn't pass and was stopped. Your changes are still in the working tree: continue from them.\n\n${continueWith.lastFailure}`
    : undefined;
  let previousFindings: ReviewFinding[] | undefined;

  for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
    await progress(
      `🩹 Fixer agent is working on it (attempt ${attempt}/${MAX_BUILD_ATTEMPTS})…`,
    );
    let fix: Awaited<ReturnType<typeof runFixAgent>>;
    try {
      fix = await runFixAgent(dir, {
        incident,
        history,
        attempt,
        previousFailure,
        feedback: attempt === 1 ? continueWith?.feedback : undefined,
      });
    } catch (error: unknown) {
      if (!(error instanceof ClaudeTimeoutError)) throw error;
      await progress(`⏱️ Attempt ${attempt} ran out of time.`);
      previousFailure = `The previous attempt was stopped after ${Math.round(error.timeoutMs / 60_000)} minutes, before it finished. Its changes are still in the working tree: finish the fix without re-running slow commands more than needed.`;
      continue;
    }
    costUsd += fix.costUsd;
    const report = fix.report;
    if (report.status === "blocked") {
      return fail(
        `The fixer agent is blocked: ${report.blocked_reason ?? report.summary}\n\nRoot cause it found: ${report.root_cause}`,
      );
    }

    const deleted = await deleteFiles(dir, report.deleted_files, []);
    if (deleted.length > 0) {
      await progress(
        `🗑️ Deleted at the fixer's request: ${deleted.join(", ")}`,
      );
    }
    const changed = await filesChangedSince(dir, base);
    const restoredConfig = await restoreDemoConfig(dir, base, changed);
    if (restoredConfig.length > 0) {
      await progress(
        `↩️ Restored the demo setup the fixer changed: ${restoredConfig.join(", ")}`,
      );
      previousFailure = `You changed how the demo runs (${restoredConfig.join(", ")}); it has been restored. Fix the cause in the app or the test instead.`;
      continue;
    }
    if (changed.length === 0) {
      previousFailure =
        "You didn't change any file. Main's CI is still failing; find the cause and fix it, or report status blocked.";
      continue;
    }

    await progress("🔍 Running the full checks…");
    const checks = await runChecks(dir);
    if (!checks.passed) {
      const failure = checks.failure!;
      await progress(`❌ Check failed: ${failure.name}`);
      previousFailure = `The "${failure.name}" check failed:\n${failure.output}`;
      continue;
    }

    await progress("🧐 Reviewer agent is checking the fix…");
    const diff = await diffSince(dir, base);
    const reviewTask = [
      incident,
      "## Root cause, according to the fixer agent",
      report.root_cause,
    ].join("\n\n");
    const reviewed = await runReviewer(dir, {
      task: reviewTask,
      diff,
      flags: [...automaticFlags(diff), ...fixFlags(changed)],
      buildReport: report,
      previousFindings: previousFindings?.filter(
        (finding) => finding.category !== "security",
      ),
    });
    costUsd += reviewed.costUsd;
    const security = await reviewSecurity(
      dir,
      { task: reviewTask, diff, previousFindings },
      progress,
    );
    costUsd += security.costUsd;
    const findings = [...reviewed.review.findings, ...security.findings];
    const blocking = findings.filter(
      (finding) => finding.severity === "blocking",
    );
    if (blocking.length > 0) {
      await progress(
        `🧐 Reviewers requested changes:\n${blocking.map((f) => `- ${f.summary}`).join("\n")}`,
      );
      previousFindings = blocking;
      previousFailure = [
        "The checks passed, but the reviewer agents found problems you must fix (the security reviewer's are marked security):",
        ...blocking.map(formatFinding),
        "If you believe a finding is wrong, keep your code and explain why in reviewer_notes; the reviewer reads your notes on the next review.",
      ].join("\n");
      continue;
    }

    await generateRegistry(dir);
    await commitAll(dir, fixCommitMessage(failedJobs, report));
    await push(dir, branch);
    const published: PublishedFix = {
      sha,
      failedJobs,
      report,
      checks,
      review: {
        findings: findings.filter((finding) => finding.severity === "note"),
      },
      attempts: attempt,
      costUsd,
    };
    const pullRequestUrl = await request.publish(
      branch,
      fixPullRequestBody(issueNumber, published),
    );
    await progress(
      `📬 Pull request: ${pullRequestUrl}\nWaiting for GitHub CI…`,
    );
    const head = (await headCommit(dir)).sha;
    let ci = await waitForCi(head);
    if (!ci.passed) {
      await progress(
        `🔁 GitHub CI failed (${ci.failures.map((f) => f.name).join(", ")}); re-running the failed jobs once…`,
      );
      ci = await rerunCi(ci, head);
    }
    if (!ci.passed) {
      await progress(
        `❌ GitHub CI failed: ${ci.failures.map((f) => f.name).join(", ")}`,
      );
      previousFailure = [
        "Your fix passed the local checks but GitHub CI still fails:",
        ...ci.failures.map((f) => `### ${f.name}\n${f.output}`),
      ].join("\n\n");
      continue;
    }
    const done = { ...published, ci };
    await request.publish(branch, fixPullRequestBody(issueNumber, done));
    return {
      branch,
      worktree: dir,
      ...done,
      costUsd,
      ok: true,
      pullRequestUrl,
    };
  }

  return fail(
    `No passing fix after ${MAX_BUILD_ATTEMPTS} attempts. Last problem:\n${previousFailure ?? "unknown"}`,
  );
}

/** The latest commits up to the failing one, and the failing commit's own diff. */
async function recentHistory(dir: string, sha: string): Promise<string> {
  const log = await runOrThrow(
    "git",
    [
      "log",
      `-${HISTORY_COMMITS}`,
      "--format=%n%h %s (%an, %ar)",
      "--stat",
      sha,
    ],
    { cwd: dir },
  );
  const diff = (
    await runOrThrow("git", ["show", "--format=", sha], { cwd: dir })
  ).split("\n");
  const shown =
    diff.length > NEWEST_DIFF_LINES
      ? [
          ...diff.slice(0, NEWEST_DIFF_LINES),
          `[… ${diff.length - NEWEST_DIFF_LINES} more lines; read the files directly]`,
        ]
      : diff;
  return [
    "```",
    log.trim(),
    "```",
    `Diff of ${sha.slice(0, 7)}, the failing commit:`,
    "```diff",
    ...shown,
    "```",
  ].join("\n");
}

/** Changes a fix should only make with a good reason: tests and how they run. */
function fixFlags(changed: string[]): string[] {
  return changed
    .filter(
      (file) =>
        /\.(test|spec)\.tsx?$/.test(file) ||
        file.startsWith("e2e/") ||
        file.startsWith(".github/") ||
        /(playwright|vitest|vite|tsconfig|eslint)[^/]*\.(ts|js|json|mjs)$/.test(
          file,
        ),
    )
    .map((file) => `A fix changed a test or test setup: ${file}`);
}
