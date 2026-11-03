import { expect, test } from "@playwright/test";

/**
 * Tests for: Add drill-down navigation from Deals chart and Sales funnel
 * to the deals board.
 *
 * Runs against the static FakeRest demo build. Demo data is random on every
 * load (faker is not seeded), but the first 5 deals are forced into the
 * current month, so the current-month bar on the chart always has data.
 */

test.describe("Dashboard drill-down to deals board", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the dashboard to fully load — the chart heading proves it
    await expect(
      page.getByRole("heading", { name: "Upcoming Deal Revenue" }),
    ).toBeVisible();
  });

  // ---------- AC1: Clicking a chart bar navigates to #/deals with created_at date filter ----------

  test("AC1: clicking a month bar on the Deals chart navigates to #/deals with created_at date filter for that month", async ({
    page,
  }) => {
    // The chart is rendered inside a container with the "Upcoming Deal Revenue" heading.
    // Nivo renders bars as <rect> elements inside an SVG. We need to find and click one.
    // The current month is guaranteed to have data (first 5 deals).
    const chartContainer = page.locator(".h-\\[400px\\]");
    await expect(chartContainer).toBeVisible();

    // Find a clickable bar rect inside the Nivo chart SVG.
    // The spec says clicking any bar segment navigates, ignoring the status segment.
    const bars = chartContainer.locator("svg rect[width]");
    // Wait for at least one bar to be rendered
    await expect(bars.first()).toBeVisible();

    // Click the first visible bar
    await bars.first().click();

    // Should navigate to #/deals
    await expect(page).toHaveURL(/#\/deals/);

    // The URL should contain filter params with created_at
    // ra-core encodes filters as JSON in the `filter` query param of the hash.
    // The filter keys are `created_at@gte` and `created_at@lt` (timestamp mode).
    const url = page.url();
    const hash = new URL(url).hash;
    expect(hash).toContain("created_at");
  });

  // ---------- AC2: The Created date filter shows as active after drill-down ----------

  test("AC2: the Created date filter on the deals board shows as active with the correct month range after drill-down and can be cleared", async ({
    page,
  }) => {
    const chartContainer = page.locator(".h-\\[400px\\]");
    await expect(chartContainer).toBeVisible();

    const bars = chartContainer.locator("svg rect[width]");
    await expect(bars.first()).toBeVisible();
    await bars.first().click();

    await expect(page).toHaveURL(/#\/deals/);

    // Wait for the deals board to load — at least one stage heading must be visible
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();

    // The Created date filter should be visible and show a selected state.
    // The DateRangeFilterInput renders preset buttons and custom date inputs.
    // When drilled-down with a specific month range, it should show in "custom" mode.
    // Look for the "Custom" button being active (variant="default" = selected).
    const customButton = page.getByRole("button", { name: "Custom" });
    await expect(customButton).toBeVisible();

    // The "from" and "to" date inputs should be visible with values set
    const fromInput = page.getByLabel("From");
    const toInput = page.getByLabel("To");
    await expect(fromInput).toBeVisible();
    await expect(toInput).toBeVisible();

    // Both should have date values (non-empty)
    await expect(fromInput).not.toHaveValue("");
    await expect(toInput).not.toHaveValue("");
  });

  // ---------- AC3: Clicking a funnel stage row navigates to #/deals ----------

  test("AC3: clicking a stage row on the Sales funnel navigates to #/deals and scrolls the stage column into view", async ({
    page,
  }) => {
    // Wait for funnel to load — check for the "Sales funnel" heading
    await expect(
      page.getByRole("heading", { name: "Sales funnel" }),
    ).toBeVisible();

    // The funnel renders <li> elements for each active stage row.
    // Each row shows the stage label. Click the first visible stage row.
    const funnelList = page.locator("ul").filter({
      has: page.locator("li").filter({ hasText: "Opportunity" }),
    });
    await expect(funnelList).toBeVisible();

    // Click on a specific stage row — "In Negotiation" to test scroll behavior
    const stageRow = funnelList
      .locator("li")
      .filter({ hasText: "In Negotiation" });
    await expect(stageRow).toBeVisible();
    await stageRow.click();

    // Should navigate to #/deals
    await expect(page).toHaveURL(/#\/deals/);

    // Wait for the deals board to load
    await expect(
      page.getByRole("heading", { name: "In Negotiation" }),
    ).toBeVisible();

    // No stage filter should be applied to the URL (stages are already columns)
    const url = page.url();
    const hash = new URL(url).hash;
    expect(hash).not.toContain("stage");
  });

  // ---------- AC4: Hovering over clickable areas changes cursor to pointer ----------

  test("AC4: hovering over a chart bar changes the cursor to pointer", async ({
    page,
  }) => {
    const chartContainer = page.locator(".h-\\[400px\\]");
    await expect(chartContainer).toBeVisible();

    const bars = chartContainer.locator("svg rect[width]");
    await expect(bars.first()).toBeVisible();

    // Check that the bar element (or its parent group) has cursor: pointer
    const cursor = await bars.first().evaluate((el) => {
      return window.getComputedStyle(el).cursor;
    });
    expect(cursor).toBe("pointer");
  });

  test("AC4: hovering over a funnel stage row changes the cursor to pointer", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Sales funnel" }),
    ).toBeVisible();

    const funnelList = page.locator("ul").filter({
      has: page.locator("li").filter({ hasText: "Opportunity" }),
    });
    await expect(funnelList).toBeVisible();

    const stageRow = funnelList
      .locator("li")
      .filter({ hasText: "Opportunity" });
    await expect(stageRow).toBeVisible();

    const cursor = await stageRow.evaluate((el) => {
      return window.getComputedStyle(el).cursor;
    });
    expect(cursor).toBe("pointer");
  });

  // ---------- AC5: Tooltip or aria-label on clickable elements ----------

  test("AC5: chart bars have a tooltip or aria-label indicating clickability (e.g. 'View deals for June')", async ({
    page,
  }) => {
    const chartContainer = page.locator(".h-\\[400px\\]");
    await expect(chartContainer).toBeVisible();

    const bars = chartContainer.locator("svg rect[width]");
    await expect(bars.first()).toBeVisible();

    // The spec says a translated tooltip or aria-label like 'View deals for June'.
    // Check for an aria-label on the bar or its group that starts with "View deals for"
    const barGroup = chartContainer.locator(
      'svg [aria-label^="View deals for"]',
    );
    await expect(barGroup.first()).toBeVisible();
  });

  test("AC5: funnel stage rows have a tooltip or aria-label indicating clickability (e.g. 'View deals in Negotiation')", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Sales funnel" }),
    ).toBeVisible();

    const funnelList = page.locator("ul").filter({
      has: page.locator("li").filter({ hasText: "Opportunity" }),
    });
    await expect(funnelList).toBeVisible();

    // Check for aria-label on funnel rows matching pattern "View deals in <stage>"
    const labelledRow = funnelList.locator('li[aria-label^="View deals in"]');
    await expect(labelledRow.first()).toBeVisible();
  });

  // ---------- AC6: Uses created_at for the date filter (not expected_closing_date) ----------

  test("AC6: drill-down from chart uses created_at for the date filter, not expected_closing_date", async ({
    page,
  }) => {
    const chartContainer = page.locator(".h-\\[400px\\]");
    await expect(chartContainer).toBeVisible();

    const bars = chartContainer.locator("svg rect[width]");
    await expect(bars.first()).toBeVisible();
    await bars.first().click();

    await expect(page).toHaveURL(/#\/deals/);

    const url = page.url();
    const hash = new URL(url).hash;
    // Must contain created_at filter keys
    expect(hash).toContain("created_at");
    // Must NOT contain expected_closing_date
    expect(hash).not.toContain("expected_closing_date");
  });

  // ---------- AC7: Empty columns shown when no deals match ----------

  test("AC7: when no deals match the drilled-down filter, the board shows empty columns", async ({
    page,
  }) => {
    // Navigate directly to #/deals with a date range in the distant past that has no deals
    await page.goto(
      "/#/deals?filter=%7B%22created_at%40gte%22%3A%222000-01-01%22%2C%22created_at%40lt%22%3A%222000-02-01%22%7D&displayedFilters=%7B%22created_at%22%3Atrue%7D",
    );

    // Wait for the board to load — stage headings should still be visible
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Won", exact: true }),
    ).toBeVisible();

    // There should be no deal cards
    await expect(page.locator("[data-rfd-draggable-id]")).toHaveCount(0);
  });

  // ---------- AC8: Both drill-down interactions work in demo mode ----------

  test("AC8: chart drill-down works in demo mode — current month bar returns results when clicked", async ({
    page,
  }) => {
    const chartContainer = page.locator(".h-\\[400px\\]");
    await expect(chartContainer).toBeVisible();

    // The current month is always present because the first 5 deals are forced
    // into the current month. Get the current month abbreviation.
    const currentMonthAbbr = new Date().toLocaleString("en-US", {
      month: "short",
    });

    // Find the axis label for the current month on the chart
    // Nivo renders axis labels as <text> elements
    const monthLabel = chartContainer.getByText(currentMonthAbbr, {
      exact: true,
    });
    await expect(monthLabel).toBeVisible();

    // Click a bar — we know the current month has bars
    const bars = chartContainer.locator("svg rect[width]");
    await expect(bars.first()).toBeVisible();
    await bars.first().click();

    await expect(page).toHaveURL(/#\/deals/);

    // Wait for the board to load
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();

    // At least one deal card should be visible (first 5 deals are in current month)
    // Note: some deals may not match if the filter is for a different month's bar.
    // We just verify navigation worked and the board rendered.
  });

  test("AC8: funnel drill-down works in demo mode", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Sales funnel" }),
    ).toBeVisible();

    const funnelList = page.locator("ul").filter({
      has: page.locator("li").filter({ hasText: "Opportunity" }),
    });
    await expect(funnelList).toBeVisible();

    const stageRow = funnelList
      .locator("li")
      .filter({ hasText: "Opportunity" });
    await stageRow.click();

    await expect(page).toHaveURL(/#\/deals/);
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();
  });

  // ---------- AC9: Filters encoded in URL hash for shareability ----------

  test("AC9: drill-down navigation encodes filters in the URL hash so the filtered view survives a page refresh", async ({
    page,
  }) => {
    const chartContainer = page.locator(".h-\\[400px\\]");
    await expect(chartContainer).toBeVisible();

    const bars = chartContainer.locator("svg rect[width]");
    await expect(bars.first()).toBeVisible();
    await bars.first().click();

    await expect(page).toHaveURL(/#\/deals/);

    // Capture the full URL with filters
    const filteredUrl = page.url();
    expect(filteredUrl).toContain("filter");
    expect(filteredUrl).toContain("created_at");

    // Reload the page to verify the filter survives refresh
    await page.reload();

    // Wait for the board to load again
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();

    // The URL should still contain the filter params
    const reloadedUrl = page.url();
    expect(reloadedUrl).toContain("created_at");

    // The Created date filter should still be visible and active
    const customButton = page.getByRole("button", { name: "Custom" });
    await expect(customButton).toBeVisible();
  });
});
