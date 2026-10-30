/**
 * Discord intake bot.
 *
 * - A new post in the ideas forum becomes a GitHub issue, and the product-owner agent evaluates it.
 * - Replies in the post's thread go back to the agent, which asks more questions or writes the spec.
 * - Approving a spec ("approve" or a ✅ reaction) runs the test and build agents and opens a PR.
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
import { requireEnv } from "./config.js";
import { buildIdea, pullRequestBody } from "./build/orchestrator.js";
import { formatCheckResults } from "./build/checks.js";
import {
  IdeaStore,
  latestSpec,
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
  "in-review": "In review",
  "build-failed": "Build failed",
};

interface ThreadWork {
  pendingReplies: { author: string; text: string; at: string }[];
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
  if (idea.status === "in-review") {
    // The spec is frozen once a PR exists; re-running the product owner would reopen it.
    void thread.send(
      `This idea is built and in review: ${idea.pullRequestUrl ?? "see the issue"}. Review and comment on the pull request there.`,
    );
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

function queueReply(thread: AnyThreadChannel, message: Message): void {
  const entry = work.get(thread.id) ?? { pendingReplies: [], running: false };
  work.set(thread.id, entry);
  entry.pendingReplies.push({
    author: message.author.username,
    text: message.content,
    at: message.createdAt.toISOString(),
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
        "Reply **approve** (or react ✅ to this message) to build it, or reply with changes to revise the spec.",
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

function startBuild(thread: AnyThreadChannel, idea: Idea): Promise<void> {
  const spec = latestSpec(idea);
  if (!spec) {
    return thread.send("There's no spec to build yet.").then(() => undefined);
  }
  // Mark it immediately so a second approval while queued doesn't start another build.
  idea.status = "building";
  const queued = buildQueue.then(async () => {
    try {
      await store.save(idea);
      await applyStatusTag(thread, "building");
      await thread.send(
        "🚀 Approved. Starting the build; this usually takes 10–30 minutes.",
      );
      const outcome = await buildIdea({
        issueNumber: idea.issueNumber,
        title: idea.title,
        spec,
        progress: async (line) => {
          await thread.send(line);
        },
      });
      idea.branch = outcome.branch;

      if (outcome.ok === true) {
        idea.pullRequestUrl = await store.openPullRequest(
          outcome.branch,
          `Implement #${idea.issueNumber}: ${spec.title}`,
          pullRequestBody(idea.issueNumber, spec, outcome),
        );
        idea.status = "in-review";
        const summary = [
          `✅ Built and checked in ${outcome.attempts} attempt(s). Pull request: ${idea.pullRequestUrl}`,
          "",
          outcome.buildReport.summary,
          "",
          formatCheckResults(outcome.checks),
          "",
          `API-equivalent cost: $${outcome.costUsd.toFixed(2)}`,
        ].join("\n");
        for (const chunk of chunkForDiscord(summary)) await thread.send(chunk);
        await store.save(idea, summary);
      } else if (outcome.ok === false) {
        idea.status = "build-failed";
        const summary = [
          "❌ The build didn't pass.",
          "",
          outcome.reason,
          "",
          `Work so far is in the local worktree \`${outcome.worktree}\` (branch \`${outcome.branch}\`). Reply **approve** to try again from scratch, or reply with changes to revise the spec.`,
        ].join("\n");
        for (const chunk of chunkForDiscord(summary)) await thread.send(chunk);
        await store.save(idea, summary);
      }
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
