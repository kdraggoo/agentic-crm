import { Octokit } from "@octokit/rest";
import { githubRepo, githubToken } from "./config.js";
import { formatEvaluation } from "./po/format.js";
import type { PoResult } from "./po/schema.js";
import type { Turn } from "./po/transcript.js";

/**
 * Ideas live in GitHub issues. The issue body shows the idea and its status, plus a
 * hidden state block (the full transcript) so the bot can restart without losing anything.
 * Comments are the human-readable log of each round.
 */

export type IdeaStatus = "clarifying" | "spec-ready" | "rejected";

export interface Idea {
  issueNumber: number;
  issueUrl: string;
  threadId: string;
  title: string;
  status: IdeaStatus;
  transcript: Turn[];
}

const IDEA_LABEL = "idea";
const STATUS_LABELS: Record<
  IdeaStatus,
  { name: string; color: string; description: string }
> = {
  clarifying: {
    name: "po:clarifying",
    color: "fbca04",
    description: "Product owner is asking questions",
  },
  "spec-ready": {
    name: "po:spec-ready",
    color: "0e8a16",
    description: "Spec written, ready to build",
  },
  rejected: {
    name: "po:rejected",
    color: "b60205",
    description: "Doesn't fit the product",
  },
};

const STATE_PATTERN = /<!-- pipeline-state:([A-Za-z0-9+/=]+) -->/;

interface StoredState {
  threadId: string;
  status: IdeaStatus;
  transcript: Turn[];
}

export class IdeaStore {
  private readonly octokit = new Octokit({ auth: githubToken() });
  private readonly repo = githubRepo();

  async ensureLabels(): Promise<void> {
    const wanted = [
      {
        name: IDEA_LABEL,
        color: "5319e7",
        description: "Submitted through the idea pipeline",
      },
      ...Object.values(STATUS_LABELS),
    ];
    const existing = await this.octokit.paginate(
      this.octokit.issues.listLabelsForRepo,
      this.repo,
    );
    const names = new Set(existing.map((label) => label.name));
    for (const label of wanted.filter(
      (candidate) => !names.has(candidate.name),
    )) {
      await this.octokit.issues.createLabel({ ...this.repo, ...label });
    }
  }

  async create(
    threadId: string,
    title: string,
    transcript: Turn[],
  ): Promise<Idea> {
    const state: StoredState = { threadId, status: "clarifying", transcript };
    const { data } = await this.octokit.issues.create({
      ...this.repo,
      title,
      body: renderBody(state),
      labels: [IDEA_LABEL, STATUS_LABELS.clarifying.name],
    });
    return {
      issueNumber: data.number,
      issueUrl: data.html_url,
      title,
      ...state,
    };
  }

  /** Saves the new state, swaps the status label and logs the round as a comment. */
  async recordRound(idea: Idea, comment: string): Promise<void> {
    const state: StoredState = {
      threadId: idea.threadId,
      status: idea.status,
      transcript: idea.transcript,
    };
    await this.octokit.issues.update({
      ...this.repo,
      issue_number: idea.issueNumber,
      body: renderBody(state),
    });
    await this.octokit.issues.setLabels({
      ...this.repo,
      issue_number: idea.issueNumber,
      labels: [IDEA_LABEL, STATUS_LABELS[idea.status].name],
    });
    await this.octokit.issues.createComment({
      ...this.repo,
      issue_number: idea.issueNumber,
      body: comment,
    });
  }

  /** Loads every open idea, keyed by Discord thread ID. */
  async loadOpen(): Promise<Map<string, Idea>> {
    const issues = await this.octokit.paginate(
      this.octokit.issues.listForRepo,
      {
        ...this.repo,
        labels: IDEA_LABEL,
        state: "open",
      },
    );
    const ideas = new Map<string, Idea>();
    for (const issue of issues) {
      const state = parseState(issue.body ?? "");
      if (!state) continue;
      ideas.set(state.threadId, {
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        title: issue.title,
        ...state,
      });
    }
    return ideas;
  }
}

export function statusFor(result: PoResult): IdeaStatus {
  if (result.decision === "ready_for_spec") return "spec-ready";
  if (result.decision === "reject") return "rejected";
  return "clarifying";
}

export function roundComment(result: PoResult, replies: string[]): string {
  const quoted = replies.map((reply) =>
    reply
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
  );
  const header =
    quoted.length > 0
      ? `**Submitter replied**\n\n${quoted.join("\n\n")}\n\n---\n\n`
      : "";
  return `${header}**Product owner**\n\n${formatEvaluation(result)}`;
}

function renderBody(state: StoredState): string {
  const first = state.transcript[0];
  const idea = first?.role === "submitter" ? first.text : "";
  const latest = [...state.transcript]
    .reverse()
    .find((turn) => turn.role === "po");
  const summary =
    latest?.role === "po"
      ? `\n\n**Current understanding:** ${latest.result.summary}`
      : "";
  const encoded = Buffer.from(JSON.stringify(state), "utf8").toString("base64");
  return [
    `**Status:** ${STATUS_LABELS[state.status].description}${summary}`,
    "",
    "## Original idea",
    "",
    idea,
    "",
    "_Managed by the idea pipeline. The conversation happens in Discord; each round is logged below._",
    "",
    `<!-- pipeline-state:${encoded} -->`,
  ].join("\n");
}

function parseState(body: string): StoredState | null {
  const match = STATE_PATTERN.exec(body);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(
      Buffer.from(match[1], "base64").toString("utf8"),
    ) as StoredState;
  } catch {
    return null;
  }
}
