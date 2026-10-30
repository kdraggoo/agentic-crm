/**
 * Terminal harness for the product-owner agent: no Discord, no GitHub.
 *
 *   npm run po                          # type an idea, answer questions interactively
 *   npm run po -- samples/deal-filter.md  # start from a file
 *   npm run po -- --once samples/*.md     # one evaluation per file, no follow-up (batch check)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { evaluateIdea } from "./po/agent.js";
import { formatEvaluation } from "./po/format.js";
import type { Turn } from "./po/transcript.js";

const OUT_DIR = "out";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const files = args.filter((arg) => arg !== "--once");

  if (once) {
    for (const file of files) await runOnce(file);
    return;
  }
  const idea = files[0]
    ? await readFile(files[0], "utf8")
    : await promptForIdea();
  await converse(idea.trim());
}

async function runOnce(file: string): Promise<void> {
  const idea = (await readFile(file, "utf8")).trim();
  console.log(`\n=== ${file} ===`);
  const started = Date.now();
  const { result, costUsd, turns } = await evaluateIdea([
    {
      role: "submitter",
      author: "cli",
      text: idea,
      at: new Date().toISOString(),
    },
  ]);
  console.log(formatEvaluation(result));
  console.log(
    `\n[${result.decision} · ${turns} turns · $${costUsd.toFixed(3)} · ${secondsSince(started)}s]`,
  );
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    path.join(OUT_DIR, `${path.basename(file, path.extname(file))}.json`),
    JSON.stringify(result, null, 2),
  );
}

async function converse(idea: string): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  const transcript: Turn[] = [
    {
      role: "submitter",
      author: "you",
      text: idea,
      at: new Date().toISOString(),
    },
  ];
  try {
    for (;;) {
      console.log("\nThinking…");
      const started = Date.now();
      const { result, costUsd } = await evaluateIdea(transcript);
      transcript.push({ role: "po", result, at: new Date().toISOString() });
      console.log(`\n${formatEvaluation(result)}`);
      console.log(`\n[$${costUsd.toFixed(3)} · ${secondsSince(started)}s]`);
      if (result.decision !== "needs_answers") break;

      const answer = await readMultiline(
        rl,
        "\nYour answers (finish with an empty line, or type 'quit'):",
      );
      if (answer === "quit") break;
      transcript.push({
        role: "submitter",
        author: "you",
        text: answer,
        at: new Date().toISOString(),
      });
    }
  } finally {
    rl.close();
  }
}

async function promptForIdea(): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await readMultiline(
      rl,
      "Describe your idea (finish with an empty line):",
    );
  } finally {
    rl.close();
  }
}

async function readMultiline(
  rl: ReturnType<typeof createInterface>,
  label: string,
): Promise<string> {
  console.log(label);
  const lines: string[] = [];
  for (;;) {
    const line = await rl.question("> ");
    if (line.trim() === "") break;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

function secondsSince(started: number): number {
  return Math.round((Date.now() - started) / 1000);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
