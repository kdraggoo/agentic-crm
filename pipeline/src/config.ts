import "dotenv/config";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo checkout the agents read. Defaults to the repo this pipeline lives in. */
export const REPO_DIR = path.resolve(
  process.env.REPO_DIR ?? path.join(here, "..", ".."),
);

export const PROMPTS_DIR = path.join(here, "..", "prompts");

/** Model alias or full name passed to `claude --model`. */
export const PO_MODEL = process.env.PO_MODEL ?? "opus";

/** Upper bound for one product-owner run. */
export const PO_TIMEOUT_MS = Number(process.env.PO_TIMEOUT_MS ?? 10 * 60_000);

/** Model for the build agent. */
export const BUILD_MODEL = process.env.BUILD_MODEL ?? "opus";

/** Model for the test agent. Defaults to the build agent's model. */
export const TEST_MODEL = process.env.TEST_MODEL ?? BUILD_MODEL;

/** Upper bounds for one test-agent run and one build-agent attempt. */
export const TEST_TIMEOUT_MS = Number(
  process.env.TEST_TIMEOUT_MS ?? 30 * 60_000,
);
export const BUILD_TIMEOUT_MS = Number(
  process.env.BUILD_TIMEOUT_MS ?? 45 * 60_000,
);

/** Build attempts per approval: the first try plus retries with the failing check output. */
export const MAX_BUILD_ATTEMPTS = Number(process.env.MAX_BUILD_ATTEMPTS ?? 3);

/** Where each idea's git worktree is created. Outside the repo so builds never touch it. */
export const WORKTREES_DIR = path.resolve(
  process.env.WORKTREES_DIR ?? path.join(REPO_DIR, "..", "worktrees"),
);

/**
 * Directory holding the Node version the app needs (see .nvmrc), put first on PATH for
 * agents and checks. Defaults to Homebrew's node@24, which is not linked onto PATH.
 */
export const NODE_BIN_DIR =
  process.env.NODE_BIN_DIR ?? "/opt/homebrew/opt/node@24/bin";

/** Environment for build-time commands: the right Node first on PATH, CI-style test runs. */
export function buildEnv(): NodeJS.ProcessEnv {
  return {
    PATH: `${NODE_BIN_DIR}:${process.env.PATH ?? ""}`,
    // CI mode: Playwright never reuses a stray server and forbids test.only.
    CI: "1",
  };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name} (see .env.example)`,
    );
  }
  return value;
}

/** GitHub token from GITHUB_TOKEN, falling back to the local `gh` login. */
export function githubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Set GITHUB_TOKEN or log in with `gh auth login`");
  }
}

export function githubRepo(): { owner: string; repo: string } {
  const [owner, repo] = requireEnv("GITHUB_REPO").split("/");
  if (!owner || !repo) throw new Error("GITHUB_REPO must look like owner/name");
  return { owner, repo };
}
