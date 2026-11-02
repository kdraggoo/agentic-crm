import { describe, expect, it } from "vitest";
import {
  getThisMonth,
  getThisQuarter,
  getNextMonth,
  getNextQuarter,
  getPresetRange,
  nextDay,
} from "./dateRangePresets";

describe("getThisMonth", () => {
  it("returns the first and last day of the current month", () => {
    const result = getThisMonth(new Date(2026, 2, 15)); // March 15
    expect(result).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("handles February in a non-leap year", () => {
    const result = getThisMonth(new Date(2025, 1, 10)); // Feb 10, 2025
    expect(result).toEqual({ from: "2025-02-01", to: "2025-02-28" });
  });

  it("handles February in a leap year", () => {
    const result = getThisMonth(new Date(2024, 1, 10)); // Feb 10, 2024
    expect(result).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("handles December", () => {
    const result = getThisMonth(new Date(2026, 11, 25)); // Dec 25
    expect(result).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("handles January", () => {
    const result = getThisMonth(new Date(2026, 0, 1)); // Jan 1
    expect(result).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });
});

describe("getThisQuarter", () => {
  it("returns Q1 (Jan-Mar) when in January", () => {
    const result = getThisQuarter(new Date(2026, 0, 15));
    expect(result).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("returns Q1 when in March", () => {
    const result = getThisQuarter(new Date(2026, 2, 31));
    expect(result).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("returns Q2 (Apr-Jun) when in May", () => {
    const result = getThisQuarter(new Date(2026, 4, 10));
    expect(result).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("returns Q3 (Jul-Sep) when in August", () => {
    const result = getThisQuarter(new Date(2026, 7, 20));
    expect(result).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("returns Q4 (Oct-Dec) when in November", () => {
    const result = getThisQuarter(new Date(2026, 10, 2));
    expect(result).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });
});

describe("getNextMonth", () => {
  it("returns next month within same year", () => {
    const result = getNextMonth(new Date(2026, 2, 15)); // March → April
    expect(result).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("wraps from December to January of next year", () => {
    const result = getNextMonth(new Date(2026, 11, 1)); // Dec → Jan 2027
    expect(result).toEqual({ from: "2027-01-01", to: "2027-01-31" });
  });

  it("handles November to December", () => {
    const result = getNextMonth(new Date(2026, 10, 15)); // Nov → Dec
    expect(result).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("handles January to February in a leap year", () => {
    const result = getNextMonth(new Date(2024, 0, 15)); // Jan → Feb 2024
    expect(result).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
});

describe("getNextQuarter", () => {
  it("returns Q2 when in Q1", () => {
    const result = getNextQuarter(new Date(2026, 1, 15)); // Feb → Q2
    expect(result).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("returns Q3 when in Q2", () => {
    const result = getNextQuarter(new Date(2026, 4, 10)); // May → Q3
    expect(result).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("returns Q4 when in Q3", () => {
    const result = getNextQuarter(new Date(2026, 8, 30)); // Sep → Q4
    expect(result).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });

  it("wraps from Q4 to Q1 of next year", () => {
    const result = getNextQuarter(new Date(2026, 10, 2)); // Nov → Q1 2027
    expect(result).toEqual({ from: "2027-01-01", to: "2027-03-31" });
  });

  it("wraps from December to Q1 of next year", () => {
    const result = getNextQuarter(new Date(2026, 11, 31)); // Dec → Q1 2027
    expect(result).toEqual({ from: "2027-01-01", to: "2027-03-31" });
  });
});

describe("getPresetRange", () => {
  const now = new Date(2026, 10, 2); // November 2, 2026

  it("delegates to getThisMonth", () => {
    expect(getPresetRange("this_month", now)).toEqual(getThisMonth(now));
  });

  it("delegates to getThisQuarter", () => {
    expect(getPresetRange("this_quarter", now)).toEqual(getThisQuarter(now));
  });

  it("delegates to getNextMonth", () => {
    expect(getPresetRange("next_month", now)).toEqual(getNextMonth(now));
  });

  it("delegates to getNextQuarter", () => {
    expect(getPresetRange("next_quarter", now)).toEqual(getNextQuarter(now));
  });
});

describe("nextDay", () => {
  it("returns the next day for a regular date", () => {
    expect(nextDay("2026-11-15")).toBe("2026-11-16");
  });

  it("crosses month boundaries", () => {
    expect(nextDay("2026-11-30")).toBe("2026-12-01");
  });

  it("crosses year boundaries", () => {
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("handles end of February in non-leap year", () => {
    expect(nextDay("2025-02-28")).toBe("2025-03-01");
  });

  it("handles end of February in leap year", () => {
    expect(nextDay("2024-02-29")).toBe("2024-03-01");
  });

  it("handles Feb 28 in a leap year (does not skip to March)", () => {
    expect(nextDay("2024-02-28")).toBe("2024-02-29");
  });
});

describe("date range format", () => {
  it("returns dates in YYYY-MM-DD format with zero-padded months and days", () => {
    const result = getThisMonth(new Date(2026, 0, 5)); // January
    expect(result.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.from).toBe("2026-01-01");
    expect(result.to).toBe("2026-01-31");
  });
});
