// Eval runner — runs every task through the current agent and grades the output.
//
//   bun run eval                # run, print results
//   bun run eval --baseline     # save the run as the baseline
//   bun run eval --task T1      # run a single task
//   bun run eval --agent v05    # which agent to call (v04 | v05; default v05)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gradeOne, type Task, type TaskResult } from "./grader.ts";

// --- Agent variants ---------------------------------------------------------
//
// Each variant is a function (brief) -> Promise<string of HTML>. We register
// them here so the runner can pick which one to call from the CLI.

import { client, DEFAULT_MODEL, extractHtml, firstText } from "../src/shared/client.ts";
import { PROMPT_NAIVE } from "../src/shared/prompts.ts";

async function v02_first_call(task: Task): Promise<string> {
  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 16384,
    system: PROMPT_NAIVE,
    messages: [{
      role: "user",
      content:
        `Create a landing page for: ${task.brief}\n` +
        `Primary goal: ${task.primary_goal} — the page's CTA must drive this action.`,
    }],
  });
  return extractHtml(firstText(response.content));
}

import { existsSync } from "node:fs";

// For v05 we want the decomposition variant. Rather than refactor that file
// to export its orchestrator, we read its HTML output. Cleaner long-term:
// extract orchestrate() into shared/. For the tutorial we inline a copy here
// so the eval runner is independent of the script file's argv handling.
async function v05_decomposition(task: Task): Promise<string> {
  const { orchestrate } = await import("./_v05.ts");
  return orchestrate(task.brief, task.primary_goal);
}

const AGENTS: Record<string, (task: Task) => Promise<string>> = {
  v02: v02_first_call,
  v05: v05_decomposition,
};

// --- CLI parsing ------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args: { baseline: boolean; task?: string; agent: string } = {
    baseline: false,
    agent: "v05",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline") args.baseline = true;
    else if (a === "--task") args.task = argv[++i];
    else if (a === "--agent") args.agent = argv[++i];
  }
  return args;
}

// --- Runner -----------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ds = JSON.parse(await readFile("evals/dataset.json", "utf8")) as { tasks: Task[] };
  const tasks = args.task ? ds.tasks.filter((t) => t.id === args.task) : ds.tasks;

  const runAgent = AGENTS[args.agent];
  if (!runAgent) throw new Error(`unknown --agent: ${args.agent}. Known: ${Object.keys(AGENTS).join(", ")}`);

  console.log(`▸ agent: ${args.agent}   tasks: ${tasks.length}`);

  await mkdir(`evals/reports/${args.agent}`, { recursive: true });
  const results: TaskResult[] = [];

  for (const task of tasks) {
    process.stdout.write(`  ${task.id.padEnd(20)} `);
    const t0 = Date.now();
    let html: string;
    try {
      html = await runAgent(task);
    } catch (err) {
      console.log(`✗  ERROR (${(err as Error).message})`);
      continue;
    }
    const ms = Date.now() - t0;
    await writeFile(`evals/reports/${args.agent}/${task.id}.html`, html);
    const result = await gradeOne(task, html);
    results.push(result);

    const p = result.programmatic.pass ? "✓" : "✗";
    const j = result.judge.pass ? "✓" : "✗";
    const avg = (
      (result.judge.conversion_quality +
        result.judge.brand_fit +
        result.judge.layout_appropriate) /
      3
    ).toFixed(1);
    console.log(`prog ${p}  judge ${j} (${avg}/5)  ${(ms / 1000).toFixed(1)}s`);
  }

  // --- Summary ---
  const passes = results.filter((r) => r.overall_pass).length;
  const score = `${passes} / ${results.length}`;
  console.log(`\n  ── score: ${score} (${((passes / results.length) * 100).toFixed(0)}%)`);

  // Save the run.
  const out = {
    agent: args.agent,
    timestamp: new Date().toISOString(),
    results,
  };
  const reportPath = resolve(`evals/reports/${args.agent}/last.json`);
  await writeFile(reportPath, JSON.stringify(out, null, 2));

  // Compare against baseline if it exists.
  const baselinePath = resolve(`evals/reports/${args.agent}/baseline.json`);
  if (args.baseline) {
    await writeFile(baselinePath, JSON.stringify(out, null, 2));
    console.log(`  ↳ saved as baseline`);
  } else if (existsSync(baselinePath)) {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as typeof out;
    const baselinePasses = baseline.results.filter((r) => r.overall_pass).length;
    const delta = passes - baselinePasses;
    const sign = delta > 0 ? "+" : delta < 0 ? "" : "±";
    console.log(`  ↳ baseline was ${baselinePasses}/${baseline.results.length} (${sign}${delta})`);

    // Per-task flips
    const baseById = new Map(baseline.results.map((r) => [r.task_id, r]));
    for (const r of results) {
      const b = baseById.get(r.task_id);
      if (!b) continue;
      if (b.overall_pass !== r.overall_pass) {
        const dir = r.overall_pass ? "→ PASS" : "→ FAIL";
        console.log(`     ${dir}  ${r.task_id}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
