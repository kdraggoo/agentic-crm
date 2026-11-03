import { describe, expect, it } from "vitest";
import { englishCrmMessages } from "../providers/commons/englishCrmMessages";
import { frenchCrmMessages } from "../providers/commons/frenchCrmMessages";

/**
 * Verify that every date range filter translation key exists in both the
 * English and French catalogs (AC10).
 */
describe("date range filter translation keys", () => {
  const requiredKeys = [
    "created_date",
    "this_month",
    "this_quarter",
    "next_month",
    "next_quarter",
    "custom",
    "from",
    "to",
  ] as const;

  const enFilters = englishCrmMessages.resources.deals.filters;
  const frFilters = frenchCrmMessages.resources.deals.filters;

  for (const key of requiredKeys) {
    it(`English catalog has "${key}"`, () => {
      expect(enFilters).toHaveProperty(key);
      expect(typeof enFilters[key]).toBe("string");
      expect(enFilters[key].length).toBeGreaterThan(0);
    });

    it(`French catalog has "${key}"`, () => {
      expect(frFilters).toHaveProperty(key);
      expect(typeof frFilters[key]).toBe("string");
      expect(frFilters[key].length).toBeGreaterThan(0);
    });
  }
});
