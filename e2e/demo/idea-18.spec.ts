import { expect, test, type Page } from "@playwright/test";

// Helper: navigate to Settings page via the user menu
async function goToSettings(page: Page) {
  // The user menu trigger is a round avatar button in the header
  const userMenuButton = page.locator("button.rounded-full").last();
  await userMenuButton.click();
  // Click the Settings menu item
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/#\/settings/);
  // Wait for the settings page heading to load
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
}

// Helper: navigate to the Products section in Settings
async function goToSettingsProducts(page: Page) {
  await goToSettings(page);
  // Click the "Products" sidebar navigation button
  await page.getByRole("button", { name: "Products", exact: true }).click();
  // Wait for the Products section heading
  await expect(
    page.getByRole("heading", { name: "Products", exact: true }),
  ).toBeVisible();
}

// Helper: navigate to the Deals Kanban page and wait for loaded state
async function goToDeals(page: Page) {
  await page.getByRole("link", { name: "Deals", exact: true }).click();
  await expect(page).toHaveURL(/#\/deals/);
  await expect(
    page.getByRole("heading", { name: "Opportunity" }),
  ).toBeVisible();
}

// Helper: open the deal create dialog and wait for it to load
async function openDealCreateDialog(page: Page) {
  await goToDeals(page);
  // Wait for the deal list to have fully loaded (draggable cards present)
  await expect(page.locator("[data-rfd-draggable-id]").first()).toBeVisible();
  // "New Deal" is rendered as a link (CreateButton uses LinkBase)
  await page.getByRole("link", { name: "New Deal" }).click();
  // Wait for the dialog to appear and the form to load (identity must resolve
  // before the form renders). The Description field uses source="description"
  // which translates to "Description". Use a generous timeout.
  await expect(page.getByLabel("Description")).toBeVisible({ timeout: 10_000 });
}

test.describe("Products catalog and deal line items", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for dashboard to confirm we are logged in as the demo admin
    await expect(
      page.getByRole("heading", { name: "Latest Activity" }),
    ).toBeVisible();
  });

  // ─── AC1 ──────────────────────────────────────────────────────────────
  test("AC1: admin can see a 'Products' section in Settings sidebar", async ({
    page,
  }) => {
    await goToSettings(page);
    // The left sidebar should have a "Products" navigation entry
    await expect(
      page.getByRole("button", { name: "Products", exact: true }),
    ).toBeVisible();
  });

  // ─── AC2 ──────────────────────────────────────────────────────────────
  test("AC2: admin can create a product with Name and Unit price", async ({
    page,
  }) => {
    await goToSettingsProducts(page);

    // Click the button to add / create a new product
    await page
      .getByRole("button", { name: /add|create|new/i })
      .first()
      .click();

    // Fill required Name
    await page.getByLabel("Name", { exact: true }).fill("Test Widget");

    // Fill required Unit price
    await page.getByLabel("Unit price").fill("49.99");

    // Fill optional SKU
    await page.getByLabel("SKU").fill("SKU-TEST-001");

    // Category dropdown (sourced from dealCategories)
    const categoryInput = page.getByLabel("Category");
    if (await categoryInput.isVisible()) {
      await categoryInput.click();
      // Pick the first available option in the dropdown
      await page.getByRole("option").first().click();
    }

    // Save
    await page.getByRole("button", { name: /save/i }).click();

    // The new product should appear in the list
    await expect(page.getByText("Test Widget")).toBeVisible();
    await expect(page.getByText("SKU-TEST-001")).toBeVisible();
  });

  // ─── AC3 ──────────────────────────────────────────────────────────────
  test("AC3: editing a product saves immediately (like Tags pattern)", async ({
    page,
  }) => {
    await goToSettingsProducts(page);

    // Wait for at least one product to appear (demo data seeds ~15)
    await expect(
      page.getByRole("button", { name: /edit/i }).first(),
    ).toBeVisible();

    // Click the edit button on the first product
    await page.getByRole("button", { name: /edit/i }).first().click();

    // Change the Name field
    const nameInput = page.getByLabel("Name", { exact: true });
    await expect(nameInput).toBeVisible();
    await nameInput.clear();
    await nameInput.fill("Edited Product Name");

    // Save (immediate save may use a Save button in a dialog/inline)
    const saveButton = page.getByRole("button", { name: /save/i });
    if (await saveButton.isVisible()) {
      await saveButton.click();
    }

    // Confirm the edited name is visible in the list
    await expect(page.getByText("Edited Product Name")).toBeVisible();
  });

  // ─── AC4 ──────────────────────────────────────────────────────────────
  test("AC4: admin can archive a product; archived products appear separately and can be unarchived", async ({
    page,
  }) => {
    await goToSettingsProducts(page);

    // Wait for at least one product action
    await expect(
      page.getByRole("button", { name: /archive/i }).first(),
    ).toBeVisible();

    // Archive the first product
    await page
      .getByRole("button", { name: /archive/i })
      .first()
      .click();

    // An "Archived" subsection or badge should now be visible
    await expect(page.getByText("Archived", { exact: true })).toBeVisible();

    // Unarchive should be available on archived products
    await expect(
      page.getByRole("button", { name: /unarchive/i }).first(),
    ).toBeVisible();
  });

  // ─── AC5 ──────────────────────────────────────────────────────────────
  test("AC5: products list shows expected columns and supports text search", async ({
    page,
  }) => {
    await goToSettingsProducts(page);

    // Verify column headers / field labels
    await expect(page.getByText("Name", { exact: true })).toBeVisible();
    await expect(page.getByText("SKU", { exact: true })).toBeVisible();
    await expect(page.getByText("Category", { exact: true })).toBeVisible();
    await expect(page.getByText("Unit price")).toBeVisible();

    // At least one product should show a SKU like SKU-XXXX
    await expect(page.getByText(/SKU-\w+/).first()).toBeVisible();

    // Text search
    const searchInput = page
      .getByRole("searchbox")
      .or(page.getByPlaceholder(/search/i));
    await searchInput.fill("SKU");
    // Results should still show SKU matches
    await expect(page.getByText(/SKU-\w+/).first()).toBeVisible();
  });

  // ─── AC6 ──────────────────────────────────────────────────────────────
  test("AC6: deal create form has a Line items section with Product picker, Quantity and Unit price", async ({
    page,
  }) => {
    await openDealCreateDialog(page);

    // The Line items section heading should be present
    await expect(page.getByText("Line items")).toBeVisible();

    // Click the add-line-item button
    await page
      .getByRole("button", { name: /add/i })
      .filter({ hasText: /line item|item|product|add/i })
      .first()
      .click();

    // A Product picker should appear
    await expect(
      page
        .getByLabel("Product")
        .or(page.getByRole("combobox", { name: /product/i })),
    ).toBeVisible();

    // Quantity input with default value 1
    const quantityInput = page.getByLabel("Quantity");
    await expect(quantityInput).toBeVisible();
    await expect(quantityInput).toHaveValue("1");

    // Unit price input
    await expect(page.getByLabel("Unit price")).toBeVisible();
  });

  // ─── AC7 ──────────────────────────────────────────────────────────────
  test("AC7: line row shows line total; Line items total summary appears next to Budget field", async ({
    page,
  }) => {
    await openDealCreateDialog(page);

    // Add a line item
    await page
      .getByRole("button", { name: /add/i })
      .filter({ hasText: /line item|item|product|add/i })
      .first()
      .click();

    // Pick a product
    const productPicker = page
      .getByLabel("Product")
      .or(page.getByRole("combobox", { name: /product/i }));
    await productPicker.click();
    await page.getByRole("option").first().click();

    // Set quantity to 3
    const quantityInput = page.getByLabel("Quantity");
    await quantityInput.clear();
    await quantityInput.fill("3");

    // A currency-formatted line total should be visible somewhere in the row
    // (product prices are random, so we just check for a formatted currency number)
    await expect(page.locator("text=/\\$[\\d,.]+/").first()).toBeVisible();

    // "Line items total" summary should appear
    await expect(page.getByText("Line items total")).toBeVisible();
  });

  // ─── AC8 ──────────────────────────────────────────────────────────────
  test("AC8: deal with no line items shows Line items section but not Line items total", async ({
    page,
  }) => {
    await openDealCreateDialog(page);

    // The Line items section should exist on the form (new feature)
    await expect(page.getByText("Line items")).toBeVisible();

    // But without adding any line items, the total summary must NOT appear
    await expect(page.getByText("Line items total")).not.toBeVisible();
  });

  // ─── AC9 ──────────────────────────────────────────────────────────────
  test("AC9: same product can appear on multiple deal lines", async ({
    page,
  }) => {
    await openDealCreateDialog(page);

    const addButton = page
      .getByRole("button", { name: /add/i })
      .filter({ hasText: /line item|item|product|add/i })
      .first();

    // Add first line item
    await addButton.click();
    const firstPicker = page
      .getByLabel("Product")
      .or(page.getByRole("combobox", { name: /product/i }))
      .first();
    await firstPicker.click();
    const firstOption = page.getByRole("option").first();
    const productName = await firstOption.textContent();
    await firstOption.click();

    // Add second line item with the same product
    await addButton.click();
    const secondPicker = page
      .getByLabel("Product")
      .or(page.getByRole("combobox", { name: /product/i }))
      .last();
    await secondPicker.click();
    await page.getByRole("option", { name: productName! }).click();

    // Both rows should show the same product name
    const productCells = page
      .locator('[data-slot="select-value"]')
      .getByText(productName!, { exact: true });
    await expect(productCells).toHaveCount(2);
  });

  // ─── AC10 ─────────────────────────────────────────────────────────────
  test("AC10: deal detail shows attached line items with product name, quantity, unit price and line total", async ({
    page,
  }) => {
    await goToDeals(page);

    // Wait for deal cards
    await expect(page.locator("[data-rfd-draggable-id]").first()).toBeVisible();

    // Click through deal cards to find one with line items (~50% have them)
    let foundLineItems = false;
    const dealCards = page.locator("[data-rfd-draggable-id]");
    const count = await dealCards.count();

    for (let i = 0; i < Math.min(count, 10); i++) {
      await dealCards.nth(i).click();
      // Wait for the deal show dialog to render (Budget label from
      // resources.deals.fields.amount = "Budget")
      await expect(page.getByText("Budget")).toBeVisible();

      const hasItems = await expect(page.getByText("Line items total"))
        .toBeVisible({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (hasItems) {
        foundLineItems = true;
        break;
      }

      // Close dialog
      await page.keyboard.press("Escape");
      await expect(
        page.locator("[data-rfd-draggable-id]").first(),
      ).toBeVisible();
    }

    expect(foundLineItems).toBe(true);
  });

  // ─── AC11 ─────────────────────────────────────────────────────────────
  test("AC11: deleting the last line item clears the computed total; Budget stays unchanged", async ({
    page,
  }) => {
    await openDealCreateDialog(page);

    // Set a manual Budget (the Amount field's label is "Budget")
    const budgetInput = page.getByLabel("Budget");
    await budgetInput.clear();
    await budgetInput.fill("5000");

    // Add a line item
    await page
      .getByRole("button", { name: /add/i })
      .filter({ hasText: /line item|item|product|add/i })
      .first()
      .click();

    // Pick a product
    const productPicker = page
      .getByLabel("Product")
      .or(page.getByRole("combobox", { name: /product/i }));
    await productPicker.click();
    await page.getByRole("option").first().click();

    // Verify Line items total appears
    await expect(page.getByText("Line items total")).toBeVisible();

    // Delete the line item
    await page
      .getByRole("button", { name: /remove|delete/i })
      .first()
      .click();

    // Line items total should disappear
    await expect(page.getByText("Line items total")).not.toBeVisible();

    // Budget should remain
    await expect(budgetInput).toHaveValue("5000");
  });

  // ─── AC12 ─────────────────────────────────────────────────────────────
  test("AC12: FakeRest demo has generated products with at least one archived", async ({
    page,
  }) => {
    await goToSettingsProducts(page);

    // Multiple products should be visible (demo seeds ~15)
    await expect(
      page.getByRole("button", { name: /edit/i }).first(),
    ).toBeVisible();

    // At least one product should carry an "Archived" badge
    await expect(page.getByText("Archived").first()).toBeVisible();
  });

  test("AC12: FakeRest demo deals include line items on roughly half", async ({
    page,
  }) => {
    await goToDeals(page);

    await expect(page.locator("[data-rfd-draggable-id]").first()).toBeVisible();

    // Open deal cards until we find one with line items
    let foundLineItems = false;
    const dealCards = page.locator("[data-rfd-draggable-id]");
    const count = await dealCards.count();

    for (let i = 0; i < Math.min(count, 10); i++) {
      await dealCards.nth(i).click();
      // Wait for deal show dialog (Budget label)
      await expect(page.getByText("Budget")).toBeVisible();

      const hasItems = await expect(page.getByText("Line items total"))
        .toBeVisible({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (hasItems) {
        foundLineItems = true;
        break;
      }

      await page.keyboard.press("Escape");
      await expect(
        page.locator("[data-rfd-draggable-id]").first(),
      ).toBeVisible();
    }

    expect(foundLineItems).toBe(true);
  });
});
