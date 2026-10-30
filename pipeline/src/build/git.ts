import { existsSync } from "node:fs";
import { lstat, rm } from "node:fs/promises";
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
  if (existsSync(dir)) {
    await runOrThrow("git", ["worktree", "remove", "--force", dir], {
      cwd: REPO_DIR,
    });
  }
  await runOrThrow(
    "git",
    ["worktree", "add", "--quiet", "-B", branch, dir, "origin/main"],
    { cwd: REPO_DIR },
  );
  return { dir, branch };
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
