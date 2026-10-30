import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Acceptance tests for idea-5: 'Last name unknown' shortcut on the contact form.
 *
 * Mirrors demoSmoke.spec.ts: runs against the static FakeRest demo build (see
 * playwright.demo.config.ts). The demo auto-logs in as the admin and generates
 * random data on every load (faker is not seeded), so these tests assert the
 * shortcut's behavior and never specific generated names or counts.
 */

const CREATE_URL = "/#/contacts/create";
const LIST_URL = "/#/contacts";

// English label the spec sets for the shortcut; the French key is
// 'Nom de famille inconnu' per the spec. The build agent chooses the HTML
// element; this suite assumes the shortcut is reachable by its accessible name
// as either a button or a link (see assumptions in the task report).
const LNU_LINK_NAME = "Last name unknown";
const LNU_VALUE = "LNU";

const getLnuShortcut = (scope: Page | Locator): Locator =>
  scope
    .getByRole("button", { name: LNU_LINK_NAME })
    .or(scope.getByRole("link", { name: LNU_LINK_NAME }));

test.describe("idea-5: 'Last name unknown' shortcut on the contact form", () => {
  test("AC1: desktop contact create form shows the 'Last name unknown' shortcut near the Last name input", async ({
    page,
  }) => {
    await page.goto(CREATE_URL);

    await expect(page.getByLabel("Last name")).toBeVisible();
    await expect(getLnuShortcut(page)).toBeVisible();
  });

  test("AC2: clicking the shortcut fills Last name with 'LNU' and clears the required-field error", async ({
    page,
  }) => {
    await page.goto(CREATE_URL);
    const lastName = page.getByLabel("Last name");

    // Trigger the required-field error by submitting the empty form.
    await page
      .getByRole("button", { name: "Save", exact: true })
      .first()
      .click();

    const lastNameGroup = page
      .getByRole("group")
      .filter({ has: page.getByLabel("Last name") });
    const requiredError = lastNameGroup.getByText("Required");
    await expect(requiredError).toBeVisible();
    await expect(lastName).toHaveValue("");

    // Now use the shortcut and verify both the value and the cleared error.
    await getLnuShortcut(page).click();
    await expect(lastName).toHaveValue(LNU_VALUE);
    await expect(requiredError).toHaveCount(0);
  });

  test("AC3a: desktop contact edit form exposes the shortcut and it fills 'LNU'", async ({
    page,
  }) => {
    // Pick any existing demo contact and open its edit page. In ra-core the
    // edit route is :id/* (no "/edit" suffix); see useCreatePath.
    await page.goto(LIST_URL);
    await page.locator('a[href^="#/contacts/"][href$="/show"]').first().click();
    await expect(page).toHaveURL(/#\/contacts\/[^/]+\/show/);

    await page.getByRole("link", { name: "Edit contact" }).click();
    await expect(page).toHaveURL(/#\/contacts\/[^/]+$/);

    const lastName = page.getByLabel("Last name");
    await expect(lastName).toBeVisible();

    // Clear whatever random surname the demo generated for this contact.
    await lastName.fill("");

    await getLnuShortcut(page).click();
    await expect(lastName).toHaveValue(LNU_VALUE);
  });

  test("AC4: saving a contact after clicking the shortcut stores last_name='LNU' and the contact shows up in the list", async ({
    page,
  }) => {
    await page.goto(CREATE_URL);

    // A per-test unique first name lets us find the contact without relying on
    // other randomly generated demo data.
    const uniqueFirstName = `Lnutest${Date.now()}`;
    await page.getByLabel("First name").fill(uniqueFirstName);

    await getLnuShortcut(page).click();
    await expect(page.getByLabel("Last name")).toHaveValue(LNU_VALUE);

    // Account manager defaults to the auto-logged-in identity; no further
    // input is required to save.
    await page
      .getByRole("button", { name: "Save", exact: true })
      .first()
      .click();

    // The create form redirects to the show page where the heading uses the
    // record representation ("<first_name> <last_name>").
    await expect(page).toHaveURL(/#\/contacts\/[^/]+\/show/);
    await expect(
      page.getByRole("heading", { name: `${uniqueFirstName} LNU` }),
    ).toBeVisible();

    // The contact also appears in the list (sorted by last_seen DESC, so the
    // just-created contact comes first).
    await page.goto(LIST_URL);
    await expect(
      page.getByText(`${uniqueFirstName} LNU`, { exact: true }).first(),
    ).toBeVisible();
  });

  test("AC6: the shortcut does not break the email-to-name prefill; LNU is kept and First name is still filled when empty", async ({
    page,
  }) => {
    await page.goto(CREATE_URL);

    await getLnuShortcut(page).click();
    await expect(page.getByLabel("Last name")).toHaveValue(LNU_VALUE);
    await expect(page.getByLabel("First name")).toHaveValue("");

    // Enter an email with a 'first.last' local part and blur to trigger the
    // existing prefill logic (ContactInputs handleEmailBlur).
    const emailInput = page.getByPlaceholder("Email", { exact: true }).first();
    await emailInput.fill("ada.lovelace@example.com");
    await emailInput.press("Tab");

    await expect(page.getByLabel("First name")).toHaveValue("Ada");
    await expect(page.getByLabel("Last name")).toHaveValue(LNU_VALUE);
  });

  test("AC7: the shortcut does not force the Last name value back after the user clears it", async ({
    page,
  }) => {
    await page.goto(CREATE_URL);
    const lastName = page.getByLabel("Last name");

    await getLnuShortcut(page).click();
    await expect(lastName).toHaveValue(LNU_VALUE);

    await lastName.fill("");
    await expect(lastName).toHaveValue("");

    await lastName.fill("Smith");
    await expect(lastName).toHaveValue("Smith");

    // The shortcut remains visible so it can be clicked again later.
    await expect(getLnuShortcut(page)).toBeVisible();
  });

  // --- Mobile sheets ----------------------------------------------------
  // AC3 also requires the shortcut on the mobile ContactCreateSheet and
  // ContactEditSheet. The useIsMobile hook flips to mobile below 768px.
  test.describe("mobile sheets (AC3b/AC3c)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("AC3b: mobile ContactCreateSheet exposes the shortcut and it fills 'LNU'", async ({
      page,
    }) => {
      await page.goto("/");

      // Mobile bottom nav: the '+' button (aria-label 'Create') opens a
      // dropdown with 'Contact', 'Note', 'Task'.
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await page.getByRole("menuitem", { name: "Contact" }).click();

      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();

      const lastName = sheet.getByLabel("Last name");
      await expect(lastName).toBeVisible();

      await getLnuShortcut(sheet).click();
      await expect(lastName).toHaveValue(LNU_VALUE);
    });

    test("AC3c: mobile ContactEditSheet exposes the shortcut and it fills 'LNU'", async ({
      page,
    }) => {
      await page.goto(LIST_URL);
      // Open the first contact's show page.
      await page.locator('a[href^="#/contacts/"]').first().click();
      await expect(page).toHaveURL(/#\/contacts\/[^/]+\/show/);

      // Mobile header pencil icon: aria-label is 'Edit'.
      await page
        .getByRole("button", { name: "Edit", exact: true })
        .first()
        .click();

      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();

      const lastName = sheet.getByLabel("Last name");
      await lastName.fill("");

      await getLnuShortcut(sheet).click();
      await expect(lastName).toHaveValue(LNU_VALUE);
    });
  });
});
