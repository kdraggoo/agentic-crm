import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  BUILD_MODEL,
  BUILD_TIMEOUT_MS,
  PROMPTS_DIR,
  TEST_MODEL,
  TEST_TIMEOUT_MS,
  buildEnv,
} from "../config.js";
import { runClaude } from "../claude.js";
import { formatSpec } from "../po/format.js";
import type { Spec } from "../po/schema.js";

const FILE_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write"];

/** Shell commands the test agent may run. Anything else is denied. */
const TEST_AGENT_COMMANDS = [
  "Bash(npm run build:demo)",
  "Bash(npx playwright test:*)",
  "Bash(npx prettier:*)",
];

/** Shell commands the build agent may run: the project's checks, nothing else (no git). */
const BUILD_AGENT_COMMANDS = [
  "Bash(npm run typecheck)",
  "Bash(npm run build:demo)",
  "Bash(npx eslint:*)",
  "Bash(npx prettier:*)",
  "Bash(npx vitest:*)",
  "Bash(npx playwright test:*)",
];

export const TestReportSchema = z.object({
  test_file: z.string().describe("Repo-relative path of the test file written"),
  criteria: z.array(
    z.object({
      number: z.number().int().describe("Acceptance criterion number, from 1"),
      covered: z.boolean(),
      tests: z.array(z.string()).describe("Names of the tests covering it"),
      reason: z
        .string()
        .nullable()
        .describe(
          "Why it is not covered by a browser test, when covered is false",
        ),
    }),
  ),
  assumptions: z
    .array(z.string())
    .describe(
      "Labels, texts or behaviors the tests assume that the spec did not fix",
    ),
  verification: z
    .string()
    .describe(
      "What happened when the tests ran against the current demo build",
    ),
});
export type TestReport = z.infer<typeof TestReportSchema>;

export const BuildReportSchema = z.object({
  status: z.enum(["done", "blocked"]),
  summary: z.string().describe("What changed and why, in a few sentences"),
  changed_files: z.array(z.string()),
  unit_tests_added: z.array(z.string()),
  docs_updated: z.array(z.string()).describe("docs/product files updated"),
  reviewer_notes: z
    .array(z.string())
    .describe("Assumptions, trade-offs and problems noticed but left alone"),
  blocked_reason: z.string().nullable(),
});
export type BuildReport = z.infer<typeof BuildReportSchema>;

async function prompt(file: string): Promise<string> {
  return readFile(path.join(PROMPTS_DIR, file), "utf8");
}

export async function runTestAgent(
  dir: string,
  spec: Spec,
  testFile: string,
): Promise<{ report: TestReport; costUsd: number }> {
  const { output, costUsd } = await runClaude({
    systemPrompt: await prompt("test-writer.md"),
    prompt: [
      `Write the acceptance tests for this spec in \`${testFile}\`.`,
      formatSpec(spec),
    ].join("\n\n"),
    schema: TestReportSchema,
    cwd: dir,
    model: TEST_MODEL,
    tools: [...FILE_TOOLS, "Bash"],
    allowedTools: [...FILE_TOOLS, ...TEST_AGENT_COMMANDS],
    env: buildEnv(),
    timeoutMs: TEST_TIMEOUT_MS,
  });
  return { report: output, costUsd };
}

export interface BuildAttemptInput {
  spec: Spec;
  testReport: TestReport;
  attempt: number;
  /** Why the previous attempt failed: a failing check's output or a rule violation. */
  previousFailure?: string;
}

export async function runBuildAgent(
  dir: string,
  input: BuildAttemptInput,
): Promise<{ report: BuildReport; costUsd: number }> {
  const sections = [
    "Implement this spec.",
    formatSpec(input.spec),
    "## Locked acceptance tests",
    `File: \`${input.testReport.test_file}\` (read it; never modify it)`,
    "Coverage by acceptance criterion:",
    ...input.testReport.criteria.map((criterion) =>
      criterion.covered
        ? `- AC${criterion.number}: ${criterion.tests.join("; ")}`
        : `- AC${criterion.number}: not covered by a browser test (${criterion.reason ?? "no reason given"}); cover it with unit tests`,
    ),
    "Assumptions the tests make, which your implementation must match:",
    ...(input.testReport.assumptions.length > 0
      ? input.testReport.assumptions.map((assumption) => `- ${assumption}`)
      : ["- None"]),
  ];
  if (input.previousFailure) {
    sections.push(
      `## Attempt ${input.attempt}: the previous attempt failed`,
      "Your earlier changes are still in the working tree. Fix the cause of this failure:",
      "```",
      input.previousFailure,
      "```",
    );
  }

  const { output, costUsd } = await runClaude({
    systemPrompt: await prompt("builder.md"),
    prompt: sections.join("\n\n"),
    schema: BuildReportSchema,
    cwd: dir,
    model: BUILD_MODEL,
    tools: [...FILE_TOOLS, "Bash"],
    allowedTools: [...FILE_TOOLS, ...BUILD_AGENT_COMMANDS],
    env: buildEnv(),
    timeoutMs: BUILD_TIMEOUT_MS,
  });
  return { report: output, costUsd };
}
