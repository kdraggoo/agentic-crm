import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";
import {
  DOCS_MODEL,
  DOCS_TIMEOUT_MS,
  PROMPTS_DIR,
  buildEnv,
} from "../config.js";
import { runClaude } from "../claude.js";
import { FILE_TOOLS } from "./agents.js";
import { runChecks } from "./checks.js";
import {
  fileInSnapshot,
  filesChangedBetween,
  restorePaths,
  snapshotWorkingTree,
} from "./git.js";
import { clipDiff } from "./reviewer.js";
import { run } from "./run.js";

const DocsReportSchema = z.object({
  summary: z
    .string()
    .describe("What changed and why, or that nothing needed to"),
  gaps: z
    .array(z.string())
    .describe(
      "Documentation problems you couldn't fix: which file and what should change",
    ),
});

/** What the documentation agent did, for the reviewers and the pull request. */
export interface DocsResult {
  summary: string;
  /** Files it changed and the pipeline kept. */
  updated: string[];
  /** What it couldn't fix, and any of its changes the pipeline reverted. */
  gaps: string[];
  costUsd: number;
}

/** Documentation that isn't the agent's to change, though it's Markdown. */
const OFF_LIMITS_DOCS = [
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "CODE_OF_CONDUCT.md",
  "LICENSE.md",
  "MEMORY.md",
];
const OFF_LIMITS_PREFIXES = [
  ".claude/",
  ".devcontainer/",
  ".github/",
  "pipeline/",
];

/** The translations hold the app's help text: tooltips, helper text, empty states. */
const HELP_TEXT_FILES = [
  "src/components/atomic-crm/providers/commons/englishCrmMessages.ts",
  "src/components/atomic-crm/providers/commons/frenchCrmMessages.ts",
];

/** Where the agent may edit comments. Other code, such as the demo setup, is off limits. */
const COMMENTED_CODE_PREFIXES = ["src/", "supabase/functions/", "e2e/"];

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

/** True when two versions of a TypeScript file differ only in comments and layout. */
export function isCommentOnlyChange(
  file: string,
  before: string,
  after: string,
): boolean {
  const printer = ts.createPrinter({ removeComments: true });
  return (
    printer.printFile(parse(file, before)) ===
    printer.printFile(parse(file, after))
  );
}

/** The shape of a messages file: its keys and code, without the text of its values. */
function withoutMessageText(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (
    ts.isStringLiteralLike(node) &&
    ts.isPropertyAssignment(node.parent) &&
    node.parent.initializer === node
  ) {
    return "<text>";
  }
  const children: string[] = [];
  ts.forEachChild(node, (child) => {
    children.push(withoutMessageText(child, sourceFile));
  });
  return children.length > 0
    ? `${node.kind}(${children.join(",")})`
    : node.getText(sourceFile);
}

/** True when two versions of a messages file have the same keys and differ only in text. */
export function isMessageTextOnlyChange(
  file: string,
  before: string,
  after: string,
): boolean {
  const beforeFile = parse(file, before);
  const afterFile = parse(file, after);
  return (
    withoutMessageText(beforeFile, beforeFile) ===
    withoutMessageText(afterFile, afterFile)
  );
}

function isDocumentation(file: string): boolean {
  return (
    /\.mdx?$/.test(file) &&
    !OFF_LIMITS_DOCS.includes(file) &&
    !OFF_LIMITS_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
}

/**
 * Why the documentation agent may not make this change, or null when it may. These
 * rules are what keep it from changing how the app behaves after the checks passed.
 */
export function docsChangeProblem(
  file: string,
  before: string | null,
  after: string | null,
  lockedFiles: string[],
): string | null {
  if (lockedFiles.includes(file))
    return "locked acceptance tests are off limits";
  if (before === null) return "it can't add files";
  if (after === null) return "it can't delete files";
  if (isDocumentation(file)) return null;
  if (HELP_TEXT_FILES.includes(file)) {
    return isMessageTextOnlyChange(file, before, after)
      ? null
      : "in the messages files it can only change the text of existing keys";
  }
  if (!COMMENTED_CODE_PREFIXES.some((prefix) => file.startsWith(prefix))) {
    return "this file is off limits";
  }
  if (!/\.tsx?$/.test(file)) return "it can only edit comments in TypeScript";
  return isCommentOnlyChange(file, before, after)
    ? null
    : "in code it can only change comments";
}

async function revert(
  dir: string,
  snapshot: string,
  files: string[],
): Promise<void> {
  for (const file of files) {
    if ((await fileInSnapshot(dir, snapshot, file)) === null) {
      await rm(path.join(dir, file), { force: true });
    } else {
      await restorePaths(dir, snapshot, [file]);
    }
  }
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Runs the documentation agent over a change that passed its checks, then keeps only
 * the edits it's allowed to make. It never fails a build: anything it can't do goes
 * in `gaps`, which reach the reviewers and the pull request.
 */
export async function updateDocs(
  dir: string,
  input: { task: string; diff: string; lockedFiles: string[] },
  progress: (message: string) => Promise<void>,
): Promise<DocsResult> {
  await progress("📝 Documentation agent is checking what the change affects…");
  const snapshot = await snapshotWorkingTree(dir);
  let report: z.infer<typeof DocsReportSchema>;
  let costUsd: number;
  try {
    const result = await runClaude({
      systemPrompt: await readFile(
        path.join(PROMPTS_DIR, "documentation.md"),
        "utf8",
      ),
      prompt: [
        "Update the documentation for this change.",
        input.task,
        "## Diff",
        "```diff",
        clipDiff(input.diff),
        "```",
      ].join("\n\n"),
      schema: DocsReportSchema,
      cwd: dir,
      model: DOCS_MODEL,
      tools: FILE_TOOLS,
      env: buildEnv(),
      timeoutMs: DOCS_TIMEOUT_MS,
    });
    report = result.output;
    costUsd = result.costUsd;
  } catch (error: unknown) {
    const changed = await filesChangedBetween(
      dir,
      snapshot,
      await snapshotWorkingTree(dir),
    );
    await revert(dir, snapshot, changed);
    const message = error instanceof Error ? error.message : String(error);
    await progress("⚠️ The documentation agent didn't finish; moving on.");
    return {
      summary:
        "The documentation agent didn't finish, so docs weren't checked.",
      updated: [],
      gaps: [`The documentation agent failed: ${message.slice(0, 500)}`],
      costUsd: 0,
    };
  }

  const changed = await filesChangedBetween(
    dir,
    snapshot,
    await snapshotWorkingTree(dir),
  );
  const gaps = [...report.gaps];
  const kept: string[] = [];
  for (const file of changed) {
    const problem = docsChangeProblem(
      file,
      await fileInSnapshot(dir, snapshot, file),
      await readIfPresent(path.join(dir, file)),
      input.lockedFiles,
    );
    if (problem) {
      await revert(dir, snapshot, [file]);
      gaps.push(`Reverted its change to \`${file}\`: ${problem}.`);
    } else {
      kept.push(file);
    }
  }

  // Comments and messages sit in code the checks cover; Markdown doesn't.
  const code = kept.filter((file) => /\.tsx?$/.test(file));
  if (code.length === 0) {
    await reportDocs(kept, progress);
    return { summary: report.summary, updated: kept, gaps, costUsd };
  }
  await run(
    "npx",
    ["prettier", "--config", "./.prettierrc.json", "--write", ...code],
    {
      cwd: dir,
      env: buildEnv(),
    },
  );
  const checks = await runChecks(dir);
  if (checks.passed) {
    await reportDocs(kept, progress);
    return { summary: report.summary, updated: kept, gaps, costUsd };
  }
  await revert(dir, snapshot, code);
  const updated = kept.filter((file) => !code.includes(file));
  gaps.push(
    `Reverted its changes to ${code.map((file) => `\`${file}\``).join(", ")}: the "${checks.failure?.name}" check failed with them.`,
  );
  await reportDocs(updated, progress);
  return { summary: report.summary, updated, gaps, costUsd };
}

async function reportDocs(
  updated: string[],
  progress: (message: string) => Promise<void>,
): Promise<void> {
  await progress(
    updated.length > 0
      ? `📝 Documentation updated: ${updated.join(", ")}`
      : "📝 No documentation changes needed.",
  );
}
