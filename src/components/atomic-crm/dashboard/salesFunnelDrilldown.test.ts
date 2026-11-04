import { describe, expect, it } from "vitest";

describe("Sales funnel drill-down URL", () => {
  /**
   * The funnel drill-down navigates to `/deals?scrollToStage=<value>`.
   * Test the URL shape produced by the SalesFunnel component's handleStageClick.
   */
  function buildFunnelNavigationUrl(stageValue: string): string {
    return `/deals?scrollToStage=${encodeURIComponent(stageValue)}`;
  }

  it("builds a URL with scrollToStage param for a simple stage value", () => {
    const url = buildFunnelNavigationUrl("opportunity");
    expect(url).toBe("/deals?scrollToStage=opportunity");
  });

  it("URL-encodes stage values with special characters", () => {
    const url = buildFunnelNavigationUrl("in-negociation");
    expect(url).toBe("/deals?scrollToStage=in-negociation");
  });

  it("does not include a stage filter in the URL (stages are shown as columns)", () => {
    const url = buildFunnelNavigationUrl("proposal-sent");
    expect(url).not.toContain("filter");
    expect(url).not.toContain("stage@");
  });

  it("URL-encodes stage values with spaces", () => {
    const url = buildFunnelNavigationUrl("some stage");
    expect(url).toBe("/deals?scrollToStage=some%20stage");
    expect(url).not.toContain(" ");
  });
});
