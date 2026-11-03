# Agent pipeline

The idea pipeline: **Discord intake → product-owner agent → spec → approval → test agent → build agent → checks → documentation agent → reviewer agent → pull request → GitHub CI → live demo → feedback or merge**, with each idea's state kept in a GitHub issue.

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
                           3. build agent: implements until the tests pass
                                └─ a test it believes is wrong → pause, "Test dispute" in Discord;
                                   owner replies accept (test agent fixes it) or reject (test stands)
                           4. checks: typecheck · lint · format · unit · demo build · demo e2e
                           5. documentation agent: docs, comments and help text the change affects
                           6. reviewer agent: reads the diff for bugs, scope creep, test bending
                           7. push + pull request, then wait for GitHub CI (e2e against Supabase)
                           8. all green → "In review" in Discord, with the PR's live demo link
                         any failure in 4, 6 or 7 goes back to the build agent (up to 3 attempts)
                         still failing → "continue" resumes from the kept work, "approve" starts over
                                                 │
                         owner tries the demo (GitHub Pages, one per PR)
                           ├─ replies with feedback → product owner revises the spec → approve
                           │    → test agent updates the tests → build agent updates the same PR
                           └─ replies "merge" → squash merge, issue closed, branch and worktree removed

GitHub CI on main fails (checked every 10 minutes; failed jobs re-run once first)
  └─▶ bot opens its own thread + issue (label `ci-fix`) → fixer agent → checks → reviewer
        → pull request → GitHub CI → "In review" → owner replies "merge"
```

## How it works

- **Product-owner agent** (`src/po/`): runs Claude Code headlessly (`claude -p`) with the instructions in [`prompts/product-owner.md`](prompts/product-owner.md), the product context layer from [`docs/product/`](../docs/product/README.md) as its system prompt, and read-only tools (Read, Grep, Glob) over the repo. It returns structured JSON (`src/po/schema.ts`): a classification, related features, constraint findings, and then either questions, a spec, or a rejection.
- **Restarts:** builds run inside the bot's process, so a restart stops any build running or queued. At startup, an idea still marked as building is set to "Build failed" and told so in its thread; its work stays in the worktree, so **continue** picks it up and **approve** starts over.
- **Stateless rounds:** every evaluation gets the whole conversation so far, so nothing depends on a long-lived session. The transcript is stored in the GitHub issue, which means the bot can restart at any time.
- **Discord bot** (`src/bot.ts`): a new forum post creates an issue and triggers the first evaluation. Replies in the thread are batched (20 seconds after the last message) and sent back to the agent. The forum tag and the issue label follow the status.
- **Questions:** a post that asks how the product works, rather than asking for a change, gets an answer from the product-owner agent and the status "Answered". A follow-up reply gets another answer; a reply that asks for a change makes it an idea. A question about a spec being written or a demo being tried gets an answer without changing where the idea stands.
- **Closing:** reply `close` (or `done`, `thanks`) or react ✅ on an answered question or a rejected idea to close its issue and archive its thread. Both also close by themselves after `CLOSE_AFTER_DAYS` (default 7) without a reply. Anything with a branch or a pull request stays open. The bot stops listening to a closed thread, so picking it up later means a new post.
- **Approval gate:** a spec builds only after the owner replies `approve` (or `lgtm`, `ship it`, `build it`) or reacts ✅ to one of the bot's messages. Any other reply goes back to the product-owner agent to revise the spec.
- **Owner only:** the bot listens only to `DISCORD_OWNER_ID`. Posts become instructions for agents that write code, so nobody else can submit, answer or approve.
- **Test agent** (`prompts/test-writer.md`): sees the spec and the existing code, never an implementation. Writes `e2e/demo/idea-<issue>.spec.ts` against the static FakeRest demo build, one or more tests per acceptance criterion, and checks they fail for the right reason. The orchestrator runs the repo's eslint `--fix` and prettier on that file, keeps only it and commits it. If eslint errors remain, the test agent gets one more run to fix only those; if they still remain, the build fails with the lint output instead of committing a file the pre-commit hook would reject.
- **Build agent** (`prompts/builder.md`): implements the spec, adds unit tests and updates `docs/product/`. It may edit files and run the project's checks, but has no git access.
- **Guardrails in code** (`src/build/orchestrator.ts`): if the build agent changes a locked test file (its own or any earlier idea's `e2e/demo/idea-*.spec.ts`), it's restored and the attempt fails. The same goes for how the demo runs (`demo/`, the Playwright and demo Vite configs, the FakeRest default latency, see `src/build/guardrails.ts`): the demo's latency is deliberate, and a build that only passes without it has a timing bug. If the spec needs docs updates and none were made, the attempt fails. Nothing counts as done until the full checks, the reviewer agent and GitHub CI all pass. Each failure goes back to the build agent with the failing output or findings, up to `MAX_BUILD_ATTEMPTS`. A build that still fails keeps its worktree: reply **continue** to give the build agent another `MAX_BUILD_ATTEMPTS` attempts from that work, with the problem that stopped it (read back from the failure comment on the issue), or **approve** to start over from a fresh worktree and new tests.
- **Test disputes** (`src/build/tests.ts`): the build agent may not bend the app to fit a test. When it believes a locked test is wrong, it reports a dispute with evidence and the build pauses with its work kept. Reply **accept** and the test agent corrects only the disputed tests (committed as "Amend acceptance tests"), in whichever idea's test file they are: a new feature can legitimately break an assumption an earlier idea's locked test makes, and that file is then amended on the same branch, or **reject** and the build agent must satisfy them as written. Either reply resumes the build. The build agent can't delete files from its sandbox; it lists them in its report and the pipeline deletes them (never the locked test file or anything outside the worktree).
- **Documentation agent** (`prompts/documentation.md`, `src/build/docs.ts`): after the local checks pass, it reads the spec and the diff and updates what the change affects: `docs/product/`, the user and developer docs in `doc/`, readme files, comments in code and tests, and the app's help text in the English and French messages. It changes words, never behavior, and code enforces that: the pipeline compares each file it touched with a snapshot and reverts any change to code other than comments, to messages other than the text of existing keys, to locked tests, to agent instructions or to `CHANGELOG.md`, and any new file. If it edited code files, the checks run again, and its edits to those files are reverted if they fail. It never fails a build, and what it couldn't fix is listed in the pull request for a human. It runs before the reviewers, so they read its work, and again on each attempt. CI fixes skip it, since they don't add features.
- **Reviewer agent** (`prompts/reviewer.md`, `src/build/reviewer.ts`): after the local checks pass, a separate agent with read-only tools gets the spec and the diff, never the build agent's reasoning, and looks for logic errors, test bending, scope creep, demo-vs-Supabase differences, accessibility regressions and docs drift. Automatic flags (a shared component changed, app code comments that mention tests) point it at known patterns. Blocking findings go back to the build agent; notes go into the pull request.
- **Security reviewer** (`prompts/security-reviewer.md`, `src/build/security.ts`): when a diff touches the database schema, migrations, edge functions, Supabase config, auth pages, the Supabase provider, `canAccess`, the login flow or CI workflows, or adds raw HTML, a security definer function, an `anon`/`public` grant or the service role, a second reviewer checks it for security only: row-level security and grants (the only server-side access control, since the browser talks to PostgREST directly), views without `security_invoker`, privilege escalation, edge-function auth, unsanitized input and secrets. It runs after the main reviewer, for idea builds and CI fixes alike, and its blocking findings go back to the agent with the others. Changes that touch none of these skip it.
- **Access rules in CI** (`e2e/accessRules.spec.ts`): the Supabase e2e suite signs in as an anonymous visitor, a regular user and an admin, and checks every table in `supabase/schemas/01_tables.sql` and every view: anonymous visitors can't read or write anything (except the `init_state` view the login page needs), signed-in users can read every table, only admins can write `configuration` and `products`, nobody writes `sales` directly, and a user can't make themselves an admin. A new table is picked up automatically and fails the suite until it gets a row in the test's `seed()`; one with stricter rules also goes in `RESTRICTED_WRITES`.
- **CI gate** (`src/build/ci.ts`): after pushing, the pipeline opens the pull request and waits for every GitHub Actions run on the commit. CI runs the e2e suite against a real Supabase database, which the local checks can't. A failed run is first re-run once (failed jobs only), which rules out flaky tests and infrastructure hiccups such as Docker Hub rate limits. A failure that persists goes back to the build agent with the end of the failed job's log, unless it is only in the locked acceptance tests, which already passed locally: then the build pauses as a test dispute raised by CI, so a human decides whether the test or the app is at fault.
- **Live demo per pull request** (`.github/workflows/preview.yml`, `scripts/publish-preview.sh`): every push to a pull request builds the FakeRest demo and publishes it to the `gh-pages` branch under `pr-<number>/`, so it is served at `https://<owner>.github.io/<repo>/pr-<number>/`; main is published at the site root. Closing the pull request removes its folder. The branch is kept to a single commit. The workflow is part of CI, so a build is only "In review" once its demo is published.
- **Feedback loop:** in an "In review" thread, any reply other than `merge` is feedback on the demo. The product-owner agent revises the spec with it; approving the revision has the test agent update the locked tests (committed as "Amend acceptance tests") and the build agent update its implementation, on the same branch and pull request.
- **Fixing main** (`src/fix/`, `prompts/fixer.md`): at startup and every 10 minutes the bot checks GitHub CI on main's latest commit. A failed run is re-run once (failed jobs only); if it fails again, the bot opens a forum thread and an issue labeled `ci-fix`, and the fixer agent gets the failing jobs' logs and the latest commits. It fixes the root cause in the smallest change, may not skip or loosen tests or change CI and test setup to hide a failure, and reports itself blocked (with a recommendation, such as reverting a pull request) when it finds no safe fix. The same gates as a build follow: demo guardrails, full checks, the reviewer agent (told that a fix which touches tests or test setup needs a reason), a pull request and GitHub CI. In the thread, reply **merge** to merge it, or with feedback to change it; after a failure, **continue** keeps going from the fixer's work and **approve** starts over from main. One fix runs at a time, in the same queue as idea builds; while one is open, main isn't checked again.
- **Merge on approval:** reply `merge` and the bot squash-merges the pull request, if GitHub reports it mergeable with every check green, then closes the issue, deletes the branch and removes the local worktree. Pull requests merged on GitHub directly are picked up at startup and every 10 minutes.
- **Isolation:** each idea builds in its own git worktree under `../../worktrees/` (outside the repo), with Node 24 first on `PATH` and `CI=1`, so builds never touch your checkout.
- **Cost:** runs on your local Claude Code login, so there is no separate API bill on a machine where Claude Code is signed in. The `$` figure the harness prints is the API-equivalent cost Claude Code reports (typically $0.20–$0.55 per round; the first run of a session is higher while the product context is cached). On a subscription it counts toward usage limits rather than being billed.

## Setup

Requirements: Node 20+ for the pipeline, Node 24 for building the app (`brew install node@24`; set `NODE_BIN_DIR` if it lives elsewhere), Playwright's Chromium (`npx playwright install chromium` in the repo root), the [`claude` CLI](https://code.claude.com) logged in (run `claude`, then `/login`), and the GitHub CLI logged in (`gh auth login`) or a `GITHUB_TOKEN`.

```bash
cd pipeline
npm install
cp .env.example .env   # then fill in the values
```

### GitHub Pages

The preview workflow creates the `gh-pages` branch on its first run. Then, in the repository's Settings → Pages, set the source to **Deploy from a branch**, `gh-pages`, `/ (root)`. Pages is free for public repositories.

### Discord

1. Create a server, then a **Forum** channel named `ideas` (if Forum isn't offered, enable Community in Server Settings).
2. Add these forum tags, spelled exactly: `Clarifying`, `Spec ready`, `Rejected`, `Answered`, `Building`, `Test dispute`, `In review`, `Build failed`, `Merged`.
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
npm run build-idea -- 5                # tests, build, checks and review, then push the branch
npm run build-idea -- 5 --pr           # same, then open (or update) the PR and wait for GitHub CI
npm run build-idea -- 5 --reuse-tests  # keep the tests already committed; only rebuild
```

`BUILD_MODEL`, `TEST_MODEL` and `REVIEW_MODEL` pick each agent's model (all default to `opus`; `DOCS_MODEL` picks the documentation agent's and defaults to `sonnet`), e.g. `BUILD_MODEL=sonnet npm run build-idea -- 5 --reuse-tests` to try the build agent on Sonnet against the same tests.

## Samples

`samples/` holds ideas chosen to exercise each outcome: an iteration of an existing feature (`deal-closing-filter`), a new feature (`email-sequences`), a constraint conflict (`delete-users`), an out-of-scope vertical feature (`vet-appointments`), and a vague request (`better-dashboard`).
