/**
 * Discord intake bot.
 *
 * - A new post in the ideas forum becomes a GitHub issue, and the product-owner agent evaluates it.
 * - Replies in the post's thread go back to the agent, which asks more questions or writes the spec.
 * - Approving a spec ("approve" or a ✅ reaction) runs the test and build agents and opens a PR,
 *   whose demo the preview workflow publishes on GitHub Pages.
 * - Replies to a built idea are feedback on its demo: the product owner revises the spec, and
 *   approving it updates the same PR. "merge" squash-merges the PR and closes the idea.
 * - The forum tag and the issue label track where each idea stands.
 * - Only the owner (DISCORD_OWNER_ID) is listened to: posts become instructions for agents that
 *   write code, so nobody else can submit, answer or approve.
 */
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type AnyThreadChannel,
  type ForumChannel,
  type Message,
} from "discord.js";
import { previewUrl, requireEnv } from "./config.js";
import { formatDispute } from "./build/agents.js";
import { formatCheckResults } from "./build/checks.js";
import { formatCiResult } from "./build/ci.js";
import { removeWorktree } from "./build/git.js";
import { buildIdea, type BuildRequest } from "./build/orchestrator.js";
import {
  IdeaStore,
  builtVersion,
  latestPoTurn,
  latestSpec,
  pullNumberFrom,
  roundComment,
  statusFor,
  type Idea,
  type IdeaStatus,
} from "./ideas.js";
import { evaluateIdea } from "./po/agent.js";
import { chunkForDiscord, formatEvaluation } from "./po/format.js";

const FORUM_CHANNEL_ID = requireEnv("DISCORD_IDEAS_CHANNEL_ID");
const OWNER_ID = requireEnv("DISCORD_OWNER_ID");

/** Wait this long after the last reply before evaluating, so multi-message answers go in one round. */
const REPLY_DEBOUNCE_MS = Number(process.env.REPLY_DEBOUNCE_MS ?? 20_000);

/** Replies that approve a spec for building. */
const APPROVAL_PATTERN = /^(approve|approved|lgtm|ship it|build it)[.!]?$/i;
const APPROVAL_EMOJI = new Set(["✅", "👍"]);

/** Replies that merge a built idea's pull request. */
const MERGE_PATTERN = /^(merge|merge it)[.!]?$/i;

/** How often to look for pull requests merged on GitHub instead of from Discord. */
const MERGE_SYNC_MS = 10 * 60_000;

/** Replies to a paused build's test disputes. */
const ACCEPT_PATTERN = /^(accept|accepted|agree|fix (the )?tests?)[.!]?$/i;
const REJECT_PATTERN = /^(reject|rejected|keep (the )?tests?)[.!]?$/i;

/** Statuses from which an approval starts a build. */
const BUILDABLE: ReadonlySet<IdeaStatus> = new Set([
  "spec-ready",
  "build-failed",
]);

/** Forum tag applied for each status. Tags must exist on the forum (see README). */
const STATUS_TAGS: Record<IdeaStatus, string> = {
  clarifying: "Clarifying",
  "spec-ready": "Spec ready",
  rejected: "Rejected",
  building: "Building",
  "test-dispute": "Test dispute",
  "in-review": "In review",
  "build-failed": "Build failed",
  merged: "Merged",
};

interface ThreadWork {
  pendingReplies: {
    author: string;
    text: string;
    at: string;
    feedback?: boolean;
  }[];
  timer?: NodeJS.Timeout;
  running: boolean;
}

const store = new IdeaStore();
const ideas = new Map<string, Idea>();
const work = new Map<string, ThreadWork>();

/** Builds run one at a time: they share the demo test port and a lot of CPU. */
let buildQueue: Promise<void> = Promise.resolve();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  // Reactions on messages sent before a restart arrive as partials.
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

client.once(Events.ClientReady, async (ready) => {
  await store.ensureLabels();
  for (const [threadId, idea] of await store.loadOpen())
    ideas.set(threadId, idea);
  console.log(
    `Logged in as ${ready.user.tag}. Watching forum ${FORUM_CHANNEL_ID}; ${ideas.size} open ideas loaded.`,
  );
  await syncMerged();
  setInterval(() => void syncMerged(), MERGE_SYNC_MS);
});

client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
  if (
    !newlyCreated ||
    thread.parentId !== FORUM_CHANNEL_ID ||
    ideas.has(thread.id)
  )
    return;
  try {
    await handleNewIdea(thread);
  } catch (error: unknown) {
    await reportError(thread, error);
  }
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.id !== OWNER_ID || !message.channel.isThread()) return;
  const thread = message.channel;
  // In a forum, the starter message shares the thread's ID; it is handled by ThreadCreate.
  if (thread.parentId !== FORUM_CHANNEL_ID || message.id === thread.id) return;
  const idea = ideas.get(thread.id);
  if (!idea) return;

  if (idea.status === "building") {
    void thread.send(
      "A build is running for this idea. I'll post here when it's done.",
    );
    return;
  }
  if (
    MERGE_PATTERN.test(message.content.trim()) &&
    idea.pullRequestUrl &&
    idea.status !== "test-dispute"
  ) {
    void mergeIdea(thread, idea);
    return;
  }
  if (idea.status === "in-review") {
    // Anything else is feedback on the demo: the product owner revises the spec.
    queueReply(thread, message, { feedback: true });
    return;
  }
  if (idea.status === "test-dispute") {
    const text = message.content.trim();
    const disputes = idea.disputes ?? [];
    if (ACCEPT_PATTERN.test(text)) {
      void startBuild(thread, idea, { disputes, decision: "accepted" });
    } else if (REJECT_PATTERN.test(text)) {
      void startBuild(thread, idea, { disputes, decision: "rejected" });
    } else {
      void thread.send(
        "The build is paused on a test dispute. Reply **accept** to have the test agent correct those tests, or **reject** to keep the tests as written.",
      );
    }
    return;
  }
  if (
    BUILDABLE.has(idea.status) &&
    APPROVAL_PATTERN.test(message.content.trim())
  ) {
    void startBuild(thread, idea);
    return;
  }
  queueReply(thread, message);
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.id !== OWNER_ID || !APPROVAL_EMOJI.has(reaction.emoji.name ?? ""))
    return;
  const message = reaction.message.partial
    ? await reaction.message.fetch()
    : reaction.message;
  const thread = message.channel;
  if (!thread.isThread() || thread.parentId !== FORUM_CHANNEL_ID) return;
  if (message.author?.id !== client.user?.id) return;
  const idea = ideas.get(thread.id);
  if (idea && BUILDABLE.has(idea.status)) void startBuild(thread, idea);
});

async function handleNewIdea(thread: AnyThreadChannel): Promise<void> {
  const starter = await fetchStarterMessage(thread);
  if (starter.author.id !== OWNER_ID) {
    console.log(
      `Ignoring post "${thread.name}" from ${starter.author.username} (not the owner).`,
    );
    return;
  }
  const text = [thread.name, starter.content].filter(Boolean).join("\n\n");
  const transcript: Idea["transcript"] = [
    {
      role: "submitter",
      author: starter.author.username,
      text,
      at: starter.createdAt.toISOString(),
    },
  ];
  const idea = await store.create(thread.id, thread.name, transcript);
  ideas.set(thread.id, idea);
  await thread.send(
    `Thanks! Tracking this as ${idea.issueUrl}. Taking a look now…`,
  );
  await runRound(thread, idea, []);
}

function queueReply(
  thread: AnyThreadChannel,
  message: Message,
  options: { feedback?: boolean } = {},
): void {
  const entry = work.get(thread.id) ?? { pendingReplies: [], running: false };
  work.set(thread.id, entry);
  entry.pendingReplies.push({
    author: message.author.username,
    text: message.content,
    at: message.createdAt.toISOString(),
    ...(options.feedback ? { feedback: true } : {}),
  });
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => void flushReplies(thread), REPLY_DEBOUNCE_MS);
}

async function flushReplies(thread: AnyThreadChannel): Promise<void> {
  const entry = work.get(thread.id);
  const idea = ideas.get(thread.id);
  if (!entry || !idea || entry.pendingReplies.length === 0) return;
  if (entry.running) {
    // A round is in progress; try again once it has had time to finish.
    entry.timer = setTimeout(
      () => void flushReplies(thread),
      REPLY_DEBOUNCE_MS,
    );
    return;
  }
  const replies = entry.pendingReplies.splice(0);
  for (const reply of replies)
    idea.transcript.push({ role: "submitter", ...reply });

  entry.running = true;
  try {
    await runRound(
      thread,
      idea,
      replies.map((reply) => reply.text),
    );
  } catch (error: unknown) {
    await reportError(thread, error);
  } finally {
    entry.running = false;
  }
}

async function runRound(
  thread: AnyThreadChannel,
  idea: Idea,
  replies: string[],
): Promise<void> {
  const typing = setInterval(() => void thread.sendTyping(), 8_000);
  await thread.sendTyping();
  try {
    const { result, costUsd } = await evaluateIdea(idea.transcript);
    idea.transcript.push({ role: "po", result, at: new Date().toISOString() });
    idea.status = statusFor(result);

    for (const chunk of chunkForDiscord(formatEvaluation(result)))
      await thread.send(chunk);
    if (idea.status === "spec-ready") {
      await thread.send(
        builtVersion(idea) && idea.pullRequestUrl
          ? `Reply **approve** (or react ✅ to this message) to update ${idea.pullRequestUrl} to this revised spec, reply with more changes, or reply **merge** to merge the current version as it is.`
          : "Reply **approve** (or react ✅ to this message) to build it, or reply with changes to revise the spec.",
      );
    }
    await store.save(idea, roundComment(result, replies));
    await applyStatusTag(thread, idea.status);
    console.log(
      `#${idea.issueNumber} → ${idea.status} ($${costUsd.toFixed(3)})`,
    );
  } finally {
    clearInterval(typing);
  }
}

function startBuild(
  thread: AnyThreadChannel,
  idea: Idea,
  resume?: BuildRequest["resume"],
): Promise<void> {
  const spec = latestSpec(idea);
  if (!spec) {
    return thread.send("There's no spec to build yet.").then(() => undefined);
  }
  const specTurn = latestPoTurn(idea);
  // A revised spec for an idea with an open pull request updates that pull request.
  const built = builtVersion(idea);
  const revise =
    !resume && idea.status === "spec-ready" && built && idea.pullRequestUrl
      ? { previousSpec: built.spec, feedback: built.feedback }
      : undefined;
  // Mark it immediately so a second approval while queued doesn't start another build.
  idea.status = "building";
  idea.disputes = undefined;
  const queued = buildQueue.then(async () => {
    try {
      await store.save(idea);
      await applyStatusTag(thread, "building");
      const pullRequest =
        revise && idea.pullRequestUrl
          ? await store.pullRequest(idea.pullRequestUrl)
          : undefined;
      const revising = revise && pullRequest?.open ? revise : undefined;
      await thread.send(
        resume
          ? `▶️ Resuming the build (disputes ${resume.decision}).`
          : revising
            ? "🚀 Approved. Updating the tests and the pull request to the revised spec; this usually takes 30–60 minutes."
            : "🚀 Approved. Starting the build; this usually takes 30–60 minutes.",
      );
      const outcome = await buildIdea({
        issueNumber: idea.issueNumber,
        title: idea.title,
        spec,
        resume,
        revise: revising,
        progress: async (line) => {
          for (const chunk of chunkForDiscord(line)) await thread.send(chunk);
        },
        publish: async (branch, body) => {
          idea.branch = branch;
          idea.pullRequestUrl = await store.openPullRequest(
            branch,
            `Implement #${idea.issueNumber}: ${spec.title}`,
            body,
          );
          return idea.pullRequestUrl;
        },
      });
      idea.branch = outcome.branch;
      if (outcome.ok === true) idea.builtTurn = specTurn;
      const summary = await reportOutcome(idea, outcome);
      for (const chunk of chunkForDiscord(summary)) await thread.send(chunk);
      await store.save(idea, summary);
      await applyStatusTag(thread, idea.status);
      console.log(`#${idea.issueNumber} → ${idea.status}`);
    } catch (error: unknown) {
      idea.status = "build-failed";
      await store.save(idea).catch(() => undefined);
      await applyStatusTag(thread, idea.status).catch(() => undefined);
      await reportError(thread, error);
    }
  });
  buildQueue = queued;
  return queued;
}

/** Sets the idea's status from a build outcome and returns the message for the thread. */
async function reportOutcome(
  idea: Idea,
  outcome: Awaited<ReturnType<typeof buildIdea>>,
): Promise<string> {
  if (outcome.ok === true) {
    idea.status = "in-review";
    const demo = idea.pullRequestUrl
      ? previewUrl(pullNumberFrom(idea.pullRequestUrl))
      : undefined;
    return [
      `✅ Built, reviewed and green on CI in ${outcome.attempts} attempt(s). Pull request: ${idea.pullRequestUrl}`,
      ...(demo
        ? [`🌐 Try it: ${demo} (the demo can take a minute to appear)`]
        : []),
      "",
      outcome.buildReport.summary,
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
      "Reply **merge** to merge it, or reply with feedback from the demo to revise it.",
    ].join("\n");
  }
  if (outcome.ok === "disputed") {
    idea.status = "test-dispute";
    idea.disputes = outcome.disputes;
    return [
      outcome.raisedBy === "ci"
        ? "⚖️ The build passed every local check, but GitHub CI failed twice (the second time on a re-run) only on these locked tests. That usually means the test is timing-sensitive, but it can be an app bug that shows when data loads slowly:"
        : "⚖️ The build agent says some locked tests are wrong, so it stopped instead of bending the app to fit them:",
      "",
      ...outcome.disputes.map(formatDispute),
      "",
      "Reply **accept** to have the test agent correct these tests, or **reject** to keep them as written. Either way the build continues from where it stopped.",
    ].join("\n");
  }
  idea.status = "build-failed";
  if (outcome.ok === false) {
    return [
      "❌ The build didn't pass.",
      "",
      outcome.reason,
      "",
      `Work so far is in the local worktree \`${outcome.worktree}\` (branch \`${outcome.branch}\`). Reply **approve** to try again from scratch, or reply with changes to revise the spec.`,
    ].join("\n");
  }
  return "The build stopped after writing tests only.";
}

/** Merges a built idea's pull request when every check is green. */
async function mergeIdea(thread: AnyThreadChannel, idea: Idea): Promise<void> {
  try {
    const pull = await store.pullRequest(idea.pullRequestUrl!);
    if (pull.merged) return await finishMerged(thread, idea, "on GitHub");
    if (!pull.open) {
      await thread.send(
        `${idea.pullRequestUrl} was closed without merging, so there's nothing to merge. Reply **approve** to build it again.`,
      );
      return;
    }
    if (pull.mergeableState !== "clean") {
      const why: Record<string, string> = {
        dirty: "it conflicts with main",
        behind: "it is behind main",
        blocked: "a branch rule blocks it",
        unstable: "some checks aren't green",
        draft: "it is a draft",
      };
      await thread.send(
        `I can't merge ${idea.pullRequestUrl} yet: ${why[pull.mergeableState] ?? `GitHub reports it as "${pull.mergeableState}"`}. Reply **approve** to rebuild it from the current spec.`,
      );
      return;
    }
    const spec = latestSpec(idea);
    await store.merge(
      pull.number,
      `Implement #${idea.issueNumber}: ${spec?.title ?? idea.title}`,
    );
    await finishMerged(thread, idea, "from Discord");
  } catch (error: unknown) {
    await reportError(thread, error);
  }
}

/** Closes a merged idea: issue, branch, worktree, tag, and the bot's memory of it. */
async function finishMerged(
  thread: AnyThreadChannel,
  idea: Idea,
  how: string,
): Promise<void> {
  idea.status = "merged";
  const message = `🎉 ${idea.pullRequestUrl} was merged ${how}. The demo of main updates in a few minutes; this idea is done.`;
  await store.save(idea, message);
  await store.close(idea);
  await removeWorktree(idea.issueNumber, idea.title).catch((error: unknown) =>
    console.warn(
      `Could not remove the worktree for #${idea.issueNumber}:`,
      error,
    ),
  );
  ideas.delete(idea.threadId);
  await applyStatusTag(thread, "merged");
  await thread.send(message);
  console.log(`#${idea.issueNumber} → merged`);
}

/** Finds pull requests merged on GitHub rather than from Discord, and closes their ideas. */
async function syncMerged(): Promise<void> {
  for (const idea of [...ideas.values()]) {
    if (!idea.pullRequestUrl || idea.status === "building") continue;
    try {
      const pull = await store.pullRequest(idea.pullRequestUrl);
      if (!pull.merged) continue;
      const thread = await client.channels.fetch(idea.threadId);
      if (thread?.isThread()) await finishMerged(thread, idea, "on GitHub");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Merge check for #${idea.issueNumber} failed: ${message}`);
    }
  }
}

async function applyStatusTag(
  thread: AnyThreadChannel,
  status: IdeaStatus,
): Promise<void> {
  const forum = await client.channels.fetch(FORUM_CHANNEL_ID);
  if (forum?.type !== ChannelType.GuildForum) return;
  const tag = (forum as ForumChannel).availableTags.find(
    (candidate) => candidate.name === STATUS_TAGS[status],
  );
  if (!tag) {
    console.warn(
      `Forum has no "${STATUS_TAGS[status]}" tag; skipping tag update.`,
    );
    return;
  }
  await thread.setAppliedTags([tag.id]);
}

/** The starter message can arrive a moment after the thread is created. */
async function fetchStarterMessage(thread: AnyThreadChannel): Promise<Message> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const starter = await thread.fetchStarterMessage({ force: true });
      if (starter) return starter;
    } catch {
      // Not available yet; retry below.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  throw new Error("Could not read the post's first message");
}

async function reportError(
  thread: AnyThreadChannel,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Thread ${thread.id}:`, message);
  await thread
    .send(
      "Something went wrong on my side. The error is in the bot's log; reply again (or approve again) to retry.",
    )
    .catch(() => undefined);
}

await client.login(requireEnv("DISCORD_TOKEN"));
