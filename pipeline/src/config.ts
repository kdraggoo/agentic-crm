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
