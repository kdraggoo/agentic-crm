import { describe, expect, it } from "vitest";

import { buildDealsChartNavigationUrl } from "./dealsChartDrilldown";

describe("buildDealsChartNavigationUrl", () => {
  it("returns a URL path with created_at@gte and created_at@lt filter params", () => {
    const url = buildDealsChartNavigationUrl({
      monthFrom: "2026-03-01",
      monthTo: "2026-04-01",
    });

    expect(url).toContain("/deals?");

    // Parse filter from URL
    const params = new URLSearchParams(url.split("?")[1]);
    const filter = JSON.parse(params.get("filter")!);
    expect(filter["created_at@gte"]).toBe("2026-03-01");
    expect(filter["created_at@lt"]).toBe("2026-04-01");
  });

  it("includes displayedFilters with created_at: true so the filter input is visible", () => {
    const url = buildDealsChartNavigationUrl({
      monthFrom: "2026-01-01",
      monthTo: "2026-02-01",
    });

    const params = new URLSearchParams(url.split("?")[1]);
    const displayedFilters = JSON.parse(params.get("displayedFilters")!);
    expect(displayedFilters).toEqual({ created_at: true });
  });

  it("does not include expected_closing_date in the filter", () => {
    const url = buildDealsChartNavigationUrl({
      monthFrom: "2026-06-01",
      monthTo: "2026-07-01",
    });

    expect(url).not.toContain("expected_closing_date");
  });

  it("URL-encodes filter and displayedFilters params", () => {
    const url = buildDealsChartNavigationUrl({
      monthFrom: "2026-12-01",
      monthTo: "2027-01-01",
    });

    // The JSON objects should be percent-encoded
    expect(url).toContain("filter=");
    expect(url).toContain("displayedFilters=");
    // Raw JSON should not appear (braces would be encoded)
    expect(url).not.toContain("{");
    expect(url).not.toContain("}");
  });

  it("handles year boundaries (December to January)", () => {
    const url = buildDealsChartNavigationUrl({
      monthFrom: "2026-12-01",
      monthTo: "2027-01-01",
    });

    const params = new URLSearchParams(url.split("?")[1]);
    const filter = JSON.parse(params.get("filter")!);
    expect(filter["created_at@gte"]).toBe("2026-12-01");
    expect(filter["created_at@lt"]).toBe("2027-01-01");
  });
});
