/**
 * Fixed weights and thresholds for the propensity-to-buy scoring helper.
 *
 * Centralized here so a reviewer can see every tunable in one place (per
 * C-002), and so none of them leaks into components as a magic number. The
 * scoring is intentionally rule-based: no ML, no server call, just the deal's
 * own fields plus the median amount of currently active deals.
 */

/** Possible scored buckets, from least to most likely to close. */
export const PROPENSITY_BUCKETS = ["low", "medium", "high"] as const;

/** Fallback bucket when the inputs are too sparse to score anything. */
export const PROPENSITY_DEFAULT_BUCKET = "medium" as const;

/** Score boundaries, inclusive on the lower end, exclusive on the upper. */
export const PROPENSITY_BUCKET_THRESHOLDS = {
  /** Score >= HIGH_SCORE -> "high". */
  HIGH_SCORE: 65,
  /** LOW_SCORE <= score < HIGH_SCORE -> "medium". */
  LOW_SCORE: 35,
} as const;

/** Max contribution of each factor to the final 0-100 score. */
export const PROPENSITY_FACTOR_WEIGHTS = {
  /** How far the deal has moved along the pipeline. */
  stage: 30,
  /** How recent the latest activity (note or task) on the deal is. */
  activityRecency: 25,
  /** How large the deal amount is relative to the median active deal. */
  amount: 15,
  /** How recent the latest deal note is. */
  dealNoteRecency: 15,
  /** How close the expected closing date is. */
  closingSoon: 15,
} as const;

/**
 * Age (days) considered "very recent" and "stale" for the activity-recency
 * and deal-note-recency signals.
 */
export const PROPENSITY_ACTIVITY_WINDOWS = {
  /** <= HOT_DAYS maps to a full score for the recency factor. */
  HOT_DAYS: 7,
  /** > COLD_DAYS maps to zero for the recency factor. */
  COLD_DAYS: 60,
} as const;

/**
 * Expected-closing-date window: a deal closing within SOON_DAYS gets a full
 * score for the "closing soon" factor; past FAR_DAYS it gets nothing.
 */
export const PROPENSITY_CLOSING_WINDOWS = {
  SOON_DAYS: 30,
  FAR_DAYS: 120,
} as const;

/**
 * Amount ratios (deal.amount / median of active deal amounts) that map to
 * the min and max of the amount factor.
 */
export const PROPENSITY_AMOUNT_RATIOS = {
  /** Below SMALL -> zero. */
  SMALL: 0.25,
  /** Above LARGE -> full score. */
  LARGE: 2,
} as const;
