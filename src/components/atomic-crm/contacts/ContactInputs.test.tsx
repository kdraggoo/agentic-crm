/**
 * Unit tests for the 'Last name unknown' shortcut added to ContactInputs.
 *
 * AC5: translation keys must be present in both message catalogs.
 * Additional coverage: the email-to-name prefill only fills each name field
 * when it is empty, so clicking LNU then entering an email fills first_name
 * but leaves last_name as 'LNU'.
 */

import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { englishCrmMessages } from "../providers/commons/englishCrmMessages";
import { frenchCrmMessages } from "../providers/commons/frenchCrmMessages";
import { ContactCreateBasic } from "./ContactCreate.stories";

// ---------------------------------------------------------------------------
// AC5 – i18n keys
// ---------------------------------------------------------------------------
describe("LNU shortcut i18n keys (AC5)", () => {
  it("has the English translation key resources.contacts.inputs.last_name_unknown with value 'Last name unknown'", () => {
    expect(englishCrmMessages.resources.contacts.inputs.last_name_unknown).toBe(
      "Last name unknown",
    );
  });

  it("has the French translation key resources.contacts.inputs.last_name_unknown with value 'Nom de famille inconnu'", () => {
    expect(frenchCrmMessages.resources.contacts.inputs.last_name_unknown).toBe(
      "Nom de famille inconnu",
    );
  });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------
describe("ContactInputs LNU shortcut (component)", () => {
  it("shows the 'Last name unknown' button in the contact create form", async () => {
    const screen = await render(<ContactCreateBasic />);

    await expect
      .element(screen.getByRole("button", { name: "Last name unknown" }))
      .toBeVisible();
  });

  it("clicking the shortcut fills Last name with 'LNU' and clears the required error", async () => {
    const screen = await render(<ContactCreateBasic />);

    // Trigger required-field error by submitting without values.
    await screen.getByRole("button", { name: /^save$/i }).click();

    // The Last name group is the role="group" div that contains the label text "Last name".
    const lastNameGroup = screen
      .getByRole("group")
      .filter({ hasText: "Last name" })
      .filter({ hasNot: screen.getByLabelText(/first name/i) });
    await expect.element(lastNameGroup.getByText("Required")).toBeVisible();

    await screen.getByRole("button", { name: "Last name unknown" }).click();
    await expect
      .element(screen.getByLabelText(/last name/i))
      .toHaveValue("LNU");
    await expect
      .element(lastNameGroup.getByText("Required"))
      .not.toBeInTheDocument();
  });

  it("the shortcut does not force Last name back after the user clears and types something else", async () => {
    const screen = await render(<ContactCreateBasic />);

    await screen.getByRole("button", { name: "Last name unknown" }).click();
    await expect
      .element(screen.getByLabelText(/last name/i))
      .toHaveValue("LNU");

    await screen.getByLabelText(/last name/i).fill("Smith");
    await expect
      .element(screen.getByLabelText(/last name/i))
      .toHaveValue("Smith");

    // Shortcut is still visible for a second click.
    await expect
      .element(screen.getByRole("button", { name: "Last name unknown" }))
      .toBeVisible();
  });

  it("fills first_name from email even when last_name is already 'LNU'", async () => {
    const screen = await render(<ContactCreateBasic />);

    await screen.getByRole("button", { name: "Last name unknown" }).click();
    await expect
      .element(screen.getByLabelText(/last name/i))
      .toHaveValue("LNU");
    await expect.element(screen.getByLabelText(/first name/i)).toHaveValue("");

    const emailInput = screen.getByPlaceholder("Email").first();
    await emailInput.fill("ada.lovelace@example.com");
    await userEvent.keyboard("{Tab}");

    await expect
      .element(screen.getByLabelText(/first name/i))
      .toHaveValue("Ada");
    await expect
      .element(screen.getByLabelText(/last name/i))
      .toHaveValue("LNU");
  });

  it("does not overwrite a non-empty first_name when email is entered with LNU set", async () => {
    const screen = await render(<ContactCreateBasic />);

    await screen.getByLabelText(/first name/i).fill("Jane");
    await screen.getByRole("button", { name: "Last name unknown" }).click();

    const emailInput = screen.getByPlaceholder("Email").first();
    await emailInput.fill("ada.lovelace@example.com");
    await userEvent.keyboard("{Tab}");

    // first_name must not be overwritten
    await expect
      .element(screen.getByLabelText(/first name/i))
      .toHaveValue("Jane");
    await expect
      .element(screen.getByLabelText(/last name/i))
      .toHaveValue("LNU");
  });
});
