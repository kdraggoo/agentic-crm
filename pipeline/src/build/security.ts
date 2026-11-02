import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PROMPTS_DIR,
  REVIEW_MODEL,
  REVIEW_TIMEOUT_MS,
  buildEnv,
} from "../config.js";
import { runClaude } from "../claude.js";
import {
  ReviewSchema,
  clipDiff,
  formatFinding,
  type ReviewFinding,
} from "./reviewer.js";

/** Paths where a change can affect who may do what. */
const SENSITIVE_PATHS: { prefix: string; why: string }[] = [
  { prefix: "supabase/schemas/", why: "database schema, policies or grants" },
  { prefix: "supabase/migrations/", why: "a database migration" },
  { prefix: "supabase/functions/", why: "an edge function" },
  { prefix: "supabase/config", why: "Supabase configuration" },
  { prefix: "src/components/supabase/", why: "auth pages" },
  {
    prefix: "src/components/atomic-crm/providers/supabase/",
    why: "the Supabase data or auth provider",
  },
  {
    prefix: "src/components/atomic-crm/providers/commons/canAccess",
    why: "role-based access in the app",
  },
  { prefix: "src/components/atomic-crm/login/", why: "the login flow" },
  { prefix: ".github/workflows/", why: "a CI workflow" },
];

/** Added code that renders or forwards untrusted input. */
const SENSITIVE_CODE: { pattern: RegExp; why: string }[] = [
  { pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=/, why: "raw HTML" },
  { pattern: /security\s+definer/i, why: "a security definer function" },
  {
    pattern: /\bto\s+(anon|public)\b/i,
    why: "a grant or policy for anon/public",
  },
  { pattern: /service_role|SERVICE_ROLE_KEY/, why: "the service role" },
];

/**
 * Why a change needs a security review: the sensitive paths it touches and the
 * sensitive code it adds. Empty when it needs none.
 */
export function securityTriggers(diff: string): string[] {
  const triggers = new Set<string>();
  let file = "";
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(\S+)/.exec(line);
    if (header) {
      file = header[1] ?? "";
      for (const { prefix, why } of SENSITIVE_PATHS) {
        if (file.startsWith(prefix)) triggers.add(`${file}: ${why}`);
      }
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const { pattern, why } of SENSITIVE_CODE) {
      if (pattern.test(line)) triggers.add(`${file}: adds ${why}`);
    }
  }
  return [...triggers];
}

/**
 * A second reviewer that looks only at security, for changes that touch the
 * database's access rules, auth, edge functions or raw HTML.
 */
export async function runSecurityReview(
  dir: string,
  input: {
    task: string;
    diff: string;
    triggers: string[];
    previousFindings?: ReviewFinding[];
  },
): Promise<{ findings: ReviewFinding[]; costUsd: number }> {
  const sections = [
    "Review this change for security.",
    input.task,
    "## Triggers",
    ...input.triggers.map((trigger) => `- ${trigger}`),
  ];
  if (input.previousFindings?.length) {
    sections.push(
      "## Your previous blocking findings (the build agent has had one attempt to address them)",
      ...input.previousFindings.map(formatFinding),
    );
  }
  sections.push("## Diff", "```diff", clipDiff(input.diff), "```");

  const { output, costUsd } = await runClaude({
    systemPrompt: await readFile(
      path.join(PROMPTS_DIR, "security-reviewer.md"),
      "utf8",
    ),
    prompt: sections.join("\n\n"),
    schema: ReviewSchema,
    cwd: dir,
    model: REVIEW_MODEL,
    tools: ["Read", "Grep", "Glob"],
    env: buildEnv(),
    timeoutMs: REVIEW_TIMEOUT_MS,
  });
  return {
    findings: output.findings.map((finding) => ({
      ...finding,
      category: "security" as const,
    })),
    costUsd,
  };
}

/**
 * Runs the security reviewer when the diff has triggers, and returns its findings
 * (none, at no cost, when there are no triggers). Pass the previous round's blocking
 * findings so it can check whether they were addressed.
 */
export async function reviewSecurity(
  dir: string,
  input: { task: string; diff: string; previousFindings?: ReviewFinding[] },
  progress: (message: string) => Promise<void>,
): Promise<{ findings: ReviewFinding[]; costUsd: number }> {
  const triggers = securityTriggers(input.diff);
  if (triggers.length === 0) return { findings: [], costUsd: 0 };
  await progress(
    `🔐 Security reviewer is checking the change (${triggers.length} trigger(s))…`,
  );
  return runSecurityReview(dir, {
    ...input,
    triggers,
    previousFindings: input.previousFindings?.filter(
      (finding) => finding.category === "security",
    ),
  });
}
