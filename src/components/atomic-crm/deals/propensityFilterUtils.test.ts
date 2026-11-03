import { describe, expect, it } from "vitest";

import type { PropensityResult } from "../providers/commons/propensityScoring";
import type { Deal, PropensityBucket } from "../types";
import {
  filterDealsByPropensity,
  PROPENSITY_BUCKET_CHOICES,
  PROPENSITY_FILTER_SOURCE,
  stripPropensityFilter,
} from "./propensityFilterUtils";

const makeDeal = (
  overrides: Partial<Deal> & { id: number; stage: string },
): Deal =>
  ({
    name: `Deal ${overrides.id}`,
    amount: 1000,
    index: 0,
    company_id: 1,
    contact_ids: [],
    categories: [],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    sales_id: 1,
    archived_at: null,
    expected_closing_date: null,
    description: "",
    propensity_override: null,
    ...overrides,
  }) as unknown as Deal;

const makeResult = (bucket: PropensityBucket): PropensityResult => ({
  bucket,
  score: 50,
  factors: [],
});

const PIPELINE_STATUSES = ["won", "lost", "delayed"];

describe("filterDealsByPropensity", () => {
  const deals = [
    makeDeal({ id: 1, stage: "opportunity" }),
    makeDeal({ id: 2, stage: "proposal-sent" }),
    makeDeal({ id: 3, stage: "won" }),
    makeDeal({ id: 4, stage: "opportunity", propensity_override: "high" }),
    makeDeal({ id: 5, stage: "lost" }),
  ];

  const propensityMap = new Map<string | number, PropensityResult>([
    [1, makeResult("low")],
    [2, makeResult("medium")],
    [4, makeResult("low")], // override wins over computed
  ]);

  it("returns all deals when no buckets are selected", () => {
    const result = filterDealsByPropensity(
      deals,
      undefined,
      PIPELINE_STATUSES,
      propensityMap,
    );
    expect(result).toEqual(deals);
  });

  it("returns all deals when empty bucket array is selected", () => {
    const result = filterDealsByPropensity(
      deals,
      [],
      PIPELINE_STATUSES,
      propensityMap,
    );
    expect(result).toEqual(deals);
  });

  it("filters deals by a single bucket", () => {
    const result = filterDealsByPropensity(
      deals,
      ["low"],
      PIPELINE_STATUSES,
      propensityMap,
    );
    expect(result.map((d) => d.id)).toEqual([1]);
  });

  it("filters deals by multiple buckets", () => {
    const result = filterDealsByPropensity(
      deals,
      ["low", "medium"],
      PIPELINE_STATUSES,
      propensityMap,
    );
    expect(result.map((d) => d.id)).toEqual([1, 2]);
  });

  it("uses manual override bucket instead of computed", () => {
    const result = filterDealsByPropensity(
      deals,
      ["high"],
      PIPELINE_STATUSES,
      propensityMap,
    );
    // Deal 4 has propensity_override: "high" even though computed is "low"
    expect(result.map((d) => d.id)).toEqual([4]);
  });

  it("hides deals in non-scorable stages when any filter is active", () => {
    const result = filterDealsByPropensity(
      deals,
      ["low", "medium", "high"],
      PIPELINE_STATUSES,
      propensityMap,
    );
    // Won (id:3) and Lost (id:5) should be excluded
    expect(result.map((d) => d.id)).toEqual([1, 2, 4]);
  });

  it("does not affect archived deals (they are already excluded from the list)", () => {
    const dealsWithArchived = [
      ...deals,
      makeDeal({
        id: 6,
        stage: "opportunity",
        archived_at: "2024-06-01T00:00:00Z",
      }),
    ];
    // Without filter, archived deal is present
    const noFilter = filterDealsByPropensity(
      dealsWithArchived,
      undefined,
      PIPELINE_STATUSES,
      propensityMap,
    );
    expect(noFilter.map((d) => d.id)).toContain(6);

    // With filter, archived deal is excluded because isDealActive returns false
    const withFilter = filterDealsByPropensity(
      dealsWithArchived,
      ["low", "medium", "high"],
      PIPELINE_STATUSES,
      propensityMap,
    );
    expect(withFilter.map((d) => d.id)).not.toContain(6);
  });

  it("excludes deals with no propensity result and no override", () => {
    const emptyMap = new Map<string | number, PropensityResult>();
    const result = filterDealsByPropensity(
      [makeDeal({ id: 10, stage: "opportunity" })],
      ["low"],
      PIPELINE_STATUSES,
      emptyMap,
    );
    expect(result).toEqual([]);
  });
});

describe("stripPropensityFilter", () => {
  it("removes the propensity_bucket key from a filter object", () => {
    const filter = {
      q: "test",
      [PROPENSITY_FILTER_SOURCE]: ["high"],
      company_id: 1,
    };
    const result = stripPropensityFilter(filter);
    expect(result).toEqual({ q: "test", company_id: 1 });
  });

  it("returns the same object when propensity_bucket is not present", () => {
    const filter = { q: "test", company_id: 1 };
    const result = stripPropensityFilter(filter);
    expect(result).toEqual(filter);
  });
});

describe("PROPENSITY_BUCKET_CHOICES", () => {
  it("has exactly three choices: low, medium, high", () => {
    expect(PROPENSITY_BUCKET_CHOICES).toHaveLength(3);
    expect(PROPENSITY_BUCKET_CHOICES.map((c) => c.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });

  it("uses translation keys for names", () => {
    for (const choice of PROPENSITY_BUCKET_CHOICES) {
      expect(choice.name).toMatch(/^crm\.propensity\.buckets\./);
    }
  });
});
