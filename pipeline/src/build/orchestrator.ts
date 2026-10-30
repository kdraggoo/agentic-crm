import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_BUILD_ATTEMPTS, WORKTREES_DIR } from "../config.js";
import { ClaudeTimeoutError } from "../claude.js";
import type { Spec } from "../po/schema.js";
import {
  TestReportSchema,
  runBuildAgent,
  runTestAgent,
  type BuildReport,
  type TestReport,
} from "./agents.js";
import {
  formatCheckResults,
  installDependencies,
  runChecks,
  type CheckReport,
} from "./checks.js";
import {
  changedPaths,
  commitAll,
  commitPaths,
  createWorktree,
  discardChanges,
  existingWorktree,
  filesChangedSince,
  headCommit,
  push,
  restorePaths,
} from "./git.js";

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
}

export type BuildOutcome =
  | {
      ok: true;
      branch: string;
      worktree: string;
      testReport: TestReport;
      buildReport: BuildReport;
      checks: CheckReport;
      attempts: number;
      costUsd: number;
    }
  | {
      ok: "tests-only";
      branch: string;
      worktree: string;
      testReport: TestReport;
      costUsd: number;
    }
  | {
      ok: false;
      branch: string;
      worktree: string;
      reason: string;
      costUsd: number;
    };

/**
 * Runs one approved spec through test → build → checks. Every rule the agents are told
 * about is also enforced here: the test agent can only add its test file, the build agent
 * can't change it, and nothing counts as done until the checks pass.
 */
export async function buildIdea(request: BuildRequest): Promise<BuildOutcome> {
  const { issueNumber, spec, progress } = request;
  let costUsd = 0;

  const prepared = request.reuseTests
    ? await reuseCommittedTests(issueNumber, request.title, progress)
    : await writeTests(request);
  const { dir, branch } = prepared;
  costUsd += prepared.costUsd;
  const fail = (reason: string): BuildOutcome => ({
    ok: false,
    branch,
    worktree: dir,
    reason,
    costUsd,
  });
  if (!prepared.ok) return fail(prepared.reason);
  const { testFile, testCommit, testReport } = prepared;
  const covered = testReport.criteria.filter((c) => c.covered).length;
  await progress(
    `🧪 Tests ${request.reuseTests ? "reused" : "written"}: ${covered}/${spec.acceptance_criteria.length} criteria covered by browser tests.`,
  );
  if (request.testsOnly) {
    return {
      ok: "tests-only",
      branch,
      worktree: dir,
      testReport,
      costUsd,
    };
  }

  // 2. Build, check, retry with the failure.
  let previousFailure: string | undefined;
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
    if (build.report.status === "blocked") {
      return fail(
        `The build agent is blocked: ${build.report.blocked_reason ?? build.report.summary}`,
      );
    }

    const changed = await filesChangedSince(dir, testCommit);
    if (changed.includes(testFile)) {
      await restorePaths(dir, testCommit, [testFile]);
      previousFailure = `You modified the locked test file ${testFile}. It has been restored. Make the implementation satisfy the test as written.`;
      continue;
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

    await commitAll(dir, commitMessage(issueNumber, spec, build.report));
    await push(dir, branch);
    return {
      ok: true,
      branch,
      worktree: dir,
      testReport,
      buildReport: build.report,
      checks,
      attempts: attempt,
      costUsd,
    };
  }

  return fail(
    `No passing build after ${MAX_BUILD_ATTEMPTS} attempts. Last problem:\n${previousFailure ?? "unknown"}`,
  );
}

type PreparedTests =
  | {
      ok: true;
      dir: string;
      branch: string;
      testFile: string;
      testCommit: string;
      testReport: TestReport;
      costUsd: number;
    }
  | { ok: false; dir: string; branch: string; reason: string; costUsd: number };

function testFileFor(issueNumber: number): string {
  return `e2e/demo/idea-${issueNumber}.spec.ts`;
}

/** The test report is kept beside the worktree, so a later run can reuse the tests. */
function testReportPath(issueNumber: number): string {
  return path.join(WORKTREES_DIR, `idea-${issueNumber}.test-report.json`);
}

/** Fresh worktree, then the test agent writes the acceptance tests and they are committed. */
async function writeTests(request: BuildRequest): Promise<PreparedTests> {
  const { issueNumber, spec, progress } = request;
  await progress("🌱 Creating a branch and installing dependencies…");
  const { dir, branch } = await createWorktree(issueNumber, request.title);
  await installDependencies(dir);

  const testFile = testFileFor(issueNumber);
  await progress("🧪 Test agent is writing acceptance tests from the spec…");
  const tests = await runTestAgent(dir, spec, testFile);
  if (!(await changedPaths(dir)).includes(testFile)) {
    return {
      ok: false,
      dir,
      branch,
      reason: `The test agent did not write ${testFile}.`,
      costUsd: tests.costUsd,
    };
  }
  // Keep only the test file; anything else the test agent touched is discarded.
  const testPath = path.join(dir, testFile);
  const testContent = await readFile(testPath, "utf8");
  await discardChanges(dir);
  await writeFile(testPath, testContent);
  const testCommit = await commitPaths(
    dir,
    [testFile],
    `${TEST_COMMIT_PREFIX}${issueNumber}: ${spec.title}`,
  );
  await writeFile(
    testReportPath(issueNumber),
    JSON.stringify(tests.report, null, 2),
  );
  return {
    ok: true,
    dir,
    branch,
    testFile,
    testCommit,
    testReport: tests.report,
    costUsd: tests.costUsd,
  };
}

const TEST_COMMIT_PREFIX = "Add acceptance tests for #";

/** Reopens the worktree at its test commit, dropping any earlier build attempt. */
async function reuseCommittedTests(
  issueNumber: number,
  title: string,
  progress: BuildRequest["progress"],
): Promise<PreparedTests> {
  const { dir, branch } = existingWorktree(issueNumber, title);
  const head = await headCommit(dir);
  if (!head.subject.startsWith(`${TEST_COMMIT_PREFIX}${issueNumber}:`)) {
    return {
      ok: false,
      dir,
      branch,
      reason: `The worktree's last commit is not the acceptance tests ("${head.subject}"); run without reusing tests.`,
      costUsd: 0,
    };
  }
  await progress("♻️ Reusing the committed acceptance tests…");
  await discardChanges(dir);
  const testReport = TestReportSchema.parse(
    JSON.parse(await readFile(testReportPath(issueNumber), "utf8")),
  );
  return {
    ok: true,
    dir,
    branch,
    testFile: testFileFor(issueNumber),
    testCommit: head.sha,
    testReport,
    costUsd: 0,
  };
}

function commitMessage(
  issueNumber: number,
  spec: Spec,
  report: BuildReport,
): string {
  return `Implement #${issueNumber}: ${spec.title}\n\n${report.summary}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
}

export function pullRequestBody(
  issueNumber: number,
  spec: Spec,
  outcome: Extract<BuildOutcome, { ok: true }>,
): string {
  const { testReport, buildReport, checks } = outcome;
  const coverage = testReport.criteria.map((criterion) => {
    const text = spec.acceptance_criteria[criterion.number - 1] ?? "";
    const how = criterion.covered
      ? criterion.tests.map((name) => `\`${name}\``).join("<br>")
      : `Not a browser test: ${criterion.reason ?? ""}`;
    return `| ${criterion.number} | ${text.replace(/\|/g, "\\|")} | ${how.replace(/\|/g, "\\|")} |`;
  });
  const list = (items: string[]) =>
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";

  return [
    `Implements the spec in #${issueNumber}. Built by the agent pipeline: the test agent wrote the acceptance tests from the spec first, then the build agent implemented it without changing them.`,
    "",
    "## Summary",
    buildReport.summary,
    "",
    "## Acceptance criteria → tests",
    `Locked test file: \`${testReport.test_file}\``,
    "",
    "| # | Criterion | Covered by |",
    "|---|---|---|",
    ...coverage,
    "",
    "## Unit tests added",
    list(buildReport.unit_tests_added),
    "",
    "## Docs updated",
    list(buildReport.docs_updated),
    "",
    "## Reviewer notes",
    list([
      ...buildReport.reviewer_notes,
      ...testReport.assumptions.map((a) => `Test assumption: ${a}`),
    ]),
    "",
    "## Pipeline checks",
    formatCheckResults(checks),
    "",
    `Attempts: ${outcome.attempts} · API-equivalent cost: $${outcome.costUsd.toFixed(2)}`,
    "",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  ].join("\n");
}
