import type { Deal, DealStage } from "../types";

/**
 * Aggregated metrics for a single stage row in the Sales funnel widget.
 */
export interface SalesFunnelRow {
  /** The stage's `value`, used as React key. */
  value: string;
  /** The stage's human-readable label from `dealStages`. */
  label: string;
  /** Number of unarchived deals currently in that stage. */
  count: number;
  /** Sum of the `amount` field of those deals. */
  amount: number;
}

/**
 * Build the funnel rows for the dashboard widget.
 *
 * - Rows follow the order of `dealStages`.
 * - Stages whose `value` is in `pipelineStatuses` (e.g. won, lost, delayed) are
 *   excluded from the output. This mirrors F-DEAL-01 / F-SET-02 semantics: a
 *   pipeline status is a closed state, not open pipeline.
 * - Deals whose stage is not present in `dealStages` are dropped. A stage with
 *   zero matching deals keeps a row with count 0 and amount 0.
 */
export function buildSalesFunnelRows(
  deals: Deal[] | undefined,
  dealStages: DealStage[],
  pipelineStatuses: string[],
): SalesFunnelRow[] {
  const excluded = new Set(pipelineStatuses);
  const activeStages = dealStages.filter((stage) => !excluded.has(stage.value));

  const rows: SalesFunnelRow[] = activeStages.map((stage) => ({
    value: stage.value,
    label: stage.label,
    count: 0,
    amount: 0,
  }));

  if (!deals || deals.length === 0) {
    return rows;
  }

  const rowByValue = new Map(rows.map((row) => [row.value, row]));
  for (const deal of deals) {
    const row = rowByValue.get(deal.stage);
    if (!row) continue;
    row.count += 1;
    row.amount += deal.amount ?? 0;
  }

  return rows;
}

/**
 * Highest `count` across the shown rows, used to size the proportional bars.
 * Returns 0 when every row has 0 deals so the caller can trigger the empty
 * state (acceptance criterion AC5).
 */
export function maxFunnelCount(rows: SalesFunnelRow[]): number {
  return rows.reduce((max, row) => (row.count > max ? row.count : max), 0);
}
