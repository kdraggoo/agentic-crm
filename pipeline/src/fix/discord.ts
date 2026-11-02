import {
  ChannelType,
  type AnyThreadChannel,
  type Client,
  type ForumChannel,
} from "discord.js";
import { previewUrl } from "../config.js";
import { formatCheckResults } from "../build/checks.js";
import { formatCiResult } from "../build/ci.js";
import {
  BUILD_FAILED_HEADING,
  pullNumberFrom,
  type Idea,
  type IdeaStatus,
  type IdeaStore,
} from "../ideas.js";
import { chunkForDiscord } from "../po/format.js";
import { formatIncident } from "./agent.js";
import { fixMain, type FixOutcome } from "./orchestrator.js";
import { fixTitle } from "./report.js";
import { failingMain } from "./watch.js";

/** Replies on a failed fix: continue from its work, or start over. */
const CONTINUE_PATTERN = /^(continue|resume|keep going)[.!]?$/i;
const RESTART_PATTERN = /^(approve|retry|start over|lgtm)[.!]?$/i;

/** Discord thread titles are limited to 100 characters. */
const MAX_THREAD_NAME = 100;

export interface FixFlowDeps {
  client: Client;
  store: IdeaStore;
  ideas: Map<string, Idea>;
  forumChannelId: string;
  /** Runs a build after the ones already queued; builds share a port and CPU. */
  enqueue: (task: () => Promise<void>) => Promise<void>;
  applyStatusTag: (
    thread: AnyThreadChannel,
    status: IdeaStatus,
  ) => Promise<void>;
  reportError: (thread: AnyThreadChannel, error: unknown) => Promise<void>;
}

/**
 * Fixes for failing CI on main. Each one is an idea without a spec: a forum thread
 * and an issue the bot opens itself, built by the fixer agent, then reviewed and
 * merged by the owner like any idea.
 */
export function createFixFlow(deps: FixFlowDeps) {
  const { client, store, ideas } = deps;
  let watching = false;

  /** Looks at CI on main and starts a fix when it fails. Never runs twice at once. */
  async function watchMain(): Promise<void> {
    // One fix at a time: while one is open, main is expected to stay red.
    if (watching || [...ideas.values()].some((idea) => idea.fix)) return;
    watching = true;
    try {
      const failure = await failingMain();
      if (!failure) return;
      const failedJobs = failure.ci.failures.map((f) => f.name);
      const title = fixTitle(failedJobs).slice(0, MAX_THREAD_NAME);
      const forum = await client.channels.fetch(deps.forumChannelId);
      if (forum?.type !== ChannelType.GuildForum) return;
      const description = [
        `GitHub CI fails on main at \`${failure.sha.slice(0, 7)}\`, also after re-running the failed jobs:`,
        ...failedJobs.map((job) => `- ${job}`),
      ].join("\n");
      const thread = await (forum as ForumChannel).threads.create({
        name: title,
        message: { content: `🔴 ${description}` },
      });
      const idea = await store.createFix(
        thread.id,
        title,
        { sha: failure.sha, failedJobs },
        `${description}\n\n${formatIncident(failure.sha, failure.ci)}`,
      );
      ideas.set(thread.id, idea);
      console.log(
        `#${idea.issueNumber} → fixing main at ${failure.sha.slice(0, 7)}`,
      );
      await startFix(thread, idea);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Main CI check failed: ${message}`);
    } finally {
      watching = false;
    }
  }

  /** Handles the owner's reply in a fix's thread (merging is handled by the bot). */
  function handleReply(
    thread: AnyThreadChannel,
    idea: Idea,
    text: string,
  ): void {
    if (idea.status === "in-review") {
      void startFix(thread, idea, { feedback: [text] });
    } else if (idea.status === "build-failed" && CONTINUE_PATTERN.test(text)) {
      void startFix(thread, idea, { continueFailed: true });
    } else if (idea.status === "build-failed" && RESTART_PATTERN.test(text)) {
      void startFix(thread, idea);
    } else {
      void thread.send(
        "This thread fixes failing CI on main. Reply **continue** to keep going from the fixer's work, or **approve** to start over from main.",
      );
    }
  }

  function startFix(
    thread: AnyThreadChannel,
    idea: Idea,
    options: { continueFailed?: boolean; feedback?: string[] } = {},
  ): Promise<void> {
    const fix = idea.fix!;
    const continuing = options.continueFailed || options.feedback;
    idea.status = "building";
    return deps.enqueue(async () => {
      try {
        await store.save(idea);
        await deps.applyStatusTag(thread, "building");
        await thread.send(
          options.feedback
            ? "🩹 Updating the fix with your feedback."
            : options.continueFailed
              ? "▶️ Continuing the fix from its kept work."
              : "🩹 Fixing main's CI; this usually takes 20–60 minutes.",
        );
        const outcome = await fixMain({
          issueNumber: idea.issueNumber,
          title: idea.title,
          sha: fix.sha,
          continueWith: continuing
            ? {
                lastFailure: options.continueFailed
                  ? await store.lastBuildFailure(idea.issueNumber)
                  : undefined,
                feedback: options.feedback,
              }
            : undefined,
          progress: async (line) => {
            for (const chunk of chunkForDiscord(line)) await thread.send(chunk);
          },
          publish: async (branch, body) => {
            idea.branch = branch;
            idea.pullRequestUrl = await store.openPullRequest(
              branch,
              idea.title,
              body,
            );
            return idea.pullRequestUrl;
          },
        });
        idea.branch = outcome.branch;
        const summary = reportOutcome(idea, outcome);
        for (const chunk of chunkForDiscord(summary)) await thread.send(chunk);
        await store.save(idea, summary);
        await deps.applyStatusTag(thread, idea.status);
        console.log(`#${idea.issueNumber} → ${idea.status}`);
      } catch (error: unknown) {
        idea.status = "build-failed";
        await store.save(idea).catch(() => undefined);
        await deps.applyStatusTag(thread, idea.status).catch(() => undefined);
        await deps.reportError(thread, error);
      }
    });
  }

  return { watchMain, handleReply };
}

function reportOutcome(idea: Idea, outcome: FixOutcome): string {
  if (outcome.ok) {
    idea.status = "in-review";
    return [
      `✅ Fix ready, reviewed and green on CI in ${outcome.attempts} attempt(s). Pull request: ${outcome.pullRequestUrl}`,
      `🌐 Demo: ${previewUrl(pullNumberFrom(outcome.pullRequestUrl))}`,
      "",
      `**Root cause:** ${outcome.report.root_cause}`,
      "",
      outcome.report.summary,
      "",
      formatCheckResults(outcome.checks),
      ...(outcome.ci ? [formatCiResult(outcome.ci)] : []),
      ...(outcome.review.findings.length > 0
        ? [
            "",
            `Reviewer agent left ${outcome.review.findings.length} note(s) on the PR.`,
          ]
        : []),
      "",
      `API-equivalent cost: $${outcome.costUsd.toFixed(2)}`,
      "",
      "Reply **merge** to merge it, or reply with feedback to change the fix.",
    ].join("\n");
  }
  idea.status = "build-failed";
  return [
    BUILD_FAILED_HEADING,
    "",
    outcome.reason,
    "",
    `Work so far is in the local worktree \`${outcome.worktree}\` (branch \`${outcome.branch}\`). Reply **continue** to keep going from this work, or **approve** to start over from main.`,
  ].join("\n");
}
