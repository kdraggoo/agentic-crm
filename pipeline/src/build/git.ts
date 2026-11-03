import { existsSync } from "node:fs";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_DIR, WORKTREES_DIR } from "../config.js";
import { run, runOrThrow } from "./run.js";

const GIT_AUTHOR = [
  "-c",
  "user.name=Agentic CRM Pipeline",
  "-c",
  "user.email=pipeline@agentic-crm.local",
];

export interface Worktree {
  dir: string;
  branch: string;
}

export function branchName(issueNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return `idea/${issueNumber}-${slug || "change"}`;
}

/**
 * Creates (or recreates) the idea's worktree on a fresh branch from origin/main.
 * Each approval starts clean, so a retried idea never inherits a failed attempt.
 */
export async function createWorktree(
  issueNumber: number,
  title: string,
): Promise<Worktree> {
  const branch = branchName(issueNumber, title);
  const dir = path.join(WORKTREES_DIR, `idea-${issueNumber}`);
  await runOrThrow("git", ["fetch", "--quiet", "origin", "main"], {
    cwd: REPO_DIR,
  });
  if (existsSync(dir)) await deleteWorktree(dir);
  await runOrThrow(
    "git",
    ["worktree", "add", "--quiet", "-B", branch, dir, "origin/main"],
    { cwd: REPO_DIR },
  );
  return { dir, branch };
}

/** Removes the idea's worktree, local branch and saved test report, once it is merged. */
export async function removeWorktree(
  issueNumber: number,
  title: string,
): Promise<void> {
  const dir = path.join(WORKTREES_DIR, `idea-${issueNumber}`);
  if (existsSync(dir)) await deleteWorktree(dir);
  await run("git", ["branch", "-D", branchName(issueNumber, title)], {
    cwd: REPO_DIR,
  });
  await rm(path.join(WORKTREES_DIR, `idea-${issueNumber}.test-report.json`), {
    force: true,
  });
}

/**
 * Deletes a worktree folder and git's record of it. `git worktree remove` gives up at
 * the first folder it can't empty, e.g. when macOS writes a .DS_Store into it
 * mid-delete, or when the folder is no longer a registered worktree. The rest is then
 * deleted with retries, and the stale record pruned.
 */
async function deleteWorktree(dir: string): Promise<void> {
  const removed = await run("git", ["worktree", "remove", "--force", dir], {
    cwd: REPO_DIR,
  });
  if (removed.code === 0) return;
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
  await runOrThrow("git", ["worktree", "prune"], { cwd: REPO_DIR });
}

/**
 * Opens the idea's existing worktree without resetting it, for reusing work already
 * committed there. Throws when there is none.
 */
export function existingWorktree(issueNumber: number, title: string): Worktree {
  const dir = path.join(WORKTREES_DIR, `idea-${issueNumber}`);
  if (!existsSync(dir)) throw new Error(`No worktree at ${dir}`);
  return { dir, branch: branchName(issueNumber, title) };
}

export async function headCommit(
  dir: string,
): Promise<{ sha: string; subject: string }> {
  const output = await runOrThrow("git", ["log", "-1", "--format=%H%n%s"], {
    cwd: dir,
  });
  const [sha, subject] = output.trim().split("\n");
  return { sha, subject };
}

/** Paths that differ from HEAD, including untracked files. */
export async function changedPaths(dir: string): Promise<string[]> {
  const output = await runOrThrow(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: dir },
  );
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^.* -> /, ""));
}

/** Throws away every uncommitted change, tracked or not. */
export async function discardChanges(dir: string): Promise<void> {
  await runOrThrow("git", ["checkout", "--", "."], { cwd: dir });
  await runOrThrow("git", ["clean", "-fdq"], { cwd: dir });
}

export async function commitPaths(
  dir: string,
  paths: string[],
  message: string,
): Promise<string> {
  await runOrThrow("git", ["add", "--", ...paths], { cwd: dir });
  await runOrThrow("git", [...GIT_AUTHOR, "commit", "--quiet", "-m", message], {
    cwd: dir,
  });
  return (await runOrThrow("git", ["rev-parse", "HEAD"], { cwd: dir })).trim();
}

export async function commitAll(dir: string, message: string): Promise<string> {
  await runOrThrow("git", ["add", "-A"], { cwd: dir });
  await runOrThrow("git", [...GIT_AUTHOR, "commit", "--quiet", "-m", message], {
    cwd: dir,
  });
  return (await runOrThrow("git", ["rev-parse", "HEAD"], { cwd: dir })).trim();
}

/** Files changed between a commit and the working tree (committed or not). */
export async function filesChangedSince(
  dir: string,
  commit: string,
): Promise<string[]> {
  const committed = await runOrThrow(
    "git",
    ["diff", "--name-only", commit, "HEAD"],
    { cwd: dir },
  );
  const pending = await changedPaths(dir);
  return [...new Set([...committed.split("\n").filter(Boolean), ...pending])];
}

/** Restores the given paths to their state at a commit. */
export async function restorePaths(
  dir: string,
  commit: string,
  paths: string[],
): Promise<void> {
  await runOrThrow("git", ["checkout", commit, "--", ...paths], { cwd: dir });
}

/**
 * Records the working tree, untracked files included, as a git tree, without touching
 * the index or the history. Returns the tree's id.
 */
export async function snapshotWorkingTree(dir: string): Promise<string> {
  const scratch = await mkdtemp(path.join(tmpdir(), "pipeline-snapshot-"));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, "index") };
  try {
    await runOrThrow("git", ["read-tree", "HEAD"], { cwd: dir, env });
    await runOrThrow("git", ["add", "-A"], { cwd: dir, env });
    return (await runOrThrow("git", ["write-tree"], { cwd: dir, env })).trim();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Files that differ between two snapshots. */
export async function filesChangedBetween(
  dir: string,
  before: string,
  after: string,
): Promise<string[]> {
  const output = await runOrThrow(
    "git",
    ["diff", "--name-only", "--no-renames", before, after],
    { cwd: dir },
  );
  return output.split("\n").filter(Boolean);
}

/** A file's content in a snapshot, or null when it isn't there. */
export async function fileInSnapshot(
  dir: string,
  snapshot: string,
  file: string,
): Promise<string | null> {
  const result = await run("git", ["show", `${snapshot}:${file}`], {
    cwd: dir,
  });
  return result.code === 0 ? result.output : null;
}

export async function push(dir: string, branch: string): Promise<void> {
  const result = await run(
    "git",
    ["push", "--force-with-lease", "--quiet", "-u", "origin", branch],
    { cwd: dir },
  );
  if (result.code !== 0) throw new Error(`git push failed:\n${result.output}`);
}

/** The last commit that touched a path. */
export async function lastCommitTouching(
  dir: string,
  file: string,
): Promise<{ sha: string; subject: string } | null> {
  const output = await runOrThrow(
    "git",
    ["log", "-1", "--format=%H%n%s", "--", file],
    { cwd: dir },
  );
  const [sha, subject] = output.trim().split("\n");
  return sha && subject ? { sha, subject } : null;
}

/**
 * Parks every uncommitted change in a temporary local commit (hooks skipped, never
 * pushed) so other work can run on a clean tree. `unpark` puts the changes back.
 */
export async function park(dir: string): Promise<void> {
  await runOrThrow("git", ["add", "-A"], { cwd: dir });
  await runOrThrow(
    "git",
    [
      ...GIT_AUTHOR,
      "commit",
      "--quiet",
      "--no-verify",
      "--allow-empty",
      "-m",
      "WIP (parked by the pipeline)",
    ],
    { cwd: dir },
  );
}

/** Undoes a `park` made just before HEAD's current commit, keeping its changes uncommitted. */
export async function unpark(dir: string, parkedSha: string): Promise<void> {
  // Re-apply the parked changes on top of whatever is committed now.
  await runOrThrow("git", ["cherry-pick", "--no-commit", parkedSha], {
    cwd: dir,
  });
  await runOrThrow("git", ["reset", "--quiet"], { cwd: dir });
}

/**
 * Files that would conflict if the working tree, as it stands, merged with the latest
 * main. GitHub runs no pull request workflows on a branch that conflicts.
 */
export async function conflictsWithMain(dir: string): Promise<string[]> {
  await runOrThrow("git", ["fetch", "--quiet", "origin", "main"], { cwd: dir });
  const base = (
    await runOrThrow("git", ["merge-base", "origin/main", "HEAD"], { cwd: dir })
  ).trim();
  const tree = await snapshotWorkingTree(dir);
  const merged = await run(
    "git",
    [
      "merge-tree",
      "--write-tree",
      "--name-only",
      `--merge-base=${base}`,
      "origin/main",
      tree,
    ],
    { cwd: dir },
  );
  if (merged.code === 0) return [];
  if (merged.code !== 1) {
    throw new Error(`git merge-tree failed:\n${merged.output}`);
  }
  // The merged tree's id, then the conflicted files, then a blank line and the messages.
  const [, ...lines] = merged.output.split("\n");
  const end = lines.indexOf("");
  return end === -1 ? lines : lines.slice(0, end);
}

/**
 * Replays the locked tests on the latest main and puts all the work since them back as
 * uncommitted changes, with conflict markers where it clashes. A rebase rather than a
 * merge, so the last commit touching the tests stays a test commit and comparing
 * against it shows only this idea's changes. Returns null, with the work back as it
 * was, when the tests themselves conflict.
 */
export async function moveOntoMain(
  dir: string,
  testCommit: string,
): Promise<{ testCommit: string; conflicted: string[] } | null> {
  await runOrThrow("git", ["reset", "--quiet", "--soft", testCommit], {
    cwd: dir,
  });
  await park(dir);
  const parked = (
    await runOrThrow("git", ["rev-parse", "HEAD"], { cwd: dir })
  ).trim();
  await runOrThrow("git", ["reset", "--quiet", "--hard", testCommit], {
    cwd: dir,
  });
  const rebased = await run(
    "git",
    [...GIT_AUTHOR, "rebase", "--quiet", "origin/main"],
    { cwd: dir },
  );
  if (rebased.code !== 0) {
    await runOrThrow("git", ["rebase", "--abort"], { cwd: dir });
    await unpark(dir, parked);
    return null;
  }
  const moved = (
    await runOrThrow("git", ["rev-parse", "HEAD"], { cwd: dir })
  ).trim();
  const picked = await run("git", ["cherry-pick", "--no-commit", parked], {
    cwd: dir,
  });
  const conflicted = (
    await runOrThrow("git", ["diff", "--name-only", "--diff-filter=U"], {
      cwd: dir,
    })
  )
    .split("\n")
    .filter(Boolean);
  if (picked.code !== 0 && conflicted.length === 0) {
    throw new Error(`git cherry-pick failed:\n${picked.output}`);
  }
  await runOrThrow("git", ["reset", "--quiet"], { cwd: dir });
  return { testCommit: moved, conflicted };
}

/** Which of these files still have conflict markers. */
export async function filesWithConflictMarkers(
  dir: string,
  files: string[],
): Promise<string[]> {
  if (files.length === 0) return [];
  const found = await run(
    "git",
    ["grep", "-lE", "--untracked", "^(<<<<<<<|>>>>>>>) ", "--", ...files],
    { cwd: dir },
  );
  if (found.code > 1) throw new Error(`git grep failed:\n${found.output}`);
  return found.output.split("\n").filter(Boolean);
}

/**
 * Deletes files the build agent asked to remove, since its sandbox can't. Only plain
 * files inside the worktree qualify (never `.git` or a protected path); returns the
 * paths actually deleted.
 */
export async function deleteFiles(
  dir: string,
  files: string[],
  protectedPaths: string[],
): Promise<string[]> {
  const deleted: string[] = [];
  for (const file of files) {
    const relative = path.relative(dir, path.resolve(dir, file));
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.split(path.sep)[0] === ".git" ||
      protectedPaths.includes(relative)
    ) {
      continue;
    }
    const stats = await lstat(path.join(dir, relative)).catch(() => null);
    if (!stats?.isFile() && !stats?.isSymbolicLink()) continue;
    await rm(path.join(dir, relative));
    deleted.push(relative);
  }
  return deleted;
}
