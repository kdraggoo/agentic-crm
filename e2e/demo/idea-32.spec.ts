import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Runs against the static FakeRest demo build (see playwright.demo.config.ts).
// The demo auto-logs in as the admin and generates random data on every load.
// These tests verify that the Products table column headers align with the
// data values below them (no extra padding on the header row).

/**
 * Navigate to Settings → Products.
 * Opens the user menu, clicks Settings, then clicks the Products nav item.
 * Waits for product data to load before returning.
 */
async function navigateToSettingsProducts(page: Page) {
  await page.goto("/");
  // Wait for the dashboard to load so the user menu is available
  await expect(
    page.getByRole("heading", { name: "Latest Activity" }),
  ).toBeVisible();

  // Open the user menu (avatar button in top-right)
  await page.locator("button.rounded-full").last().click();

  // Click "Settings" in the dropdown
  await page.getByRole("menuitem", { name: "Settings" }).click();

  await expect(page).toHaveURL(/#\/settings/);

  // Click the "Products" nav button in the left sidebar to switch to the
  // standalone Products section
  await page.getByRole("button", { name: "Products", exact: true }).click();

  // Wait for the Products section heading and at least one product row to load
  await expect(
    page.getByRole("heading", { name: "Products", exact: true }),
  ).toBeVisible();
  // Wait for a product name to appear (the first active row)
  await expect(
    page.locator("#products .grid.items-center").first(),
  ).toBeVisible();
}

test.describe("Settings → Products column header alignment", () => {
  test("AC1: Name header aligns horizontally with the product name values below it", async ({
    page,
  }) => {
    await navigateToSettingsProducts(page);

    // The header row is a grid div with text-xs class containing column labels.
    // The data rows are grid divs with items-center class containing values.
    // After the fix, the header row should NOT have px-1 class,
    // so the left edge of the Name header matches the left edge of name values.
    const headerRow = page.locator("#products .grid.text-xs");
    const firstDataRow = page.locator("#products .grid.items-center").first();

    await expect(headerRow).toBeVisible();
    await expect(firstDataRow).toBeVisible();

    // Get the computed paddingLeft of both rows — they should match
    const headerPaddingLeft = await headerRow.evaluate(
      (el) => window.getComputedStyle(el).paddingLeft,
    );
    const dataPaddingLeft = await firstDataRow.evaluate(
      (el) => window.getComputedStyle(el).paddingLeft,
    );
    expect(headerPaddingLeft).toBe(dataPaddingLeft);

    // Also verify via bounding boxes: the Name header text and first name
    // value should have the same left position (within 1px tolerance)
    const headerNameSpan = headerRow.locator("span").first();
    const dataNameSpan = firstDataRow.locator("span").first();
    const headerBox = await headerNameSpan.boundingBox();
    const dataBox = await dataNameSpan.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(dataBox).not.toBeNull();
    expect(Math.abs(headerBox!.x - dataBox!.x)).toBeLessThanOrEqual(1);
  });

  test("AC2: SKU, Category, and Unit price headers each align with their respective column values", async ({
    page,
  }) => {
    await navigateToSettingsProducts(page);

    const headerRow = page.locator("#products .grid.text-xs");
    const firstDataRow = page.locator("#products .grid.items-center").first();

    await expect(headerRow).toBeVisible();
    await expect(firstDataRow).toBeVisible();

    // Get bounding boxes of each header span (Name, SKU, Category, Unit price)
    const headerSpans = headerRow.locator("span");
    const dataSpans = firstDataRow.locator("span");

    // Columns: 0=Name, 1=SKU, 2=Category, 3=Unit price
    // (there's a 5th empty span in the header for the action column)
    for (const colIndex of [1, 2, 3]) {
      const headerBox = await headerSpans.nth(colIndex).boundingBox();
      const dataBox = await dataSpans.nth(colIndex).boundingBox();
      expect(headerBox).not.toBeNull();
      expect(dataBox).not.toBeNull();
      expect(Math.abs(headerBox!.x - dataBox!.x)).toBeLessThanOrEqual(1);
    }
  });

  test("AC3: The fix applies to both the active and archived product sections", async ({
    page,
  }) => {
    await navigateToSettingsProducts(page);

    const headerRow = page.locator("#products .grid.text-xs");
    await expect(headerRow).toBeVisible();

    // The header row should not have px-1 class (the source of the bug)
    const headerClasses = await headerRow.getAttribute("class");
    expect(headerClasses).not.toContain("px-1");

    // The archived section heading should be visible (demo guarantees at
    // least one archived product)
    const archivedHeading = page.getByRole("heading", {
      name: "Archived",
      exact: true,
    });
    await expect(archivedHeading).toBeVisible();

    // Verify active product rows exist and share alignment with the header
    const activeRow = page
      .locator("#products .grid.items-center:not(.opacity-60)")
      .first();
    await expect(activeRow).toBeVisible();

    const headerNameBox = await headerRow.locator("span").first().boundingBox();
    const activeNameBox = await activeRow.locator("span").first().boundingBox();
    expect(headerNameBox).not.toBeNull();
    expect(activeNameBox).not.toBeNull();
    expect(Math.abs(headerNameBox!.x - activeNameBox!.x)).toBeLessThanOrEqual(
      1,
    );

    // Verify archived product rows also share alignment with the header
    const archivedRow = page.locator("#products .grid.opacity-60").first();
    await expect(archivedRow).toBeVisible();

    const archivedNameBox = await archivedRow
      .locator("span")
      .first()
      .boundingBox();
    expect(archivedNameBox).not.toBeNull();
    expect(Math.abs(headerNameBox!.x - archivedNameBox!.x)).toBeLessThanOrEqual(
      1,
    );
  });

  test("AC4: The archived section header row inherits the same alignment", async ({
    page,
  }) => {
    await navigateToSettingsProducts(page);

    // Since there is only one shared header row for both active and archived
    // sections, this test verifies that the single header row aligns with
    // archived product rows (same grid template, same padding).
    const headerRow = page.locator("#products .grid.text-xs");
    await expect(headerRow).toBeVisible();

    // Verify the header has no extra horizontal padding (no px-1)
    const headerPaddingLeft = await headerRow.evaluate(
      (el) => window.getComputedStyle(el).paddingLeft,
    );
    const headerPaddingRight = await headerRow.evaluate(
      (el) => window.getComputedStyle(el).paddingRight,
    );
    // After the fix, padding should be 0px (no px-1 = no 4px padding)
    expect(headerPaddingLeft).toBe("0px");
    expect(headerPaddingRight).toBe("0px");

    // Verify archived rows share the same padding
    const archivedRow = page.locator("#products .grid.opacity-60").first();
    await expect(archivedRow).toBeVisible();

    const archivedPaddingLeft = await archivedRow.evaluate(
      (el) => window.getComputedStyle(el).paddingLeft,
    );
    expect(headerPaddingLeft).toBe(archivedPaddingLeft);
  });
});
