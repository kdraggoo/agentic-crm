/**
 * Runs the test and build agents for an idea from the terminal, without Discord.
 *
 *   npm run build-idea -- 5               # tests + build + checks; leaves the branch pushed, no PR
 *   npm run build-idea -- 5 --tests-only  # only the test agent; inspect the worktree afterwards
 *   npm run build-idea -- 5 --reuse-tests # keep the tests already committed in the worktree
 *   npm run build-idea -- 5 --pr          # also open (or update) the pull request
 */
import { buildIdea, pullRequestBody } from "./build/orchestrator.js";
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
    return;
  }
  console.log("\nTest report:\n" + JSON.stringify(outcome.testReport, null, 2));
  if (outcome.ok === true) {
    console.log(
      "\nBuild report:\n" + JSON.stringify(outcome.buildReport, null, 2),
    );
    if (args.includes("--pr")) {
      const url = await store.openPullRequest(
        outcome.branch,
        `Implement #${issueNumber}: ${spec.title}`,
        pullRequestBody(issueNumber, spec, outcome),
      );
      console.log(`\nPull request: ${url}`);
    }
  }
}

function minutesSince(started: number): string {
  return ((Date.now() - started) / 60_000).toFixed(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
