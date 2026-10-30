import { expect, test } from "@playwright/test";

// Runs against the static FakeRest demo build (see playwright.demo.config.ts).
// The demo auto-logs in as the admin and generates random data on every load
// (faker is not seeded), so these tests assert structure, never specific names.

test.describe("demo build smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("dashboard renders for the auto-logged-in demo admin", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Latest Activity" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Upcoming Tasks" }),
    ).toBeVisible();
  });

  test("contacts list shows contact rows", async ({ page }) => {
    await page.getByRole("link", { name: "Contacts", exact: true }).click();

    await expect(page).toHaveURL(/#\/contacts/);
    await expect(
      page.locator('a[href^="#/contacts/"][href$="/show"]').first(),
    ).toBeVisible();
  });

  test("companies list shows company cards", async ({ page }) => {
    await page.getByRole("link", { name: "Companies", exact: true }).click();

    await expect(page).toHaveURL(/#\/companies/);
    await expect(
      page.locator('a[href^="#/companies/"][href$="/show"]').first(),
    ).toBeVisible();
  });

  test("deals Kanban shows stage columns with deal cards", async ({ page }) => {
    await page.getByRole("link", { name: "Deals", exact: true }).click();

    await expect(page).toHaveURL(/#\/deals/);
    for (const stage of ["Opportunity", "Proposal Sent", "Won", "Lost"]) {
      await expect(page.getByRole("heading", { name: stage })).toBeVisible();
    }
    await expect(page.locator("[data-rfd-draggable-id]").first()).toBeVisible();
  });
});
