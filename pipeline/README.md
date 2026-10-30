# Agent pipeline

Phase 1 of the idea pipeline: **Discord intake → product-owner agent → spec**, with each idea's state kept in a GitHub issue.

```
Discord forum post ──▶ bot.ts
                         ├─▶ GitHub issue (label `idea`, status label, hidden transcript)
                         ├─▶ product-owner agent (Claude, reads docs/product, read-only repo access)
                         └─▶ questions back in the thread  ⇄  submitter replies
                                         └─▶ spec (or a reasoned rejection)
```

## How it works

- **Product-owner agent** (`src/po/`): runs Claude Code headlessly (`claude -p`) with the instructions in [`prompts/product-owner.md`](prompts/product-owner.md), the product context layer from [`docs/product/`](../docs/product/README.md) as its system prompt, and read-only tools (Read, Grep, Glob) over the repo. It returns structured JSON (`src/po/schema.ts`): a classification, related features, constraint findings, and then either questions, a spec, or a rejection.
- **Stateless rounds:** every evaluation gets the whole conversation so far, so nothing depends on a long-lived session. The transcript is stored in the GitHub issue, which means the bot can restart at any time.
- **Discord bot** (`src/bot.ts`): a new forum post creates an issue and triggers the first evaluation. Replies in the thread are batched (20 seconds after the last message) and sent back to the agent. The forum tag and the issue label follow the status.
- **Cost:** runs on your local Claude Code login, so there is no separate API bill on a machine where Claude Code is signed in. The `$` figure the harness prints is the API-equivalent cost Claude Code reports (typically $0.20–$0.55 per round; the first run of a session is higher while the product context is cached). On a subscription it counts toward usage limits rather than being billed.

## Setup

Requirements: Node 20+, the [`claude` CLI](https://code.claude.com) logged in (run `claude`, then `/login`), and the GitHub CLI logged in (`gh auth login`) or a `GITHUB_TOKEN`.

```bash
cd pipeline
npm install
cp .env.example .env   # then fill in the values
```

### Discord

1. Create a server, then a **Forum** channel named `ideas` (if Forum isn't offered, enable Community in Server Settings).
2. Add these forum tags: `Clarifying`, `Spec ready`, `Rejected`. Later phases add `Building`, `In review`, `Approved`, `Merged`.
3. At the [Discord Developer Portal](https://discord.com/developers/applications), create an application. On the **Bot** tab, reset the token (put it in `.env` as `DISCORD_TOKEN`) and enable **Message Content Intent**.
4. Under OAuth2 → URL Generator, select scopes `bot` and `applications.commands`, and permissions View Channels, Send Messages, Send Messages in Threads, Read Message History, Manage Threads. Open the URL to invite the bot.
5. Turn on Developer Mode (User Settings → Advanced), right-click the `ideas` channel → Copy Channel ID, and put it in `.env` as `DISCORD_IDEAS_CHANNEL_ID`.

## Running

Try the agent in the terminal first (no Discord or GitHub needed):

```bash
npm run po                                   # type an idea and answer its questions
npm run po -- samples/deal-closing-filter.md # start from a sample
npm run po -- --once samples/*.md            # one evaluation per sample; JSON saved to out/
```

Then start the bot:

```bash
npm run bot
```

Post in the `ideas` forum and the bot replies in the thread.

## Samples

`samples/` holds ideas chosen to exercise each outcome: an iteration of an existing feature (`deal-closing-filter`), a new feature (`email-sequences`), a constraint conflict (`delete-users`), an out-of-scope vertical feature (`vet-appointments`), and a vague request (`better-dashboard`).

## Next phases

Spec approval in Discord, then build and test agents on a branch per idea, a demo deploy per branch, the iteration loop, and merge on approval.
