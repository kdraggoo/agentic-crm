import { CLOSE_AFTER_DAYS } from "./config.js";
import type { Idea } from "./ideas.js";

const DAY_MS = 24 * 60 * 60_000;

/**
 * Nothing more will happen on an answered question or a rejected idea unless the owner
 * replies. One with a branch or a pull request has work attached, so it stays open.
 */
export function isClosable(idea: Idea): boolean {
  return (
    (idea.status === "answered" || idea.status === "rejected") &&
    !idea.branch &&
    !idea.pullRequestUrl
  );
}

/** Whether a closable idea has had no activity for `CLOSE_AFTER_DAYS`. */
export function isDueToClose(idea: Idea, now: Date): boolean {
  const lastActivity = idea.transcript.at(-1)?.at;
  if (!isClosable(idea) || !lastActivity) return false;
  const idleMs = now.getTime() - new Date(lastActivity).getTime();
  return idleMs >= CLOSE_AFTER_DAYS * DAY_MS;
}
