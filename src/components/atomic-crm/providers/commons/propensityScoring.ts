/**
 * Propensity-to-buy scoring for a single deal.
 *
 * The score is produced client-side from fields that are already fetched when
 * the Kanban board renders (plus a median amount computed from the current
 * active-deal set). The output is both a Low/Medium/High bucket (so the badge
 * can render) and the list of contributing factors (so the tooltip can name
 * the top ones).
 *
 * "Activity" means the single most-recent of: the latest contact note on any
 * linked contact of the deal, the latest deal note, and the latest task on a
 * linked contact — whichever is the newest. If none of those exist, the
 * activity factor contributes zero (not undefined), so the overall score
 * degrades gracefully for an unknown-activity deal rather than throwing.
 *
 * Rules out of scope on purpose:
 * - Archived deals and deals in a stage flagged `won` or `closed` via
 *   `dealPipelineStatuses` are not scored by the caller.
 * - A manual override (deal.propensity_override) bypasses the formula; the
 *   caller handles that path and asks this helper only for the computed value.
 */
import type { Deal, DealStage, LabeledValue } from "../../types";
import {
  PROPENSITY_ACTIVITY_WINDOWS,
  PROPENSITY_AMOUNT_RATIOS,
  PROPENSITY_BUCKET_THRESHOLDS,
  PROPENSITY_CLOSING_WINDOWS,
  PROPENSITY_DEFAULT_BUCKET,
  PROPENSITY_FACTOR_WEIGHTS,
} from "./propensityConstants";

export type PropensityBucket = "low" | "medium" | "high";

/** All factors the helper weighs. Used as a translation key suffix. */
export type PropensityFactorKey =
  "stage" | "activityRecency" | "amount" | "dealNoteRecency" | "closingSoon";

export interface PropensityFactor {
  /** Which factor this is. The UI translates it, so keep the string stable. */
  key: PropensityFactorKey;
  /** Normalized score for this factor, 0..1. */
  score: number;
  /** Weighted contribution to the final 0..100 score. */
  weight: number;
}

export interface PropensityResult {
  bucket: PropensityBucket;
  /** 0..100 raw score for debugging. */
  score: number;
  /**
   * Contributing factors, sorted strongest-first. Factors that could not be
   * evaluated (e.g. missing date, no active deals to compute the median) are
   * excluded from this list; they do not drag the score down with a 0.
   */
  factors: PropensityFactor[];
}

export interface PropensityContext {
  /** All configured stages, in pipeline order (first = earliest). */
  dealStages: readonly LabeledValue[] | readonly DealStage[];
  /**
   * Stages flagged as "closed" via `dealPipelineStatuses` (default: ["won"]).
   * They are excluded from the stage-position ranking so the active pipeline
   * tops out at 1.0 — otherwise a terminal stage (won/lost) would
   * mathematically outrank "in-negociation".
   */
  closedStages?: readonly string[];
  /**
   * Median amount of the deals considered "active" (not archived, not in a
   * closed/won stage). The caller computes this once over the Kanban dataset.
   * Falsy or non-positive values are treated as unknown.
   */
  medianActiveAmount?: number | null;
  /**
   * Latest activity date on the deal: the newest of the deal notes, contact
   * notes on linked contacts, and tasks on linked contacts. ISO string or
   * undefined when no such event exists.
   */
  latestActivityDate?: string | null;
  /** Latest deal-note date, if any. ISO string. */
  latestDealNoteDate?: string | null;
  /**
   * Current time, defaulting to new Date() if omitted. Dependency-injected to
   * keep tests deterministic.
   */
  now?: Date;
}

/**
 * Returns the Low/Medium/High bucket for a deal and the factors that drove
 * the score. The caller is expected to pass pre-computed context values; this
 * function does not query the dataProvider.
 */
export function scoreDeal(
  deal: Pick<Deal, "amount" | "stage" | "expected_closing_date">,
  context: PropensityContext,
): PropensityResult {
  const now = context.now ?? new Date();

  const factors: PropensityFactor[] = [];
  const push = (key: PropensityFactorKey, score: number) => {
    const clamped = clamp01(score);
    if (!Number.isFinite(clamped)) return;
    factors.push({
      key,
      score: clamped,
      weight: clamped * PROPENSITY_FACTOR_WEIGHTS[key],
    });
  };

  const stageScore = scoreStage(
    deal.stage,
    context.dealStages,
    context.closedStages ?? [],
  );
  if (stageScore !== null) push("stage", stageScore);

  const activity = scoreRecency(context.latestActivityDate, now);
  if (activity !== null) push("activityRecency", activity);

  const dealNote = scoreRecency(context.latestDealNoteDate, now);
  if (dealNote !== null) push("dealNoteRecency", dealNote);

  const closing = scoreClosing(deal.expected_closing_date, now);
  if (closing !== null) push("closingSoon", closing);

  const amount = scoreAmount(deal.amount, context.medianActiveAmount);
  if (amount !== null) push("amount", amount);

  if (factors.length === 0) {
    // No input could be evaluated — fall back to Medium, as documented.
    return { bucket: PROPENSITY_DEFAULT_BUCKET, score: 50, factors: [] };
  }

  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const maxPossible = factors.reduce(
    (sum, f) => sum + PROPENSITY_FACTOR_WEIGHTS[f.key],
    0,
  );
  // Normalize to 0..100 against the max weight actually in play, so a deal
  // with sparse inputs can still reach "high" when every evaluated factor is
  // strong (rather than being capped by missing-signal zeros).
  const score = maxPossible > 0 ? (totalWeight / maxPossible) * 100 : 50;

  const sortedFactors = [...factors].sort((a, b) => b.weight - a.weight);

  return {
    bucket: toBucket(score),
    score,
    factors: sortedFactors,
  };
}

const toBucket = (score: number): PropensityBucket => {
  if (score >= PROPENSITY_BUCKET_THRESHOLDS.HIGH_SCORE) return "high";
  if (score < PROPENSITY_BUCKET_THRESHOLDS.LOW_SCORE) return "low";
  return "medium";
};

const scoreStage = (
  stage: string,
  dealStages: PropensityContext["dealStages"],
  closedStages: readonly string[],
): number | null => {
  if (!dealStages.length) return null;
  // Only rank active (non-closed) stages. The configuration lists terminal
  // stages like "won", "lost" or "delayed" after the active ones in the
  // Settings UI, but they must not count toward "pipeline advancement".
  const activeStages = dealStages.filter(
    (s) => !closedStages.includes(s.value),
  );
  const pool = activeStages.length > 0 ? activeStages : dealStages;
  const index = pool.findIndex((s) => s.value === stage);
  if (index < 0) return null;
  if (pool.length === 1) return 1;
  return index / (pool.length - 1);
};

const scoreRecency = (
  iso: string | null | undefined,
  now: Date,
): number | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const days = (now.getTime() - date.getTime()) / MS_PER_DAY;
  const hot = PROPENSITY_ACTIVITY_WINDOWS.HOT_DAYS;
  const cold = PROPENSITY_ACTIVITY_WINDOWS.COLD_DAYS;
  if (days <= hot) return 1;
  if (days >= cold) return 0;
  return 1 - (days - hot) / (cold - hot);
};

const scoreClosing = (
  iso: string | null | undefined,
  now: Date,
): number | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const days = (date.getTime() - now.getTime()) / MS_PER_DAY;
  const soon = PROPENSITY_CLOSING_WINDOWS.SOON_DAYS;
  const far = PROPENSITY_CLOSING_WINDOWS.FAR_DAYS;
  // Deals already past their expected closing date still get the maximum
  // signal — they are "due now".
  if (days <= soon) return 1;
  if (days >= far) return 0;
  return 1 - (days - soon) / (far - soon);
};

const scoreAmount = (
  amount: number | null | undefined,
  median: number | null | undefined,
): number | null => {
  if (!Number.isFinite(amount) || amount == null) return null;
  if (!Number.isFinite(median) || median == null || median <= 0) return null;
  const ratio = amount / median;
  const small = PROPENSITY_AMOUNT_RATIOS.SMALL;
  const large = PROPENSITY_AMOUNT_RATIOS.LARGE;
  if (ratio <= small) return 0;
  if (ratio >= large) return 1;
  return (ratio - small) / (large - small);
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Convenience: compute the median of a positive number list, or null if
 * empty. The helper does not throw on an empty input — the division-by-zero
 * risk the spec flags is handled here.
 */
export const medianAmount = (amounts: readonly number[]): number | null => {
  const positive = amounts.filter(
    (n): n is number => Number.isFinite(n) && n > 0,
  );
  if (positive.length === 0) return null;
  const sorted = [...positive].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * True when the deal is "active" (should get a badge): not archived, not in
 * a stage flagged won/closed by `dealPipelineStatuses`.
 */
export const isDealActive = (
  deal: Pick<Deal, "stage" | "archived_at">,
  dealPipelineStatuses: readonly string[],
): boolean => {
  if (deal.archived_at) return false;
  return !dealPipelineStatuses.includes(deal.stage);
};
