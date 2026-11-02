import type { Idea } from "./ideas.js";

/**
 * Not a build failure comment on purpose (see `BUILD_FAILED_HEADING`): "continue" still
 * gives the build agent the last real problem, not the restart.
 */
const INTERRUPTED_MESSAGE =
  "⚠️ The bot restarted while this build was running or queued, so the build stopped. Any work so far is still in its worktree. Reply **continue** to keep going from that work, or **approve** to start over.";

export interface RecoveryDeps {
  /** Stores the idea's new status, with a comment for the issue's log. */
  save: (idea: Idea, comment: string) => Promise<void>;
  /** Updates the idea's Discord thread: its status tag and a message. */
  notify: (idea: Idea, message: string) => Promise<void>;
}

/**
 * Builds run inside the bot's process, so at startup none can be running. An idea still
 * marked "building" was interrupted, and would otherwise answer every reply with "a
 * build is running". Marks each one failed and returns the issue numbers recovered.
 */
export async function recoverInterruptedBuilds(
  ideas: Iterable<Idea>,
  deps: RecoveryDeps,
): Promise<number[]> {
  const recovered: number[] = [];
  for (const idea of ideas) {
    if (idea.status !== "building") continue;
    idea.status = "build-failed";
    try {
      await deps.save(idea, INTERRUPTED_MESSAGE);
      recovered.push(idea.issueNumber);
      await deps.notify(idea, INTERRUPTED_MESSAGE);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Could not fully recover #${idea.issueNumber} after the restart: ${message}`,
      );
    }
  }
  return recovered;
}
