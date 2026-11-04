import { ResponsiveBar } from "@nivo/bar";
import { format, startOfMonth } from "date-fns";
import { TrendingUp } from "lucide-react";
import { useGetList, useTranslate } from "ra-core";
import { memo, type MouseEvent, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router";

import { nextDay } from "../deals/dateRangePresets";
import { findDealLabel } from "../deals/dealUtils";
import {
  buildDealsChartNavigationUrl,
  type MonthBarDatum,
} from "./dealsChartDrilldown";
import { createAriaLabelLayer } from "./MonthOverlayLayer";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";

const multiplier = {
  opportunity: 0.2,
  "proposal-sent": 0.5,
  "in-negociation": 0.8,
  delayed: 0.3,
};

const threeMonthsAgo = new Date(
  new Date().setMonth(new Date().getMonth() - 6),
).toISOString();

const DEFAULT_LOCALE = "en-US";

/** Chart margins — must stay in sync with the ResponsiveBar `margin` prop. */
const CHART_MARGIN = { top: 30, right: 50, bottom: 30, left: 0 };

/** Inner chart height used for the aria-label overlay. */
const CHART_INNER_HEIGHT = 400 - CHART_MARGIN.top - CHART_MARGIN.bottom;

export const DealsChart = memo(() => {
  const translate = useTranslate();
  const navigate = useNavigate();
  const chartRef = useRef<HTMLDivElement>(null);
  const { dealStages, currency } = useConfigurationContext();
  const acceptedLanguages = navigator
    ? navigator.languages || [navigator.language]
    : [DEFAULT_LOCALE];
  const wonLabel = findDealLabel(dealStages, "won") ?? "Won";
  const lostLabel = findDealLabel(dealStages, "lost") ?? "Lost";

  const { data, isPending } = useGetList<Deal>("deals", {
    pagination: { perPage: 100, page: 1 },
    sort: {
      field: "created_at",
      order: "ASC",
    },
    filter: {
      "created_at@gte": threeMonthsAgo,
    },
  });
  const months = useMemo(() => {
    if (!data) return [];
    const dealsByMonth = data.reduce(
      (acc, deal) => {
        const month = startOfMonth(deal.created_at ?? new Date()).toISOString();
        if (!acc[month]) {
          acc[month] = [];
        }
        acc[month].push(deal);
        return acc;
      },
      {} as Record<string, Deal[]>,
    );

    const amountByMonth: MonthBarDatum[] = Object.keys(dealsByMonth).map(
      (month) => {
        const d = new Date(month);
        const lastDay = new Date(
          d.getFullYear(),
          d.getMonth() + 1,
          0,
        ).getDate();
        const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
        const to = nextDay(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
        );
        return {
          date: format(month, "MMM"),
          monthName: format(month, "MMMM"),
          monthFrom: from,
          monthTo: to,
          won: dealsByMonth[month]
            .filter((deal: Deal) => deal.stage === "won")
            .reduce((acc: number, deal: Deal) => {
              acc += deal.amount;
              return acc;
            }, 0),
          pending: dealsByMonth[month]
            .filter((deal: Deal) => !["won", "lost"].includes(deal.stage))
            .reduce((acc: number, deal: Deal) => {
              // @ts-expect-error - multiplier type issue
              acc += deal.amount * multiplier[deal.stage];
              return acc;
            }, 0),
          lost: dealsByMonth[month]
            .filter((deal: Deal) => deal.stage === "lost")
            .reduce((acc: number, deal: Deal) => {
              acc -= deal.amount;
              return acc;
            }, 0),
        };
      },
    );

    return amountByMonth;
  }, [data]);

  /**
   * Click handler on the wrapper div. Maps the click's x-coordinate
   * to a month column so any click inside the chart area (on a bar
   * or in the gaps between bars) navigates to the corresponding
   * month on the deals board.
   */
  const handleChartClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (months.length === 0) return;

      const svg = chartRef.current?.querySelector("svg");
      if (!svg) return;
      const svgRect = svg.getBoundingClientRect();
      const clickX = e.clientX - svgRect.left - CHART_MARGIN.left;
      const innerWidth = svgRect.width - CHART_MARGIN.left - CHART_MARGIN.right;
      if (innerWidth <= 0) return;
      const bandWidth = innerWidth / months.length;
      const monthIdx = Math.min(
        Math.max(Math.floor(clickX / bandWidth), 0),
        months.length - 1,
      );
      navigate(buildDealsChartNavigationUrl(months[monthIdx]));
    },
    [months, navigate],
  );

  const getBarAriaLabel = useCallback(
    (monthName: string) =>
      translate("crm.dashboard.view_deals_for_month", { month: monthName }),
    [translate],
  );

  const ariaLabelLayer = useMemo(
    () => createAriaLabelLayer(getBarAriaLabel, CHART_INNER_HEIGHT),
    [getBarAriaLabel],
  );

  if (isPending) return null; // FIXME return skeleton instead
  const range = months.reduce(
    (acc, month) => {
      acc.min = Math.min(acc.min, month.lost);
      acc.max = Math.max(acc.max, month.won + month.pending);
      return acc;
    },
    { min: 0, max: 0 },
  );
  return (
    <div className="flex flex-col">
      <div className="flex items-center mb-4">
        <div className="mr-3 flex">
          <TrendingUp className="text-muted-foreground w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-muted-foreground">
          {translate("crm.dashboard.deals_chart")}
        </h2>
      </div>
      <div ref={chartRef} className="h-[400px]" onClick={handleChartClick}>
        <ResponsiveBar
          data={months}
          indexBy="date"
          keys={["won", "pending", "lost"]}
          colors={["#61cdbb", "#97e3d5", "#e25c3b"]}
          margin={CHART_MARGIN}
          padding={0.3}
          valueScale={{
            type: "linear",
            min: range.min * 1.2,
            max: range.max * 1.2,
          }}
          indexScale={{ type: "band", round: true }}
          enableGridX={true}
          enableGridY={false}
          enableLabel={false}
          animate={false}
          tooltip={({ value, indexValue }) => (
            <div className="p-2 bg-secondary rounded shadow inline-flex items-center gap-1 text-secondary-foreground">
              <strong>{indexValue}: </strong>&nbsp;{value > 0 ? "+" : ""}
              {value.toLocaleString(acceptedLanguages.at(0) ?? DEFAULT_LOCALE, {
                style: "currency",
                currency,
              })}
            </div>
          )}
          layers={[
            "grid",
            "axes",
            "bars",
            ariaLabelLayer,
            "markers",
            "legends",
            "annotations",
          ]}
          axisTop={{
            tickSize: 0,
            tickPadding: 12,
            style: {
              ticks: {
                text: {
                  fill: "var(--color-muted-foreground)",
                },
              },
              legend: {
                text: {
                  fill: "var(--color-muted-foreground)",
                },
              },
            },
          }}
          axisBottom={{
            legendPosition: "middle",
            legendOffset: 50,
            tickSize: 0,
            tickPadding: 0,
            format: () => "",
            style: {
              ticks: {
                text: {
                  fill: "var(--color-muted-foreground)",
                },
              },
              legend: {
                text: {
                  fill: "var(--color-muted-foreground)",
                },
              },
            },
          }}
          axisLeft={null}
          axisRight={{
            format: (v: any) => `${Math.abs(v / 1000)}k`,
            tickValues: 8,
            style: {
              ticks: {
                text: {
                  fill: "var(--color-muted-foreground)",
                },
              },
              legend: {
                text: {
                  fill: "var(--color-muted-foreground)",
                },
              },
            },
          }}
          markers={
            [
              {
                axis: "y",
                value: 0,
                lineStyle: { strokeOpacity: 0 },
                textStyle: { fill: "#2ebca6" },
                legend: wonLabel,
                legendPosition: "top-left",
                legendOrientation: "vertical",
              },
              {
                axis: "y",
                value: 0,
                lineStyle: {
                  stroke: "#f47560",
                  strokeWidth: 1,
                },
                textStyle: { fill: "#e25c3b" },
                legend: lostLabel,
                legendPosition: "bottom-left",
                legendOrientation: "vertical",
              },
            ] as any
          }
        />
      </div>
      <style>{`
        .h-\\[400px\\] svg rect[width] { cursor: pointer; }
        .h-\\[400px\\] svg rect[data-testid] { pointer-events: none; }
        .h-\\[400px\\] svg g[transform] > line { pointer-events: none; }
      `}</style>
    </div>
  );
});
