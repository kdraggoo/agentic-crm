import { describe, expect, it } from "vitest";

import { englishCrmMessages } from "../providers/commons/englishCrmMessages";
import { frenchCrmMessages } from "../providers/commons/frenchCrmMessages";

describe("AC8: propensity filter i18n", () => {
  it("has the filter label in the English catalog", () => {
    expect(englishCrmMessages.resources.deals.fields.propensity_override).toBe(
      "Propensity to buy",
    );
  });

  it("has the filter label in the French catalog", () => {
    expect(
      frenchCrmMessages.resources.deals.fields.propensity_override,
    ).toBeTruthy();
  });

  it("has all three bucket labels in the English catalog", () => {
    const buckets = englishCrmMessages.crm.propensity.buckets;
    expect(buckets.low).toBe("Low");
    expect(buckets.medium).toBe("Medium");
    expect(buckets.high).toBe("High");
  });

  it("has all three bucket labels in the French catalog", () => {
    const buckets = frenchCrmMessages.crm.propensity.buckets;
    expect(buckets.low).toBeTruthy();
    expect(buckets.medium).toBeTruthy();
    expect(buckets.high).toBeTruthy();
  });
});
