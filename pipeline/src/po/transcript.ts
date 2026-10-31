import type { PoResult } from "./schema.js";

/** One exchange in an idea's conversation, oldest first. */
export type Turn =
  | {
      role: "submitter";
      author: string;
      text: string;
      at: string;
      /** Sent after the spec was built: feedback from trying the demo. */
      feedback?: boolean;
    }
  | { role: "po"; result: PoResult; at: string };

export function renderTranscript(turns: Turn[]): string {
  return turns
    .map((turn, index) => {
      if (turn.role === "submitter") {
        const label =
          index === 0
            ? "Original idea"
            : turn.feedback
              ? "Feedback after trying the built demo of your latest spec"
              : "Reply";
        return `## ${label} from ${turn.author} (${turn.at})\n\n${turn.text}`;
      }
      return `## Your previous evaluation (${turn.at})\n\n\`\`\`json\n${JSON.stringify(turn.result, null, 2)}\n\`\`\``;
    })
    .join("\n\n");
}
