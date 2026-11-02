import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  PROMPTS_DIR,
  REVIEW_MODEL,
  REVIEW_TIMEOUT_MS,
  buildEnv,
} from "../config.js";
import { runClaude } from "../claude.js";
import type { BuildReport } from "./agents.js";
import { runOrThrow } from "./run.js";

export const ReviewSchema = z.object({
  findings: z.array(
    z.object({
      severity: z.enum(["blocking", "note"]),
      category: z.enum([
        "bug",
        "test-bending",
        "scope",
        "backend-parity",
        "accessibility",
        "docs",
        "security",
        "other",
      ]),
      file: z.string().nullable(),
      summary: z.string().describe("One sentence"),
      detail: z.string().describe("The scenario or input, and what goes wrong"),
    }),
  ),
});
export type Review = z.infer<typeof ReviewSchema>;
export type ReviewFinding = Review["findings"][number];

/** Paths whose changes a spec rarely needs; a change there is worth a look. */
const SHARED_PATHS = ["src/components/admin/", "src/components/ui/"];
const MAX_DIFF_LINES = 4_000;
const NOT_REVIEWED = [
  ":(exclude)registry.json",
  ":(exclude)**/package-lock.json",
];

/** Diff of everything since the test commit, including new files. */
export async function diffSince(dir: string, commit: string): Promise<string> {
  // Intent-to-add makes new files show up in `git diff` without staging their content.
  await runOrThrow("git", ["add", "-A", "--intent-to-add"], { cwd: dir });
  return runOrThrow("git", ["diff", commit, "--", ".", ...NOT_REVIEWED], {
    cwd: dir,
  });
}

/**
 * Cheap mechanical flags for the reviewer to check. They point at the patterns
 * seen in earlier builds: shared components changed and app code that talks
 * about the tests it was changed for.
 */
export function automaticFlags(diff: string): string[] {
  const flags: string[] = [];
  let file = "";
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(\S+)/.exec(line);
    if (header) {
      file = header[1] ?? "";
      if (SHARED_PATHS.some((prefix) => file.startsWith(prefix))) {
        flags.push(`Shared component changed: ${file}`);
      }
      continue;
    }
    const isAppCode =
      file.startsWith("src/") && !/\.(test|spec)\.tsx?$/.test(file);
    const isAddedComment = /^\+\s*(\/\/|\/?\*)/.test(line);
    if (
      isAppCode &&
      isAddedComment &&
      /\b(tests?|playwright|e2e|test suite)\b/i.test(line)
    ) {
      flags.push(
        `Comment mentions tests in app code (${file}): ${line.slice(1).trim()}`,
      );
    }
  }
  return flags;
}

export async function runReviewer(
  dir: string,
  input: {
    /** What the change is for: the formatted spec, or the CI failure a fix addresses. */
    task: string;
    diff: string;
    flags: string[];
    buildReport: Pick<BuildReport, "summary" | "reviewer_notes">;
    previousFindings?: ReviewFinding[];
  },
): Promise<{ review: Review; costUsd: number }> {
  const diff = clipDiff(input.diff);
  const sections = [
    "Review this change.",
    input.task,
    "## Automatic flags",
    ...(input.flags.length > 0
      ? input.flags.map((flag) => `- ${flag}`)
      : ["- None"]),
    "## Build agent's notes",
    input.buildReport.summary,
    ...input.buildReport.reviewer_notes.map((note) => `- ${note}`),
  ];
  if (input.previousFindings?.length) {
    sections.push(
      "## Your previous blocking findings (the build agent has had one attempt to address them)",
      ...input.previousFindings.map(formatFinding),
    );
  }
  sections.push("## Diff", "```diff", diff, "```");

  const { output, costUsd } = await runClaude({
    systemPrompt: await readFile(path.join(PROMPTS_DIR, "reviewer.md"), "utf8"),
    prompt: sections.join("\n\n"),
    schema: ReviewSchema,
    cwd: dir,
    model: REVIEW_MODEL,
    tools: ["Read", "Grep", "Glob"],
    env: buildEnv(),
    timeoutMs: REVIEW_TIMEOUT_MS,
  });
  return { review: output, costUsd };
}

/** Keeps a diff within what a reviewer can read in one prompt. */
export function clipDiff(diff: string): string {
  const lines = diff.split("\n");
  return lines.length > MAX_DIFF_LINES
    ? `${lines.slice(0, MAX_DIFF_LINES).join("\n")}\n[… ${lines.length - MAX_DIFF_LINES} more lines; read the files directly]`
    : diff;
}

export function formatFinding(finding: ReviewFinding): string {
  const where = finding.file ? ` (${finding.file})` : "";
  return `- [${finding.severity}, ${finding.category}]${where} ${finding.summary}\n  ${finding.detail}`;
}
