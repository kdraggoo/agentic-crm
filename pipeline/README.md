# Agent pipeline

The idea pipeline: **Discord intake → product-owner agent → spec → approval → test agent → build agent → checks → pull request**, with each idea's state kept in a GitHub issue.

```
Discord forum post ──▶ bot.ts
                         ├─▶ GitHub issue (label `idea`, status label, hidden transcript)
                         ├─▶ product-owner agent (Claude, reads docs/product, read-only repo access)
                         └─▶ questions back in the thread  ⇄  owner replies
                                         └─▶ spec (or a reasoned rejection)
                                                 │  owner replies "approve" or reacts ✅
                                                 ▼
                         orchestrator (src/build/, plain code; one build at a time)
                           1. git worktree on idea/<issue>-<slug> from origin/main
                           2. test agent: acceptance tests from the spec only → committed, locked
                           3. build agent: implements until the tests pass (up to 3 attempts)
                           4. checks: typecheck · lint · format · unit · demo build · demo e2e
                           5. push + pull request → "In review" in Discord
```

## How it works

- **Product-owner agent** (`src/po/`): runs Claude Code headlessly (`claude -p`) with the instructions in [`prompts/product-owner.md`](prompts/product-owner.md), the product context layer from [`docs/product/`](../docs/product/README.md) as its system prompt, and read-only tools (Read, Grep, Glob) over the repo. It returns structured JSON (`src/po/schema.ts`): a classification, related features, constraint findings, and then either questions, a spec, or a rejection.
- **Stateless rounds:** every evaluation gets the whole conversation so far, so nothing depends on a long-lived session. The transcript is stored in the GitHub issue, which means the bot can restart at any time.
- **Discord bot** (`src/bot.ts`): a new forum post creates an issue and triggers the first evaluation. Replies in the thread are batched (20 seconds after the last message) and sent back to the agent. The forum tag and the issue label follow the status.
- **Approval gate:** a spec builds only after the owner replies `approve` (or `lgtm`, `ship it`, `build it`) or reacts ✅ to one of the bot's messages. Any other reply goes back to the product-owner agent to revise the spec.
- **Owner only:** the bot listens only to `DISCORD_OWNER_ID`. Posts become instructions for agents that write code, so nobody else can submit, answer or approve.
- **Test agent** (`prompts/test-writer.md`): sees the spec and the existing code, never an implementation. Writes `e2e/demo/idea-<issue>.spec.ts` against the static FakeRest demo build, one or more tests per acceptance criterion, and checks they fail for the right reason. The orchestrator keeps only that file and commits it.
- **Build agent** (`prompts/builder.md`): implements the spec, adds unit tests and updates `docs/product/`. It may edit files and run the project's checks, but has no git access.
- **Guardrails in code** (`src/build/orchestrator.ts`): if the build agent changes the locked test file, it's restored and the attempt fails. If the spec needs docs updates and none were made, the attempt fails. Nothing counts as done until the full checks pass. Each failure goes back to the build agent with the failing output, up to `MAX_BUILD_ATTEMPTS`.
- **Isolation:** each idea builds in its own git worktree under `../../worktrees/` (outside the repo), with Node 24 first on `PATH` and `CI=1`, so builds never touch your checkout.
- **Cost:** runs on your local Claude Code login, so there is no separate API bill on a machine where Claude Code is signed in. The `$` figure the harness prints is the API-equivalent cost Claude Code reports (typically $0.20–$0.55 per round; the first run of a session is higher while the product context is cached). On a subscription it counts toward usage limits rather than being billed.

## Setup

Requirements: Node 20+ for the pipeline, Node 24 for building the app (`brew install node@24`; set `NODE_BIN_DIR` if it lives elsewhere), Playwright's Chromium (`npx playwright install chromium` in the repo root), the [`claude` CLI](https://code.claude.com) logged in (run `claude`, then `/login`), and the GitHub CLI logged in (`gh auth login`) or a `GITHUB_TOKEN`.

```bash
cd pipeline
npm install
cp .env.example .env   # then fill in the values
```

### Discord

1. Create a server, then a **Forum** channel named `ideas` (if Forum isn't offered, enable Community in Server Settings).
2. Add these forum tags, spelled exactly: `Clarifying`, `Spec ready`, `Rejected`, `Building`, `In review`, `Build failed`.
3. Turn on Developer Mode (User Settings → Advanced), right-click your own name → Copy User ID, and put it in `.env` as `DISCORD_OWNER_ID`.
4. At the [Discord Developer Portal](https://discord.com/developers/applications), create an application. On the **Bot** tab, reset the token (put it in `.env` as `DISCORD_TOKEN`) and enable **Message Content Intent**.
5. Under OAuth2 → URL Generator, select scopes `bot` and `applications.commands`, and permissions View Channels, Send Messages, Send Messages in Threads, Read Message History, Add Reactions, Manage Threads. Open the URL to invite the bot.
6. Right-click the `ideas` channel → Copy Channel ID, and put it in `.env` as `DISCORD_IDEAS_CHANNEL_ID`.

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

Post in the `ideas` forum and the bot replies in the thread. Approve a spec to build it.

To run the test and build agents on an existing spec without Discord:

```bash
npm run build-idea -- 5 --tests-only   # only the test agent; inspect ../../worktrees/idea-5
npm run build-idea -- 5                # tests + build + checks, then push the branch
npm run build-idea -- 5 --pr           # same, and open (or update) the pull request
npm run build-idea -- 5 --reuse-tests  # keep the tests already committed; only rebuild
```

`BUILD_MODEL` and `TEST_MODEL` pick each agent's model (both default to `opus`), e.g. `BUILD_MODEL=sonnet npm run build-idea -- 5 --reuse-tests` to try the build agent on Sonnet against the same tests.

## Samples

`samples/` holds ideas chosen to exercise each outcome: an iteration of an existing feature (`deal-closing-filter`), a new feature (`email-sequences`), a constraint conflict (`delete-users`), an out-of-scope vertical feature (`vet-appointments`), and a vague request (`better-dashboard`).

## Next phases

A live demo deploy per pull request, the iteration loop from demo feedback, and merge on approval.
