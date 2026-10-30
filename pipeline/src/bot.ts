/**
 * Discord intake bot.
 *
 * - A new post in the ideas forum becomes a GitHub issue, and the product-owner agent evaluates it.
 * - Replies in the post's thread go back to the agent, which asks more questions or writes the spec.
 * - The forum tag and the issue label track where each idea stands.
 */
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type AnyThreadChannel,
  type ForumChannel,
  type Message,
} from "discord.js";
import { requireEnv } from "./config.js";
import {
  IdeaStore,
  roundComment,
  statusFor,
  type Idea,
  type IdeaStatus,
} from "./ideas.js";
import { evaluateIdea } from "./po/agent.js";
import { chunkForDiscord, formatEvaluation } from "./po/format.js";

const FORUM_CHANNEL_ID = requireEnv("DISCORD_IDEAS_CHANNEL_ID");

/** Wait this long after the last reply before evaluating, so multi-message answers go in one round. */
const REPLY_DEBOUNCE_MS = Number(process.env.REPLY_DEBOUNCE_MS ?? 20_000);

/** Forum tag applied for each status. Tags must exist on the forum (see README). */
const STATUS_TAGS: Record<IdeaStatus, string> = {
  clarifying: "Clarifying",
  "spec-ready": "Spec ready",
  rejected: "Rejected",
};

interface ThreadWork {
  pendingReplies: { author: string; text: string; at: string }[];
  timer?: NodeJS.Timeout;
  running: boolean;
}

const store = new IdeaStore();
const ideas = new Map<string, Idea>();
const work = new Map<string, ThreadWork>();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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
  if (message.author.bot || !message.channel.isThread()) return;
  const thread = message.channel;
  // In a forum, the starter message shares the thread's ID; it is handled by ThreadCreate.
  if (thread.parentId !== FORUM_CHANNEL_ID || message.id === thread.id) return;
  if (!ideas.has(thread.id)) return;
  queueReply(thread, message);
});

async function handleNewIdea(thread: AnyThreadChannel): Promise<void> {
  const starter = await fetchStarterMessage(thread);
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
    await store.recordRound(idea, roundComment(result, replies));
    await applyStatusTag(thread, idea.status);
    console.log(
      `#${idea.issueNumber} → ${idea.status} ($${costUsd.toFixed(3)})`,
    );
  } finally {
    clearInterval(typing);
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
      "Something went wrong on my side while evaluating this. The error is in the bot's log; reply again to retry.",
    )
    .catch(() => undefined);
}

await client.login(requireEnv("DISCORD_TOKEN"));
