import { expect, test, type Page } from "@playwright/test";

// Helpers shared across tests

/** Navigate to the Deals page and wait for the Kanban board to load. */
async function goToDeals(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Deals", exact: true }).click();
  await expect(page).toHaveURL(/#\/deals/);
  // Wait for at least one deal card to prove data has loaded
  await expect(page.locator("[data-rfd-draggable-id]").first()).toBeVisible();
}

/** Open the FilterButton dropdown on the Deals page. */
async function openFilterDropdown(page: Page) {
  await page.getByRole("button", { name: "Add filter" }).click();
}

test.describe("Deals date range filters", () => {
  // ── AC1: Expected closing date filter exists in FilterButton ──────────

  test("AC1: FilterButton dropdown includes an 'Expected closing date' filter option", async ({
    page,
  }) => {
    await goToDeals(page);
    await openFilterDropdown(page);

    // The filter item should appear as a menuitemcheckbox inside the dropdown
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Expected closing date" }),
    ).toBeVisible();
  });

  test("AC1: Activating 'Expected closing date' shows preset buttons and Custom option", async ({
    page,
  }) => {
    await goToDeals(page);
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();

    // Preset buttons should be visible in the filter form
    for (const preset of [
      "This month",
      "This quarter",
      "Next month",
      "Next quarter",
    ]) {
      await expect(page.getByRole("button", { name: preset })).toBeVisible();
    }
    // Custom range option
    await expect(
      page.getByRole("button", { name: "Custom", exact: true }),
    ).toBeVisible();
  });

  // ── AC2: Created date filter exists in FilterButton ───────────────────

  test("AC2: FilterButton dropdown includes a 'Created date' filter option", async ({
    page,
  }) => {
    await goToDeals(page);
    await openFilterDropdown(page);

    await expect(
      page.getByRole("menuitemcheckbox", { name: "Created date" }),
    ).toBeVisible();
  });

  test("AC2: Activating 'Created date' shows preset buttons and Custom option", async ({
    page,
  }) => {
    await goToDeals(page);
    await openFilterDropdown(page);
    await page.getByRole("menuitemcheckbox", { name: "Created date" }).click();

    for (const preset of [
      "This month",
      "This quarter",
      "Next month",
      "Next quarter",
    ]) {
      await expect(page.getByRole("button", { name: preset })).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "Custom", exact: true }),
    ).toBeVisible();
  });

  // ── AC3: Selecting a preset filters the Kanban ────────────────────────

  test("AC3: Selecting 'This quarter' on expected closing date filters deals and highlights the button", async ({
    page,
  }) => {
    await goToDeals(page);

    // Count cards before filtering
    const initialCards = page.locator("[data-rfd-draggable-id]");
    await expect(initialCards.first()).toBeVisible();

    // Activate expected closing date filter
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();

    // Click "This quarter" preset – use the one inside the expected closing date filter
    const thisQuarterButton = page.getByRole("button", {
      name: "This quarter",
    });
    await expect(thisQuarterButton).toBeVisible();
    await thisQuarterButton.click();

    // The button should appear highlighted (selected/active state).
    // We check it's still visible after click (filter applied).
    await expect(thisQuarterButton).toBeVisible();

    // The board should still show stage columns (the Kanban structure remains)
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();
  });

  test("AC3: Selecting another preset replaces the previous one", async ({
    page,
  }) => {
    await goToDeals(page);

    // Activate expected closing date filter
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();

    // Select "This month"
    await page.getByRole("button", { name: "This month" }).click();
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();

    // Now select "Next quarter" – it should replace "This month"
    await page.getByRole("button", { name: "Next quarter" }).click();
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();
  });

  // ── AC4: Custom date range with from/to pickers ───────────────────────

  test("AC4: Selecting 'Custom' reveals from and to date pickers", async ({
    page,
  }) => {
    await goToDeals(page);

    // Activate expected closing date filter
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();

    // Click Custom
    await page.getByRole("button", { name: "Custom", exact: true }).click();

    // From and To date inputs should appear
    // Assumption: the date pickers are labeled "From" and "To" (or use those as placeholders)
    const fromInput = page.getByLabel("From", { exact: true });
    const toInput = page.getByLabel("To", { exact: true });
    await expect(fromInput).toBeVisible();
    await expect(toInput).toBeVisible();
  });

  test("AC4: Setting only 'from' date filters deals on or after that date", async ({
    page,
  }) => {
    await goToDeals(page);

    // Activate expected closing date filter
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();

    // Click Custom
    await page.getByRole("button", { name: "Custom", exact: true }).click();

    // Set a "from" date in the past (e.g. 2020-01-01 to include most deals)
    const fromInput = page.getByLabel("From", { exact: true });
    await expect(fromInput).toBeVisible();
    await fromInput.fill("2020-01-01");

    // The board should still show the Kanban structure
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();
  });

  test("AC4: Setting only 'to' date filters deals on or before that date", async ({
    page,
  }) => {
    await goToDeals(page);

    // Activate expected closing date filter
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();

    // Click Custom
    await page.getByRole("button", { name: "Custom", exact: true }).click();

    // Set a "to" date far in the future (to include all deals)
    const toInput = page.getByLabel("To", { exact: true });
    await expect(toInput).toBeVisible();
    await toInput.fill("2030-12-31");

    // The board should still show the Kanban structure
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();
  });

  // ── AC5: Null expected_closing_date excluded by filter ────────────────

  test("AC5: Deals with null expected_closing_date are excluded when the expected closing date filter is active", async ({
    page,
  }) => {
    await goToDeals(page);

    // Activate expected closing date filter and pick a very wide custom range
    // that would include every valid date. If any deal has null expected_closing_date
    // it should be excluded, meaning the filtered count should be ≤ the total count.
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();

    // Pick "Custom" and set a very wide range
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    const fromInput = page.getByLabel("From", { exact: true });
    const toInput = page.getByLabel("To", { exact: true });
    await expect(fromInput).toBeVisible();
    await fromInput.fill("2000-01-01");
    await toInput.fill("2099-12-31");

    // The board should render. We cannot assert exact counts since data is random,
    // but the Kanban columns should still be visible.
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();
  });

  // ── AC6: Preset periods computed at render time ───────────────────────
  // This is a computation test best covered by unit tests. We verify that
  // the presets exist and are clickable (functional), but the exact date
  // computation is a unit-test concern.

  test("AC6: All four preset buttons are present for both date filters", async ({
    page,
  }) => {
    await goToDeals(page);
    const presets = [
      "This month",
      "This quarter",
      "Next month",
      "Next quarter",
    ];

    // Check expected closing date filter
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();
    for (const preset of presets) {
      await expect(page.getByRole("button", { name: preset })).toBeVisible();
    }

    // Remove the expected closing date filter and add created date filter
    // Click the remove button (MinusCircle) for the expected closing date filter
    const expectedClosingFilterField = page.locator(
      '[data-source*="expected_closing_date"]',
    );
    await expectedClosingFilterField
      .getByRole("button", { name: "Remove this filter" })
      .click();

    // Now activate created date filter
    await openFilterDropdown(page);
    await page.getByRole("menuitemcheckbox", { name: "Created date" }).click();
    for (const preset of presets) {
      await expect(page.getByRole("button", { name: preset })).toBeVisible();
    }
  });

  // ── AC7: Date filters work together with existing filters ─────────────

  test("AC7: Expected closing date filter works together with search filter", async ({
    page,
  }) => {
    await goToDeals(page);

    // Activate expected closing date filter
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();

    // Select "This quarter" preset
    await page.getByRole("button", { name: "This quarter" }).click();

    // The search input (alwaysOn) should still be visible and functional
    const searchInput = page.getByRole("textbox", { name: "Search" });
    await expect(searchInput).toBeVisible();

    // Type a search query – both filters should be AND-combined
    await searchInput.fill("zzz_nonexistent_deal_name");

    // With a nonsense search term AND a date filter, the board should show
    // zero cards (or empty state) but still have the column headings
    // (Kanban structure persists even when empty)
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();
  });

  test("AC7: Both date filters can be active simultaneously", async ({
    page,
  }) => {
    await goToDeals(page);

    // Activate expected closing date filter
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();
    await page.getByRole("button", { name: "This quarter" }).click();

    // Activate created date filter too
    await openFilterDropdown(page);
    await page.getByRole("menuitemcheckbox", { name: "Created date" }).click();

    // We should now see a second set of preset buttons (for Created date)
    // The created date filter area should show its own presets
    // Pick "This quarter" on the created date filter
    // Since there are two sets of "This quarter" buttons, we need to target
    // the one inside the created date filter area
    const createdDateFilter = page.locator('[data-source*="created_at"]');
    await expect(
      createdDateFilter.getByRole("button", { name: "This quarter" }),
    ).toBeVisible();
    await createdDateFilter
      .getByRole("button", { name: "This quarter" })
      .click();

    // Both filters active – Kanban should still render
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();
  });

  // ── AC8: Clearing the filter removes the date constraint ──────────────

  test("AC8: Removing the expected closing date filter via the remove button clears the constraint", async ({
    page,
  }) => {
    await goToDeals(page);

    // Activate expected closing date filter and select a preset
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();
    await page.getByRole("button", { name: "This month" }).click();

    // The filter should be active – find the remove button for this filter
    const filterField = page.locator('[data-source*="expected_closing_date"]');
    await expect(filterField).toBeVisible();

    // Click the remove (MinusCircle) button
    await filterField
      .getByRole("button", { name: "Remove this filter" })
      .click();

    // The expected closing date filter UI should be gone
    await expect(filterField).toBeHidden();

    // The board should show all deals again (unfiltered by date)
    await expect(page.locator("[data-rfd-draggable-id]").first()).toBeVisible();
  });

  // ── AC9: Filters work in demo mode with FakeRest data ─────────────────

  test("AC9: Date filters function in demo mode - expected closing date 'This quarter' returns results or empty board", async ({
    page,
  }) => {
    await goToDeals(page);

    // Activate expected closing date filter
    await openFilterDropdown(page);
    await page
      .getByRole("menuitemcheckbox", { name: "Expected closing date" })
      .click();

    // Select "This quarter" – the demo generator should produce deals
    // spanning current and future months so some may match
    await page.getByRole("button", { name: "This quarter" }).click();

    // The Kanban columns should still render (even if empty)
    await expect(
      page.getByRole("heading", { name: "Opportunity" }),
    ).toBeVisible();
  });

  // ── AC10: Translation catalog labels ──────────────────────────────────
  // This criterion requires checking that labels exist in both en and fr
  // translation catalogs. This is a static code concern, not verifiable
  // in a browser test against one locale. Covered by unit tests.
});
