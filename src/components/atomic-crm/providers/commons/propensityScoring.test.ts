import { describe, expect, it } from "vitest";

import {
  isDealActive,
  medianAmount,
  scoreDeal,
  type PropensityContext,
} from "./propensityScoring";
import {
  PROPENSITY_ACTIVITY_WINDOWS,
  PROPENSITY_BUCKET_THRESHOLDS,
  PROPENSITY_CLOSING_WINDOWS,
  PROPENSITY_DEFAULT_BUCKET,
} from "./propensityConstants";

/** Default stages mirroring `defaultDealStages` (first = earliest). */
const stages = [
  { value: "opportunity", label: "Opportunity" },
  { value: "proposal-sent", label: "Proposal Sent" },
  { value: "in-negociation", label: "In Negotiation" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "delayed", label: "Delayed" },
];

const NOW = new Date("2026-10-30T12:00:00.000Z");

const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const daysAhead = (days: number) =>
  new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

/** Default pipeline statuses (same as `defaultDealPipelineStatuses`). */
const closedStages = ["won"];

/** A context that produces a near-perfect score; tests tweak one field. */
const strongContext = (): PropensityContext => ({
  dealStages: stages,
  closedStages,
  medianActiveAmount: 10_000,
  latestActivityDate: daysAgo(1),
  latestDealNoteDate: daysAgo(1),
  now: NOW,
});

describe("scoreDeal", () => {
  it("returns the Medium fallback when no input can be evaluated", () => {
    const result = scoreDeal(
      { amount: NaN, stage: "unknown", expected_closing_date: "" },
      { dealStages: [], now: NOW },
    );

    expect(result.bucket).toBe(PROPENSITY_DEFAULT_BUCKET);
    expect(result.factors).toEqual([]);
  });

  it("falls back to Medium when the median amount is zero (no division-by-zero)", () => {
    const result = scoreDeal(
      { amount: 5000, stage: "unknown", expected_closing_date: "" },
      { dealStages: [], medianActiveAmount: 0, now: NOW },
    );

    expect(result.bucket).toBe(PROPENSITY_DEFAULT_BUCKET);
    expect(result.factors).toEqual([]);
  });

  it("rates a late-stage, hot, large, closing-soon deal as High", () => {
    const result = scoreDeal(
      {
        amount: 50_000,
        stage: "in-negociation",
        expected_closing_date: daysAhead(5),
      },
      strongContext(),
    );

    expect(result.bucket).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(
      PROPENSITY_BUCKET_THRESHOLDS.HIGH_SCORE,
    );
  });

  it("rates an early-stage, cold, tiny, far-closing deal as Low", () => {
    const result = scoreDeal(
      {
        amount: 500,
        stage: "opportunity",
        expected_closing_date: daysAhead(200),
      },
      {
        dealStages: stages,
        medianActiveAmount: 10_000,
        latestActivityDate: daysAgo(90),
        latestDealNoteDate: daysAgo(90),
        now: NOW,
      },
    );

    expect(result.bucket).toBe("low");
    expect(result.score).toBeLessThan(PROPENSITY_BUCKET_THRESHOLDS.LOW_SCORE);
  });

  it("names the top contributing factors in order", () => {
    // Use a tight pipeline (just the active stages) so the stage factor hits
    // its full weight for the last stage, and dominates on this deal.
    const result = scoreDeal(
      {
        amount: 50_000,
        stage: "in-negociation",
        expected_closing_date: daysAhead(5),
      },
      {
        dealStages: [
          { value: "opportunity", label: "Opportunity" },
          { value: "proposal-sent", label: "Proposal Sent" },
          { value: "in-negociation", label: "In Negotiation" },
          { value: "won", label: "Won" },
        ],
        closedStages: ["won"],
        medianActiveAmount: 10_000,
        latestActivityDate: daysAgo(1),
        latestDealNoteDate: daysAgo(1),
        now: NOW,
      },
    );

    // stage weight (1.0 * 30) now beats activity (1.0 * 25).
    expect(result.factors[0]?.key).toBe("stage");
    expect(result.factors[1]?.key).toBe("activityRecency");
  });

  it("counts missing activity as stale (zero) instead of dropping it", () => {
    const result = scoreDeal(
      {
        amount: 50_000,
        stage: "in-negociation",
        expected_closing_date: daysAhead(5),
      },
      {
        ...strongContext(),
        latestActivityDate: undefined,
        latestDealNoteDate: undefined,
      },
    );

    expect(result.factors.find((f) => f.key === "activityRecency")?.score).toBe(
      0,
    );
    expect(result.factors.find((f) => f.key === "dealNoteRecency")?.score).toBe(
      0,
    );
  });

  it("never rates an untouched deal above the same deal with stale activity", () => {
    const deal = {
      amount: 10_000,
      stage: "proposal-sent",
      expected_closing_date: daysAhead(60),
    };
    const base = {
      dealStages: stages,
      closedStages,
      medianActiveAmount: 10_000,
      now: NOW,
    };

    const untouched = scoreDeal(deal, base);
    const stale = scoreDeal(deal, {
      ...base,
      latestActivityDate: daysAgo(PROPENSITY_ACTIVITY_WINDOWS.COLD_DAYS + 1),
      latestDealNoteDate: daysAgo(PROPENSITY_ACTIVITY_WINDOWS.COLD_DAYS + 1),
    });

    expect(untouched.score).toBe(stale.score);
    expect(untouched.bucket).toBe(stale.bucket);
  });

  it("has the stage factor dominate when every other signal is neutral", () => {
    const result = scoreDeal(
      {
        amount: 10_000,
        stage: "in-negociation",
        // no closing-soon or stale-closing bonus
        expected_closing_date: daysAhead(
          Math.round(
            (PROPENSITY_CLOSING_WINDOWS.SOON_DAYS +
              PROPENSITY_CLOSING_WINDOWS.FAR_DAYS) /
              2,
          ),
        ),
      },
      {
        dealStages: [
          { value: "opportunity", label: "Opportunity" },
          { value: "proposal-sent", label: "Proposal Sent" },
          { value: "in-negociation", label: "In Negotiation" },
          { value: "won", label: "Won" },
        ],
        closedStages: ["won"],
        medianActiveAmount: 10_000,
        latestActivityDate: daysAgo(
          Math.round(
            (PROPENSITY_ACTIVITY_WINDOWS.HOT_DAYS +
              PROPENSITY_ACTIVITY_WINDOWS.COLD_DAYS) /
              2,
          ),
        ),
        latestDealNoteDate: daysAgo(
          Math.round(
            (PROPENSITY_ACTIVITY_WINDOWS.HOT_DAYS +
              PROPENSITY_ACTIVITY_WINDOWS.COLD_DAYS) /
              2,
          ),
        ),
        now: NOW,
      },
    );

    expect(result.factors[0]?.key).toBe("stage");
  });

  it("gives a full recency score at the HOT_DAYS boundary", () => {
    const result = scoreDeal(
      {
        amount: 10_000,
        stage: "opportunity",
        expected_closing_date: daysAhead(90),
      },
      {
        dealStages: stages,
        medianActiveAmount: 10_000,
        latestActivityDate: daysAgo(PROPENSITY_ACTIVITY_WINDOWS.HOT_DAYS),
        now: NOW,
      },
    );
    const activity = result.factors.find((f) => f.key === "activityRecency");
    expect(activity?.score).toBe(1);
  });

  it("gives a zero recency score at the COLD_DAYS boundary", () => {
    const result = scoreDeal(
      {
        amount: 10_000,
        stage: "opportunity",
        expected_closing_date: daysAhead(90),
      },
      {
        dealStages: stages,
        medianActiveAmount: 10_000,
        latestActivityDate: daysAgo(PROPENSITY_ACTIVITY_WINDOWS.COLD_DAYS),
        now: NOW,
      },
    );
    const activity = result.factors.find((f) => f.key === "activityRecency");
    expect(activity?.score).toBe(0);
  });

  it("treats a deal past its expected closing date as 'closing now'", () => {
    const result = scoreDeal(
      {
        amount: 10_000,
        stage: "opportunity",
        expected_closing_date: daysAgo(3),
      },
      { dealStages: stages, medianActiveAmount: 10_000, now: NOW },
    );
    const closing = result.factors.find((f) => f.key === "closingSoon");
    expect(closing?.score).toBe(1);
  });

  it("gives a full amount score when the deal is at or above the LARGE ratio", () => {
    const result = scoreDeal(
      {
        amount: 100_000,
        stage: "opportunity",
        expected_closing_date: daysAhead(90),
      },
      { dealStages: stages, medianActiveAmount: 10_000, now: NOW },
    );
    const amount = result.factors.find((f) => f.key === "amount");
    expect(amount?.score).toBe(1);
  });

  it("gives a zero amount score when the deal is at or below the SMALL ratio", () => {
    const result = scoreDeal(
      {
        amount: 100,
        stage: "opportunity",
        expected_closing_date: daysAhead(90),
      },
      { dealStages: stages, medianActiveAmount: 10_000, now: NOW },
    );
    const amount = result.factors.find((f) => f.key === "amount");
    expect(amount?.score).toBe(0);
  });

  it("works with a single configured stage without dividing by zero", () => {
    const result = scoreDeal(
      {
        amount: 10_000,
        stage: "only",
        expected_closing_date: daysAhead(90),
      },
      {
        dealStages: [{ value: "only", label: "Only" }],
        medianActiveAmount: 10_000,
        now: NOW,
      },
    );
    const stage = result.factors.find((f) => f.key === "stage");
    expect(stage?.score).toBe(1);
  });

  it("drops the stage factor when the deal's stage is unknown to the configuration", () => {
    const result = scoreDeal(
      {
        amount: 10_000,
        stage: "ghost",
        expected_closing_date: daysAhead(90),
      },
      { dealStages: stages, medianActiveAmount: 10_000, now: NOW },
    );
    expect(result.factors.some((f) => f.key === "stage")).toBe(false);
  });

  it("has activity dominate the result when the stage factor is unavailable", () => {
    const result = scoreDeal(
      {
        amount: 10_000,
        stage: "ghost",
        expected_closing_date: daysAhead(90),
      },
      {
        dealStages: stages,
        medianActiveAmount: 10_000,
        latestActivityDate: daysAgo(0),
        now: NOW,
      },
    );
    expect(result.factors[0]?.key).toBe("activityRecency");
  });

  it("has closingSoon dominate the result when only that signal is strong", () => {
    const result = scoreDeal(
      {
        amount: 10_000,
        stage: "ghost", // unknown stage dropped
        expected_closing_date: daysAhead(1),
      },
      {
        dealStages: stages,
        medianActiveAmount: 10_000,
        latestActivityDate: daysAgo(PROPENSITY_ACTIVITY_WINDOWS.COLD_DAYS),
        now: NOW,
      },
    );
    expect(result.factors[0]?.key).toBe("closingSoon");
  });
});

describe("medianAmount", () => {
  it("returns the median of an odd-length list", () => {
    expect(medianAmount([1, 3, 2])).toBe(2);
  });

  it("averages the two middle values of an even-length list", () => {
    expect(medianAmount([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for an empty list (safe for scoreDeal)", () => {
    expect(medianAmount([])).toBeNull();
  });

  it("ignores non-positive and non-finite values", () => {
    expect(medianAmount([0, -5, Number.NaN, 10, 20])).toBe(15);
  });
});

describe("isDealActive", () => {
  it("excludes archived deals", () => {
    expect(
      isDealActive(
        { stage: "opportunity", archived_at: "2026-01-01T00:00:00Z" },
        ["won"],
      ),
    ).toBe(false);
  });

  it("excludes deals whose stage is in dealPipelineStatuses", () => {
    expect(isDealActive({ stage: "won" }, ["won"])).toBe(false);
  });

  it("includes active deals in regular stages", () => {
    expect(isDealActive({ stage: "opportunity" }, ["won"])).toBe(true);
  });
});
