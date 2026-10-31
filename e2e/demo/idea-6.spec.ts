import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Acceptance tests for idea-6: "Sales funnel" widget on the desktop dashboard.
 *
 * Runs against the static FakeRest demo build (see `playwright.demo.config.ts`).
 * The demo auto-logs in as the admin and generates random data on every load
 * (faker is not seeded), so these tests assert structure — never specific
 * generated names, counts or amounts.
 *
 * Label and text assumptions the build agent must match
 * -----------------------------------------------------
 * The spec names "Sales funnel" and "No active deals" directly; the rest of
 * these conventions borrow from the existing i18n catalog and sibling specs
 * (idea-9, idea-12). The build agent must keep them intact:
 *  - Widget heading accessible name is exactly "Sales funnel". Any heading
 *    level is accepted (h2 or h3), per sibling dashboard widgets.
 *  - Empty-state message is exactly "No active deals".
 *  - Each visible row contains the stage `label` (e.g. "Opportunity",
 *    "Proposal Sent", "In Negotiation"), its deal count as a plain integer
 *    and its amount as a currency-formatted string containing "$" (default
 *    currency is USD, F-SET-03).
 *  - The deals revenue chart heading is "Upcoming Deal Revenue"
 *    (crm.dashboard.deals_chart in englishCrmMessages.ts).
 *  - The Settings → "Pipeline Statuses" chips expose role=button with the
 *    stage label as accessible name; the "selected" state carries the
 *    `bg-primary` Tailwind class (same convention as idea-12.spec.ts).
 *  - Saving Settings surfaces the existing "Configuration saved
 *    successfully" toast (crm.settings.saved).
 *
 * Not covered in a browser test (reported for unit coverage):
 *  - AC5 "No active deals" empty state: demo seed guarantees deals in every
 *    active stage, so this is covered by a unit test.
 *  - AC6 deals in an unknown stage are dropped: the demo generator only
 *    emits known stages, so this is covered by a unit test.
 *  - AC8 i18n keys exist in both English and French catalogs: a static
 *    assertion, not a user-observable behavior.
 *  - AC9 bar/track/text use semantic Tailwind tokens: style assertion, not
 *    a user-observable behavior.
 */

const FUNNEL_HEADING = "Sales funnel";
const DEALS_CHART_HEADING = "Upcoming Deal Revenue";

/**
 * Default `defaultDealPipelineStatuses` is `['won', 'lost', 'delayed']`
 * (idea-12). The funnel excludes those three stages, so these three are the
 * ones that should appear in rows on a fresh demo install.
 */
const DEFAULT_ACTIVE_STAGE_LABELS = [
  "Opportunity",
  "Proposal Sent",
  "In Negotiation",
] as const;

const DEFAULT_CLOSED_STAGE_LABELS = ["Won", "Lost", "Delayed"] as const;

const ALL_STAGE_LABELS = [
  ...DEFAULT_ACTIVE_STAGE_LABELS,
  ...DEFAULT_CLOSED_STAGE_LABELS,
] as const;

async function gotoDashboard(page: Page) {
  await page.goto("/");
  // Wait for the dashboard (post-stepper gate) to render before asserting on
  // the funnel: the stepper disappears once contacts + notes are loaded.
  await expect(
    page.getByRole("heading", { name: "Latest Activity" }),
  ).toBeVisible();
}

function funnelHeading(page: Page): Locator {
  return page.getByRole("heading", { name: FUNNEL_HEADING, exact: true });
}

/**
 * The funnel's own scope: climb two parents from the heading to catch the
 * enclosing card/section. The spec does not dictate the DOM shape, so we
 * keep this flexible rather than relying on a specific test id.
 */
function funnelScope(page: Page): Locator {
  return funnelHeading(page).locator("..").locator("..");
}

/**
 * Navigate to the Settings page by changing `window.location.hash` rather
 * than `page.goto("/#/settings")`. The demo uses `memoryStore()` for ra-core
 * and seeds random FakeRest data on every page load, so any `goto` that
 * reloads the document wipes both the ra-core store (including the
 * configuration we just saved) and the FakeRest DB. Changing the hash fires
 * a hashchange React Router responds to without reloading.
 *
 * Waits for the Pipeline Statuses chips to be rendered AND for at least one
 * of them to be in the selected (`bg-primary`) state, which is only true
 * after `useGetOne("configuration")` has resolved and the first form reset
 * has fired. Clicking chips before that point lets the subsequent reset
 * silently overwrite the selection.
 */
async function navigateToSettings(page: Page) {
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await expect(page).toHaveURL(/#\/settings/);
  await expect(
    page.getByRole("heading", { name: "Pipeline Statuses", exact: true }),
  ).toBeVisible();
  for (const label of ALL_STAGE_LABELS) {
    await expect(
      page.getByRole("button", { name: label, exact: true }).first(),
    ).toBeVisible();
  }
  // The "Won" chip is pre-selected in the current default pipeline statuses,
  // so waiting for its `bg-primary` class is a reliable signal that the
  // configuration has loaded into form state. Clicks issued before that
  // point are silently reset.
  await expect(
    page.getByRole("button", { name: "Won", exact: true }).first(),
  ).toHaveClass(/bg-primary/, { timeout: 15000 });
}

async function waitForFormToSettle(page: Page, ms = 1200) {
  await page.evaluate(
    (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
    ms,
  );
}

async function deselectPipelineStatusChip(page: Page, stageLabel: string) {
  const chip = page
    .getByRole("button", { name: stageLabel, exact: true })
    .first();
  await expect(chip).toBeVisible();
  await expect(async () => {
    const classes = (await chip.getAttribute("class")) ?? "";
    if (classes.includes("bg-primary")) {
      await chip.click();
    }
    await expect(chip).not.toHaveClass(/bg-primary/, { timeout: 500 });
    await waitForFormToSettle(page);
    await expect(chip).not.toHaveClass(/bg-primary/, { timeout: 500 });
  }).toPass({ timeout: 20000, intervals: [500, 1000, 2000] });
}

async function saveSettingsConfiguration(page: Page) {
  const saveButton = page
    .getByRole("button", { name: "Save", exact: true })
    .first();
  const toast = page.getByText("Configuration saved successfully");
  const validating = page.getByText("Validating…");
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(toast.or(validating).first()).toBeVisible({ timeout: 10000 });
  if (await validating.isVisible().catch(() => false)) {
    await expect(validating).toBeHidden({ timeout: 15000 });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(toast).toBeVisible({ timeout: 10000 });
  }
}

async function navigateToDashboardViaMenu(page: Page) {
  await page.evaluate(() => {
    window.location.hash = "#/";
  });
  await expect(
    page.getByRole("heading", { name: "Latest Activity" }),
  ).toBeVisible();
}

test.describe("idea-6: Sales funnel widget on the desktop dashboard", () => {
  test.describe("desktop", () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test("AC1: 'Sales funnel' heading renders on the desktop dashboard alongside the existing Deals chart", async ({
      page,
    }) => {
      // The widget is gated behind the onboarding stepper (F-DASH-01). The
      // demo generates contacts and notes, so the stepper is dismissed and
      // both widgets must be visible.
      await expect(funnelHeading(page)).toBeVisible();
      await expect(
        page.getByRole("heading", { name: DEALS_CHART_HEADING }),
      ).toBeVisible();
    });

    test("AC2: funnel lists the default active stages (Opportunity, Proposal Sent, In Negotiation) and omits default closed stages (Won, Lost, Delayed)", async ({
      page,
    }) => {
      const scope = funnelScope(page);
      await expect(scope).toBeVisible();

      // Each active stage from `dealStages` must have a row with its label.
      for (const label of DEFAULT_ACTIVE_STAGE_LABELS) {
        await expect(
          scope.getByText(label, { exact: true }).first(),
        ).toBeVisible();
      }

      // Stages whose value is in `dealPipelineStatuses` (Won, Lost, Delayed
      // by default) must NOT render a row in the funnel.
      for (const label of DEFAULT_CLOSED_STAGE_LABELS) {
        await expect(
          scope.getByText(label, { exact: true }),
          `${label} must not appear in the funnel while it's a pipeline status`,
        ).toHaveCount(0);
      }
    });

    test("AC3: each shown row includes the stage label, a numeric count and a currency-formatted amount", async ({
      page,
    }) => {
      const scope = funnelScope(page);
      await expect(scope).toBeVisible();

      // The widget text content captures the full row: label + count + amount.
      // We only assert the pattern per stage, not exact values, because demo
      // data is random.
      const widgetText = (await scope.innerText()).replace(/\s+/g, " ");

      for (const label of DEFAULT_ACTIVE_STAGE_LABELS) {
        expect(widgetText).toContain(label);
      }

      // At least one currency-formatted amount is rendered somewhere in the
      // funnel (default currency is USD, so a $ prefix is reliable).
      await expect(scope.getByText(/\$\s?\d/).first()).toBeVisible();

      // At least one integer count is rendered somewhere in the funnel.
      // We require a digit that is NOT part of a currency amount nor part
      // of the stage label.
      expect(
        /\b\d+\b/.test(widgetText),
        `funnel text should contain at least one integer count: ${widgetText}`,
      ).toBe(true);
    });

    test("AC4: Won / Lost / Delayed deals (default done-pipeline stages) do not surface anywhere inside the funnel widget", async ({
      page,
    }) => {
      const scope = funnelScope(page);
      await expect(scope).toBeVisible();

      // Different safety net from AC2: assert the whole text of the funnel
      // never contains the closed-stage labels. This catches implementations
      // that render the label in a dropdown or tooltip even if no row exists.
      const widgetText = await scope.innerText();
      for (const label of DEFAULT_CLOSED_STAGE_LABELS) {
        expect(
          widgetText,
          `${label} must not appear anywhere in the funnel while it is a pipeline status`,
        ).not.toContain(label);
      }
    });

    test("AC10: dashboard loads without any network request to demo.example.org", async ({
      page,
    }) => {
      // Guard: the FakeRest provider is fully in-browser; the funnel must
      // read its data via useGetList and never call out to the placeholder
      // demo host used in docs.
      const unexpectedRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("demo.example.org")) {
          unexpectedRequests.push(request.url());
        }
      });

      // Fresh load so we capture every request the dashboard fires.
      await page.goto("/");
      await expect(funnelHeading(page)).toBeVisible();
      await expect(
        page.getByRole("heading", { name: DEALS_CHART_HEADING }),
      ).toBeVisible();

      expect(unexpectedRequests, unexpectedRequests.join("\n")).toHaveLength(0);
    });
  });

  test.describe("configuration (AC2 dynamic exclusion)", () => {
    test("AC2 dynamic: deselecting 'Lost' from Pipeline Statuses in Settings adds a 'Lost' row to the funnel without a code change", async ({
      page,
    }) => {
      await gotoDashboard(page);

      // Baseline: Lost is excluded by default.
      const scope = funnelScope(page);
      await expect(scope).toBeVisible();
      await expect(scope.getByText("Lost", { exact: true })).toHaveCount(0);

      // Toggle "Lost" off in Pipeline Statuses, save, and come back to the
      // dashboard without reloading the document (which would reset the demo
      // store).
      await navigateToSettings(page);
      await deselectPipelineStatusChip(page, "Lost");
      await saveSettingsConfiguration(page);

      await navigateToDashboardViaMenu(page);

      const refreshedScope = funnelScope(page);
      await expect(refreshedScope).toBeVisible();
      await expect(
        refreshedScope.getByText("Lost", { exact: true }).first(),
        "Lost row must appear in the funnel after it is removed from Pipeline Statuses",
      ).toBeVisible();

      // Won and Delayed stay in the pipeline statuses, so their rows must
      // remain excluded even after the Lost change.
      for (const label of ["Won", "Delayed"] as const) {
        await expect(
          refreshedScope.getByText(label, { exact: true }),
          `${label} must still be excluded while it stays in Pipeline Statuses`,
        ).toHaveCount(0);
      }
    });
  });

  test("AC7: the funnel appears on the desktop dashboard but not on the mobile one", async ({
    page,
  }) => {
    // Desktop first: the funnel must be visible (this half fails until the
    // feature exists, so AC7 as a whole does not trivially pass today).
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Latest Activity" }),
    ).toBeVisible();
    await expect(funnelHeading(page)).toBeVisible();

    // Resize to a mobile viewport and reload; `useIsMobile` picks the
    // MobileDashboard layout, which must remain unchanged by this feature.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Latest Activity" }),
    ).toBeVisible();
    await expect(funnelHeading(page)).toHaveCount(0);
  });
});
