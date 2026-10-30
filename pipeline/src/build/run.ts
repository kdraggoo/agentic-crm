import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  output: string;
}

/** Runs a command, capturing stdout and stderr together. Never throws on a non-zero exit. */
export function run(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer) => (output += chunk.toString());
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          output += `\n[timed out after ${options.timeoutMs} ms]`;
        }, options.timeoutMs)
      : undefined;
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not run ${command}: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

/** Like `run`, but throws with the output when the command fails. */
export async function runOrThrow(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<string> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.code}):\n${tail(result.output)}`,
    );
  }
  return result.output;
}

/** Last lines of a long output, for error messages and agent feedback. */
export function tail(text: string, lines = 120): string {
  const all = text.trimEnd().split("\n");
  return all.length <= lines
    ? all.join("\n")
    : [
        `[… ${all.length - lines} earlier lines omitted]`,
        ...all.slice(-lines),
      ].join("\n");
}
