import { afterEach, describe, expect, it, vi } from "vitest";
import { englishCrmMessages } from "./englishCrmMessages";
import { frenchCrmMessages } from "./frenchCrmMessages";
import { getInitialLocale, i18nProvider } from "./i18nProvider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("i18nProvider", () => {
  it("registers en and fr locales", () => {
    expect(i18nProvider.getLocales?.()).toEqual([
      { locale: "en", name: "English" },
      { locale: "fr", name: "Français" },
    ]);
  });

  it("translates the language key in french", async () => {
    await i18nProvider.changeLocale("fr");

    expect(i18nProvider.translate("crm.language")).toBe("Langue");
  });

  it("falls back to english for unknown locales", async () => {
    await i18nProvider.changeLocale("es");

    expect(i18nProvider.translate("crm.language")).toBe("Language");
  });

  it("uses customized password reset overrides for en and fr", async () => {
    await i18nProvider.changeLocale("en");
    expect(i18nProvider.translate("ra-supabase.auth.password_reset")).toBe(
      "Check your emails for a Reset Password message.",
    );

    await i18nProvider.changeLocale("fr");
    expect(i18nProvider.translate("ra-supabase.auth.password_reset")).toBe(
      "Consultez vos emails pour trouver le message de reinitialisation du mot de passe.",
    );
  });

  it("translates recently added fr crm keys", async () => {
    await i18nProvider.changeLocale("fr");

    expect(i18nProvider.translate("resources.deals.empty.title")).toBe(
      "Aucune affaire trouvée",
    );
  });

  it("uses browser french locale when available", () => {
    vi.stubGlobal("navigator", {
      language: "fr-FR",
      languages: ["fr-FR", "en-US"],
    });

    expect(getInitialLocale()).toBe("fr");
  });

  it("falls back to english when browser locale is unsupported", () => {
    vi.stubGlobal("navigator", {
      language: "es-ES",
      languages: ["es-ES", "pt-BR"],
    });

    expect(getInitialLocale()).toBe("en");
  });

  it("defines the propensity keys in both english and french catalogs (AC-11)", async () => {
    const englishKeys = flattenKeys(englishCrmMessages.crm.propensity);
    const frenchKeys = flattenKeys(frenchCrmMessages.crm.propensity);

    // Both catalogs must carry the same keys under crm.propensity; otherwise
    // one locale would silently fall back to another and ship the wrong text.
    expect(frenchKeys).toEqual(englishKeys);

    // And every bucket + factor key must translate to a non-empty string on
    // both sides. We check French explicitly because English is the source.
    await i18nProvider.changeLocale("fr");
    for (const bucket of ["low", "medium", "high"] as const) {
      expect(
        i18nProvider.translate(`crm.propensity.buckets.${bucket}`),
      ).toMatch(/\S/);
    }
    for (const factor of [
      "stage",
      "activityRecency",
      "amount",
      "dealNoteRecency",
      "closingSoon",
    ] as const) {
      expect(
        i18nProvider.translate(`crm.propensity.factors.${factor}`),
      ).toMatch(/\S/);
    }
    expect(i18nProvider.translate("crm.propensity.manual_override")).toMatch(
      /\S/,
    );
    expect(
      i18nProvider.translate("crm.propensity.override_options.auto"),
    ).toMatch(/\S/);
  });
});

/** Recursively collect dotted keys from a nested message object. */
const flattenKeys = (obj: Record<string, unknown>, prefix = ""): string[] => {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenKeys(value as Record<string, unknown>, full));
    } else {
      out.push(full);
    }
  }
  return out.sort();
};
