# Feature catalog

Atomic CRM is a small, customizable CRM for small sales teams. Team members ("sales") log in, manage **contacts** and the **companies** they work at, track **deals** on a Kanban pipeline, and keep a history of **notes** and **tasks** per contact or deal. Contacts are labelled with **tags** and a note-derived status (cold/warm/hot...). Admins manage users and team-wide settings. Data also flows in through CSV/JSON import, inbound email (Postmark) and an MCP server for AI assistants. The UI is responsive: a separate, reduced mobile app (PWA, offline-capable) is rendered below the mobile breakpoint. Two backends: Supabase (production) and FakeRest (in-browser demo, data resets on reload).

**Path shorthands:** `crm/` = `src/components/atomic-crm/`, `fn/` = `supabase/functions/`, `schemas/` = `supabase/schemas/`. Demo entry: `demo/App.tsx` (FakeRest providers + `memoryStore`). Production entry: `src/App.tsx`.

## Core entities

| Entity | What it represents | Key relations | Main table / view |
|---|---|---|---|
| Sale | A team member / CRM user (admin or not, can be disabled) | 1:1 `auth.users` (`user_id`); owner (`sales_id`) of every other record | `sales` |
| Contact | A person | `company_id` → Company; `sales_id` → Sale; `tags[]` → Tag | `contacts`; reads via `contacts_summary` (adds `company_name`, `nb_tasks` pending, `email_fts`, `phone_fts`) |
| Company | An organization | has Contacts and Deals; `sales_id` → Sale | `companies`; reads via `companies_summary` (adds `nb_contacts`, `nb_deals`) |
| Deal | A sales opportunity on the pipeline | `company_id` → Company; `contact_ids[]` → Contacts; `stage`, `categories[]`, `index` (column order), `archived_at` | `deals` |
| Contact note | Timestamped note (with status, attachments) on a contact | `contact_id`, `sales_id` | `contact_notes` |
| Deal note | Timestamped note (with attachments) on a deal | `deal_id`, `sales_id` | `deal_notes` |
| Task | To-do with due date and type, always tied to a contact | `contact_id`, `sales_id` | `tasks` |
| Tag | Colored label for contacts | referenced by `contacts.tags[]` | `tags` |
| Configuration | Team-wide settings singleton (id=1, JSON) | — | `configuration` |
| Activity | Read-only union of creation events (company, contact, contact note, deal, deal note) | `company_id`, `sales_id` | view `activity_log` |

Schema source of truth: `schemas/01_tables.sql`, `03_views.sql`. Resources registered in `crm/root/CRM.tsx`.

---

## Contacts (CONT)

### F-CONT-01 Contact list (desktop)
- **What:** Paginated list (25/page) sorted by last seen; sort by first name, last name, last seen; free-text search over name, company name, title, emails, phones, background. Each row shows avatar, title/company, status dot, tags, pending task count, last seen.
- **Where:** `crm/contacts/ContactList.tsx`, `ContactListContent.tsx`, `ContactEmpty.tsx`; search mapping in `crm/providers/supabase/dataProvider.ts` (`applyFullTextSearch`); view `contacts_summary`.
- **Demo mode:** works.
- **Related:** F-CONT-02, F-CONT-06, F-IMP-01, F-MOB-02.

### F-CONT-02 Contact list filters
- **What:** Sidebar toggle filters: last seen (today, this week, before this week/month/last month), status, tags (first 10 by name), "with pending tasks", account manager ("me" or any other active sale). Mobile shows them in a sheet plus an active-filter summary.
- **Where:** `crm/contacts/ContactListFilter.tsx`, `crm/filters/FilterCategory.tsx`, `crm/misc/ResponsiveFilters.tsx`, `crm/misc/ActiveFilterButton.tsx`, `crm/sales/AccountManagerInput.tsx` (`AccountManagerFilter`).
- **Config:** status values from `noteStatuses`.
- **Demo mode:** works (filters translated by `crm/providers/fakerest/internal/supabaseAdapter.ts`).

### F-CONT-03 Create / edit contact
- **What:** Form with pronouns (He/She/They), first/last name (required), title, company (autocomplete with inline create), multiple typed emails and phones (Work/Home/Other), LinkedIn URL (validated), background, newsletter flag, account manager (required, active sales only). Typing/pasting an email pre-fills empty first/last name from `first.last@`.
- **Where:** `crm/contacts/ContactCreate.tsx`, `ContactEdit.tsx`, `ContactInputs.tsx`, `contactModel.ts` (gender list, cleanup), `crm/misc/isLinkedInUrl.ts`; mobile sheets `ContactCreateSheet.tsx`, `ContactEditSheet.tsx`.
- **Demo mode:** works.
- **Related:** F-COMP-06, F-CONT-10, F-USER-05.

### F-CONT-04 Contact detail page
- **What:** Desktop show page: header (avatar, title at company, company logo link), note composer and infinite-scroll notes timeline; aside with status, personal info, background, tags, tasks with "add task", and an Edit link.
- **Where:** `crm/contacts/ContactShow.tsx`, `ContactAside.tsx`, `ContactPersonalInfo.tsx`, `ContactBackgroundInfo.tsx`.
- **Demo mode:** works.
- **Related:** F-NOTE-01, F-TASK-05, F-TAG-01, F-CONT-05, F-MOB-02.

### F-CONT-05 Contact status
- **What:** Contact carries a status (default cold/warm/hot/in-contract, colored dot). Changed directly from the aside selector, or set by the status chosen when adding a contact note (note form defaults to the contact's current status).
- **Where:** `crm/contacts/ContactInputs.tsx` (`ContactStatusSelector`), `crm/notes/StatusSelector.tsx`, `crm/notes/NoteCreate.tsx` (updates contact `status`), `crm/misc/Status.tsx`.
- **Config:** `noteStatuses` (`<CRM>` prop / Settings).
- **Demo mode:** works.
- **Related:** F-DASH-02, F-SET-02.

### F-CONT-06 Bulk actions on contacts
- **What:** Select rows (or select all) then: add/remove a tag on all selected, export selected to CSV, delete selected.
- **Where:** `crm/contacts/ContactList.tsx` (`ContactBulkActionButtons`), `crm/contacts/BulkTagButton.tsx`.
- **Demo mode:** works.
- **Related:** F-TAG-01, F-CONT-07.

### F-CONT-07 Contact CSV export
- **What:** Export (whole filtered list or selection) to `contacts.csv`, resolving company name, account manager name, tag names, and flattening emails/phones into `email_work/home/other`, `phone_work/home/other`.
- **Where:** `crm/contacts/ContactList.tsx` (`exporter`).
- **Demo mode:** works.
- **Related:** F-IMP-01 (same column layout as `crm/contacts/contacts_export.csv`).

### F-CONT-08 vCard export
- **What:** Download a single contact as a `.vcf` file. Button shown only in the aside of the contact **edit** page.
- **Where:** `crm/contacts/ExportVCardButton.tsx`, `crm/contacts/ContactAside.tsx` (`link !== "edit"` branch).
- **Demo mode:** works.

### F-CONT-09 Merge contacts
- **What:** From the contact edit page aside, pick a target contact; the current contact is merged into it (target wins on conflicting scalar fields; emails, phones, tags unioned; notes, tasks, deal `contact_ids` re-pointed) and the current contact is deleted.
- **Where:** `crm/contacts/ContactMergeButton.tsx`; edge function `fn/merge_contacts/index.ts`; FakeRest port `crm/providers/commons/mergeContacts.ts`. A SQL `merge_contacts()` also exists in `schemas/02_functions.sql` but the UI calls the edge function.
- **Demo mode:** works (client-side emulation).
- **Related:** F-NOTE-01, F-TASK-02, F-DEAL-03.

### F-CONT-10 Automatic contact avatar and email normalization
- **What:** On save, emails are lowercased and, if no avatar is set, an avatar is fetched from Gravatar, falling back to the email domain's favicon (some domains excluded).
- **Where:** triggers `10_lowercase_contact_emails`, `20_contact_saved` in `schemas/04_triggers.sql`; functions `lowercase_email_jsonb`, `handle_contact_saved`, `get_avatar_for_email`, `get_domain_favicon` in `schemas/02_functions.sql`; table `favicons_excluded_domains`. Demo: `crm/providers/commons/getContactAvatar.ts`, `crm/misc/unsupportedDomains.const.ts`.
- **Demo mode:** works (client-side, no lowercasing).

### F-CONT-11 Last-seen tracking
- **What:** `first_seen`/`last_seen` set at creation; `last_seen` bumped when a contact note or task is added. Drives default sort, filters and hot-contacts order.
- **Where:** `crm/contacts/contactModel.ts` (`cleanupContactForCreate`), `crm/notes/NoteCreate.tsx`, `crm/tasks/AddTask.tsx`; trigger `on_public_contact_notes_created_or_updated` (`handle_contact_note_created_or_updated`).
- **Demo mode:** works (client updates only).

### F-CONT-12 Delete contact
- **What:** Delete button in the contact edit page aside (desktop), plus bulk delete (F-CONT-06). Hard delete.
- **Where:** `crm/contacts/ContactAside.tsx`; RLS `schemas/05_policies.sql` ("Contact Delete Policy").
- **Demo mode:** works (company `nb_contacts` decremented client-side).

---

## Companies (COMP)

### F-COMP-01 Company list
- **What:** Card grid (logo, name, sector, contact and deal counts), 10/25/50/100 per page, sort by name, created date, contact count; text search over name, phone, website, zip, city, state.
- **Where:** `crm/companies/CompanyList.tsx`, `GridList.tsx`, `CompanyCard.tsx`, `CompanyEmpty.tsx`; view `companies_summary`.
- **Demo mode:** works.

### F-COMP-02 Company filters
- **What:** Search box plus toggle filters by size bucket, sector, and "managed by me".
- **Where:** `crm/companies/CompanyListFilter.tsx`, `crm/companies/sizes.ts`.
- **Config:** sectors from `companySectors`.
- **Demo mode:** works.

### F-COMP-03 Create / edit company
- **What:** Form: logo (image editor), name (required), website (URL), LinkedIn, phone, sector, size, revenue, tax identifier, address/city/zip/state/country, description, list of context links, account manager.
- **Where:** `crm/companies/CompanyCreate.tsx`, `CompanyEdit.tsx`, `CompanyInputs.tsx`, `crm/misc/ImageEditorField.tsx`; logo upload in `crm/providers/supabase/dataProvider.ts` (`processCompanyLogo`).
- **Config:** `companySectors`.
- **Demo mode:** works (logo stored as base64).

### F-COMP-04 Company detail page
- **What:** Desktop: tabs (URL `/companies/:id/show/:tab`) for activity log, contacts (sortable, "add contact" pre-linked to the company) and deals; aside with company info, address, context links, account manager. Mobile: read-only info only.
- **Where:** `crm/companies/CompanyShow.tsx`, `CompanyAside.tsx`.
- **Demo mode:** works.
- **Related:** F-ACT-01, F-CONT-03, F-DEAL-04.

### F-COMP-05 Automatic company logo
- **What:** On save without a logo, the website's favicon becomes the logo.
- **Where:** trigger `company_saved` → `handle_company_saved`/`get_domain_favicon` (`schemas/02_functions.sql`, `04_triggers.sql`). Demo: `crm/providers/commons/getCompanyAvatar.ts` (uses favicon.show).
- **Demo mode:** works (different favicon source).

### F-COMP-06 Inline company creation
- **What:** In the contact form company autocomplete, typing an unknown name offers "create" which inserts the company immediately.
- **Where:** `crm/companies/AutocompleteCompanyInput.tsx`.
- **Demo mode:** works.

### F-COMP-07 Company CSV export
- **What:** Export button on the company list (default ra-core CSV exporter, raw columns).
- **Where:** `crm/companies/CompanyList.tsx` (`ExportButton`).
- **Demo mode:** works.

### F-COMP-08 Delete company
- **What:** Delete button in the company edit page aside. Hard delete.
- **Where:** `crm/companies/CompanyAside.tsx` (`link !== "edit"` branch).
- **Demo mode:** works.

---

## Deals (DEAL)

### F-DEAL-01 Deal pipeline Kanban
- **What:** Desktop-only board with one column per stage, each showing the summed amount; drag cards to reorder within or move across stages (persists `stage` and `index`). Up to 100 unarchived deals. Cards show name, company logo, amount, categories.
- **Where:** `crm/deals/DealList.tsx`, `DealListContent.tsx` (drag logic, `@hello-pangea/dnd`), `DealColumn.tsx`, `DealCard.tsx`, `stages.ts` (deals with unknown stage go to first column).
- **Config:** `dealStages`, `currency`.
- **Demo mode:** works.
- **Related:** F-SET-02, F-SET-03.

### F-DEAL-02 Deal search and filters
- **What:** Always-on search (name, description, and category labels), filters by company and categories (any-of); admins get an account manager picker, non-admins an "Only deals I manage" switch.
- **Where:** `crm/deals/DealList.tsx`, `OnlyMineInput.tsx`, `crm/sales/AccountManagerInput.tsx`, `crm/providers/supabase/searchDealCategories.ts`.
- **Demo mode:** works.

### F-DEAL-03 Create / edit deal
- **What:** Modal dialog (routes `/deals/create`, `/deals/:id`): name (required), description, company, contacts (multi), categories (multi), amount, expected closing date (date only), stage. New deals go to the top of their column.
- **Where:** `crm/deals/DealCreate.tsx`, `DealEdit.tsx`, `DealInputs.tsx`; migrations `20261026120000_deal_categories.sql`, `20260226163952_deals_expected_closing_date_date_only.sql`.
- **Config:** `dealStages`, `dealCategories`.
- **Demo mode:** works.

### F-DEAL-04 Deal detail
- **What:** Modal (`/deals/:id/show`) with expected closing date (flagged when past), amount, categories, stage, description, linked contacts, and deal notes; actions Edit / Archive (or Unarchive / Delete when archived).
- **Where:** `crm/deals/DealShow.tsx`, `crm/deals/ContactList.tsx`.
- **Demo mode:** works.
- **Related:** F-NOTE-02, F-DEAL-05.

### F-DEAL-05 Archive / unarchive deals
- **What:** Archiving sets `archived_at` and removes the deal from the board and global search; "View archived deals" opens a dialog grouped by archive date. Unarchive puts the deal back at the top of its stage. Delete is only offered on archived deals (and in the edit dialog).
- **Where:** `crm/deals/DealShow.tsx` (`ArchiveButton`, `UnarchiveButton`), `DealArchivedList.tsx`, `dataProvider.unarchiveDeal` in `crm/providers/supabase/dataProvider.ts` and `crm/providers/fakerest/dataProvider.ts`.
- **Demo mode:** works.

### F-DEAL-06 Deal CSV export
- **What:** Export button on the deals board (default CSV exporter).
- **Where:** `crm/deals/DealList.tsx` (`DealActions`).
- **Demo mode:** works.

---

## Tasks (TASK)

### F-TASK-01 My tasks by due date
- **What:** The current user's tasks grouped into Overdue, Today, Tomorrow, This week, Later; completed tasks hidden (kept 5 minutes after completion to avoid flicker). Shown as "Upcoming tasks" on the desktop dashboard and as the mobile Tasks page. There is no standalone desktop tasks page.
- **Where:** `crm/tasks/TasksListByDueDate.tsx`, `TasksListContent.tsx`, `TasksIterator.tsx`, `tasksPredicate.ts`, `crm/dashboard/TasksList.tsx`, `crm/tasks/MobileTasksList.tsx`.
- **Demo mode:** works.
- **Related:** F-DASH-05, F-MOB-04.

### F-TASK-02 Create task
- **What:** Add a task (description, due date, type) from a contact, or from the dashboard / mobile "+" with a contact picker. Owner is always the creator; creating a task bumps the contact's `last_seen`.
- **Where:** `crm/tasks/AddTask.tsx`, `TaskFormContent.tsx`, `TaskCreateSheet.tsx` (mobile).
- **Config:** `taskTypes`.
- **Demo mode:** works.

### F-TASK-03 Complete / reopen task
- **What:** Checkbox toggles `done_date`; done tasks are struck through. Completed tasks are excluded from `nb_tasks` counts and global search.
- **Where:** `crm/tasks/Task.tsx`; view `contacts_summary` (`nb_tasks` filter); migration `20260307120000_nb_tasks_pending_only.sql`.
- **Demo mode:** works.
- **Related:** F-MCP-02.

### F-TASK-04 Postpone, edit, delete task
- **What:** Per-task menu: postpone to tomorrow, postpone to next week, edit (dialog desktop / sheet mobile), delete.
- **Where:** `crm/tasks/Task.tsx`, `TaskEdit.tsx`, `TaskEditSheet.tsx`.
- **Demo mode:** works.

### F-TASK-05 Contact tasks
- **What:** All tasks of one contact (any owner) in the contact aside (desktop) or the "Tasks (n)" tab (mobile).
- **Where:** `crm/contacts/ContactAside.tsx`, `crm/contacts/ContactTasksList.tsx`.
- **Demo mode:** works.

---

## Notes (NOTE)

### F-NOTE-01 Contact notes
- **What:** Composer that grows on focus; text (Markdown rendered), optional status, date/time, file attachments ("show options"). Text or attachment required. Notes listed newest first with infinite scroll.
- **Where:** `crm/notes/NoteCreate.tsx`, `NoteInputs.tsx`, `NotesIterator.tsx`, `Note.tsx`, `crm/misc/Markdown.tsx`, `crm/notes/noteModel.ts`, `foreignKeyMapping.ts`.
- **Config:** `noteStatuses`.
- **Demo mode:** works.
- **Related:** F-CONT-05, F-CONT-11, F-NOTE-03, F-MAIL-01.

### F-NOTE-02 Deal notes
- **What:** Same composer and timeline on the deal detail, without status. Desktop only.
- **Where:** `crm/deals/DealShow.tsx`, `crm/notes/NoteCreate.tsx` (`reference="deals"`), table `deal_notes`.
- **Demo mode:** works.

### F-NOTE-03 Edit / delete note
- **What:** Inline edit and delete (with notification) on each note; mobile uses a full note page and edit sheet.
- **Where:** `crm/notes/Note.tsx`, `NoteEditSheet.tsx`, `NoteShowPage.tsx`, `NotesIteratorMobile.tsx`.
- **Demo mode:** works.

### F-NOTE-04 Note attachments
- **What:** Files uploaded to the `attachments` storage bucket with MIME type kept; removed from storage when detached or when the note is deleted.
- **Where:** `crm/notes/AttachmentField.tsx`, `NoteAttachments.tsx`, `crm/providers/supabase/dataProvider.ts` (`uploadToBucket`), `crm/providers/commons/attachments.ts`; `schemas/07_storage.sql`; triggers `on_*_notes_attachments_updated_delete_note_attachments`, `on_*_notes_deleted_delete_note_attachments` → `cleanup_note_attachments` → edge function `fn/delete_note_attachments/index.ts`.
- **Demo mode:** partial (files kept as blob/data URLs in memory; no storage cleanup).

---

## Tags (TAG)

### F-TAG-01 Tag a contact
- **What:** From the contact aside / mobile details tab, add an existing tag, remove one, or create a new tag (name + color from a 10-color palette) and apply it.
- **Where:** `crm/contacts/TagsListEdit.tsx`, `TagsList.tsx`, `crm/tags/TagCreateModal.tsx`, `TagForm.tsx`, `TagDialog.tsx`, `TagChip.tsx`, `colors.ts`, `useCreateTag.ts`.
- **Demo mode:** works.
- **Related:** F-CONT-06 (bulk), F-CONT-02 (filter).

### F-TAG-02 Manage tags
- **What:** Settings "Tags" section lists all tags with edit (name, color) and delete (with undo); applied immediately, independent of the Settings Save button. Deleting a tag removes it from all contacts.
- **Where:** `crm/settings/SettingsTags.tsx`, `crm/tags/TagEditModal.tsx`, `useTags.ts`; trigger `on_tag_deleted` (`handle_tag_deleted`); FakeRest `afterDelete` on `tags`.
- **Demo mode:** works.
- **Related:** F-SET-01.

---

## Activity (ACT)

### F-ACT-01 Activity log
- **What:** Infinite-scroll feed of creation events (company added, contact added, contact note, deal added, deal note) with author and relative date; filtered to one company on the company page.
- **Where:** `crm/activity/ActivityLog.tsx`, `ActivityLogIterator.tsx`, `ActivityLog*.tsx`, `ActivityLogContext.tsx`; view `activity_log` (`schemas/03_views.sql`); FakeRest emulation `crm/providers/commons/activity.ts`.
- **Demo mode:** works.
- **Related:** F-DASH-04, F-COMP-04.

---

## Dashboard (DASH)

### F-DASH-01 Onboarding stepper
- **What:** Until the CRM has a contact and a contact note, the dashboard shows a 3-step guide: install, add first contact (or import CSV), add first note.
- **Where:** `crm/dashboard/Dashboard.tsx`, `DashboardStepper.tsx`, `MobileDashboard.tsx`.
- **Demo mode:** works.
- **Related:** F-IMP-01.

### F-DASH-02 Hot contacts
- **What:** Up to 10 of my contacts with status `hot`, most recently seen first, with a quick "create contact" button.
- **Where:** `crm/dashboard/HotContacts.tsx` (status value `hot` hardcoded).
- **Demo mode:** works.

### F-DASH-03 Upcoming deal revenue chart
- **What:** Bar chart of deal amounts per month (last 6 months by creation date): won, pending (not won/lost) and lost. Shown only if any deal exists.
- **Where:** `crm/dashboard/DealsChart.tsx` (stage values `won`/`lost` hardcoded; labels from config).
- **Config:** `currency`, `dealStages` labels.
- **Demo mode:** works.

### F-DASH-04 Latest activity
- **What:** Team-wide activity log (10 per page) on desktop and mobile dashboards.
- **Where:** `crm/dashboard/DashboardActivityLog.tsx`.
- **Demo mode:** works.
- **Related:** F-ACT-01.

### F-DASH-05 Upcoming tasks panel
- **What:** Desktop dashboard right column: my tasks by due date plus an add-task icon with contact picker.
- **Where:** `crm/dashboard/TasksList.tsx`.
- **Demo mode:** works.
- **Related:** F-TASK-01, F-TASK-02.

### F-DASH-06 Demo welcome card
- **What:** Explanatory card shown on dashboards when built in demo mode.
- **Where:** `crm/dashboard/Welcome.tsx`; env `VITE_IS_DEMO=true`.
- **Demo mode:** demo only.

---

## Search (SRCH)

### F-SRCH-01 Global search
- **What:** Header search box (desktop, Ctrl/Cmd+K, ignored while typing in a field) or magnifier (every mobile header). Searches companies, contacts, deals, tasks, contact notes and deal notes (incl. attachment names) from 2 characters, 300 ms debounce; every word must prefix-match a word of the same record, accent/case-insensitive. Up to 10 results per type, newest first, grouped, 3 shown per group until expanded; matches highlighted with excerpt. Archived deals (and their notes) and done tasks excluded; mobile excludes deals and deal notes. Results link to the record (tasks/notes open their contact).
- **Where:** `crm/search/GlobalSearchButton.tsx`, `crm/search/searchModel.ts`; RPC `global_search` + `fts` columns/indexes in `schemas/08_search.sql`; migrations `20261010054346_global_search.sql`, `20261022120000_global_search_per_resource_cap.sql`; FakeRest `crm/providers/fakerest/search.ts`.
- **Demo mode:** works (client-side emulation).
- **Related:** F-MOB-06 (not persisted offline).

### F-SRCH-02 Per-list search
- **What:** Search boxes on the contact list (desktop), company list, deals board and users list, each filtering only its own list (ILIKE over fixed columns).
- **Where:** `crm/providers/supabase/dataProvider.ts` (`lifeCycleCallbacks` `beforeGetList`, `applyFullTextSearch`).
- **Demo mode:** works.

---

## Import / Export (IMP)

### F-IMP-01 CSV import (contacts, companies, deals)
- **What:** "Import CSV" on the contacts, companies and deals pages (and "Import data" with resource picker on the onboarding stepper) opens a dialog with a downloadable sample. Runs in the background in batches with a progress toast and a Stop button. Unknown columns ignored. Contacts: companies and tags matched by name or created. Companies: `name` required, sector matched by value or label. Deals: `name` required, company matched or created, categories (comma/semicolon) and stage matched by value or label. Leading zeros kept in phone/zip/tax columns.
- **Where:** `crm/dataImport/` (`DataImportButton.tsx`, `DataImportDialog.tsx`, `DataImportProvider.tsx`, `DataImportProgressToast.tsx`, `useImportableResources.ts`, `useCompanyImport.ts`, `useDealImport.ts`, `useCompanyResolver.ts`, `parseCell.ts`, `createEachRow.ts`, `companies_sample.csv`, `deals_sample.csv`), `crm/contacts/useContactImport.tsx`, `crm/contacts/contacts_export.csv`, `crm/misc/usePapaParse.tsx`.
- **Config:** `companySectors`, `dealCategories`, `dealStages`.
- **Demo mode:** works.
- **Related:** F-CONT-07, F-DASH-01, F-MOB-01 (mobile offers only registered resources).

### F-IMP-02 JSON migration import
- **What:** User menu → "Import data" page (`/import`): upload one JSON file with `sales`, `companies`, `contacts`, `notes` (contact notes, with attachment URLs) and `tasks`; tags created from names, sales created as users. Shows per-type progress and errors; sample file downloadable. Desktop only.
- **Where:** `crm/misc/ImportPage.tsx`, `crm/misc/useImportFromJson.ts`, `crm/misc/import-sample.json`; uses `dataProvider.salesCreate`.
- **Demo mode:** works.
- **Related:** F-USER-02.

---

## Sales team / Users (USER)

### F-USER-01 Users list (admin)
- **What:** Admin-only page `/sales` (user menu → Users): table of first/last name, email, with admin and disabled badges, and search.
- **Where:** `crm/sales/SalesList.tsx`, `crm/layout/Header.tsx` (`UsersMenu`).
- **Demo mode:** works.
- **Related:** F-USER-04.

### F-USER-02 Create (invite) user
- **What:** Admin creates a user (first/last name, email, admin flag, disabled flag); Supabase sends an invitation email whose link leads to the set-password page. Duplicate emails (incl. secondary) rejected.
- **Where:** `crm/sales/SalesCreate.tsx`, `SalesInputs.tsx`, `salesErrorNotification.ts`; `fn/users/index.ts` (POST, `inviteUser`); `dataProvider.salesCreate`.
- **Demo mode:** partial (record created in memory, no email).
- **Related:** F-AUTH-03.

### F-USER-03 Edit user, promote, disable
- **What:** Admin edits name/email, toggles administrator and disabled. Disabling bans the auth user (~10 years) and hides them from account-manager pickers; an admin cannot change their own admin/disabled flags. Non-admins may only update their own profile.
- **Where:** `crm/sales/SalesEdit.tsx`, `SalesInputs.tsx` (`readOnly` for self); `fn/users/index.ts` (PATCH, `patchUser`, `ban_duration`).
- **Demo mode:** partial (no auth ban; disabled users fall back to default demo user on login).

### F-USER-04 Roles and access control
- **What:** Two roles: admin (`sales.administrator`) and user. Non-admins cannot access `sales` (users) or `configuration` (settings); all authenticated users can read/write all CRM records.
- **Where:** `crm/providers/commons/canAccess.ts`, `crm/providers/supabase/authProvider.ts` (`canAccess`), `crm/providers/fakerest/authProvider.ts`; `is_admin()` and policies in `schemas/05_policies.sql`.
- **Demo mode:** works (demo user Jane Doe is admin).

### F-USER-05 Record ownership defaults
- **What:** New companies, contacts, notes, deals and tasks get `sales_id` = current user unless set; account manager pickers list only active (non-disabled) sales.
- **Where:** `set_sales_id_default()` + `set_*_sales_id_trigger` (`schemas/02_functions.sql`, `04_triggers.sql`); `crm/sales/AccountManagerInput.tsx`, `crm/contacts/ContactInputs.tsx`.
- **Demo mode:** partial (UI passes `sales_id`; no trigger).

### F-USER-06 Auth ↔ sales sync, first user is admin
- **What:** Creating an auth user inserts a `sales` row (first one ever becomes admin); auth updates sync name and email.
- **Where:** triggers `on_auth_user_created`/`on_auth_user_updated` → `handle_new_user`/`handle_update_user`.
- **Demo mode:** n/a (FakeRest creates sales rows directly).
- **Related:** F-AUTH-02.

---

## Settings (SET)

### F-SET-01 Settings page (admin)
- **What:** Admin-only `/settings` with section nav: Branding, Companies, Deals, Notes, Tasks, Tags. One Save button (pessimistic) for all but tags; "Reset to defaults" refills the form from built-in defaults. Desktop only.
- **Where:** `crm/settings/SettingsPage.tsx`, `crm/layout/Header.tsx` (`SettingsMenu`, gated by `CanAccess resource="configuration"`).
- **Demo mode:** works (lost on reload: `memoryStore` + in-memory DB).
- **Related:** F-TAG-02, F-SET-04.

### F-SET-02 Domain value lists
- **What:** Edit company sectors, deal stages (reorderable), pipeline statuses (stages counted as "won/closed", toggle chips), deal categories, note statuses (label + color), task types. Values are slugged from labels on first save and stay stable when relabelled; removing a stage or category still used by a deal, or duplicating one, is rejected.
- **Where:** `crm/settings/SettingsPage.tsx` (`validateItemsInUse`, `ensureValues`, `transformFormValues`), `src/lib/toSlug.ts`.
- **Config:** initial values from `<CRM companySectors dealStages dealPipelineStatuses dealCategories noteStatuses taskTypes>`; defaults in `crm/root/defaultConfiguration.ts`.
- **Demo mode:** works.

### F-SET-03 Branding and currency
- **What:** App title, light-mode and dark-mode logos (uploaded via image editor), and ISO 4217 currency used for all deal amounts.
- **Where:** `crm/settings/SettingsPage.tsx`; logo upload in `crm/providers/supabase/dataProvider.ts` (`processConfigLogo`); used in `crm/layout/Header.tsx`, `crm/deals/DealColumn.tsx`, `DealCard.tsx`, `crm/dashboard/DealsChart.tsx`.
- **Config:** `<CRM title lightModeLogo darkModeLogo currency>` (logos must be imported assets, absolute URLs or data URIs).
- **Demo mode:** works.

### F-SET-04 Configuration storage and loading
- **What:** Settings live in the `configuration` singleton row (readable by all, writable by admins), cached in the ra-core store (`app.configuration`), prefetched at login and refreshed every 5 min; `<CRM>` props only seed the store when empty; missing keys fall back to defaults.
- **Where:** `crm/root/CRM.tsx`, `ConfigurationContext.tsx`, `useConfigurationLoader.ts`, `defaultConfiguration.ts`; `dataProvider.getConfiguration/updateConfiguration`; migration `20260211194545_app_configuration.sql`.
- **Demo mode:** works (in memory).

### F-SET-05 Changelog page
- **What:** `/changelog` renders the repo `CHANGELOG.md`; linked from the user menu (desktop) and Settings → About (mobile).
- **Where:** `crm/misc/ChangelogPage.tsx`, `CHANGELOG.md`.
- **Demo mode:** works.

### F-SET-06 Usage telemetry
- **What:** In production builds, one anonymous image ping with the hostname is sent on load.
- **Where:** `crm/root/CRM.tsx` (`useEffect` telemetry).
- **Config:** `<CRM disableTelemetry>`.
- **Demo mode:** works the same (production builds only).

---

## Auth (AUTH)

### F-AUTH-01 Email / password login and logout
- **What:** Login page with email + password, "forgot password" link; logout clears cached configuration. All app routes require auth.
- **Where:** `crm/login/StartPage.tsx`, `LoginPage.tsx`, `LoginSkeleton.tsx`; `crm/providers/supabase/authProvider.ts`; `crm/root/CRM.tsx` (`wrappedAuthProvider`, `requireAuth`).
- **Demo mode:** partial (any password accepted; logs in as the matching sale or default admin Jane Doe).

### F-AUTH-02 First-user sign-up
- **What:** When no sale exists, the start page redirects to `/sign-up` to create the first (admin) account; with email confirmation enabled, `/sign-up/confirm` asks to check email. Sign-up redirects to login once initialized.
- **Where:** `crm/login/SignupPage.tsx`, `ConfirmationRequired.tsx`, `StartPage.tsx`; `dataProvider.signUp`, `isInitialized`; view `init_state`.
- **Demo mode:** n/a in practice (demo data already has sales).
- **Related:** F-USER-06.

### F-AUTH-03 Forgot / set password
- **What:** `/forgot-password` sends a reset email; `/set-password` sets a password from an invite or reset link.
- **Where:** `src/components/supabase/forgot-password-page.tsx`, `set-password-page.tsx`, `public/auth-callback.html`.
- **Demo mode:** no-op (simulated delay).

### F-AUTH-04 Google Workspace SSO and password-less mode
- **What:** Optional SSO button (Supabase `signInWithSSO` by domain); email/password form can be hidden entirely.
- **Where:** `crm/login/SSOAuthButton.tsx`, `authConfig.ts`, `LoginPage.tsx`; migration `20260128165057_sso_handling.sql`.
- **Config:** env `VITE_GOOGLE_WORKPLACE_DOMAIN`, `VITE_DISABLE_EMAIL_PASSWORD_AUTHENTICATION=true`.
- **Demo mode:** Supabase only.

### F-AUTH-05 OAuth consent page
- **What:** `/oauth/consent` lets a logged-in user approve or deny a third-party OAuth client (used by MCP clients via Supabase OAuth server).
- **Where:** `src/components/supabase/oauth-consent-page.tsx`; `getAuthorizationDetails`/`approveAuthorization`/`denyAuthorization` in auth providers.
- **Demo mode:** dummy data only.
- **Related:** F-MCP-01.

---

## Inbound email (MAIL)

### F-MAIL-01 Email-to-note capture
- **What:** Emails sent by a known, active sale with the inbound address in To/Cc/Bcc become contact notes (subject + body, attachments uploaded) on each To recipient. Unknown recipients are created as contacts (name from address, capitalized) and, unless the domain is a public mail provider, linked to a company found by website/name or created from the domain. Owner = sending sale.
- **Where:** `fn/postmark/index.ts`, `addNoteToContact.ts`, `extractMailContactData.ts`, `getNoteContent.ts`, `extractAndUploadAttachments.ts`, `mailProvider.const.ts`; inbound address shown in profile (`crm/settings/ProfilePage.tsx`, `SettingsPageMobile.tsx`).
- **Config:** env `VITE_INBOUND_EMAIL` (UI), function secrets incl. `INBOUND_EMAIL`, webhook basic-auth and Postmark IP allowlist (`getExpectedAuthorization.ts`).
- **Demo mode:** Supabase only.
- **Related:** F-NOTE-01, F-MAIL-02, F-MAIL-03.

### F-MAIL-02 Forwarded email parsing
- **What:** When a sale forwards an email only to the inbound address, the original correspondent's address is extracted from the body, forwarding headers and `Fwd:` prefixes are stripped, and the note is attached to that contact.
- **Where:** `fn/postmark/index.ts`, `forwardedParser.ts`.
- **Demo mode:** Supabase only.

### F-MAIL-03 Secondary sender emails
- **What:** Each user can register extra addresses they send from (profile); inbound mail from them is attributed to that user. Ambiguous or duplicate addresses rejected.
- **Where:** `crm/settings/ProfilePage.tsx` (`SecondaryEmailsRender`), `SettingsPageMobile.tsx`; `fn/users/index.ts`, `fn/users/secondaryEmails.ts`; `fn/postmark/addNoteToContact.ts`; column `sales.secondary_emails` (migration `20260811131131_sales_secondary_emails.sql`).
- **Demo mode:** partial (stored; no inbound processing).

---

## MCP server (MCP)

### F-MCP-01 MCP server for AI assistants
- **What:** Remote MCP endpoint (`<SUPABASE_URL>/functions/v1/mcp`, Supabase OAuth) exposing `get_schema`, `query` (SELECT/WITH only) and `mutate` (INSERT/UPDATE/DELETE) tools; SQL is AST-validated (no `set_config`) and runs as the caller so RLS applies. URL shown with copy button in the profile.
- **Where:** `fn/mcp/index.ts`, `fn/mcp/validateSql.ts`; `crm/settings/ProfilePage.tsx`, `SettingsPageMobile.tsx` (`McpServerSection`).
- **Demo mode:** Supabase only (URL still displayed).
- **Related:** F-AUTH-05.

### F-MCP-02 Task list MCP app
- **What:** `display_task_list` renders tasks as an interactive widget (MCP App resource) where the user can tick tasks done; `complete_task` marks one done.
- **Where:** `fn/mcp/index.ts`, `fn/mcp/taskListUi.ts`.
- **Demo mode:** Supabase only.
- **Related:** F-TASK-03.

---

## Mobile (MOB)

### F-MOB-01 Mobile app shell
- **What:** Below the mobile breakpoint a separate admin renders: bottom nav (Dashboard, Contacts, "+", Tasks, Settings), sticky header with global search. Registered resources: contacts (list, show, note page), companies (show), tasks (list). No deals, company list, users, desktop settings or JSON import.
- **Where:** `crm/root/CRM.tsx` (`MobileAdmin`), `crm/layout/MobileLayout.tsx`, `MobileNavigation.tsx`, `MobileHeader.tsx`, `MobileContent.tsx`, `crm/misc/MobileBackButton.tsx`, `src/hooks/use-mobile.ts`.
- **Demo mode:** works.

### F-MOB-02 Mobile contacts
- **What:** Infinite-scroll contact list with filter sheet (no name search; global search instead); contact page with Notes / Tasks / Details tabs (`?tab=` deep link), edit sheet.
- **Where:** `crm/contacts/ContactList.tsx` (`ContactListMobile`), `ContactListContent.tsx`, `ContactShow.tsx` (`ContactShowContentMobile`), `ContactEditSheet.tsx`, `crm/misc/InfinitePagination.tsx`.
- **Demo mode:** works.

### F-MOB-03 Quick create sheets
- **What:** Center "+" opens a menu to create a contact, a note (pick contact; attach files incl. camera on phones) or a task, each in a bottom sheet.
- **Where:** `crm/layout/MobileNavigation.tsx`, `crm/contacts/ContactCreateSheet.tsx`, `crm/notes/NoteCreateSheet.tsx`, `NoteInputsMobile.tsx`, `crm/tasks/TaskCreateSheet.tsx`, `crm/misc/CreateSheet.tsx`, `EditSheet.tsx`.
- **Demo mode:** works.

### F-MOB-04 Mobile tasks and dashboard
- **What:** Tasks tab shows my tasks by due date; mobile dashboard shows onboarding stepper or the latest activity (no charts, hot contacts or tasks panel).
- **Where:** `crm/tasks/MobileTasksList.tsx`, `crm/dashboard/MobileDashboard.tsx`.
- **Demo mode:** works.

### F-MOB-05 Mobile note page
- **What:** Full-page note view at `/contacts/:id/notes/:noteId` with edit/delete.
- **Where:** `crm/notes/NoteShowPage.tsx`, `NotesIteratorMobile.tsx`.
- **Demo mode:** works.

### F-MOB-06 Offline mode
- **What:** Query cache persisted to localStorage (24h, offline-first) so previously loaded data is readable offline; mutations queue offline-first. Global search results are not persisted.
- **Where:** `crm/root/CRM.tsx` (`PersistQueryClientProvider`, `shouldDehydrateQuery`).
- **Demo mode:** works (but demo data itself resets on reload).

### F-MOB-07 Refresh and pull-to-refresh
- **What:** Refresh button on list headers and pull-down gesture refetch the current page's data.
- **Where:** `crm/layout/MobileRefreshButton.tsx`, `PullToRefresh.tsx`, `useRefreshData.ts`.
- **Demo mode:** works.

### F-MOB-08 Installable PWA
- **What:** Web manifest and service worker (auto-update, reload on stale chunk) allow "Add to Home Screen".
- **Where:** `public/manifest.json`, `public/appIcon/`, `vite.config.ts` (`VitePWA`), `src/main.tsx` (`vite:preloadError`).
- **Demo mode:** works.

### F-MOB-09 Mobile settings page
- **What:** Settings tab with Profile (avatar, names, email, secondary emails; saved per field), Preferences (language, theme), Inbound email, MCP server URL, About (changelog), Change password, Log out. No team configuration.
- **Where:** `crm/settings/SettingsPageMobile.tsx`.
- **Demo mode:** works.
- **Related:** F-PREF-01..04.

---

## Preferences / i18n / theme (PREF)

### F-PREF-01 Profile page
- **What:** `/profile` (user menu → Profile): avatar via image editor (saved immediately), first/last name and email (Edit/Save; email is the login), secondary emails, plus Inbound email (if configured) and MCP URL cards.
- **Where:** `crm/settings/ProfilePage.tsx`, `crm/misc/ImageEditorField.tsx`; `dataProvider.salesUpdate` → `fn/users/index.ts` (PATCH).
- **Demo mode:** works.
- **Related:** F-MAIL-03, F-MCP-01.

### F-PREF-02 Language (i18n)
- **What:** English and French UI; initial locale from browser (fr* → French, else English); selector on profile/mobile settings, hidden if only one locale.
- **Where:** `crm/providers/commons/i18nProvider.ts`, `englishCrmMessages.ts`, `frenchCrmMessages.ts`; `LanguageSelector` in `crm/settings/ProfilePage.tsx`.
- **Config:** `<CRM i18nProvider>`.
- **Demo mode:** works (choice not kept across reloads: `memoryStore`).

### F-PREF-03 Theme
- **What:** Light / dark / system theme via header toggle (desktop) or Preferences (mobile); logos switch per theme.
- **Where:** `src/components/admin/theme-mode-toggle.tsx`, `theme-provider.tsx` (store key `theme`), `crm/settings/SettingsPageMobile.tsx` (`ThemeRow`), `crm/layout/Header.tsx`.
- **Demo mode:** works (not kept across reloads).

### F-PREF-04 Change password
- **What:** "Change password" sends a password-reset email to the user.
- **Where:** `crm/settings/ProfilePage.tsx`, `SettingsPageMobile.tsx`; `dataProvider.updatePassword` → `fn/update_password/index.ts`.
- **Demo mode:** no email (fake password set in memory).
- **Related:** F-AUTH-03.

---

## Known gaps / not supported

- **User deletion.** Users are disabled, never deleted. Evidence: `AGENTS.md`; `fn/users/index.ts` handles only POST/PATCH; no delete in `crm/sales/`; `sales` has no delete policy (`schemas/05_policies.sql`). User doc `doc/src/content/docs/users/user-management.mdx` wrongly says admins can delete users.
- **Per-user data visibility.** Every authenticated user can read/write/delete all companies, contacts, deals, notes, tasks and tags (`using (true)` policies in `schemas/05_policies.sql`). Only users and settings are admin-gated.
- **Desktop task list page.** `tasks` resource has no list view on desktop (`crm/root/CRM.tsx`); header nav is Dashboard/Contacts/Companies/Deals only (`crm/layout/Header.tsx`).
- **Task reassignment.** Task form has no owner field; owner is always the creator (`crm/tasks/TaskFormContent.tsx`, `AddTask.tsx`). Tasks must belong to a contact (`tasks.contact_id not null`), not to deals or companies.
- **Deals on mobile.** No deal screens, deal notes or deal search results on mobile (`MobileAdmin` in `crm/root/CRM.tsx`; `MOBILE_SEARCH_RESOURCES` in `crm/search/searchModel.ts`).
- **Tags on other records.** Tags exist only on contacts (`contacts.tags`; no tag column on companies/deals in `schemas/01_tables.sql`).
- **Lost reason / stage history.** A deal lost-reason column was added then dropped (`supabase/migrations/20260924120000_deals_lost_reason.sql`, `20260928120000_drop_deals_lost_reason.sql`); no stage-change history is kept.
- **Custom fields via UI.** Adding fields requires schema, view, import/export and merge code changes (`AGENTS.md` "Adding Custom Fields").
- **Configurable contact pronouns.** Gender options are hardcoded (`crm/contacts/contactModel.ts`), not a `<CRM>` prop.
- **Outbound email / mailbox sync / calendar.** Only inbound capture via Postmark (`fn/postmark/`); nothing sends emails except auth emails.
- **Languages beyond en/fr.** Only two catalogs (`crm/providers/commons/i18nProvider.ts`).
- **Company merge, undo of contact merge.** Only contact merge exists and it deletes the loser (`fn/merge_contacts/index.ts`).
- **JSON import of deals / deal notes; CSV import of notes/tasks.** `TYPES` in `crm/misc/useImportFromJson.ts` = sales, companies, contacts, notes (contact), tasks; CSV import covers contacts, companies, deals only (`crm/dataImport/useImportableResources.ts`).
- **Team settings on mobile.** `SettingsPageMobile.tsx` has no domain-list/branding editing.
- **Real-time updates.** No subscriptions; data refreshes on navigation or manual refresh (`crm/layout/useRefreshData.ts`, header `RefreshButton`).
- **Configurable "hot" / "won" semantics on dashboard.** `HotContacts.tsx` filters `status: "hot"` and `DealsChart.tsx` uses stage values `won`/`lost` literally; renaming those values in Settings breaks these widgets (`dealPipelineStatuses` is not used by the chart).
- **Theme objects as props.** `lightTheme`/`darkTheme` are listed in `AGENTS.md` and the `CRM.tsx` JSDoc but nothing consumes them (`src/components/admin/theme-provider.tsx` only handles light/dark/system mode).
- **Unused component.** `crm/dashboard/DealsPipeline.tsx` is not rendered anywhere.
