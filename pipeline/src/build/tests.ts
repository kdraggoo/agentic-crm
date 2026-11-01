import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TEST_TIMEOUT_MS, WORKTREES_DIR, buildEnv } from "../config.js";
import { ClaudeNoReportError, ClaudeTimeoutError } from "../claude.js";
import type { Spec } from "../po/schema.js";
import { TestReportSchema, runTestAgent, type TestReport } from "./agents.js";
import { installDependencies } from "./checks.js";
import {
  changedPaths,
  commitPaths,
  createWorktree,
  discardChanges,
  existingWorktree,
  lastCommitTouching,
  park,
  restorePaths,
  unpark,
} from "./git.js";
import { run, runOrThrow, tail } from "./run.js";

/** The locked acceptance tests a build works against. */
export interface LockedTests {
  dir: string;
  branch: string;
  testFile: string;
  /** Last commit that wrote the test file; nothing may change it after this. */
  testCommit: string;
  testReport: TestReport;
  costUsd: number;
}

type Progress = (message: string) => Promise<void>;

/**
 * The test file still has lint errors after the pipeline's auto-fix and one more
 * test-agent run. Carries where the work is, so the build can fail with a report
 * instead of an unexpected error.
 */
export class TestLintError extends Error {
  constructor(
    readonly dir: string,
    readonly branch: string,
    readonly testFile: string,
    readonly lintOutput: string,
    readonly costUsd: number,
  ) {
    super(`Lint errors remain in ${testFile}:\n${lintOutput}`);
  }
}

const ADD_PREFIX = "Add acceptance tests for #";
const AMEND_PREFIX = "Amend acceptance tests for #";

export function testFileFor(issueNumber: number): string {
  return `e2e/demo/idea-${issueNumber}.spec.ts`;
}

/** The test report is kept beside the worktree, so a later run can reuse the tests. */
function testReportPath(issueNumber: number): string {
  return path.join(WORKTREES_DIR, `idea-${issueNumber}.test-report.json`);
}

/** Fresh worktree, then the test agent writes the acceptance tests and they are committed. */
export async function writeTests(
  issueNumber: number,
  title: string,
  spec: Spec,
  progress: Progress,
): Promise<LockedTests> {
  await progress("🌱 Creating a branch and installing dependencies…");
  const { dir, branch } = await createWorktree(issueNumber, title);
  await installDependencies(dir);

  const testFile = testFileFor(issueNumber);
  await progress("🧪 Test agent is writing acceptance tests from the spec…");
  const tests = await runTestAgentWithRetry(dir, spec, testFile, progress);
  const lint = await lintWithOneFix(dir, spec, testFile, progress);
  if (lint.errors) {
    throw new TestLintError(
      dir,
      branch,
      testFile,
      lint.errors,
      tests.costUsd + lint.costUsd,
    );
  }
  const testCommit = await keepOnlyTestFile(
    dir,
    testFile,
    `${ADD_PREFIX}${issueNumber}: ${spec.title}`,
  );
  await writeFile(
    testReportPath(issueNumber),
    JSON.stringify(tests.report, null, 2),
  );
  return {
    dir,
    branch,
    testFile,
    testCommit,
    testReport: tests.report,
    costUsd: tests.costUsd + lint.costUsd,
  };
}

/**
 * Reopens the idea's worktree with its committed tests. `keepWork` keeps the build
 * agent's uncommitted changes (resuming a paused build); otherwise they are dropped
 * (rebuilding against the same tests).
 */
export async function existingTests(
  issueNumber: number,
  title: string,
  options: { keepWork: boolean },
): Promise<LockedTests> {
  const { dir, branch } = existingWorktree(issueNumber, title);
  const testFile = testFileFor(issueNumber);
  const last = await lastCommitTouching(dir, testFile);
  const prefixes = [ADD_PREFIX, AMEND_PREFIX].map((p) => `${p}${issueNumber}:`);
  if (!last || !prefixes.some((prefix) => last.subject.startsWith(prefix))) {
    throw new Error(
      `No committed acceptance tests for #${issueNumber} in ${dir}; run a fresh build.`,
    );
  }
  if (!options.keepWork) await discardChanges(dir);
  const testReport = TestReportSchema.parse(
    JSON.parse(await readFile(testReportPath(issueNumber), "utf8")),
  );
  return {
    dir,
    branch,
    testFile,
    testCommit: last.sha,
    testReport,
    costUsd: 0,
  };
}

/**
 * Has the test agent revise the locked tests: correct the ones a human agreed were
 * wrong, or follow a spec revised after demo feedback. The build agent's
 * work, committed or not, is parked so the test agent sees the app as it is on the base
 * branch, then put back as uncommitted changes on top of the amended tests.
 */
export async function amendTests(
  locked: LockedTests,
  issueNumber: number,
  spec: Spec,
  revision: string,
  progress: Progress,
): Promise<LockedTests> {
  const { dir, testFile } = locked;
  await restorePaths(dir, locked.testCommit, [testFile]);
  // A dispute raised after CI has implementation commits on top of the tests; fold
  // them back into the working tree so all the build agent's work is parked together.
  await runOrThrow("git", ["reset", "--quiet", "--soft", locked.testCommit], {
    cwd: dir,
  });
  await park(dir);
  const parked = (
    await runOrThrow("git", ["rev-parse", "HEAD"], { cwd: dir })
  ).trim();
  await runOrThrow("git", ["reset", "--quiet", "--hard", "HEAD~1"], {
    cwd: dir,
  });

  await progress("🧪 Test agent is revising the acceptance tests…");
  const tests = await runTestAgentWithRetry(
    dir,
    spec,
    testFile,
    progress,
    revision,
  );
  const lint = await lintWithOneFix(dir, spec, testFile, progress);
  if (lint.errors) {
    // Put the worktree back as it was: the locked tests, with the build agent's work uncommitted.
    await discardChanges(dir);
    await unpark(dir, parked);
    throw new TestLintError(
      dir,
      locked.branch,
      testFile,
      lint.errors,
      tests.costUsd + lint.costUsd,
    );
  }
  const testCommit = await keepOnlyTestFile(
    dir,
    testFile,
    `${AMEND_PREFIX}${issueNumber}: ${spec.title}`,
  );
  await unpark(dir, parked);
  await writeFile(
    testReportPath(issueNumber),
    JSON.stringify(tests.report, null, 2),
  );
  return {
    ...locked,
    testCommit,
    testReport: tests.report,
    costUsd: tests.costUsd + lint.costUsd,
  };
}

/**
 * Runs the test agent, and once more if it runs out of time or ends without a report
 * after drafting the file: the draft is kept, everything else it touched is reverted,
 * and the second run is told to finish and report rather than start over.
 */
async function runTestAgentWithRetry(
  dir: string,
  spec: Spec,
  testFile: string,
  progress: Progress,
  revision?: string,
): Promise<Awaited<ReturnType<typeof runTestAgent>>> {
  try {
    return await runTestAgent(dir, spec, testFile, revision);
  } catch (error: unknown) {
    const timedOut = error instanceof ClaudeTimeoutError;
    if (!timedOut && !(error instanceof ClaudeNoReportError)) throw error;
    const testPath = path.join(dir, testFile);
    const draft = await readFile(testPath, "utf8").catch(() => null);
    if (draft === null) throw error;
    await discardChanges(dir);
    await writeFile(testPath, draft);
    await progress(
      timedOut
        ? "⏱️ The test agent ran out of time; one more run to finish its draft…"
        : "📝 The test agent finished without a report; one more run to report on its draft…",
    );
    const why = timedOut
      ? `was stopped after ${Math.round(TEST_TIMEOUT_MS / 60_000)} minutes, before it reported`
      : "ended without returning its structured report";
    return runTestAgent(
      dir,
      spec,
      testFile,
      revision,
      `A previous run drafted \`${testFile}\` but ${why}. The draft is in the working tree; everything else it changed was reverted. Don't start over: review the draft, fix what's wrong, run it against the demo build once, and report. Keep verification short.`,
    );
  }
}

/**
 * Auto-fixes and formats the test file with the repo's own eslint and prettier, so the
 * pre-commit hook accepts it. If eslint errors remain, the test agent gets one run to
 * fix just those, keeping its draft. Returns the errors still left, if any.
 */
async function lintWithOneFix(
  dir: string,
  spec: Spec,
  testFile: string,
  progress: Progress,
): Promise<{ errors?: string; costUsd: number }> {
  const errors = await lintTestFile(dir, testFile);
  if (!errors) return { costUsd: 0 };
  await progress(
    "🧹 The test file has lint errors; one more test-agent run to fix them…",
  );
  let costUsd = 0;
  try {
    // The report from this run is ignored: fixing lint doesn't change coverage.
    ({ costUsd } = await runTestAgent(
      dir,
      spec,
      testFile,
      [
        `\`${testFile}\` is written and verified, but eslint reports errors in it. Fix only these lint errors: don't change what any test does, don't rewrite the file, and don't build the demo or run the tests again. Run \`npx eslint ${testFile}\` to confirm they are gone, then report as before.`,
        "```",
        errors,
        "```",
      ].join("\n"),
    ));
  } catch (error: unknown) {
    // The file is linted again below either way, so a run that stops early is no worse.
    const stoppedEarly =
      error instanceof ClaudeTimeoutError ||
      error instanceof ClaudeNoReportError;
    if (!stoppedEarly) throw error;
  }
  return { errors: await lintTestFile(dir, testFile), costUsd };
}

/** Runs eslint --fix and prettier on the test file; returns eslint's remaining errors, if any. */
async function lintTestFile(
  dir: string,
  testFile: string,
): Promise<string | undefined> {
  const bin = (name: string) => path.join(dir, "node_modules", ".bin", name);
  const options = { cwd: dir, env: buildEnv(), timeoutMs: 5 * 60_000 };
  // Errors eslint can't fix show up in the final check below.
  await run(bin("eslint"), ["--fix", testFile], options);
  await runOrThrow(
    bin("prettier"),
    ["--config", "./.prettierrc.json", "--write", testFile],
    options,
  );
  const result = await run(bin("eslint"), [testFile], options);
  return result.code === 0 ? undefined : tail(result.output, 40);
}

/** Commits the test file alone; anything else the test agent touched is discarded. */
async function keepOnlyTestFile(
  dir: string,
  testFile: string,
  message: string,
): Promise<string> {
  if (!(await changedPaths(dir)).includes(testFile)) {
    throw new Error(`The test agent did not write ${testFile}.`);
  }
  const testPath = path.join(dir, testFile);
  const content = await readFile(testPath, "utf8");
  await discardChanges(dir);
  await writeFile(testPath, content);
  return commitPaths(dir, [testFile], message);
}
