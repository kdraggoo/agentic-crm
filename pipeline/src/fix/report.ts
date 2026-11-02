import { formatCheckResults } from "../build/checks.js";
import { formatCiResult } from "../build/ci.js";
import type { FixReport } from "./agent.js";
import type { PublishedFix } from "./orchestrator.js";

export function fixTitle(failedJobs: string[]): string {
  return `Fix main CI: ${failedJobs.join(", ")}`;
}

export function fixCommitMessage(
  failedJobs: string[],
  report: FixReport,
): string {
  return `${fixTitle(failedJobs)}\n\n${report.summary}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
}

export function fixPullRequestBody(
  issueNumber: number,
  fix: PublishedFix,
): string {
  const list = (items: string[]) =>
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
  const reviewNotes = fix.review.findings.map(
    (finding) =>
      `**${finding.category}**${finding.file ? ` (\`${finding.file}\`)` : ""}: ${finding.summary} ${finding.detail}`,
  );

  return [
    `Fixes GitHub CI on main, failing at ${fix.sha.slice(0, 7)} (#${issueNumber}). Made by the agent pipeline: the fixer agent changed the code, the full checks ran, and a separate reviewer agent checked the diff.`,
    "",
    "## Failing on main",
    list(fix.failedJobs),
    "",
    "## Root cause",
    fix.report.root_cause,
    "",
    "## Fix",
    fix.report.summary,
    "",
    "## Reviewer agent",
    fix.review.findings.length > 0
      ? `No blocking findings. Notes for the human reviewer:\n${list(reviewNotes)}`
      : "No findings.",
    "",
    "## Fixer agent notes",
    list(fix.report.reviewer_notes),
    "",
    "## Checks",
    formatCheckResults(fix.checks),
    fix.ci ? formatCiResult(fix.ci) : "⏳ GitHub CI is running",
    "",
    `Attempts: ${fix.attempts} · API-equivalent cost: $${fix.costUsd.toFixed(2)}`,
    "",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  ].join("\n");
}
