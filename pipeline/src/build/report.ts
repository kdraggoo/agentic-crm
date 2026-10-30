import type { Spec } from "../po/schema.js";
import type { BuildReport, TestReport } from "./agents.js";
import { formatCheckResults, type CheckReport } from "./checks.js";
import { formatCiResult, type CiResult } from "./ci.js";
import type { Review } from "./reviewer.js";

/** What a pull request describes: a build that passed its local checks and review. */
export interface PublishedBuild {
  testReport: TestReport;
  buildReport: BuildReport;
  checks: CheckReport;
  review: Review;
  /** Unset while GitHub CI is still running. */
  ci?: CiResult;
  attempts: number;
  costUsd: number;
}

export function commitMessage(
  issueNumber: number,
  spec: Spec,
  report: BuildReport,
  attempt: number,
): string {
  const title =
    attempt === 1
      ? `Implement #${issueNumber}: ${spec.title}`
      : `Revise #${issueNumber} (attempt ${attempt}): ${spec.title}`;
  return `${title}\n\n${report.summary}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
}

export function pullRequestBody(
  issueNumber: number,
  spec: Spec,
  build: PublishedBuild,
): string {
  const { testReport, buildReport, checks, review } = build;
  const coverage = testReport.criteria.map((criterion) => {
    const text = spec.acceptance_criteria[criterion.number - 1] ?? "";
    const how = criterion.covered
      ? criterion.tests.map((name) => `\`${name}\``).join("<br>")
      : `Not a browser test: ${criterion.reason ?? ""}`;
    return `| ${criterion.number} | ${escapeCell(text)} | ${escapeCell(how)} |`;
  });
  const list = (items: string[]) =>
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
  const reviewNotes = review.findings.map(
    (finding) =>
      `**${finding.category}**${finding.file ? ` (\`${finding.file}\`)` : ""}: ${finding.summary} ${finding.detail}`,
  );

  return [
    `Implements the spec in #${issueNumber}. Built by the agent pipeline: the test agent wrote the acceptance tests from the spec first, the build agent implemented it without changing them, and a separate reviewer agent checked the diff.`,
    "",
    "## Summary",
    buildReport.summary,
    "",
    "## Acceptance criteria → tests",
    `Locked test file: \`${testReport.test_file}\``,
    "",
    "| # | Criterion | Covered by |",
    "|---|---|---|",
    ...coverage,
    "",
    "## Unit tests added",
    list(buildReport.unit_tests_added),
    "",
    "## Docs updated",
    list(buildReport.docs_updated),
    "",
    "## Reviewer agent",
    review.findings.length > 0
      ? `No blocking findings. Notes for the human reviewer:\n${list(reviewNotes)}`
      : "No findings.",
    "",
    "## Build agent notes",
    list([
      ...buildReport.reviewer_notes,
      ...testReport.assumptions.map((a) => `Test assumption: ${a}`),
    ]),
    "",
    "## Checks",
    formatCheckResults(checks),
    build.ci ? formatCiResult(build.ci) : "⏳ GitHub CI is running",
    "",
    `Attempts: ${build.attempts} · API-equivalent cost: $${build.costUsd.toFixed(2)}`,
    "",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  ].join("\n");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}
