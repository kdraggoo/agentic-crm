import { MAX_BUILD_ATTEMPTS } from "../config.js";
import { ClaudeTimeoutError } from "../claude.js";
import type { Spec } from "../po/schema.js";
import {
  formatDispute,
  runBuildAgent,
  type TestDispute,
  type TestReport,
} from "./agents.js";
import { generateRegistry, runChecks } from "./checks.js";
import {
  failuresOnlyIn,
  rerunFailedJobs,
  waitForCi,
  type CiResult,
} from "./ci.js";
import {
  commitAll,
  deleteFiles,
  filesChangedSince,
  headCommit,
  push,
  restorePaths,
} from "./git.js";
import {
  commitMessage,
  pullRequestBody,
  type PublishedBuild,
} from "./report.js";
import {
  automaticFlags,
  diffSince,
  formatFinding,
  runReviewer,
  type ReviewFinding,
} from "./reviewer.js";
import {
  amendTests,
  existingTests,
  writeTests,
  type LockedTests,
} from "./tests.js";

export interface BuildRequest {
  issueNumber: number;
  title: string;
  spec: Spec;
  /** Called with short progress lines for the Discord thread. */
  progress: (message: string) => Promise<void>;
  /** Stop once the acceptance tests are committed (for trying the test agent alone). */
  testsOnly?: boolean;
  /**
   * Keep the acceptance tests already committed in the idea's worktree instead of
   * starting over (for retrying the build agent, e.g. with another model).
   */
  reuseTests?: boolean;
  /** Continue a build that paused on test disputes, with the human's decision. */
  resume?: { disputes: TestDispute[]; decision: "accepted" | "rejected" };
  /**
   * Opens or updates the pull request with this body and returns its URL. When set,
   * a build is only done once GitHub CI passes on it; without it, CI is skipped.
   */
  publish?: (branch: string, body: string) => Promise<string>;
}

interface Located {
  branch: string;
  worktree: string;
  costUsd: number;
}

export type BuildOutcome =
  | (Located & PublishedBuild & { ok: true; pullRequestUrl?: string })
  | (Located & { ok: "tests-only"; testReport: TestReport })
  | (Located & {
      ok: "disputed";
      disputes: TestDispute[];
      /** Who raised them: the build agent, or the pipeline after CI failed only on them. */
      raisedBy: "build-agent" | "ci";
    })
  | (Located & { ok: false; reason: string });

/**
 * Runs one approved spec through test → build → checks → review → CI. Every rule the
 * agents are told about is also enforced here: the test agent can only add its test
 * file, the build agent can't change it, and nothing counts as done until the checks,
 * the reviewer agent and GitHub CI all pass.
 */
export async function buildIdea(request: BuildRequest): Promise<BuildOutcome> {
  const { issueNumber, spec, progress } = request;
  let costUsd = 0;
  let locked: LockedTests;
  let previousFailure: string | undefined;

  if (request.resume) {
    locked = await existingTests(issueNumber, request.title, {
      keepWork: true,
    });
    if (request.resume.decision === "accepted") {
      locked = await amendTests(
        locked,
        issueNumber,
        spec,
        request.resume.disputes,
        progress,
      );
      previousFailure =
        "A human accepted your test disputes and the test agent corrected those tests in a new commit; read the test file again. Your earlier changes are still in the working tree: continue from them.";
    } else {
      previousFailure = [
        "A human reviewed your test disputes and decided the tests stand as written:",
        ...request.resume.disputes.map(formatDispute),
        "Make the app satisfy them without changing behavior the spec doesn't ask for. If that is truly impossible, report status blocked and explain why.",
      ].join("\n");
    }
  } else if (request.reuseTests) {
    await progress("♻️ Reusing the committed acceptance tests…");
    locked = await existingTests(issueNumber, request.title, {
      keepWork: false,
    });
  } else {
    locked = await writeTests(issueNumber, request.title, spec, progress);
  }
  costUsd += locked.costUsd;
  const { dir, branch, testFile, testCommit, testReport } = locked;
  const at: Located = { branch, worktree: dir, costUsd };
  const fail = (reason: string): BuildOutcome => ({
    ...at,
    costUsd,
    ok: false,
    reason,
  });

  const covered = testReport.criteria.filter((c) => c.covered).length;
  await progress(
    `🧪 Tests ready: ${covered}/${spec.acceptance_criteria.length} criteria covered by browser tests.`,
  );
  if (request.testsOnly) {
    return { ...at, costUsd, ok: "tests-only", testReport };
  }

  let previousFindings: ReviewFinding[] | undefined;
  for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
    await progress(
      `🔨 Build agent is implementing the spec (attempt ${attempt}/${MAX_BUILD_ATTEMPTS})…`,
    );
    let build: Awaited<ReturnType<typeof runBuildAgent>>;
    try {
      build = await runBuildAgent(dir, {
        spec,
        testReport,
        attempt,
        previousFailure,
      });
    } catch (error: unknown) {
      if (!(error instanceof ClaudeTimeoutError)) throw error;
      // The work so far stays in the worktree; the next attempt picks it up.
      await progress(`⏱️ Attempt ${attempt} ran out of time.`);
      previousFailure = `The previous attempt was stopped after ${Math.round(error.timeoutMs / 60_000)} minutes, before it finished. Its changes are still in the working tree: review them, finish the work, and avoid re-running slow commands (the full e2e suite, repeated demo builds) more than needed.`;
      continue;
    }
    costUsd += build.costUsd;
    const report = build.report;
    if (report.status === "blocked") {
      return fail(
        `The build agent is blocked: ${report.blocked_reason ?? report.summary}`,
      );
    }

    const deleted = await deleteFiles(dir, report.deleted_files, [testFile]);
    if (deleted.length > 0) {
      await progress(
        `🗑️ Deleted at the build agent's request: ${deleted.join(", ")}`,
      );
    }
    const changed = await filesChangedSince(dir, testCommit);
    if (changed.includes(testFile)) {
      await restorePaths(dir, testCommit, [testFile]);
      if (report.status !== "test_dispute") {
        previousFailure = `You modified the locked test file ${testFile}. It has been restored. Make the implementation satisfy the test as written, or report a test dispute.`;
        continue;
      }
    }
    if (report.status === "test_dispute" || report.test_disputes.length > 0) {
      // Pause for a human: the work stays uncommitted in the worktree.
      return {
        ...at,
        costUsd,
        ok: "disputed",
        disputes: report.test_disputes,
        raisedBy: "build-agent",
      };
    }
    if (
      spec.docs_updates.length > 0 &&
      !changed.some((file) => file.startsWith("docs/product/"))
    ) {
      previousFailure = `The spec requires docs/product updates (${spec.docs_updates.join("; ")}), but no file under docs/product/ changed.`;
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

    await progress("🧐 Reviewer agent is checking the diff…");
    const diff = await diffSince(dir, testCommit);
    const reviewed = await runReviewer(dir, {
      spec,
      diff,
      flags: automaticFlags(diff),
      buildReport: report,
      previousFindings,
    });
    costUsd += reviewed.costUsd;
    const blocking = reviewed.review.findings.filter(
      (finding) => finding.severity === "blocking",
    );
    if (blocking.length > 0) {
      await progress(
        `🧐 Reviewer requested changes:\n${blocking.map((f) => `- ${f.summary}`).join("\n")}`,
      );
      previousFindings = blocking;
      previousFailure = [
        "The checks passed, but the reviewer agent found problems you must fix:",
        ...blocking.map(formatFinding),
        "If you believe a finding is wrong, keep your code and explain why in reviewer_notes; the reviewer reads your notes on the next review.",
      ].join("\n");
      continue;
    }

    await generateRegistry(dir);
    await commitAll(dir, commitMessage(issueNumber, spec, report, attempt));
    await push(dir, branch);
    const published: PublishedBuild = {
      testReport,
      buildReport: report,
      checks,
      review: {
        findings: reviewed.review.findings.filter(
          (finding) => finding.severity === "note",
        ),
      },
      attempts: attempt,
      costUsd,
    };
    if (!request.publish) return { ...at, ...published, costUsd, ok: true };

    const pullRequestUrl = await request.publish(
      branch,
      pullRequestBody(issueNumber, spec, published),
    );
    await progress(
      `📬 Pull request: ${pullRequestUrl}\nWaiting for GitHub CI (the full suite, including e2e against Supabase)…`,
    );
    const sha = (await headCommit(dir)).sha;
    let ci = await waitForCi(sha);
    if (!ci.passed) {
      // Rule out a flaky test or an infrastructure hiccup before blaming the code.
      await progress(
        `🔁 GitHub CI failed (${ci.failures.map((f) => f.name).join(", ")}); re-running the failed jobs once…`,
      );
      ci = await rerunCi(ci, sha);
    }
    const lockedFailures = ci.passed ? null : failuresOnlyIn(ci, testFile);
    if (lockedFailures) {
      // The locked tests pass locally but fail twice on CI: a human decides whether
      // the tests or the app are at fault, instead of spending attempts on it.
      await progress(
        "⚖️ CI failed twice, only on locked acceptance tests that pass locally.",
      );
      return {
        ...at,
        costUsd,
        ok: "disputed",
        disputes: lockedFailures.map((test) => ciDispute(test, ci)),
        raisedBy: "ci",
      };
    }
    if (!ci.passed) {
      await progress(
        `❌ GitHub CI failed: ${ci.failures.map((f) => f.name).join(", ")}`,
      );
      previousFailure = [
        "Your change passed the local checks but failed GitHub CI. CI also runs the e2e suite against a real Supabase database, where things that work in the demo can fail (database constraints, values a form sends by default, filters the API can't express).",
        ...ci.failures.map((f) => `### ${f.name}\n${f.output}`),
      ].join("\n\n");
      continue;
    }
    const done = { ...published, ci };
    await request.publish(branch, pullRequestBody(issueNumber, spec, done));
    return { ...at, ...done, costUsd, ok: true, pullRequestUrl };
  }

  return fail(
    `No passing build after ${MAX_BUILD_ATTEMPTS} attempts. Last problem:\n${previousFailure ?? "unknown"}`,
  );
}

async function rerunCi(failed: CiResult, sha: string): Promise<CiResult> {
  try {
    await rerunFailedJobs(failed.failedRunIds);
  } catch {
    return failed;
  }
  return waitForCi(sha);
}

const DISPUTE_LOG_LINES = 25;

function ciDispute(test: string, ci: CiResult): TestDispute {
  const log = ci.failures
    .map((failure) => failure.output)
    .join("\n")
    .split("\n");
  const at = log.findIndex((line) => line.includes(test));
  return {
    test,
    assumption:
      "The test passes against the local demo build but failed on GitHub CI twice, so it likely depends on timing: it acts before the page or form has finished loading, or expects state that a slower machine reaches later.",
    actual:
      "Every other check passed, including this test locally. It may also be a real app bug that only shows when data loads slowly; reject the dispute if you think so.",
    evidence: [
      "GitHub CI log:",
      "```",
      ...log.slice(Math.max(0, at), Math.max(0, at) + DISPUTE_LOG_LINES),
      "```",
    ].join("\n"),
    proposed_change:
      "Make the test robust on a slower machine: before interacting, wait for a sign that the page's data has loaded (a field shows its saved value, a list shows its rows), and don't rely on timing.",
  };
}
