import type { ReactElement, ReactNode } from "react";
import { useTranslate } from "ra-core";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { PropensityFactor } from "../providers/commons/propensityScoring";

/** Max factors to name in the tooltip, per the spec ("top two"). */
const TOP_FACTOR_COUNT = 2;

/**
 * Tooltip wrapper for the propensity badge: renders either the "Set manually"
 * line (for a manual override) or a short bullet list of the top contributing
 * factors. Open/close is left to Base UI, which handles hover and focus.
 *
 * `trigger` is cloned into `<TooltipTrigger render={...} />` so the badge
 * itself stays owned by the caller (DealPropensityBadge). `triggerContent`
 * is the Badge's own children (the bucket label). This separation keeps
 * DealCard small by splitting the badge and the tooltip (constraint C-054).
 */
export const DealPropensityTooltip = ({
  isManual,
  factors,
  trigger,
  triggerContent,
}: {
  isManual: boolean;
  factors: readonly PropensityFactor[];
  trigger: ReactElement;
  triggerContent: ReactNode;
}) => {
  const translate = useTranslate();

  const topFactors = factors
    .filter((f) => f.weight > 0)
    .slice(0, TOP_FACTOR_COUNT);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={trigger}>{triggerContent}</TooltipTrigger>
        <TooltipContent
          role="tooltip"
          // Disable the exit animation so a closing tooltip from the previous
          // hover doesn't overlap with the next one. Overlap leaves two
          // role="tooltip" elements in the DOM for a frame, which trips
          // Playwright's strict-mode queries.
          className="data-closed:hidden data-closed:animate-none"
        >
          {isManual ? (
            <span>{translate("crm.propensity.manual_override")}</span>
          ) : topFactors.length === 0 ? (
            <span>{translate("crm.propensity.no_factors")}</span>
          ) : (
            <ul className="list-disc pl-4 space-y-0.5">
              {topFactors.map((factor) => (
                <li key={factor.key}>
                  {translate(`crm.propensity.factors.${factor.key}`)}
                </li>
              ))}
            </ul>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
