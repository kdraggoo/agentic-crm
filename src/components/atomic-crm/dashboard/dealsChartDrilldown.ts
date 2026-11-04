import type { BarDatum } from "@nivo/bar";

/**
 * Data shape for each month bar in the Deals chart.
 * Extends Nivo's BarDatum with drill-down metadata.
 */
export interface MonthBarDatum extends BarDatum {
  date: string; // abbreviated month label (e.g. "Nov")
  monthName: string; // full month name (e.g. "November")
  monthFrom: string; // first day of the month as YYYY-MM-DD
  monthTo: string; // first day of the NEXT month as YYYY-MM-DD (exclusive upper bound)
  won: number;
  pending: number;
  lost: number;
}

/**
 * Builds the hash URL for navigating to the deals board with a
 * created_at date-range filter matching the clicked month bar.
 *
 * Uses `created_at@gte` (inclusive) and `created_at@lt` (exclusive,
 * timestamp mode) so the DateRangeFilterInput recognizes the filter
 * in "custom" mode.
 */
export function buildDealsChartNavigationUrl(
  monthData: Pick<MonthBarDatum, "monthFrom" | "monthTo">,
): string {
  const filter = JSON.stringify({
    "created_at@gte": monthData.monthFrom,
    "created_at@lt": monthData.monthTo,
  });
  const displayedFilters = JSON.stringify({ created_at: true });
  return `/deals?filter=${encodeURIComponent(filter)}&displayedFilters=${encodeURIComponent(displayedFilters)}`;
}
