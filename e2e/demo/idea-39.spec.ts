import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Runs against the static FakeRest demo build (see playwright.demo.config.ts).
// The demo auto-logs in as the admin and generates random data on every load
// (faker is not seeded), so these tests assert structure, never specific values.

const DEALS_URL = /#\/deals/;

/**
 * Navigate to the deals board and wait for it to be fully loaded
 * (at least one draggable deal card visible).
 */
async function goToDealsBoard(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Deals", exact: true }).click();
  await expect(page).toHaveURL(DEALS_URL);
  // Wait for at least one deal card to appear, proving data loaded
  await expect(page.locator("[data-rfd-draggable-id]").first()).toBeVisible();
}

/**
 * Open the propensity filter on the deals board.
 *
 * The spec adds a "Propensity to buy" multi-select to the filter bar.
 * It may be alwaysOn or accessible via the "Add filter" dropdown.
 * We first check if the input placeholder is already visible, and if not
 * we open the dropdown to add it.
 */
async function openPropensityFilter(page: Page) {
  const placeholder = page.getByPlaceholder("Propensity to buy");

  // If already displayed (e.g. alwaysOn), no need to add it
  // Use a short timeout to probe quickly without false-negatives
  const alreadyVisible = await placeholder
    .waitFor({ state: "visible", timeout: 2000 })
    .then(() => true)
    .catch(() => false);

  if (!alreadyVisible) {
    // Open the "Add filter" dropdown and select the propensity filter
    await page.getByRole("button", { name: "Add filter" }).click();
    await page.getByRole("menuitem", { name: "Propensity to buy" }).click();
    await expect(placeholder).toBeVisible();
  }
}

test.describe("Propensity-to-buy filter on deals board", () => {
  test("AC1: deals board filter bar includes a 'Propensity to buy' multi-select filter with Low, Medium, and High options", async ({
    page,
  }) => {
    await goToDealsBoard(page);
    await openPropensityFilter(page);

    // Click to open the dropdown and verify the three options exist
    await page.getByPlaceholder("Propensity to buy").click();

    // Verify the three propensity bucket options appear in the listbox
    await expect(
      page.getByRole("option", { name: "Low", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Medium", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "High", exact: true }),
    ).toBeVisible();
  });

  test("AC2: selecting a propensity bucket hides deals that do not match", async ({
    page,
  }) => {
    await goToDealsBoard(page);

    // Count the total deal cards before filtering
    const allCards = page.locator("[data-rfd-draggable-id]");
    const initialCardCount = await allCards.count();
    expect(initialCardCount).toBeGreaterThan(0);

    // Open and select "High" bucket
    await openPropensityFilter(page);
    await page.getByPlaceholder("Propensity to buy").click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await page.keyboard.press("Escape");

    // After filtering, fewer cards should remain (demo data has a mix of buckets)
    await expect(allCards).not.toHaveCount(initialCardCount);

    // All visible propensity badges must be "High"
    const allBadges = page.locator('[aria-label^="Propensity to buy:"]');
    const badgeCount = await allBadges.count();
    for (let i = 0; i < badgeCount; i++) {
      await expect(allBadges.nth(i)).toHaveAttribute(
        "aria-label",
        "Propensity to buy: High",
      );
    }
  });

  test("AC3: deals in non-scorable stages are hidden when propensity filter is active", async ({
    page,
  }) => {
    await goToDealsBoard(page);

    // Non-scorable stages are Won, Lost, Delayed (dealPipelineStatuses).
    // Select all three buckets so we keep every scorable deal but hide non-scorable ones.
    await openPropensityFilter(page);
    await page.getByPlaceholder("Propensity to buy").click();
    await page.getByRole("option", { name: "Low", exact: true }).click();
    await page.getByRole("option", { name: "Medium", exact: true }).click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await page.keyboard.press("Escape");

    // Wait for the filter to take effect
    // The non-scorable stage columns (Won, Lost, Delayed) should have 0 deal cards.
    // Each column is a top-level flex-1 div containing:
    //   - a header area with heading (h3) and amount (p)
    //   - a droppable area with deal cards
    // We find columns by their heading and verify no cards inside.
    for (const nonScorableStage of ["Won", "Lost", "Delayed"]) {
      const heading = page.getByRole("heading", { name: nonScorableStage });
      // If the heading is visible, check that column has no deal cards
      await expect(heading).toBeVisible();
      // Navigate from heading to its column container and check for cards
      const column = heading.locator("../..");
      const cardsInColumn = column.locator("[data-rfd-draggable-id]");
      await expect(cardsInColumn).toHaveCount(0);
    }
  });

  test("AC5: column deal count and summed amount update to reflect only visible filtered deals", async ({
    page,
  }) => {
    await goToDealsBoard(page);

    // The DealColumn renders the total amount beneath the heading. We pick the
    // "Opportunity" column because it should always have scorable active deals.
    const opportunityHeading = page.getByRole("heading", {
      name: "Opportunity",
    });
    await expect(opportunityHeading).toBeVisible();

    // The amount text sits in a <p> with class text-muted-foreground, inside
    // the same parent container as the heading.
    const columnHeader = opportunityHeading.locator("..");
    const amountText = columnHeader.locator("p");
    const amountBefore = await amountText.textContent();
    expect(amountBefore).toBeTruthy();

    // Apply "High" filter only — should reduce the deals shown
    await openPropensityFilter(page);
    await page.getByPlaceholder("Propensity to buy").click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await page.keyboard.press("Escape");

    // The column amount should change (fewer deals = lower total)
    await expect(amountText).not.toHaveText(amountBefore!);
  });

  test("AC6: clearing the propensity filter restores all deals to the board", async ({
    page,
  }) => {
    await goToDealsBoard(page);

    const allCards = page.locator("[data-rfd-draggable-id]");
    const initialCardCount = await allCards.count();

    // Apply a filter
    await openPropensityFilter(page);
    await page.getByPlaceholder("Propensity to buy").click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await page.keyboard.press("Escape");

    // Wait for filter to take effect
    await expect(allCards).not.toHaveCount(initialCardCount);

    // Clear the filter by deselecting the chosen option
    await page.getByPlaceholder("Propensity to buy").click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await page.keyboard.press("Escape");

    // All deals should be restored
    await expect(allCards).toHaveCount(initialCardCount);
  });

  test("AC7: the filter works in FakeRest demo mode with same behavior as production", async ({
    page,
  }) => {
    // This test implicitly runs in demo mode (playwright.demo.config.ts).
    // Verify the full flow: navigate, apply filter, see filtered results.
    await goToDealsBoard(page);

    const allCards = page.locator("[data-rfd-draggable-id]");
    const initialCount = await allCards.count();
    expect(initialCount).toBeGreaterThan(0);

    // Select "Low" bucket
    await openPropensityFilter(page);
    await page.getByPlaceholder("Propensity to buy").click();
    await page.getByRole("option", { name: "Low", exact: true }).click();
    await page.keyboard.press("Escape");

    // Some "Low" deals should be visible and count should be less than initial
    await expect(allCards.first()).toBeVisible();
    const filteredCount = await allCards.count();
    expect(filteredCount).toBeLessThan(initialCount);
    expect(filteredCount).toBeGreaterThan(0);
  });
});
