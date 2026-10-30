import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Acceptance tests for "Propensity-to-buy badge on deal cards".
 *
 * Runs against the static FakeRest demo build (see `playwright.demo.config.ts`).
 * The demo auto-logs in as the demo admin and generates random data on every
 * load (faker is not seeded), so these tests assert structure, never specific
 * names or counts.
 *
 * Assumptions the build agent must match (spec leaves the exact wording open):
 * - The badge renders Low / Medium / High as a visible label on each card.
 * - The badge is accessible as `Propensity to buy: Low|Medium|High`
 *   (role is treated as a status/img with an accessible name).
 * - The deal edit form exposes a selector with the accessible name
 *   "Propensity to buy" and options "Auto", "Low", "Medium", "High".
 * - When the user picks a manual bucket, the badge tooltip says
 *   "Set manually" (exact spec wording).
 */

const BUCKETS = ["Low", "Medium", "High"] as const;
type Bucket = (typeof BUCKETS)[number];

/** All stage column headings shown on the Kanban board (default config). */
const PIPELINE_STAGE_HEADINGS = [
  "Opportunity",
  "Proposal Sent",
  "In Negotiation",
  "Lost",
  "Delayed",
] as const;

/** Stage that is flagged in dealPipelineStatuses as "won" by default. */
const CLOSED_STAGE_HEADING = "Won";

async function gotoDealsBoard(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Deals", exact: true }).click();
  await expect(page).toHaveURL(/#\/deals/);
  // the Kanban is only mounted once the data provider has returned
  await expect(page.locator("[data-rfd-draggable-id]").first()).toBeVisible();
}

/** All draggable deal cards currently on the Kanban board. */
function dealCards(page: Page): Locator {
  return page.locator("[data-rfd-draggable-id]");
}

/** All cards nested inside a given stage column (keyed on heading text). */
function cardsInStage(page: Page, stageHeading: string): Locator {
  // The droppable sits as a sibling of the heading inside the column container.
  return page
    .getByRole("heading", { name: stageHeading, exact: true })
    .locator("..")
    .locator("..")
    .locator("[data-rfd-draggable-id]");
}

/** A badge locator matching any of the three buckets inside a card. */
function badgeInCard(card: Locator): Locator {
  return card.getByText(/^(Low|Medium|High)$/).first();
}

test.describe("propensity-to-buy badge on deal cards", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDealsBoard(page);
  });

  test("AC1: every active deal card shows a Low/Medium/High badge with an accessible label", async ({
    page,
  }) => {
    // Wait for the Kanban to populate before counting.
    await expect(dealCards(page).first()).toBeVisible();

    // Collect active cards: everything except the closed "Won" column.
    const activeCards: Locator[] = [];
    for (const heading of PIPELINE_STAGE_HEADINGS) {
      const stageCards = cardsInStage(page, heading);
      const count = await stageCards.count();
      for (let i = 0; i < count; i += 1) {
        activeCards.push(stageCards.nth(i));
      }
    }

    expect(
      activeCards.length,
      "demo seed should produce at least one active deal",
    ).toBeGreaterThan(0);

    for (const card of activeCards) {
      // the visible bucket text appears inside the card
      await expect(badgeInCard(card)).toBeVisible();
      // and the accessible name reflects the bucket for assistive tech
      await expect(
        card.getByLabel(/^Propensity to buy: (Low|Medium|High)$/),
      ).toHaveCount(1);
    }
  });

  test("AC2: cards in the won stage do not show the propensity badge while active cards do", async ({
    page,
  }) => {
    const wonHeading = page.getByRole("heading", {
      name: CLOSED_STAGE_HEADING,
      exact: true,
    });
    await expect(wonHeading).toBeVisible();

    // 1. There is at least one active card showing a badge — pins the test
    //    to the full behavior, so it fails before the feature exists
    //    (otherwise "no badges anywhere" would trivially satisfy AC2).
    const activeBadge = page.locator(
      "[data-rfd-droppable-id='opportunity'] [aria-label^='Propensity to buy:'], " +
        "[data-rfd-droppable-id='proposal-sent'] [aria-label^='Propensity to buy:'], " +
        "[data-rfd-droppable-id='in-negociation'] [aria-label^='Propensity to buy:'], " +
        "[data-rfd-droppable-id='lost'] [aria-label^='Propensity to buy:'], " +
        "[data-rfd-droppable-id='delayed'] [aria-label^='Propensity to buy:']",
    );
    await expect(
      activeBadge.first(),
      "at least one active deal must carry a propensity badge",
    ).toBeVisible();

    // 2. No Won card carries a propensity badge (even visible bucket text).
    const wonCards = cardsInStage(page, CLOSED_STAGE_HEADING);
    const wonCount = await wonCards.count();
    if (wonCount > 0) {
      for (let i = 0; i < wonCount; i += 1) {
        const card = wonCards.nth(i);
        await expect(
          card.getByLabel(/^Propensity to buy:/),
          "won deals must not expose a propensity accessible label",
        ).toHaveCount(0);
        await expect(
          card.getByText(/^(Low|Medium|High)$/),
          "won deals must not show a bucket label",
        ).toHaveCount(0);
      }
    }
  });

  test("AC3: hovering the badge opens a tooltip with the top contributing factors", async ({
    page,
  }) => {
    // pick the first active card (anywhere except the Won column)
    const firstCard = cardsInStage(page, "Opportunity").first();
    const hasOpportunity = await firstCard.isVisible().catch(() => false);
    const probe = hasOpportunity
      ? firstCard
      : cardsInStage(page, "Proposal Sent").first();

    const badge = probe.getByLabel(/^Propensity to buy: (Low|Medium|High)$/);
    await expect(badge).toBeVisible();

    await badge.hover();

    // The tooltip is rendered in a portal; look it up at the page level.
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();

    // When the badge is computed (not manual), the tooltip lists factors as
    // bullet-style text — never the manual-override message.
    await expect(tooltip).not.toHaveText(/Set manually/);
    // The tooltip body is non-empty: at least a few readable characters.
    await expect(tooltip).toHaveText(/\S{3,}/);
  });

  test("AC4: deal edit form exposes a 'Propensity to buy' selector defaulting to Auto with Low/Medium/High options", async ({
    page,
  }) => {
    // open the first deal's show modal, then switch to the edit form
    const firstCard = dealCards(page).first();
    await firstCard.click();

    await page.getByRole("button", { name: "Edit" }).click();
    const editDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Linked to" });
    await expect(editDialog).toBeVisible();

    const selector = editDialog.getByRole("combobox", {
      name: "Propensity to buy",
    });
    await expect(selector).toBeVisible();
    // default value is Auto
    await expect(selector).toContainText("Auto");

    // all four options are available
    await selector.click();
    for (const option of ["Auto", "Low", "Medium", "High"]) {
      await expect(
        page.getByRole("option", { name: option, exact: true }),
      ).toBeVisible();
    }
    // close the dropdown
    await page.keyboard.press("Escape");
  });

  test("AC5: saving a manual bucket makes the Kanban card reflect that bucket", async ({
    page,
  }) => {
    // remember the id of the first card so we can find it again after save
    const firstCard = dealCards(page).first();
    const draggableId = await firstCard.getAttribute("data-rfd-draggable-id");
    expect(draggableId, "card must expose a draggable id").toBeTruthy();

    await firstCard.click();
    await page.getByRole("button", { name: "Edit" }).click();

    const editDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Linked to" });
    await expect(editDialog).toBeVisible();

    const selector = editDialog.getByRole("combobox", {
      name: "Propensity to buy",
    });
    await selector.click();
    await page.getByRole("option", { name: "High", exact: true }).click();

    // persist
    await editDialog.getByRole("button", { name: "Save" }).click();

    // return to the Kanban board
    await page.getByRole("link", { name: "Deals", exact: true }).click();
    await expect(page).toHaveURL(/#\/deals/);
    await expect(dealCards(page).first()).toBeVisible();

    const card = page.locator(`[data-rfd-draggable-id="${draggableId}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByLabel("Propensity to buy: High")).toBeVisible();
  });

  test("AC3-override: a manually-overridden card tooltip says 'Set manually'", async ({
    page,
  }) => {
    // override one card to Medium so we have a known manual bucket to probe
    const firstCard = dealCards(page).first();
    const draggableId = await firstCard.getAttribute("data-rfd-draggable-id");
    expect(draggableId).toBeTruthy();

    await firstCard.click();
    await page.getByRole("button", { name: "Edit" }).click();
    const editDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Linked to" });
    await editDialog
      .getByRole("combobox", { name: "Propensity to buy" })
      .click();
    await page.getByRole("option", { name: "Medium", exact: true }).click();
    await editDialog.getByRole("button", { name: "Save" }).click();

    await page.getByRole("link", { name: "Deals", exact: true }).click();
    const card = page.locator(`[data-rfd-draggable-id="${draggableId}"]`);
    const badge = card.getByLabel(/^Propensity to buy: Medium$/);
    await expect(badge).toBeVisible();
    await badge.hover();

    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Set manually");
  });

  test("AC6: switching the override back to Auto clears it and the computed bucket returns", async ({
    page,
  }) => {
    // 1. force a known bucket so we can later observe a change
    const firstCard = dealCards(page).first();
    const draggableId = await firstCard.getAttribute("data-rfd-draggable-id");
    expect(draggableId).toBeTruthy();

    await firstCard.click();
    await page.getByRole("button", { name: "Edit" }).click();
    const openEditDialog = () =>
      page.getByRole("dialog").filter({ hasText: "Linked to" });
    let editDialog = openEditDialog();
    await editDialog
      .getByRole("combobox", { name: "Propensity to buy" })
      .click();
    await page.getByRole("option", { name: "Low", exact: true }).click();
    await editDialog.getByRole("button", { name: "Save" }).click();

    // verify the forced bucket shows up
    await page.getByRole("link", { name: "Deals", exact: true }).click();
    const card = page.locator(`[data-rfd-draggable-id="${draggableId}"]`);
    await expect(card.getByLabel("Propensity to buy: Low")).toBeVisible();

    // 2. open the edit form again and switch back to Auto
    await card.click();
    await page.getByRole("button", { name: "Edit" }).click();
    editDialog = openEditDialog();
    const selector = editDialog.getByRole("combobox", {
      name: "Propensity to buy",
    });
    await selector.click();
    await page.getByRole("option", { name: "Auto", exact: true }).click();
    await expect(selector).toContainText("Auto");
    await editDialog.getByRole("button", { name: "Save" }).click();

    // 3. back on the board, the card tooltip no longer reports a manual override
    await page.getByRole("link", { name: "Deals", exact: true }).click();
    const refreshedCard = page.locator(
      `[data-rfd-draggable-id="${draggableId}"]`,
    );
    const badge = refreshedCard.getByLabel(
      /^Propensity to buy: (Low|Medium|High)$/,
    );
    await expect(badge).toBeVisible();
    await badge.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).not.toHaveText(/Set manually/);
  });

  test("AC10: the demo board shows a mix of Low, Medium and High badges", async ({
    page,
  }) => {
    // collect the bucket label on every active card
    await expect(dealCards(page).first()).toBeVisible();

    const bucketCounts: Record<Bucket, number> = { Low: 0, Medium: 0, High: 0 };
    for (const heading of PIPELINE_STAGE_HEADINGS) {
      const cards = cardsInStage(page, heading);
      const count = await cards.count();
      for (let i = 0; i < count; i += 1) {
        const label = await cards
          .nth(i)
          .getByLabel(/^Propensity to buy: (Low|Medium|High)$/)
          .first()
          .getAttribute("aria-label");
        if (!label) continue;
        const match = label.match(/(Low|Medium|High)/);
        if (match) {
          bucketCounts[match[1] as Bucket] += 1;
        }
      }
    }

    const distinctBuckets = BUCKETS.filter((b) => bucketCounts[b] > 0).length;
    expect(
      distinctBuckets,
      `expected at least 2 of Low/Medium/High on the demo board, got ${JSON.stringify(bucketCounts)}`,
    ).toBeGreaterThanOrEqual(2);
  });
});
