export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export type PresetKey =
  "this_month" | "this_quarter" | "next_month" | "next_quarter";

/**
 * Returns the first and last day of the current calendar month.
 */
export function getThisMonth(now: Date = new Date()): DateRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  return {
    from: formatDate(year, month, 1),
    to: formatDate(year, month, lastDayOfMonth(year, month)),
  };
}

/**
 * Returns the first and last day of the current calendar quarter.
 * Calendar quarters: Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec.
 */
export function getThisQuarter(now: Date = new Date()): DateRange {
  const year = now.getFullYear();
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const quarterEndMonth = quarterStartMonth + 2;
  return {
    from: formatDate(year, quarterStartMonth, 1),
    to: formatDate(
      year,
      quarterEndMonth,
      lastDayOfMonth(year, quarterEndMonth),
    ),
  };
}

/**
 * Returns the first and last day of the next calendar month.
 */
export function getNextMonth(now: Date = new Date()): DateRange {
  const year =
    now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
  const month = (now.getMonth() + 1) % 12;
  return {
    from: formatDate(year, month, 1),
    to: formatDate(year, month, lastDayOfMonth(year, month)),
  };
}

/**
 * Returns the first and last day of the next calendar quarter.
 */
export function getNextQuarter(now: Date = new Date()): DateRange {
  const currentQuarterStart = Math.floor(now.getMonth() / 3) * 3;
  const nextQuarterStart = currentQuarterStart + 3;
  const year =
    nextQuarterStart > 11 ? now.getFullYear() + 1 : now.getFullYear();
  const startMonth = nextQuarterStart % 12;
  const endMonth = startMonth + 2;
  return {
    from: formatDate(year, startMonth, 1),
    to: formatDate(year, endMonth, lastDayOfMonth(year, endMonth)),
  };
}

export function getPresetRange(key: PresetKey, now?: Date): DateRange {
  switch (key) {
    case "this_month":
      return getThisMonth(now);
    case "this_quarter":
      return getThisQuarter(now);
    case "next_month":
      return getNextMonth(now);
    case "next_quarter":
      return getNextQuarter(now);
  }
}

/**
 * Returns the date string (YYYY-MM-DD) for the day after the given date.
 * Useful for timestamp columns where `< next_day` is the correct way to
 * express "on or before `date`" (since timestamps have time components).
 */
export function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return formatDate(d.getFullYear(), d.getMonth(), d.getDate());
}

function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the next month gives the last day of the current month
  return new Date(year, month + 1, 0).getDate();
}

function formatDate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}
