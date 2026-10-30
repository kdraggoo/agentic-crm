import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TEST_TIMEOUT_MS, WORKTREES_DIR } from "../config.js";
import { ClaudeTimeoutError } from "../claude.js";
import type { Spec } from "../po/schema.js";
import {
  TestReportSchema,
  runTestAgent,
  type TestDispute,
  type TestReport,
} from "./agents.js";
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
import { runOrThrow } from "./run.js";

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
    costUsd: tests.costUsd,
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
 * Has the test agent correct the tests a human agreed were wrong. The build agent's
 * work, committed or not, is parked so the test agent sees the app as it is on the base
 * branch, then put back as uncommitted changes on top of the amended tests.
 */
export async function amendTests(
  locked: LockedTests,
  issueNumber: number,
  spec: Spec,
  disputes: TestDispute[],
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

  await progress("🧪 Test agent is correcting the disputed tests…");
  const tests = await runTestAgentWithRetry(
    dir,
    spec,
    testFile,
    progress,
    disputes,
  );
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
    costUsd: tests.costUsd,
  };
}

/**
 * Runs the test agent, and once more if it runs out of time after drafting the
 * file: the draft is kept, everything else it touched is reverted, and the second
 * run is told to finish and report rather than start over.
 */
async function runTestAgentWithRetry(
  dir: string,
  spec: Spec,
  testFile: string,
  progress: Progress,
  amend?: TestDispute[],
): Promise<Awaited<ReturnType<typeof runTestAgent>>> {
  try {
    return await runTestAgent(dir, spec, testFile, amend);
  } catch (error: unknown) {
    if (!(error instanceof ClaudeTimeoutError)) throw error;
    const testPath = path.join(dir, testFile);
    const draft = await readFile(testPath, "utf8").catch(() => null);
    if (draft === null) throw error;
    await discardChanges(dir);
    await writeFile(testPath, draft);
    await progress(
      "⏱️ The test agent ran out of time; one more run to finish its draft…",
    );
    return runTestAgent(
      dir,
      spec,
      testFile,
      amend,
      `A previous run drafted \`${testFile}\` but was stopped after ${Math.round(TEST_TIMEOUT_MS / 60_000)} minutes, before it reported. The draft is in the working tree; everything else it changed was reverted. Don't start over: review the draft, fix what's wrong, run it against the demo build once, and report. Keep verification short.`,
    );
  }
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
