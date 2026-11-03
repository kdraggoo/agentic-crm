import { useEffect, useRef, useState } from "react";
import { useListFilterContext, useTranslate } from "ra-core";
import { useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getPresetRange,
  nextDay,
  type DateRange,
  type PresetKey,
} from "./dateRangePresets";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "this_month", label: "resources.deals.filters.this_month" },
  { key: "this_quarter", label: "resources.deals.filters.this_quarter" },
  { key: "next_month", label: "resources.deals.filters.next_month" },
  { key: "next_quarter", label: "resources.deals.filters.next_quarter" },
];

interface DateRangeFilterInputProps {
  source: string;
  label?: string;
  /**
   * When true, the upper-bound filter uses `@lt` with the day after the
   * selected end date instead of `@lte` with the end date itself. This
   * is necessary for timestamp columns (like `created_at`) where the
   * stored values include a time component: `@lte "2026-11-30"` would
   * exclude records created on Nov 30 after midnight.
   */
  isTimestamp?: boolean;
  // Props passed by FilterFormInput that we accept but don't use
  resource?: string;
  record?: unknown;
  size?: string;
  helperText?: boolean;
  defaultValue?: unknown;
}

type Mode = PresetKey | "custom" | null;

/**
 * A filter input that lets the user pick a date range via preset buttons
 * (This month, This quarter, Next month, Next quarter) or a custom from/to
 * range. For date columns, sets `{source}@gte` and `{source}@lte`.
 * For timestamp columns (`isTimestamp`), sets `{source}@gte` and
 * `{source}@lt` (with the next day) to correctly include the last day.
 */
export const DateRangeFilterInput = ({
  source,
  isTimestamp = false,
}: DateRangeFilterInputProps) => {
  const translate = useTranslate();
  const { setValue, getValues } = useFormContext();
  const { filterValues, displayedFilters, setFilters } = useListFilterContext();

  const gteKey = `${source}@gte`;
  // For timestamp columns, use @lt with the next day instead of @lte with
  // the end date, so that records created on the last day are included.
  const upperBoundKey = isTimestamp ? `${source}@lt` : `${source}@lte`;

  // Derive mode from current filter values on mount
  const [mode, setMode] = useState<Mode>(() =>
    inferMode(filterValues, source, isTimestamp),
  );
  const [customFrom, setCustomFrom] = useState(
    () => (filterValues[gteKey] as string) ?? "",
  );
  const [customTo, setCustomTo] = useState(() =>
    recoverDisplayDate(filterValues, source, isTimestamp),
  );

  // Keep refs for cleanup to avoid stale closures
  const filterValuesRef = useRef(filterValues);
  filterValuesRef.current = filterValues;
  const displayedFiltersRef = useRef(displayedFilters);
  displayedFiltersRef.current = displayedFilters;

  // Cleanup on unmount: remove the gte/upper-bound filter values
  useEffect(() => {
    return () => {
      const current = { ...filterValuesRef.current };
      let changed = false;
      if (gteKey in current) {
        delete current[gteKey];
        changed = true;
      }
      if (upperBoundKey in current) {
        delete current[upperBoundKey];
        changed = true;
      }
      if (changed) {
        setFilters(current, displayedFiltersRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gteKey, upperBoundKey]);

  const applyRange = (range: DateRange) => {
    setValue(gteKey, range.from, { shouldDirty: true });
    setValue(upperBoundKey, isTimestamp ? nextDay(range.to) : range.to, {
      shouldDirty: true,
    });
  };

  const handlePresetClick = (presetKey: PresetKey) => {
    setMode(presetKey);
    const range = getPresetRange(presetKey);
    applyRange(range);
    setCustomFrom(range.from);
    setCustomTo(range.to);
  };

  const handleCustomClick = () => {
    setMode("custom");
    // Clear any preset range — keep existing custom values if any
    const currentGte = getValues(gteKey) as string | undefined;
    const currentUpperBound = getValues(upperBoundKey) as string | undefined;
    if (!currentGte && !currentUpperBound) {
      // Clear filters when switching to custom with no values
      setValue(gteKey, undefined, { shouldDirty: true });
      setValue(upperBoundKey, undefined, { shouldDirty: true });
    }
  };

  const handleFromChange = (value: string) => {
    setCustomFrom(value);
    setValue(gteKey, value || undefined, { shouldDirty: true });
  };

  const handleToChange = (value: string) => {
    setCustomTo(value);
    const filterValue =
      value && isTimestamp ? nextDay(value) : value || undefined;
    setValue(upperBoundKey, filterValue, { shouldDirty: true });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(({ key, label }) => (
          <Button
            key={key}
            type="button"
            variant={mode === key ? "default" : "outline"}
            size="sm"
            onClick={() => handlePresetClick(key)}
          >
            {translate(label)}
          </Button>
        ))}
        <Button
          type="button"
          variant={mode === "custom" ? "default" : "outline"}
          size="sm"
          onClick={handleCustomClick}
        >
          {translate("resources.deals.filters.custom")}
        </Button>
      </div>
      {mode === "custom" && (
        <div className="flex items-center gap-2">
          <div>
            <Label htmlFor={`${source}-from`}>
              {translate("resources.deals.filters.from")}
            </Label>
            <Input
              id={`${source}-from`}
              type="date"
              value={customFrom}
              onChange={(e) => handleFromChange(e.target.value)}
              aria-label={translate("resources.deals.filters.from")}
            />
          </div>
          <div>
            <Label htmlFor={`${source}-to`}>
              {translate("resources.deals.filters.to")}
            </Label>
            <Input
              id={`${source}-to`}
              type="date"
              value={customTo}
              onChange={(e) => handleToChange(e.target.value)}
              aria-label={translate("resources.deals.filters.to")}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Recover the user-visible "to" date from filter values.
 * For timestamp sources, the stored value is `@lt` with the next day,
 * so we subtract a day to show the original end date.
 */
function recoverDisplayDate(
  filterValues: Record<string, unknown>,
  source: string,
  isTimestamp: boolean,
): string {
  if (isTimestamp) {
    const ltValue = filterValues[`${source}@lt`] as string | undefined;
    if (!ltValue) return "";
    // Subtract one day to get the display date
    const d = new Date(ltValue + "T00:00:00");
    d.setDate(d.getDate() - 1);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }
  return (filterValues[`${source}@lte`] as string) ?? "";
}

/**
 * Infer the UI mode from existing filter values (e.g. from URL restoration).
 */
function inferMode(
  filterValues: Record<string, unknown>,
  source: string,
  isTimestamp: boolean,
): Mode {
  const gte = filterValues[`${source}@gte`] as string | undefined;
  const upperBound = isTimestamp
    ? (filterValues[`${source}@lt`] as string | undefined)
    : (filterValues[`${source}@lte`] as string | undefined);

  if (!gte && !upperBound) return null;

  // Check if the values match any preset
  const now = new Date();
  for (const key of [
    "this_month",
    "this_quarter",
    "next_month",
    "next_quarter",
  ] as PresetKey[]) {
    const range = getPresetRange(key, now);
    const expectedUpperBound = isTimestamp ? nextDay(range.to) : range.to;
    if (range.from === gte && expectedUpperBound === upperBound) {
      return key;
    }
  }

  return "custom";
}
