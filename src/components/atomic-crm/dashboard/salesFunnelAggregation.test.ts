import { describe, expect, it } from "vitest";

import type { Deal, DealStage } from "../types";
import { buildSalesFunnelRows, maxFunnelCount } from "./salesFunnelAggregation";

const DEAL_STAGES: DealStage[] = [
  { value: "opportunity", label: "Opportunity" },
  { value: "proposal-sent", label: "Proposal Sent" },
  { value: "in-negociation", label: "In Negotiation" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "delayed", label: "Delayed" },
];

const DEFAULT_PIPELINE_STATUSES = ["won", "lost", "delayed"];

const buildDeal = (overrides: Partial<Deal>): Deal =>
  ({
    amount: 1000,
    categories: [],
    company_id: 1,
    contact_ids: [],
    created_at: "2026-01-01",
    description: "",
    expected_closing_date: "2026-02-01",
    id: Math.random(),
    index: 0,
    name: "Deal",
    sales_id: 1,
    stage: "opportunity",
    updated_at: "2026-01-01",
    ...overrides,
  }) as Deal;

describe("buildSalesFunnelRows", () => {
  it("returns one row per active stage in configuration order", () => {
    const rows = buildSalesFunnelRows(
      [],
      DEAL_STAGES,
      DEFAULT_PIPELINE_STATUSES,
    );

    expect(rows.map((row) => row.value)).toEqual([
      "opportunity",
      "proposal-sent",
      "in-negociation",
    ]);
  });

  it("excludes stages flagged in dealPipelineStatuses", () => {
    const rows = buildSalesFunnelRows(
      [],
      DEAL_STAGES,
      DEFAULT_PIPELINE_STATUSES,
    );

    const labels = rows.map((row) => row.label);
    expect(labels).not.toContain("Won");
    expect(labels).not.toContain("Lost");
    expect(labels).not.toContain("Delayed");
  });

  it("sums count and amount per stage", () => {
    const deals = [
      buildDeal({ id: 1, stage: "opportunity", amount: 1000 }),
      buildDeal({ id: 2, stage: "opportunity", amount: 2500 }),
      buildDeal({ id: 3, stage: "proposal-sent", amount: 750 }),
    ];

    const rows = buildSalesFunnelRows(
      deals,
      DEAL_STAGES,
      DEFAULT_PIPELINE_STATUSES,
    );

    expect(rows.find((row) => row.value === "opportunity")).toMatchObject({
      count: 2,
      amount: 3500,
    });
    expect(rows.find((row) => row.value === "proposal-sent")).toMatchObject({
      count: 1,
      amount: 750,
    });
    expect(rows.find((row) => row.value === "in-negociation")).toMatchObject({
      count: 0,
      amount: 0,
    });
  });

  it("drops deals whose stage is unknown to the configuration (AC6)", () => {
    const deals = [
      buildDeal({ id: 1, stage: "ghost-stage", amount: 999 }),
      buildDeal({ id: 2, stage: "opportunity", amount: 100 }),
    ];

    const rows = buildSalesFunnelRows(
      deals,
      DEAL_STAGES,
      DEFAULT_PIPELINE_STATUSES,
    );
    const total = rows.reduce((acc, row) => acc + row.count, 0);

    expect(total).toBe(1);
    expect(rows.find((row) => row.value === "opportunity")?.count).toBe(1);
    // No row is created for the unknown stage.
    expect(rows.find((row) => row.value === "ghost-stage")).toBeUndefined();
  });

  it("drops deals whose stage is excluded (AC4: won/lost/delayed)", () => {
    const deals = [
      buildDeal({ id: 1, stage: "won", amount: 10000 }),
      buildDeal({ id: 2, stage: "lost", amount: 500 }),
      buildDeal({ id: 3, stage: "delayed", amount: 200 }),
      buildDeal({ id: 4, stage: "opportunity", amount: 300 }),
    ];

    const rows = buildSalesFunnelRows(
      deals,
      DEAL_STAGES,
      DEFAULT_PIPELINE_STATUSES,
    );

    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.value === "opportunity")?.count).toBe(1);
    expect(rows.find((row) => row.value === "won")).toBeUndefined();
    expect(rows.find((row) => row.value === "lost")).toBeUndefined();
    expect(rows.find((row) => row.value === "delayed")).toBeUndefined();
  });

  it("respects a custom dealPipelineStatuses list without code changes (AC2 dynamic)", () => {
    const customPipelineStatuses = ["won"];
    const rows = buildSalesFunnelRows([], DEAL_STAGES, customPipelineStatuses);

    const values = rows.map((row) => row.value);
    expect(values).toContain("lost");
    expect(values).toContain("delayed");
    expect(values).not.toContain("won");
  });

  it("respects the configured stage order (reordering has no code change)", () => {
    const reordered: DealStage[] = [
      { value: "in-negociation", label: "In Negotiation" },
      { value: "opportunity", label: "Opportunity" },
      { value: "proposal-sent", label: "Proposal Sent" },
      { value: "won", label: "Won" },
    ];

    const rows = buildSalesFunnelRows([], reordered, ["won"]);

    expect(rows.map((row) => row.value)).toEqual([
      "in-negociation",
      "opportunity",
      "proposal-sent",
    ]);
  });

  it("handles undefined deals without throwing", () => {
    const rows = buildSalesFunnelRows(
      undefined,
      DEAL_STAGES,
      DEFAULT_PIPELINE_STATUSES,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.count === 0 && row.amount === 0)).toBe(true);
  });
});

describe("maxFunnelCount", () => {
  it("returns the largest count across rows", () => {
    const rows = buildSalesFunnelRows(
      [
        buildDeal({ id: 1, stage: "opportunity" }),
        buildDeal({ id: 2, stage: "opportunity" }),
        buildDeal({ id: 3, stage: "opportunity" }),
        buildDeal({ id: 4, stage: "proposal-sent" }),
      ],
      DEAL_STAGES,
      DEFAULT_PIPELINE_STATUSES,
    );

    expect(maxFunnelCount(rows)).toBe(3);
  });

  it("returns 0 when every row is empty (AC5 empty-state trigger)", () => {
    const rows = buildSalesFunnelRows(
      [],
      DEAL_STAGES,
      DEFAULT_PIPELINE_STATUSES,
    );
    expect(maxFunnelCount(rows)).toBe(0);
  });
});
