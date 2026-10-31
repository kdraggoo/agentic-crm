import { Octokit } from "@octokit/rest";
import type { TestDispute } from "./build/agents.js";
import { githubRepo, githubToken } from "./config.js";
import { formatEvaluation } from "./po/format.js";
import type { PoResult, Spec } from "./po/schema.js";
import type { Turn } from "./po/transcript.js";

/**
 * Ideas live in GitHub issues. The issue body shows the idea and its status, plus a
 * hidden state block (the full transcript) so the bot can restart without losing anything.
 * Comments are the human-readable log of each round.
 */

export type IdeaStatus =
  | "clarifying"
  | "spec-ready"
  | "rejected"
  | "building"
  | "test-dispute"
  | "in-review"
  | "build-failed"
  | "merged";

export interface Idea {
  issueNumber: number;
  issueUrl: string;
  threadId: string;
  title: string;
  status: IdeaStatus;
  transcript: Turn[];
  /** Set once a build has started. */
  branch?: string;
  /** Set once a build has opened a pull request. */
  pullRequestUrl?: string;
  /** Locked tests the build agent disputed, waiting for the owner's decision. */
  disputes?: TestDispute[];
  /** Transcript index of the product-owner turn whose spec the pull request implements. */
  builtTurn?: number;
}

export interface PullRequestState {
  number: number;
  open: boolean;
  merged: boolean;
  /** GitHub's mergeable_state: "clean" means mergeable with every check green. */
  mergeableState: string;
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
  building: {
    name: "build:in-progress",
    color: "1d76db",
    description: "Test and build agents are working on it",
  },
  "test-dispute": {
    name: "build:test-dispute",
    color: "fbca04",
    description: "Build paused: the build agent disputes a locked test",
  },
  "in-review": {
    name: "build:in-review",
    color: "0e8a16",
    description: "Built, reviewed and CI green; pull request open for review",
  },
  "build-failed": {
    name: "build:failed",
    color: "d93f0b",
    description: "The build did not pass its checks",
  },
  merged: {
    name: "build:merged",
    color: "6f42c1",
    description: "Merged into main",
  },
};

const STATE_PATTERN = /<!-- pipeline-state:([A-Za-z0-9+/=]+) -->/;

interface StoredState {
  threadId: string;
  status: IdeaStatus;
  transcript: Turn[];
  branch?: string;
  pullRequestUrl?: string;
  disputes?: TestDispute[];
  builtTurn?: number;
}

function toState(idea: Idea): StoredState {
  return {
    threadId: idea.threadId,
    status: idea.status,
    transcript: idea.transcript,
    branch: idea.branch,
    pullRequestUrl: idea.pullRequestUrl,
    disputes: idea.disputes,
    builtTurn: idea.builtTurn,
  };
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

  /** Saves the idea's state, swaps the status label and optionally logs a comment. */
  async save(idea: Idea, comment?: string): Promise<void> {
    await this.octokit.issues.update({
      ...this.repo,
      issue_number: idea.issueNumber,
      body: renderBody(toState(idea)),
    });
    await this.octokit.issues.setLabels({
      ...this.repo,
      issue_number: idea.issueNumber,
      labels: [IDEA_LABEL, STATUS_LABELS[idea.status].name],
    });
    if (comment) {
      await this.octokit.issues.createComment({
        ...this.repo,
        issue_number: idea.issueNumber,
        body: comment,
      });
    }
  }

  /** Opens a pull request for the branch, or updates the open one if a rebuild reused it. */
  async openPullRequest(
    branch: string,
    title: string,
    body: string,
  ): Promise<string> {
    const { data: existing } = await this.octokit.pulls.list({
      ...this.repo,
      head: `${this.repo.owner}:${branch}`,
      state: "open",
    });
    const open = existing[0];
    if (open) {
      await this.octokit.pulls.update({
        ...this.repo,
        pull_number: open.number,
        title,
        body,
      });
      return open.html_url;
    }
    const { data } = await this.octokit.pulls.create({
      ...this.repo,
      head: branch,
      base: "main",
      title,
      body,
    });
    return data.html_url;
  }

  async pullRequest(url: string): Promise<PullRequestState> {
    const pull_number = pullNumberFrom(url);
    // GitHub computes mergeability in the background; it reads "unknown" until then.
    for (let attempt = 0; ; attempt++) {
      const { data } = await this.octokit.pulls.get({
        ...this.repo,
        pull_number,
      });
      if (
        data.mergeable_state !== "unknown" ||
        data.state !== "open" ||
        attempt >= 5
      ) {
        return {
          number: data.number,
          open: data.state === "open",
          merged: data.merged,
          mergeableState: data.mergeable_state,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  /** Squash-merges the pull request. */
  async merge(pullNumber: number, title: string): Promise<void> {
    await this.octokit.pulls.merge({
      ...this.repo,
      pull_number: pullNumber,
      merge_method: "squash",
      commit_title: `${title} (#${pullNumber})`,
    });
  }

  /** Closes the idea's issue as done and deletes its branch on GitHub. */
  async close(idea: Idea): Promise<void> {
    await this.octokit.issues.update({
      ...this.repo,
      issue_number: idea.issueNumber,
      state: "closed",
      state_reason: "completed",
    });
    if (idea.branch) {
      await this.octokit.git
        .deleteRef({ ...this.repo, ref: `heads/${idea.branch}` })
        .catch(() => undefined);
    }
  }

  /** Loads one idea by issue number. */
  async get(issueNumber: number): Promise<Idea> {
    const { data: issue } = await this.octokit.issues.get({
      ...this.repo,
      issue_number: issueNumber,
    });
    const state = parseState(issue.body ?? "");
    if (!state) throw new Error(`Issue #${issueNumber} is not a pipeline idea`);
    return {
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      title: issue.title,
      ...state,
    };
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

export function pullNumberFrom(url: string): number {
  const match = /\/pull\/(\d+)/.exec(url);
  if (!match?.[1]) throw new Error(`Not a pull request URL: ${url}`);
  return Number(match[1]);
}

export function statusFor(result: PoResult): IdeaStatus {
  if (result.decision === "ready_for_spec") return "spec-ready";
  if (result.decision === "reject") return "rejected";
  return "clarifying";
}

/** The spec from the product owner's latest evaluation, if it wrote one. */
export function latestSpec(idea: Idea): Spec | null {
  const index = latestPoTurn(idea);
  const latest = index === -1 ? undefined : idea.transcript[index];
  return latest?.role === "po" ? latest.result.spec : null;
}

/** Transcript index of the product owner's latest evaluation, or -1. */
export function latestPoTurn(idea: Idea): number {
  for (let index = idea.transcript.length - 1; index >= 0; index--) {
    if (idea.transcript[index]?.role === "po") return index;
  }
  return -1;
}

/** The spec the open pull request implements, and the feedback given since. */
export function builtVersion(
  idea: Idea,
): { spec: Spec; feedback: string[] } | null {
  if (idea.builtTurn === undefined) return null;
  const built = idea.transcript[idea.builtTurn];
  if (built?.role !== "po" || !built.result.spec) return null;
  const feedback = idea.transcript
    .slice(idea.builtTurn + 1)
    .flatMap((turn) =>
      turn.role === "submitter" && turn.feedback ? [turn.text] : [],
    );
  return { spec: built.result.spec, feedback };
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
  const links = [
    state.branch ? `**Branch:** \`${state.branch}\`` : "",
    state.pullRequestUrl ? `**Pull request:** ${state.pullRequestUrl}` : "",
  ].filter(Boolean);
  const encoded = Buffer.from(JSON.stringify(state), "utf8").toString("base64");
  return [
    `**Status:** ${STATUS_LABELS[state.status].description}${summary}`,
    ...(links.length > 0 ? ["", ...links] : []),
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
