import { useTranslate } from "ra-core";

import { cn } from "@/lib/utils";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal, PropensityBucket } from "../types";
import {
  isDealActive,
  type PropensityResult,
} from "../providers/commons/propensityScoring";
import { useDealPropensity } from "./DealPropensityContext";
import { DealPropensityTooltip } from "./DealPropensityTooltip";

/**
 * Low/Medium/High badge rendered on top of a deal's Kanban card. The visible
 * text is the bucket label; the accessible name is
 * "Propensity to buy: Low|Medium|High" so screen readers get the full context
 * without duplicating the bucket on the card. Hovering/focusing the badge
 * opens the DealPropensityTooltip.
 *
 * Returns null when the deal is not scorable (archived, closed stage, or no
 * computed result): the parent card simply doesn't render a badge (AC2).
 */
export const DealPropensityBadge = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { dealPipelineStatuses } = useConfigurationContext();
  const computed = useDealPropensity(deal.id);

  // Archived or closed/won deals never show a badge, even if they carry a
  // leftover manual override (AC2).
  if (!isDealActive(deal, dealPipelineStatuses)) return null;

  const effectiveBucket = resolveBucket(deal, computed);
  if (!effectiveBucket) return null;

  const isManual = isValidBucket(deal.propensity_override);
  const label = translate(`crm.propensity.buckets.${effectiveBucket}`);
  const ariaLabel = translate("crm.propensity.aria_label", { bucket: label });

  return (
    <DealPropensityTooltip
      isManual={isManual}
      factors={isManual ? [] : (computed?.factors ?? [])}
      triggerContent={label}
      trigger={
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex items-center justify-center rounded-md",
            "px-2 py-0.5 text-xs font-medium",
            "cursor-help select-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            BUCKET_CLASSES[effectiveBucket],
          )}
          // Keep the card's click handler (opens the show dialog) from firing
          // when the user interacts with the badge itself.
          onClick={(event) => event.stopPropagation()}
        />
      }
    />
  );
};

const BUCKET_CLASSES: Record<PropensityBucket, string> = {
  low: "bg-muted text-muted-foreground",
  medium:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  high: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
};

const isValidBucket = (
  value: string | null | undefined,
): value is PropensityBucket =>
  value === "low" || value === "medium" || value === "high";

const resolveBucket = (
  deal: Deal,
  computed: PropensityResult | undefined,
): PropensityBucket | null => {
  if (isValidBucket(deal.propensity_override)) {
    return deal.propensity_override;
  }
  return computed?.bucket ?? null;
};
