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

/**
 * Stage column headings whose cards must show a propensity badge under the
 * default `dealPipelineStatuses` (`['won','lost','delayed']`, F-DEAL-07).
 */
const PIPELINE_STAGE_HEADINGS = [
  "Opportunity",
  "Proposal Sent",
  "In Negotiation",
] as const;

/**
 * Stages flagged in the default `dealPipelineStatuses`: Won / Lost / Delayed
 * cards never show a propensity badge, even with a manual override (idea-12).
 */
const CLOSED_STAGE_HEADINGS = ["Won", "Lost", "Delayed"] as const;

/** After a save the deal's show dialog opens over the board; close it. */
async function closeDealDialog(page: Page) {
  await expect(page).toHaveURL(/#\/deals\/[^/]+\/show/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/deals$/);
}

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

/**
 * Pick the first draggable card nested under an "active" stage (one that
 * must carry a propensity badge). Lost/Delayed/Won columns are default-closed
 * since idea-12, so picking `dealCards(page).first()` can land on a card
 * that intentionally has no badge.
 */
async function firstActiveCard(page: Page): Promise<Locator> {
  for (const heading of PIPELINE_STAGE_HEADINGS) {
    const cards = cardsInStage(page, heading);
    if ((await cards.count()) > 0) {
      return cards.first();
    }
  }
  throw new Error("No active-stage card found on the demo board");
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

  test("AC2: cards in closed-out stages do not show the propensity badge while active cards do", async ({
    page,
  }) => {
    for (const heading of CLOSED_STAGE_HEADINGS) {
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
    }

    // 1. There is at least one active card showing a badge — pins the test
    //    to the full behavior, so it fails before the feature exists
    //    (otherwise "no badges anywhere" would trivially satisfy AC2).
    const activeBadge = page.locator(
      "[data-rfd-droppable-id='opportunity'] [aria-label^='Propensity to buy:'], " +
        "[data-rfd-droppable-id='proposal-sent'] [aria-label^='Propensity to buy:'], " +
        "[data-rfd-droppable-id='in-negociation'] [aria-label^='Propensity to buy:']",
    );
    await expect(
      activeBadge.first(),
      "at least one active deal must carry a propensity badge",
    ).toBeVisible();

    // 2. No card in a default-closed stage carries a propensity badge
    //    (idea-12 added Lost / Delayed to the default alongside Won).
    for (const heading of CLOSED_STAGE_HEADINGS) {
      const closedCards = cardsInStage(page, heading);
      const closedCount = await closedCards.count();
      for (let i = 0; i < closedCount; i += 1) {
        const card = closedCards.nth(i);
        await expect(
          card.getByLabel(/^Propensity to buy:/),
          `${heading} deals must not expose a propensity accessible label`,
        ).toHaveCount(0);
        await expect(
          card.getByText(/^(Low|Medium|High)$/),
          `${heading} deals must not show a bucket label`,
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

  test("AC4: the deal form exposes a 'Propensity to buy' selector defaulting to Auto with Low/Medium/High options", async ({
    page,
  }) => {
    // The create form shows the default: existing demo deals may already
    // carry a manual override (~10% of generated deals do).
    await page.goto("/#/deals/create");
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
    // Pick a card in an active stage so the manual override is actually
    // rendered on the board (deals in Won/Lost/Delayed never show a badge
    // since idea-12, even with an override).
    const firstCard = await firstActiveCard(page);
    const draggableId = await firstCard.getAttribute("data-rfd-draggable-id");
    expect(draggableId, "card must expose a draggable id").toBeTruthy();

    await firstCard.click();
    await page.getByRole("link", { name: "Edit", exact: true }).click();

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
    await closeDealDialog(page);
    await expect(dealCards(page).first()).toBeVisible();

    const card = page.locator(`[data-rfd-draggable-id="${draggableId}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByLabel("Propensity to buy: High")).toBeVisible();
  });

  test("AC3-override: a manually-overridden card tooltip says 'Set manually'", async ({
    page,
  }) => {
    // override one active-stage card to Medium so we have a known manual
    // bucket to probe (closed-stage cards suppress the badge entirely).
    const firstCard = await firstActiveCard(page);
    const draggableId = await firstCard.getAttribute("data-rfd-draggable-id");
    expect(draggableId).toBeTruthy();

    await firstCard.click();
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    const editDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Linked to" });
    await editDialog
      .getByRole("combobox", { name: "Propensity to buy" })
      .click();
    await page.getByRole("option", { name: "Medium", exact: true }).click();
    await editDialog.getByRole("button", { name: "Save" }).click();

    await closeDealDialog(page);
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
    // 1. force a known bucket on an active-stage card (closed stages
    //    suppress the badge; see idea-12).
    const firstCard = await firstActiveCard(page);
    const draggableId = await firstCard.getAttribute("data-rfd-draggable-id");
    expect(draggableId).toBeTruthy();

    await firstCard.click();
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    const openEditDialog = () =>
      page.getByRole("dialog").filter({ hasText: "Linked to" });
    let editDialog = openEditDialog();
    await editDialog
      .getByRole("combobox", { name: "Propensity to buy" })
      .click();
    await page.getByRole("option", { name: "Low", exact: true }).click();
    await editDialog.getByRole("button", { name: "Save" }).click();

    // verify the forced bucket shows up
    await closeDealDialog(page);
    const card = page.locator(`[data-rfd-draggable-id="${draggableId}"]`);
    await expect(card.getByLabel("Propensity to buy: Low")).toBeVisible();

    // 2. open the edit form again and switch back to Auto
    await card.click();
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    editDialog = openEditDialog();
    const selector = editDialog.getByRole("combobox", {
      name: "Propensity to buy",
    });
    await selector.click();
    await page.getByRole("option", { name: "Auto", exact: true }).click();
    await expect(selector).toContainText("Auto");
    await editDialog.getByRole("button", { name: "Save" }).click();

    // 3. back on the board, the card tooltip no longer reports a manual override
    await closeDealDialog(page);
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
