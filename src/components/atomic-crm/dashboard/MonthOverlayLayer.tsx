import type { BarCustomLayerProps } from "@nivo/bar";

import type { MonthBarDatum } from "./dealsChartDrilldown";

/**
 * Groups computed bars by their data index (month position) and returns
 * a map from index to the first bar's x position, width, and datum.
 */
function groupBarsByMonth(bars: BarCustomLayerProps<MonthBarDatum>["bars"]) {
  const monthBands = new Map<
    number,
    { x: number; width: number; datum: MonthBarDatum }
  >();
  for (const bar of bars) {
    const idx = bar.data.index;
    if (!monthBands.has(idx)) {
      monthBands.set(idx, {
        x: bar.x,
        width: bar.width,
        datum: bar.data.data as MonthBarDatum,
      });
    }
  }
  return monthBands;
}

/**
 * Creates a Nivo custom layer that renders accessible `<g>` groups
 * for each month column. Each group carries an aria-label
 * (e.g. "View deals for June") so assistive technology can identify
 * clickable month regions.
 *
 * Click handling is done on the wrapper div (not in this layer) to
 * avoid invisible rects that would intercept pointer events on the
 * chart's bar elements.
 */
export function createAriaLabelLayer(
  getAriaLabel: (monthName: string) => string,
  innerHeight: number,
) {
  const AriaLabelLayer = (props: BarCustomLayerProps<MonthBarDatum>) => {
    const { bars } = props;
    const monthBands = groupBarsByMonth(bars);

    return (
      <g>
        {Array.from(monthBands.values()).map((band) => (
          <g
            key={`aria-${band.datum.date}`}
            aria-label={getAriaLabel(band.datum.monthName)}
          >
            <rect
              x={band.x}
              y={0}
              // Use style for dimensions so this invisible rect does
              // not interfere with Nivo's own bar rect rendering.
              style={{
                width: band.width,
                height: innerHeight,
                pointerEvents: "none",
              }}
              fillOpacity={0}
            />
          </g>
        ))}
      </g>
    );
  };
  return AriaLabelLayer;
}
