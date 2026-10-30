# Constraints

Rules every change must obey. The product-owner agent rejects or reshapes ideas that break one; build and test agents verify their branch against all of them. Conventions: see [README.md](README.md). Paths are repo-relative.

## Product & scope

### C-001 Keep the product a generic CRM
- **Rule:** No vertical- or industry-specific feature (e.g. real-estate listings, clinic appointments) ships unless an approved spec explicitly requires it; domain flavor goes through configuration (C-002).
- **Why:** The showcase demonstrates a general-purpose CRM that any team can adopt.
- **Evidence:** `docs/product/README.md`. Source: project decision.
- **Check:** The feature makes sense for a generic B2B sales team without renaming its concepts.

### C-002 Domain option lists are configuration, never code
- **Rule:** Company sectors, deal stages/categories/pipeline statuses, note statuses, task types, currency, title and logos are read from `useConfigurationContext()` (defaults in `defaultConfiguration.ts`, overridable via `<CRM>` props and the Settings page), never hardcoded in components.
- **Why:** Admins customize these at runtime and integrators via `src/App.tsx`; hardcoded values silently ignore both.
- **Evidence:** `src/components/atomic-crm/root/ConfigurationContext.tsx`, `src/components/atomic-crm/root/defaultConfiguration.ts`, `src/components/atomic-crm/root/CRM.tsx`, `.claude/skills/frontend-dev/SKILL.md`, `MEMORY.md`.
- **Check:** No literal stage/status/sector/type values in new components; a new option list is added to `ConfigurationContextValue`, `defaultConfiguration.ts` and the Settings page.

### C-003 Never hard-delete users
- **Rule:** Sales users (team members) cannot be deleted; deactivation uses the `disabled` flag (Supabase auth ban).
- **Why:** Deleting a user would orphan or lose the records they own.
- **Evidence:** `AGENTS.md` (Important Notes), `doc/src/content/docs/developers/architecture-choices.mdx`, `supabase/functions/users/index.ts` (POST/PATCH only, `ban_duration`), `supabase/schemas/05_policies.sql` (no write policies on `sales`).
- **Check:** No UI action, dataProvider method or edge-function route deletes a `sales` row or an `auth.users` entry.

### C-004 Only free or no-cost services and dependencies
- **Rule:** A change may add only open-source dependencies or services usable at no cost (free tier); no new paid third-party service, API key with billing, or SaaS dependency.
- **Why:** The showcase must be runnable and previewable by anyone without spending money.
- **Evidence:** `docs/product/README.md`, `doc/src/content/docs/developers/data-providers.mdx` (Supabase free tier). Source: project decision.
- **Check:** Every new `package.json` entry has an OSI license; every new external URL or env var points to a free service.

### C-005 All committed content is in English
- **Rule:** Code identifiers, comments, docs, agent prompts, commit messages, PR text, log/error strings and config keys are English; the only exceptions are translation catalogs (`frenchCrmMessages.ts`, `ra-language-*` packages) and runtime data values in fixtures.
- **Why:** One working language keeps agents and reviewers aligned; localization happens through i18n, not source text.
- **Evidence:** `.claude/rules/english-only.md`, `docs/product/README.md`. Source: project decision.
- **Check:** Scan the diff for accented characters or non-English words outside locale catalogs.

### C-006 Implement exactly the requested scope
- **Rule:** A change implements only its spec; adjacent bugs, refactors or missing tests are reported, not fixed in the same branch.
- **Why:** Each idea is demoed and reviewed in isolation on its own preview.
- **Evidence:** `.claude/rules/coding-style.md` (Scope discipline).
- **Check:** Every hunk in the diff traces to an acceptance criterion.

### C-007 Keep the product context layer in sync
- **Rule:** A pull request that adds, removes or alters a feature, constraint or architectural element updates the matching file in `docs/product/` in the same PR, or states why not.
- **Why:** Agents evaluate ideas against these files; stale files produce wrong verdicts.
- **Evidence:** `docs/product/README.md` (Maintenance).

## Data & database

### C-010 Declarative schema is the source of truth
- **Rule:** Every database change edits `supabase/schemas/*.sql` and ships a migration generated with `npx supabase db diff --local -f <name>`; afterwards `npx supabase db diff --local` reports no changes.
- **Why:** Schema files and migration history must describe the same database.
- **Evidence:** `doc/src/content/docs/developers/migrations.mdx`, `AGENTS.md` (Database Management), `supabase/schemas/`.
- **Check:** Diff touches both `supabase/schemas/` and a new file in `supabase/migrations/`; `npx supabase db reset --local` replays cleanly.

### C-011 Never edit existing migrations
- **Rule:** Committed files in `supabase/migrations/` are append-only; only the newly generated migration of the current change may be hand-adjusted (e.g. `RENAME COLUMN` instead of DROP+CREATE), and it must stay coherent with the schema files.
- **Why:** Deployed databases have already applied earlier migrations.
- **Evidence:** `doc/src/content/docs/developers/migrations.mdx`, `.claude/skills/delete-initial-resource/SKILL.md` (Red Flags).
- **Check:** `git diff --name-status` shows only `A` (added) entries under `supabase/migrations/`.

### C-012 SQL functions use exact pg_dump format and a fixed search_path
- **Rule:** Functions in `supabase/schemas/02_functions.sql` / `08_search.sql` are written in the exact `npx supabase db dump --local --schema public` format and declare `SET search_path`; a function that counts rows to enforce a limit is `SECURITY DEFINER`.
- **Why:** Other formatting causes phantom diffs; a missing search_path is a security warning; an invoker count under-counts under RLS.
- **Evidence:** `AGENTS.md`, `doc/src/content/docs/developers/migrations.mdx` (Editing Functions), `supabase/schemas/02_functions.sql`, `supabase/migrations/20260309112831_fix_security_warnings.sql`, `.claude/skills/backend-dev/SKILL.md`.

### C-013 Every new table ships with RLS, grants and ownership trigger
- **Rule:** A new public table enables RLS and declares policies in `05_policies.sql`, grants table and sequence in `06_grants.sql`, and, if it has a `sales_id` owner column, a `set_sales_id_default` trigger in `04_triggers.sql`.
- **Why:** Without RLS the PostgREST API exposes the table to the `anon` role, which holds table grants.
- **Evidence:** `supabase/schemas/05_policies.sql`, `supabase/schemas/06_grants.sql` (anon/authenticated grants), `supabase/schemas/04_triggers.sql`, `.claude/skills/backend-dev/SKILL.md`.

### C-014 Keep summary views aligned with their tables
- **Rule:** A column added, renamed or removed on `contacts`, `companies`, notes, deals or tasks is reflected in `contacts_summary`, `companies_summary` and every `UNION ALL` branch of `activity_log`; views keep `security_invoker = on`.
- **Why:** The Supabase provider reads contacts and companies only through the summary views, and invoker views keep RLS applied.
- **Evidence:** `supabase/schemas/03_views.sql`, `src/components/atomic-crm/providers/supabase/dataProvider.ts` (`getList`/`getOne` routing), `.claude/skills/backend-dev/SKILL.md`.

### C-015 Data-shape changes propagate to every consumer
- **Rule:** A field added to or removed from contacts, companies or deals updates the CSV samples and importers, the JSON importer, exporters, both contact-merge implementations, and the FakeRest data generators.
- **Why:** These paths copy record fields explicitly and silently drop unknown ones.
- **Evidence:** `AGENTS.md` (Adding Custom Fields), `src/components/atomic-crm/contacts/useContactImport.tsx`, `src/components/atomic-crm/dataImport/`, `src/components/atomic-crm/misc/useImportFromJson.ts`, `src/components/atomic-crm/providers/commons/mergeContacts.ts`, `supabase/functions/merge_contacts/`, `src/components/atomic-crm/providers/fakerest/dataGenerator/`.

### C-016 Put backend logic in the lightest layer
- **Rule:** Prefer a frontend dataProvider method against PostgREST; use a database view for aggregated reads and an edge function (exposed as a dataProvider method) for multi-table writes; no custom backend server.
- **Why:** The architecture is "Supabase only" with minimal backend code to maintain.
- **Evidence:** `.claude/skills/backend-dev/SKILL.md`, `doc/src/content/docs/developers/architecture-choices.mdx`, `supabase/functions/`.

## Data providers & demo mode

### C-020 Every user-facing feature works in FakeRest demo mode
- **Rule:** Each user-facing feature is fully usable in the demo build (`npm run build:demo`, FakeRest, seeded data, no backend); Supabase-only capabilities (auth admin, inbound email, storage, MCP, edge functions) are exempt only if they degrade gracefully per C-021.
- **Why:** Idea previews are static demo deploys with no backend.
- **Evidence:** `docs/product/README.md`, `demo/App.tsx`, `vite.demo.config.ts` (`VITE_IS_DEMO`, placeholder Supabase URL), `src/components/atomic-crm/providers/fakerest/`. Source: project decision.
- **Check:** Run `npm run dev:demo`, exercise every acceptance criterion; no request goes to `demo.example.org`.

### C-021 Supabase-only capabilities degrade gracefully in demo
- **Rule:** In demo mode a Supabase-only capability is hidden (feature-flagged on its env var) or stubbed in the FakeRest auth/data provider, and never throws, blanks the page or shows a raw error.
- **Why:** A broken control on a preview reads as a broken feature.
- **Evidence:** `src/components/atomic-crm/settings/ProfilePage.tsx` (`VITE_INBOUND_EMAIL` guard), `src/components/atomic-crm/providers/fakerest/authProvider.ts` (stubbed `resetPassword`, `setPassword`, OAuth consent), `src/components/atomic-crm/providers/fakerest/dataProvider.ts` (`salesCreate`, `updatePassword`).

### C-022 Both providers implement the same CrmDataProvider contract
- **Rule:** Every custom method added to the Supabase provider is also implemented in the FakeRest provider with equivalent observable behavior.
- **Why:** UI code calls `useDataProvider<CrmDataProvider>()` and must run unchanged on either backend.
- **Evidence:** `src/components/atomic-crm/providers/types.ts`, `src/components/atomic-crm/providers/supabase/dataProvider.ts` (`CrmDataProvider` type), `src/components/atomic-crm/providers/fakerest/dataProvider.ts` (`dataProviderWithCustomMethod: CrmDataProvider`).
- **Check:** `npm run typecheck` enforces the signature; a test in `fakerest/dataProvider.test.ts` covers the behavior.

### C-023 List filters use postgrest syntax supported by the supabaseAdapter
- **Rule:** List filters use `field@operator` (`ra-data-postgrest`) keys, and every operator used must be mapped in `transformFilter.ts` (currently `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `is`, `not.is`, `in`, `cs`, `ov`, `or`).
- **Why:** Unmapped operators pass through to FakeRest unchanged and silently match nothing in demo mode.
- **Evidence:** `src/components/atomic-crm/providers/fakerest/internal/transformFilter.ts`, `src/components/atomic-crm/providers/fakerest/internal/supabaseAdapter.ts`, `doc/src/content/docs/developers/data-providers.mdx` (Filters Syntax), `AGENTS.md`, `MEMORY.md`.
- **Check:** A new operator adds a case in `transformFilter.ts` and a test in `supabaseAdapter.test.ts`.

### C-024 FakeRest emulates database views, triggers and seeds new data
- **Rule:** Any field computed by a view or trigger (e.g. `nb_tasks`, `nb_contacts`, `company_name`, tag cleanup) is also computed in FakeRest lifecycle callbacks or generators, and new fields/resources are seeded in `fakerest/dataGenerator/`.
- **Why:** FakeRest strips the `_summary` suffix and has no database, so un-emulated fields are missing on previews.
- **Evidence:** `src/components/atomic-crm/providers/fakerest/internal/supabaseAdapter.ts` (`removeSummarySuffix`), `src/components/atomic-crm/providers/fakerest/dataProvider.ts` (lifecycle callbacks), `src/components/atomic-crm/providers/fakerest/dataGenerator/`, `doc/src/content/docs/developers/architecture-choices.mdx` (Views).

### C-025 UI accesses data only through ra-core hooks or the dataProvider
- **Rule:** Components fetch and mutate data via ra-core hooks or custom dataProvider methods called with react-query; no direct Supabase client, `fetch` or axios call to the backend outside `providers/`.
- **Why:** Direct calls bypass FakeRest and break demo mode.
- **Evidence:** `.claude/skills/frontend-dev/SKILL.md` (Data fetching), `src/components/atomic-crm/providers/supabase/supabase.ts`.
- **Check:** `grep -rn "getSupabaseClient\|supabase-js" src` matches only `src/components/atomic-crm/providers/supabase/`.

## Security & auth

### C-030 Enforce permissions server-side and mirror them in canAccess
- **Rule:** Any permission rule is enforced on the server (RLS policy or edge-function check) and mirrored in `commons/canAccess.ts`, which both auth providers use; admin-only resources stay `sales` and `configuration` unless a spec changes it.
- **Why:** Frontend checks are cosmetic; the API is directly reachable with the publishable key.
- **Evidence:** `src/components/atomic-crm/providers/commons/canAccess.ts`, `supabase/schemas/05_policies.sql` (`is_admin()` on `configuration`), `supabase/functions/users/index.ts` (administrator checks).

### C-031 Team members are written only through the users edge function
- **Rule:** `sales` rows are created and updated only by the `users` edge function (service role); no RLS insert/update/delete policy is granted on `sales` to `authenticated`.
- **Why:** Sales rows mirror `auth.users` and carry the `administrator` flag; client writes would allow privilege escalation.
- **Evidence:** `supabase/schemas/05_policies.sql` (select-only on `sales`), `supabase/schemas/04_triggers.sql` (`on_auth_user_created/updated`), `src/components/atomic-crm/providers/supabase/dataProvider.ts` (`salesCreate`, `salesUpdate`).

### C-032 Edge functions authenticate every request themselves
- **Rule:** Because `verify_jwt = false`, every edge-function handler runs behind `OptionsMiddleware` → `AuthMiddleware` → `UserMiddleware` from `_shared/authentication.ts`, or behind an equivalent function-specific secret check (Postmark: basic auth + IP allowlist).
- **Why:** Without it the function is publicly callable with service-role privileges.
- **Evidence:** `supabase/config.toml` (`verify_jwt = false`), `supabase/functions/_shared/authentication.ts`, `supabase/functions/users/index.ts`, `supabase/functions/postmark/index.ts`.

### C-033 No secrets in the frontend bundle
- **Rule:** Frontend code uses only `VITE_SUPABASE_URL` and `VITE_SB_PUBLISHABLE_KEY`; service-role keys and webhook secrets live only in edge functions, e2e fixtures or server env.
- **Why:** Everything under `src/` and `VITE_*` is shipped to the browser.
- **Evidence:** `src/components/atomic-crm/providers/supabase/supabase.ts`, `supabase/functions/_shared/supabaseAdmin.ts`, `e2e/fixtures.ts`.
- **Check:** `grep -rn "SERVICE_ROLE" src` returns nothing; no new `VITE_*` variable holds a secret.

### C-034 RLS write checks constrain every client-settable column
- **Rule:** A `WITH CHECK` (or trigger / `CHECK` constraint) restricts every column a non-admin may set, not just ownership; client-chosen `status`, `type`, flags or amounts are never trusted.
- **Why:** PostgREST lets callers set any granted column.
- **Evidence:** `.claude/skills/backend-dev/SKILL.md` (RLS enforcement pitfalls), `supabase/schemas/05_policies.sql`.

### C-035 Sanitize rendered HTML
- **Rule:** User-provided Markdown/HTML is rendered only through `misc/Markdown.tsx` (marked + DOMPurify); no other `dangerouslySetInnerHTML` without DOMPurify.
- **Why:** Notes and inbound emails contain attacker-controllable content.
- **Evidence:** `src/components/atomic-crm/misc/Markdown.tsx`, `.claude/rules/web-security.md`.
- **Check:** `grep -rn dangerouslySetInnerHTML src` lists only sanitized sites.

### C-036 Security-sensitive diffs get a security review
- **Rule:** A diff touching auth, user input handling, database queries/migrations, RLS, file operations or external API calls requests a security review before merge.
- **Why:** These areas carry the highest impact for missed vulnerabilities.
- **Evidence:** `.claude/rules/security-triggers.md`.

## Frontend & UI

### C-040 Stay on the established stack
- **Rule:** UI is built with React 19, ra-core / shadcn-admin-kit, shadcn/ui (`base-vega`) on Base UI, Tailwind CSS v4, React Router 7, TanStack Query and React Hook Form; no alternative UI kit, CSS framework, router, form or server-state library.
- **Why:** One stack keeps the codebase small and customizable.
- **Evidence:** `package.json`, `components.json`, `AGENTS.md` (Technology Stack), `doc/src/content/docs/developers/architecture-choices.mdx`.

### C-041 Use the admin and ui layers as mutable dependencies
- **Rule:** Form inputs come from `@/components/admin/`, UI primitives from `@/components/ui/`; extend these files in place rather than adding parallel copies or importing equivalents from npm.
- **Why:** The admin layer binds inputs to ra-core forms; both folders are vendored to be edited.
- **Evidence:** `AGENTS.md` (Mutable Dependencies), `.claude/skills/frontend-dev/SKILL.md`, `src/components/admin/`, `src/components/ui/`.

### C-042 Every user-facing string is translated in all catalogs
- **Rule:** UI text goes through `useTranslate`/i18n keys, and each key exists in both `englishCrmMessages.ts` and `frenchCrmMessages.ts`.
- **Why:** The French catalog `satisfies CrmMessages`, so a one-sided key breaks typecheck, and locale switching is a shipped feature.
- **Evidence:** `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`, `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`, `src/components/atomic-crm/providers/commons/i18nProvider.ts`, `doc/src/content/docs/developers/customizing.mdx`.
- **Check:** `npm run typecheck`; no literal English labels in new JSX.

### C-043 Pages work on desktop and mobile
- **Rule:** New or changed pages render a usable layout on both desktop and mobile viewports (branch with `useIsMobile()` where layouts differ; mobile resources registered in the mobile `<Resource>` set of `CRM.tsx`).
- **Why:** The app ships separate mobile layouts and e2e runs a Mobile Chrome project.
- **Evidence:** `.claude/skills/frontend-dev/SKILL.md` (Responsive design), `src/components/atomic-crm/root/CRM.tsx`, `playwright.config.ts` (`Mobile Chrome`).

### C-044 Style with semantic theme tokens
- **Rule:** Component colors use semantic Tailwind tokens (`bg-primary`, `text-muted-foreground`); new tokens are defined in both `:root` and `.dark` in `src/index.css` and registered under `@theme inline`; palette changes go through `lightTheme`/`darkTheme`.
- **Why:** Hardcoded colors break dark mode and theming.
- **Evidence:** `.claude/skills/shadcn-customization/SKILL.md`, `src/index.css`, `src/components/admin/theme-provider.tsx`.

### C-045 Asset URLs must survive sub-path deploys
- **Rule:** Images and logos are imported as modules, absolute URLs or data URIs, never route-relative paths.
- **Why:** The demo build uses `base: "./"` and nested routes (e.g. `/oauth/consent`) break relative paths (issue #291).
- **Evidence:** `vite.demo.config.ts`, `src/components/atomic-crm/root/CRM.tsx` (logo prop docs), `src/App.tsx`, `doc/src/content/docs/developers/customizing.mdx`.

### C-046 Resources follow the standard structure
- **Rule:** A new resource lives in `src/components/atomic-crm/<resource>/` with `index.tsx` exporting `{ list, show, edit, create, recordRepresentation }` as applicable, shared `<Resource>Inputs.tsx`, and is registered in `root/CRM.tsx`.
- **Why:** Routing, menus and agent tooling (e.g. `delete-initial-resource`) rely on this layout.
- **Evidence:** `.claude/skills/frontend-dev/SKILL.md` (Resource conventions), `src/components/atomic-crm/root/CRM.tsx`, `src/components/atomic-crm/contacts/`.

## Code quality & testing

### C-050 Strict TypeScript must pass
- **Rule:** `npm run typecheck` (strict, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`) passes with no new `@ts-ignore`.
- **Why:** Type parity is what enforces provider and i18n contracts (C-022, C-042).
- **Evidence:** `tsconfig.app.json`, `.github/workflows/check.yml` (typecheck job).

### C-051 ESLint and Prettier must pass
- **Rule:** `make lint` passes: no `console.log` (only `console.warn`/`console.error`), unused variables prefixed `_`, no `any` in `src/components/admin`, `src/hooks`, `src/lib`, and Prettier formatting.
- **Why:** CI's lint job fails on any violation.
- **Evidence:** `eslint.config.js`, `.prettierrc.json`, `.lintstagedrc`, `.github/workflows/check.yml` (lint job).

### C-052 New behavior ships with behavior-level unit tests
- **Rule:** New code paths get tests named `*.test.ts(x)` next to the code (browser-mode Vitest for `src/`, Node for `supabase/functions/**`), asserting user-observable behavior; snapshot-only, mock-return or internal-state assertions are not accepted.
- **Why:** Tests guard future regressions; filler tests do not.
- **Evidence:** `vitest.config.ts`, `.claude/rules/testing.md`, `.github/workflows/check.yml` (test-app job).
- **Check:** `make test` passes; each test maps to an acceptance criterion.

### C-053 UI changes ship with an e2e spec
- **Rule:** A change touching UI, filters, forms or interactions adds or updates `e2e/<feature>.spec.ts` using role/label locators and web-first assertions, with no `waitForTimeout`; pure-CSS or migration-only changes state their exemption.
- **Why:** E2E is the acceptance gate for user-visible behavior.
- **Evidence:** `.claude/skills/e2e-conventions/SKILL.md`, `.claude/skills/playwright-testing/SKILL.md`, `.claude/rules/testing.md`, `playwright.config.ts`, `e2e/fixtures.ts`.
- **Check:** CI `e2e-test` job is green.

### C-054 Keep files small
- **Rule:** No source file grows past 800 lines; when an edit would push a file past ~400 lines, extract a focused module instead.
- **Why:** The codebase is meant to stay small and easy to customize.
- **Evidence:** `.claude/rules/coding-style.md` (File organization), `doc/src/content/docs/developers/architecture-choices.mdx`.
- **Check:** `wc -l` on changed files.

## Tooling & CI

### C-060 Node 24 and npm with the lockfile
- **Rule:** Use Node 24 (`.nvmrc`) and npm; dependency changes update `package-lock.json` so `npm ci` succeeds.
- **Why:** CI installs with `npm ci` on Node 24.
- **Evidence:** `.nvmrc`, `package-lock.json`, `.github/workflows/check.yml`.

### C-061 Never bypass the npm release-age guard
- **Rule:** Do not override or remove `min-release-age` in `.npmrc`; pick a version old enough to satisfy it.
- **Why:** Freshly published versions are the main supply-chain attack window.
- **Evidence:** `.npmrc`, `AGENTS.md` (Important Notes).

### C-062 All CI checks pass before merge
- **Rule:** The `check.yml` jobs lint, typecheck, test-app (app + functions unit tests), e2e-test and build pass on the PR.
- **Why:** These are the merge gate for every branch.
- **Evidence:** `.github/workflows/check.yml`, `makefile` (`test-e2e-ci`).

### C-063 Both production and demo builds succeed
- **Rule:** `npm run build` and `npm run build:demo` both succeed.
- **Why:** Production deploys use the first; idea previews use the second, which CI does not run.
- **Evidence:** `package.json` (`build`, `build:demo`), `vite.demo.config.ts`, `.github/workflows/check.yml`.

### C-064 Keep pre-commit hooks and generated files intact
- **Rule:** Commits run the husky pre-commit hook (registry regeneration + lint-staged) and are never made with `--no-verify`; `registry.json` is regenerated, not hand-edited.
- **Why:** The shadcn registry and formatting must match the source.
- **Evidence:** `.husky/pre-commit`, `.lintstagedrc`, `scripts/generate-registry.mjs`, `AGENTS.md` (Git Hooks).

### C-065 Edge functions target Deno with aliased imports for tests
- **Rule:** Edge functions use Deno `jsr:`/`npm:` specifiers and shared helpers in `supabase/functions/_shared/`; any new specifier used by tested function code is aliased in the `functions` project of `vitest.config.ts`.
- **Why:** Function tests run in Node in CI without a Deno runtime.
- **Evidence:** `vitest.config.ts`, `supabase/functions/_shared/`, `.github/workflows/check.yml` (functions tests).
