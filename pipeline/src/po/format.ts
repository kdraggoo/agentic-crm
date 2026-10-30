import type { PoResult, Spec } from "./schema.js";

const CLASSIFICATION_LABEL: Record<PoResult["classification"], string> = {
  iteration: "Iteration of an existing feature",
  new_feature: "New feature",
  conflict: "Conflicts with something existing",
  out_of_scope: "Out of scope",
  unclear: "Unclear so far",
};

const STATUS_ICON: Record<
  PoResult["constraint_findings"][number]["status"],
  string
> = {
  ok: "✅",
  risk: "⚠️",
  violation: "⛔",
};

/** Markdown rendering shared by Discord and GitHub. */
export function formatEvaluation(result: PoResult): string {
  const lines: string[] = [
    `**${result.summary}**`,
    `*${CLASSIFICATION_LABEL[result.classification]}*`,
  ];

  if (result.related_features.length > 0) {
    lines.push("", "**Related features**");
    for (const feature of result.related_features) {
      lines.push(`- \`${feature.id}\`: ${feature.relation}`);
    }
  }

  const flagged = result.constraint_findings.filter(
    (finding) => finding.status !== "ok",
  );
  if (flagged.length > 0) {
    lines.push("", "**Constraint concerns**");
    for (const finding of flagged) {
      lines.push(
        `- ${STATUS_ICON[finding.status]} \`${finding.id}\`: ${finding.note}`,
      );
    }
  }

  if (result.decision === "needs_answers") {
    lines.push("", "**Questions**");
    result.questions.forEach((question, index) => {
      lines.push(
        `${index + 1}. ${question.question}`,
        `   *Why:* ${question.why}`,
      );
      if (question.options.length > 0) {
        lines.push(
          `   *Options:* ${question.options.map((option) => `\`${option}\``).join(" · ")}`,
        );
      }
    });
    lines.push("", "Reply in this thread. Answering by number is fine.");
  }

  if (result.decision === "reject") {
    lines.push(
      "",
      "**Not a fit**",
      result.rejection_reason ?? "No reason given.",
    );
  }

  if (result.decision === "ready_for_spec" && result.spec) {
    lines.push("", formatSpec(result.spec));
  }

  return lines.join("\n");
}

export function formatSpec(spec: Spec): string {
  const list = (items: string[]) =>
    items.length > 0 ? items.map((item) => `- ${item}`) : ["- None"];
  return [
    `## Spec: ${spec.title}  (size ${spec.size})`,
    "",
    "**Problem**",
    spec.problem,
    "",
    "**Proposal**",
    spec.proposal,
    "",
    "**User stories**",
    ...list(spec.user_stories),
    "",
    "**Acceptance criteria**",
    ...spec.acceptance_criteria.map(
      (criterion, index) => `${index + 1}. ${criterion}`,
    ),
    "",
    "**Non-goals**",
    ...list(spec.non_goals),
    "",
    `**Affected features:** ${spec.affected_features.join(", ") || "none"}`,
    "",
    "**Constraints to watch**",
    ...list(spec.constraints),
    "",
    "**Demo mode**",
    spec.demo_mode,
    "",
    "**Docs updates**",
    ...list(spec.docs_updates),
    "",
    "**Risks**",
    ...list(spec.risks),
  ].join("\n");
}

/** Splits text into chunks under Discord's 2000-character message limit, on line breaks. */
export function chunkForDiscord(text: string, limit = 1900): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    let rest = line;
    while (rest.length > limit) {
      chunks.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    current = rest;
  }
  if (current) chunks.push(current);
  return chunks;
}
