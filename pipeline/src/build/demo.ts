import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import { z } from "zod";
import {
  DEMO_MODEL,
  DEMO_TIMEOUT_MS,
  PIPELINE_DIR,
  PROMPTS_DIR,
  WORKTREES_DIR,
  buildEnv,
  githubRepo,
  githubToken,
  previewUrl,
} from "../config.js";
import { runClaude } from "../claude.js";
import { pullNumberFrom } from "../ideas.js";
import { FILE_TOOLS } from "./agents.js";
import { changedPaths, discardChanges } from "./git.js";
import { clipDiff } from "./reviewer.js";
import { run, runOrThrow, tail } from "./run.js";

const DemoReportSchema = z.object({
  recorded: z
    .boolean()
    .describe("Whether the walkthrough is written and passing"),
  summary: z
    .string()
    .describe("What the video shows, or why there is nothing to show"),
  concerns: z
    .array(z.string())
    .describe("Anything that looked wrong in the feature while filming"),
});

/** The recording of a build, for the Discord thread and the pull request. */
export interface DemoResult {
  summary: string;
  /** The video on this machine; null when there is none to attach. */
  videoFile: string | null;
  /** The video on GitHub Pages; null when it isn't published. */
  videoUrl: string | null;
  /** What looked wrong in the feature. */
  concerns: string[];
  /** Why part of the recording didn't happen. */
  gaps: string[];
  costUsd: number;
}

const RECORDING_DIR = "demo-recording";
const CONFIG = `${RECORDING_DIR}/playwright.config.ts`;
const WALKTHROUGH = `${RECORDING_DIR}/walkthrough.spec.ts`;
const RUN_TIMEOUT_MS = 5 * 60_000;
/** The data is random on every load, so a passing walkthrough can fail once. */
const RUNS = 2;
/** Discord's upload limit for a server without boosts is 10 MB. */
const MAX_VIDEO_BYTES = 9 * 1024 * 1024;
/** Each is smaller and rougher than the last: [width, quality factor]. */
const ENCODINGS = [
  [1280, 28],
  [960, 32],
  [800, 36],
] as const;

export function demoVideoPath(issueNumber: number): string {
  return path.join(WORKTREES_DIR, `idea-${issueNumber}.demo.mp4`);
}

async function findVideo(dir: string): Promise<string | null> {
  const results = path.join(dir, RECORDING_DIR, "results");
  if (!existsSync(results)) return null;
  const files = await readdir(results, { recursive: true });
  const video = files.find((file) => file.endsWith(".webm"));
  return video ? path.join(results, video) : null;
}

/** Runs the walkthrough to film it, and returns the raw video. */
async function film(dir: string): Promise<string> {
  let output = "";
  for (let attempt = 1; attempt <= RUNS; attempt++) {
    const result = await run(
      "npx",
      ["playwright", "test", "--config", CONFIG],
      { cwd: dir, env: buildEnv(), timeoutMs: RUN_TIMEOUT_MS },
    );
    const video = await findVideo(dir);
    if (result.code === 0 && video) return video;
    output = result.output;
  }
  throw new Error(`The walkthrough failed when filmed:\n${tail(output, 30)}`);
}

/** Converts the raw video to an MP4 that plays inline in Discord, within its limit. */
async function encode(video: string, target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const scratch = `${target}.${randomUUID()}.mp4`;
  try {
    for (const [width, quality] of ENCODINGS) {
      await runOrThrow(
        "ffmpeg",
        [
          "-y",
          "-loglevel",
          "error",
          "-i",
          video,
          "-vf",
          `scale=${width}:-2`,
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          String(quality),
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-an",
          scratch,
        ],
        { cwd: path.dirname(target) },
      );
      if ((await stat(scratch)).size <= MAX_VIDEO_BYTES) {
        await rename(scratch, target);
        return;
      }
    }
    throw new Error("The video is too large to attach, even at low quality.");
  } finally {
    await rm(scratch, { force: true });
  }
}

/**
 * Publishes the video beside the pull request's demo. The preview workflow replaces
 * that folder on every push and removes it when the pull request closes.
 */
async function publishVideo(file: string, pullNumber: number): Promise<string> {
  const octokit = new Octokit({ auth: githubToken() });
  const repo = githubRepo();
  const target = `pr-${pullNumber}/demo.mp4`;
  const existing = await octokit.repos
    .getContent({ ...repo, path: target, ref: "gh-pages" })
    .catch((error: { status?: number }) => {
      if (error.status === 404) return null;
      throw error;
    });
  await octokit.repos.createOrUpdateFileContents({
    ...repo,
    path: target,
    branch: "gh-pages",
    message: `Publish the demo video of pull request ${pullNumber}`,
    content: (await readFile(file)).toString("base64"),
    sha:
      existing && !Array.isArray(existing.data) ? existing.data.sha : undefined,
  });
  return `${previewUrl(pullNumber)}demo.mp4`;
}

async function runDemoAgent(
  dir: string,
  input: { task: string; diff: string },
): Promise<{ report: z.infer<typeof DemoReportSchema>; costUsd: number }> {
  const { output, costUsd } = await runClaude({
    systemPrompt: await readFile(path.join(PROMPTS_DIR, "demo.md"), "utf8"),
    prompt: [
      "Record a walkthrough of this feature.",
      input.task,
      "## Diff",
      "```diff",
      clipDiff(input.diff),
      "```",
    ].join("\n\n"),
    schema: DemoReportSchema,
    cwd: dir,
    model: DEMO_MODEL,
    tools: [...FILE_TOOLS, "Bash"],
    allowedTools: [...FILE_TOOLS, "Bash(npx playwright test:*)"],
    env: buildEnv(),
    timeoutMs: DEMO_TIMEOUT_MS,
  });
  return { report: output, costUsd };
}

/**
 * Has the demo agent film a build that passed CI. It never fails a build: what it
 * can't do is reported. The commit is already pushed, so anything the agent left in
 * the worktree, in the recording folder or not, is thrown away afterward.
 */
export async function recordDemo(
  dir: string,
  input: {
    issueNumber: number;
    task: string;
    diff: string;
    pullRequestUrl: string;
  },
  progress: (message: string) => Promise<void>,
): Promise<DemoResult> {
  const failed = (message: string, costUsd = 0): DemoResult => ({
    summary: "The demo video wasn't recorded.",
    videoFile: null,
    videoUrl: null,
    concerns: [],
    gaps: [message],
    costUsd,
  });
  await progress("🎬 Demo agent is recording a walkthrough…");
  const pending = await changedPaths(dir);
  if (pending.length > 0) {
    return failed(
      `The worktree had uncommitted changes, so it wasn't safe to record: ${pending.join(", ")}`,
    );
  }

  let costUsd = 0;
  try {
    await runOrThrow("npm", ["run", "build:demo"], {
      cwd: dir,
      env: buildEnv(),
    });
    await cp(
      path.join(PIPELINE_DIR, RECORDING_DIR),
      path.join(dir, RECORDING_DIR),
      { recursive: true },
    );
    const { report, costUsd: agentCost } = await runDemoAgent(dir, input);
    costUsd = agentCost;
    if (!report.recorded || !existsSync(path.join(dir, WALKTHROUGH))) {
      await progress(`🎬 No demo video: ${report.summary}`);
      return {
        summary: report.summary,
        videoFile: null,
        videoUrl: null,
        concerns: report.concerns,
        gaps: [],
        costUsd,
      };
    }

    const target = demoVideoPath(input.issueNumber);
    await encode(await film(dir), target);
    const gaps: string[] = [];
    const videoUrl = await publishVideo(
      target,
      pullNumberFrom(input.pullRequestUrl),
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      gaps.push(`The video wasn't published to GitHub Pages: ${message}`);
      return null;
    });
    return {
      summary: report.summary,
      videoFile: target,
      videoUrl,
      concerns: report.concerns,
      gaps,
      costUsd,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await progress("⚠️ The demo video didn't work out; moving on.");
    return failed(message.slice(0, 1000), costUsd);
  } finally {
    await discardChanges(dir);
    await rm(path.join(dir, RECORDING_DIR), { recursive: true, force: true });
  }
}
