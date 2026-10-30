import { z } from "zod";

export const SpecSchema = z.object({
  title: z
    .string()
    .describe(
      "Short imperative title, e.g. 'Filter deals by expected closing date'",
    ),
  problem: z.string().describe("The user problem in two or three sentences"),
  proposal: z
    .string()
    .describe("What will change, from the user's point of view"),
  user_stories: z
    .array(z.string())
    .describe("'As a <role>, I want <x>, so that <y>'"),
  acceptance_criteria: z
    .array(z.string())
    .describe(
      "Testable, user-visible criteria; each one becomes at least one test",
    ),
  non_goals: z.array(z.string()),
  affected_features: z
    .array(z.string())
    .describe("Existing feature IDs this changes (F-...)"),
  constraints: z
    .array(z.string())
    .describe(
      "Constraint IDs (C-...) the build must pay attention to, each with a short note",
    ),
  demo_mode: z
    .string()
    .describe(
      "How the feature works in FakeRest demo mode, incl. demo data needed",
    ),
  docs_updates: z
    .array(z.string())
    .describe(
      "Changes needed in docs/product (features.md, constraints.md, architecture.md)",
    ),
  size: z
    .enum(["S", "M", "L"])
    .describe("S: under a day of work, M: a few days, L: needs splitting"),
  risks: z.array(z.string()),
});

export const PoResultSchema = z.object({
  summary: z
    .string()
    .describe("One-sentence restatement of the idea as understood so far"),
  classification: z
    .enum(["iteration", "new_feature", "conflict", "out_of_scope", "unclear"])
    .describe(
      "iteration: changes an existing feature; conflict: contradicts a feature or constraint",
    ),
  related_features: z.array(
    z.object({
      id: z.string().describe("Feature ID from features.md"),
      relation: z.string().describe("How the idea relates to it"),
    }),
  ),
  constraint_findings: z.array(
    z.object({
      id: z.string().describe("Constraint ID from constraints.md"),
      status: z.enum(["ok", "risk", "violation"]),
      note: z.string(),
    }),
  ),
  decision: z
    .enum(["needs_answers", "ready_for_spec", "reject"])
    .describe(
      "needs_answers: ask questions; ready_for_spec: spec is filled in; reject: cannot fit",
    ),
  questions: z
    .array(
      z.object({
        question: z.string(),
        why: z.string().describe("What in the spec depends on the answer"),
        options: z
          .array(z.string())
          .describe("Suggested answers; empty for open questions"),
      }),
    )
    .describe("Empty unless decision is needs_answers"),
  rejection_reason: z
    .string()
    .nullable()
    .describe("Set only when decision is reject"),
  spec: SpecSchema.nullable().describe(
    "Set only when decision is ready_for_spec",
  ),
});

export type Spec = z.infer<typeof SpecSchema>;
export type PoResult = z.infer<typeof PoResultSchema>;
