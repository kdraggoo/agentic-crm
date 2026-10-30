import { spawn } from "node:child_process";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface ClaudeRunOptions<T extends z.ZodTypeAny> {
  systemPrompt: string;
  prompt: string;
  schema: T;
  cwd: string;
  model: string;
  /** Built-in tools the agent may use, e.g. ["Read", "Grep", "Glob"]. Empty disables tools. */
  tools: string[];
  /**
   * Tool calls that run without a prompt, e.g. ["Edit", "Bash(npm run typecheck)"].
   * Defaults to `tools`. Anything else is denied, since headless runs cannot ask.
   */
  allowedTools?: string[];
  /** Extra environment variables for the agent and the commands it runs. */
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface ClaudeRunResult<T> {
  output: T;
  costUsd: number;
  turns: number;
}

/**
 * Runs Claude Code headlessly (`claude -p`) with a JSON schema and returns the
 * validated structured output. Uses whatever login the local `claude` CLI has,
 * so no API key is needed on a machine where Claude Code is signed in.
 */
export function runClaude<T extends z.ZodTypeAny>(
  options: ClaudeRunOptions<T>,
): Promise<ClaudeRunResult<z.infer<T>>> {
  const jsonSchema = zodToJsonSchema(options.schema, { $refStrategy: "none" });
  const toolList = options.tools.join(",");
  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    options.model,
    "--system-prompt",
    options.systemPrompt,
    "--json-schema",
    JSON.stringify(jsonSchema),
    "--tools",
    toolList,
    "--no-session-persistence",
    // Only project settings: keeps the user's personal hooks and plugins out of pipeline runs.
    "--setting-sources",
    "project",
  ];
  const allowed = options.allowedTools ?? options.tools;
  if (allowed.length > 0) args.push("--allowedTools", ...allowed);

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude timed out after ${options.timeoutMs} ms`));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start claude CLI: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        resolve(parseResult(stdout, options.schema));
      } catch (error: unknown) {
        const detail = stderr.trim() || stdout.trim().slice(0, 2000);
        const message = error instanceof Error ? error.message : String(error);
        reject(new Error(`${message} (exit code ${code}): ${detail}`));
      }
    });

    child.stdin.end(options.prompt);
  });
}

function parseResult<T extends z.ZodTypeAny>(
  stdout: string,
  schema: T,
): ClaudeRunResult<z.infer<T>> {
  const envelope: unknown = JSON.parse(stdout);
  if (typeof envelope !== "object" || envelope === null) {
    throw new Error("claude returned no JSON envelope");
  }
  const result = envelope as {
    is_error?: boolean;
    result?: string;
    structured_output?: unknown;
    total_cost_usd?: number;
    num_turns?: number;
  };
  if (result.is_error) {
    throw new Error(`claude reported an error: ${result.result ?? "unknown"}`);
  }
  const parsed = schema.safeParse(result.structured_output);
  if (!parsed.success) {
    throw new Error(
      `claude output did not match the schema: ${parsed.error.message}`,
    );
  }
  return {
    output: parsed.data,
    costUsd: result.total_cost_usd ?? 0,
    turns: result.num_turns ?? 0,
  };
}
