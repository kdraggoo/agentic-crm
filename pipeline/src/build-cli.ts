/**
 * Runs the test and build agents for an idea from the terminal, without Discord.
 *
 *   npm run build-idea -- 5               # tests, build, checks and review; pushes the branch, no PR or CI
 *   npm run build-idea -- 5 --tests-only  # only the test agent; inspect the worktree afterwards
 *   npm run build-idea -- 5 --reuse-tests # keep the tests already committed in the worktree
 *   npm run build-idea -- 5 --pr          # also open (or update) the PR and wait for GitHub CI
 */
import { formatDispute } from "./build/agents.js";
import { buildIdea } from "./build/orchestrator.js";
import { formatFinding } from "./build/reviewer.js";
import { IdeaStore, latestSpec } from "./ideas.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const issueNumber = Number(args.find((arg) => /^\d+$/.test(arg)));
  if (!issueNumber)
    throw new Error(
      "Usage: npm run build-idea -- <issue number> [--tests-only] [--reuse-tests] [--pr]",
    );

  const store = new IdeaStore();
  const idea = await store.get(issueNumber);
  const spec = latestSpec(idea);
  if (!spec) throw new Error(`Issue #${issueNumber} has no spec yet`);

  const started = Date.now();
  const outcome = await buildIdea({
    issueNumber,
    title: idea.title,
    spec,
    testsOnly: args.includes("--tests-only"),
    reuseTests: args.includes("--reuse-tests"),
    publish: args.includes("--pr")
      ? (branch, body) =>
          store.openPullRequest(
            branch,
            `Implement #${issueNumber}: ${spec.title}`,
            body,
          )
      : undefined,
    progress: async (line) =>
      console.log(`[${minutesSince(started)}m] ${line}`),
  });

  console.log(`\nWorktree: ${outcome.worktree}\nBranch: ${outcome.branch}`);
  console.log(
    `API-equivalent cost: $${outcome.costUsd.toFixed(2)} · ${minutesSince(started)} min`,
  );
  if (outcome.ok === false) {
    console.log(`\nFAILED: ${outcome.reason}`);
    process.exitCode = 1;
  } else if (outcome.ok === "disputed") {
    console.log(
      `\nTEST DISPUTES (decide in Discord, or edit the tests by hand):\n${outcome.disputes.map(formatDispute).join("\n")}`,
    );
    process.exitCode = 2;
  } else if (outcome.ok === "tests-only") {
    console.log(
      "\nTest report:\n" + JSON.stringify(outcome.testReport, null, 2),
    );
  } else {
    console.log(
      "\nBuild report:\n" + JSON.stringify(outcome.buildReport, null, 2),
    );
    console.log(
      `\nReviewer notes:\n${outcome.review.findings.map(formatFinding).join("\n") || "- None"}`,
    );
    if (outcome.pullRequestUrl)
      console.log(`\nPull request: ${outcome.pullRequestUrl}`);
  }
}

function minutesSince(started: number): string {
  return ((Date.now() - started) / 60_000).toFixed(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
