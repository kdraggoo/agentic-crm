import { z } from "zod";
import { BUILD_MODEL, BUILD_TIMEOUT_MS, buildEnv } from "../config.js";
import { runClaude } from "../claude.js";
import { BUILD_AGENT_COMMANDS, FILE_TOOLS, prompt } from "../build/agents.js";
import type { CiResult } from "../build/ci.js";

export const FixReportSchema = z.object({
  status: z
    .enum(["done", "blocked"])
    .describe(
      "blocked: no safe fix found; explain in blocked_reason and recommend what a human should do",
    ),
  root_cause: z
    .string()
    .describe("Why main fails, with the evidence (job, file and line)"),
  summary: z.string().describe("What changed and why, in a few sentences"),
  changed_files: z.array(z.string()),
  deleted_files: z
    .array(z.string())
    .describe(
      "Repo-relative files to delete (you can't delete files yourself); the pipeline deletes them",
    ),
  reviewer_notes: z
    .array(z.string())
    .describe(
      "Any test you changed and why, risks, and problems noticed but left alone",
    ),
  blocked_reason: z.string().nullable(),
});
export type FixReport = z.infer<typeof FixReportSchema>;

export interface FixAttemptInput {
  /** Markdown describing the failing CI run on main (see `formatIncident`). */
  incident: string;
  /** Recent commits on main and the newest one's diff. */
  history: string;
  attempt: number;
  /** Why the previous attempt failed: a failing check, the reviewer or CI. */
  previousFailure?: string;
  /** What the owner asked for after seeing the fix's pull request. */
  feedback?: string[];
}

/** The failing CI jobs on a main commit, with the end of each job's log. */
export function formatIncident(sha: string, ci: CiResult): string {
  return [
    `## GitHub CI fails on main at ${sha.slice(0, 7)}`,
    ...ci.failures.map((failure) =>
      [`### ${failure.name}`, "```", failure.output, "```"].join("\n"),
    ),
  ].join("\n\n");
}

export async function runFixAgent(
  dir: string,
  input: FixAttemptInput,
): Promise<{ report: FixReport; costUsd: number }> {
  const sections = [
    "Fix this failing CI run on main.",
    input.incident,
    "## Recent commits on main",
    input.history,
  ];
  if (input.feedback?.length) {
    sections.push(
      "## The owner's feedback on your fix",
      "Your fix is already in the working tree as the latest commit. Change it as asked:",
      ...input.feedback.map((line) => `> ${line}`),
    );
  }
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
    systemPrompt: await prompt("fixer.md"),
    prompt: sections.join("\n\n"),
    schema: FixReportSchema,
    cwd: dir,
    model: BUILD_MODEL,
    tools: [...FILE_TOOLS, "Bash"],
    allowedTools: [...FILE_TOOLS, ...BUILD_AGENT_COMMANDS],
    env: buildEnv(),
    timeoutMs: BUILD_TIMEOUT_MS,
  });
  return { report: output, costUsd };
}
