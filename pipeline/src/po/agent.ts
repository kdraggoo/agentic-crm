import { readFile } from "node:fs/promises";
import path from "node:path";
import { PO_MODEL, PO_TIMEOUT_MS, PROMPTS_DIR, REPO_DIR } from "../config.js";
import { runClaude } from "../claude.js";
import { PoResultSchema, type PoResult } from "./schema.js";
import { renderTranscript, type Turn } from "./transcript.js";

const CONTEXT_FILES = [
  "README.md",
  "features.md",
  "constraints.md",
  "architecture.md",
];

/** Read-only: the agent may check the code when the docs are not enough, never change it. */
const PO_TOOLS = ["Read", "Grep", "Glob"];

async function buildSystemPrompt(): Promise<string> {
  const role = await readFile(
    path.join(PROMPTS_DIR, "product-owner.md"),
    "utf8",
  );
  const docs = await Promise.all(
    CONTEXT_FILES.map(async (file) => {
      const content = await readFile(
        path.join(REPO_DIR, "docs", "product", file),
        "utf8",
      );
      return `<document path="docs/product/${file}">\n${content}\n</document>`;
    }),
  );
  return `${role}\n\n# Product context\n\n${docs.join("\n\n")}`;
}

export interface Evaluation {
  result: PoResult;
  costUsd: number;
  turns: number;
}

/** Evaluates an idea given the full conversation so far. Stateless: callers keep the transcript. */
export async function evaluateIdea(transcript: Turn[]): Promise<Evaluation> {
  const systemPrompt = await buildSystemPrompt();
  const prompt = [
    "Evaluate this idea. The conversation so far, oldest first:",
    renderTranscript(transcript),
    "Respond with your evaluation of the idea as it stands now.",
  ].join("\n\n");

  const { output, costUsd, turns } = await runClaude({
    systemPrompt,
    prompt,
    schema: PoResultSchema,
    cwd: REPO_DIR,
    model: PO_MODEL,
    tools: PO_TOOLS,
    timeoutMs: PO_TIMEOUT_MS,
  });
  return { result: output, costUsd, turns };
}
