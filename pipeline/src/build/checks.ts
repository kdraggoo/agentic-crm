import { buildEnv } from "../config.js";
import { run, tail } from "./run.js";

/**
 * The checks every build must pass before a PR is opened. These run in code, after the
 * agent has finished, so an agent cannot report success while a check is failing.
 * They mirror the CI jobs in .github/workflows/check.yml that run without Supabase.
 */
const CHECKS: { name: string; command: string; args: string[] }[] = [
  { name: "typecheck", command: "npm", args: ["run", "typecheck"] },
  {
    name: "lint",
    command: "npx",
    args: ["eslint", "**/*.{mjs,ts,tsx}"],
  },
  {
    name: "format",
    command: "npx",
    args: [
      "prettier",
      "--config",
      "./.prettierrc.json",
      "--check",
      "**/*.{js,json,ts,tsx,css,md,html}",
    ],
  },
  {
    name: "unit tests",
    command: "npx",
    args: ["vitest", "--config", "vitest.config.ts", "--run"],
  },
  { name: "demo build", command: "npm", args: ["run", "build:demo"] },
  {
    name: "demo e2e",
    command: "npx",
    args: ["playwright", "test", "--config", "playwright.demo.config.ts"],
  },
];

const CHECK_TIMEOUT_MS = 15 * 60_000;

export interface CheckReport {
  passed: boolean;
  results: { name: string; passed: boolean }[];
  /** Output of the first failing check, trimmed for an agent prompt or a Discord message. */
  failure?: { name: string; output: string };
}

/** Runs the checks in order and stops at the first failure. */
export async function runChecks(dir: string): Promise<CheckReport> {
  const results: CheckReport["results"] = [];
  for (const check of CHECKS) {
    const result = await run(check.command, check.args, {
      cwd: dir,
      env: buildEnv(),
      timeoutMs: CHECK_TIMEOUT_MS,
    });
    const passed = result.code === 0;
    results.push({ name: check.name, passed });
    if (!passed) {
      return {
        passed: false,
        results,
        failure: { name: check.name, output: tail(result.output, 150) },
      };
    }
  }
  return { passed: true, results };
}

/** Installs dependencies in a fresh worktree. */
export async function installDependencies(dir: string): Promise<void> {
  const result = await run("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: dir,
    env: buildEnv(),
    timeoutMs: CHECK_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    throw new Error(`npm ci failed:\n${tail(result.output, 60)}`);
  }
}

/**
 * Regenerates registry.json, which must list every source file. The pre-commit
 * hook regenerates it too, but after staging, so the update was left out.
 */
export async function generateRegistry(dir: string): Promise<void> {
  const result = await run("npm", ["run", "registry:gen"], {
    cwd: dir,
    env: buildEnv(),
    timeoutMs: CHECK_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    throw new Error(`registry:gen failed:\n${tail(result.output, 60)}`);
  }
}

export function formatCheckResults(report: CheckReport): string {
  return report.results
    .map((result) => `${result.passed ? "✅" : "❌"} ${result.name}`)
    .join("\n");
}
