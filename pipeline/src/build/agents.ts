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

export const TestDisputeSchema = z.object({
  test: z.string().describe("Exact name of the disputed locked test"),
  assumption: z
    .string()
    .describe("What the test assumes about the app or its data"),
  actual: z.string().describe("What the app actually does, or should do"),
  evidence: z
    .string()
    .describe(
      "Where you verified it: file and line, component source, or the failing output",
    ),
  proposed_change: z
    .string()
    .describe("The smallest change to the test that would fix it"),
});
export type TestDispute = z.infer<typeof TestDisputeSchema>;

export const BuildReportSchema = z.object({
  status: z
    .enum(["done", "blocked", "test_dispute"])
    .describe(
      "test_dispute: a locked test is wrong; stop and list the disputes instead of bending the app",
    ),
  summary: z.string().describe("What changed and why, in a few sentences"),
  changed_files: z.array(z.string()),
  deleted_files: z
    .array(z.string())
    .describe(
      "Repo-relative files to delete (you can't delete files yourself); the pipeline deletes them",
    ),
  unit_tests_added: z.array(z.string()),
  docs_updated: z.array(z.string()).describe("docs/product files updated"),
  reviewer_notes: z
    .array(z.string())
    .describe("Assumptions, trade-offs and problems noticed but left alone"),
  blocked_reason: z.string().nullable(),
  test_disputes: z
    .array(TestDisputeSchema)
    .describe(
      "Locked tests you believe are wrong; empty unless status is test_dispute",
    ),
});
export type BuildReport = z.infer<typeof BuildReportSchema>;

export function formatDispute(dispute: TestDispute): string {
  return [
    `- **${dispute.test}**`,
    `  - Assumes: ${dispute.assumption}`,
    `  - Actually: ${dispute.actual}`,
    `  - Evidence: ${dispute.evidence}`,
    `  - Proposed: ${dispute.proposed_change}`,
  ].join("\n");
}

async function prompt(file: string): Promise<string> {
  return readFile(path.join(PROMPTS_DIR, file), "utf8");
}

export async function runTestAgent(
  dir: string,
  spec: Spec,
  testFile: string,
  /** Disputes a human accepted: revise the existing tests instead of writing new ones. */
  amend?: TestDispute[],
  /** Extra instruction, e.g. to finish a draft left by a run that timed out. */
  note?: string,
): Promise<{ report: TestReport; costUsd: number }> {
  const task = amend
    ? [
        `Revise the acceptance tests in \`${testFile}\`. The build agent disputed these tests and a human reviewer accepted the disputes. Change only what the disputes require, keep every other test as it is, and re-verify the whole file.`,
        "## Accepted disputes",
        ...amend.map(formatDispute),
      ]
    : [`Write the acceptance tests for this spec in \`${testFile}\`.`];
  const { output, costUsd } = await runClaude({
    systemPrompt: await prompt("test-writer.md"),
    prompt: [...task, ...(note ? [note] : []), formatSpec(spec)].join("\n\n"),
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
