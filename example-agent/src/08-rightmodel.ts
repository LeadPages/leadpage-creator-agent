// Chapter 08 — Right model
// ------------------------
// Sweep the eval set across { Haiku, Sonnet, Opus }, by subagent.
//
// The decomposed agent has three LLM calls per task: copywriter, designer,
// assembler. We let you override each one's model independently, then
// measure pass rate, cost, and latency.
//
//   bun run sweep                    # full grid
//   bun run sweep --pin assembler=claude-sonnet-4-6
//   bun run sweep --tasks T1,T2      # quicker

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { client, type ModelName } from "./shared/client.ts";

import { gradeOne, type Task } from "../evals/grader.ts";

const MODELS: ModelName[] = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
];

// Per-1M-token pricing (USD) — keep in sync with the public price list.
// Used for cost estimation in the sweep; the actual bill is from your usage
// dashboard.
const PRICE_PER_M: Record<ModelName, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-4-6":          { input: 3, output: 15 },
  "claude-opus-4-7":            { input: 15, output: 75 },
};

// --- Configurable subagent runner -------------------------------------------

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

async function loadSkill(name: string) {
  const text = await readFile(join(HERE, "skills", `${name}.md`), "utf8");
  return text.replace(/^---\n[\s\S]*?\n---\n*/, "");
}

type Subagents = { copywriter: ModelName; designer: ModelName; assembler: ModelName };
type Usage = { input: number; output: number; ms: number };

function priceUSD(model: ModelName, u: Usage) {
  const p = PRICE_PER_M[model];
  return (u.input * p.input + u.output * p.output) / 1_000_000;
}

async function callSubagent(model: ModelName, system: string, user: string): Promise<{ text: string; usage: Usage }> {
  const t0 = Date.now();
  const r = await client.messages.create({
    model,
    max_tokens: 16384,
    system,
    messages: [{ role: "user", content: user }],
  });
  const ms = Date.now() - t0;
  const text = r.content.find((b) => b.type === "text")?.text ?? "";
  return { text, usage: { input: r.usage.input_tokens, output: r.usage.output_tokens, ms } };
}

function extractJson<T>(text: string): T {
  const fence = text.match(/```(?:json)?\n([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

function extractHtml(text: string): string {
  const fence = text.match(/```(?:html)?\n([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = text.search(/<!doctype html|<html/i);
  return start >= 0 ? text.slice(start) : text;
}

async function runAgent(brief: string, models: Subagents): Promise<{ html: string; cost: number; ms: number }> {
  const copyRules = await loadSkill("conversion-copy");
  const heroRules = await loadSkill("hero-patterns");

  const copyOut = await callSubagent(
    models.copywriter,
    `You are a conversion copywriter. Return ONLY JSON with fields: headline,
subhead, body (2 paragraphs), cta.\n\nRules:\n${copyRules}`,
    `Brief: ${brief}\n\nReturn the JSON.`,
  );
  const copy = extractJson<{ headline: string; subhead: string; body: string[]; cta: string }>(copyOut.text);

  const designOut = await callSubagent(
    models.designer,
    `You are an art director. Return ONLY JSON: palette (array of 3-5 hex),
font (font-stack), layout (one of: headline-led, split, social-proof,
three-column).\n\nRules:\n${heroRules}`,
    `Brief: ${brief}\nCopy: ${JSON.stringify(copy)}\n\nReturn the JSON.`,
  );
  const design = extractJson<{ palette: string[]; font: string; layout: string }>(designOut.text);

  const asmOut = await callSubagent(
    models.assembler,
    `Assemble landing pages. Output ONLY a complete <!doctype html> document
with inline CSS. Use the palette, font, and layout you're given.`,
    `Copy: ${JSON.stringify(copy)}\nDesign: ${JSON.stringify(design)}\n\nBuild the page.`,
  );
  const html = extractHtml(asmOut.text);

  const cost =
    priceUSD(models.copywriter, copyOut.usage) +
    priceUSD(models.designer, designOut.usage) +
    priceUSD(models.assembler, asmOut.usage);
  const ms = copyOut.usage.ms + designOut.usage.ms + asmOut.usage.ms;
  return { html, cost, ms };
}

// --- CLI parsing ------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args: { pin: Partial<Subagents>; tasks?: string[] } = { pin: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pin") {
      const [k, v] = argv[++i].split("=");
      (args.pin as Record<string, string>)[k] = v;
    } else if (a === "--tasks") {
      args.tasks = argv[++i].split(",");
    }
  }
  return args;
}

// --- Sweep ------------------------------------------------------------------
//
// For a 3-subagent agent with 3 models = 27 cells. That's expensive.
// We use a smarter strategy: vary one subagent at a time while pinning the
// other two to Sonnet. That gives us 3 cells per subagent — 9 total.

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ds = JSON.parse(await readFile("evals/dataset.json", "utf8")) as { tasks: Task[] };
  const tasks = args.tasks ? ds.tasks.filter((t) => args.tasks!.includes(t.id)) : ds.tasks;

  const subagents: Array<keyof Subagents> = ["copywriter", "designer", "assembler"];
  const baseline: Subagents = { copywriter: "claude-sonnet-4-6", designer: "claude-sonnet-4-6", assembler: "claude-sonnet-4-6" };
  Object.assign(baseline, args.pin);

  const grid: Array<{ subagent: keyof Subagents; model: ModelName; pass_rate: number; cost: number; ms: number }> = [];

  for (const sub of subagents) {
    if (args.pin[sub]) {
      console.log(`▸ skipping ${sub} (pinned to ${args.pin[sub]})`);
      continue;
    }
    for (const model of MODELS) {
      const models: Subagents = { ...baseline, [sub]: model };
      console.log(`\n── ${sub} = ${model} ──`);

      let passes = 0;
      let totalCost = 0;
      let totalMs = 0;
      for (const task of tasks) {
        process.stdout.write(`  ${task.id.padEnd(20)} `);
        try {
          const { html, cost, ms } = await runAgent(task.brief, models);
          totalCost += cost;
          totalMs += ms;
          const result = await gradeOne(task, html);
          if (result.overall_pass) passes += 1;
          console.log(`${result.overall_pass ? "✓" : "✗"}  $${cost.toFixed(4)}  ${(ms / 1000).toFixed(1)}s`);
        } catch (err) {
          console.log(`ERR ${(err as Error).message.slice(0, 80)}`);
        }
      }
      const pass_rate = passes / tasks.length;
      grid.push({ subagent: sub, model, pass_rate, cost: totalCost, ms: totalMs });
      console.log(`  pass ${(pass_rate * 100).toFixed(0)}%  cost $${totalCost.toFixed(3)}  total ${(totalMs / 1000).toFixed(0)}s`);
    }
  }

  // --- Report ---
  console.log("\n┌─────────────┬──────────┬──────────┬──────────┬──────────┐");
  console.log("│ subagent    │ model    │ pass     │ cost     │ latency  │");
  console.log("├─────────────┼──────────┼──────────┼──────────┼──────────┤");
  for (const row of grid) {
    const m = row.model.replace("claude-", "").replace("-4-", "-").replace(/-\d{8}.*$/, "");
    console.log(
      `│ ${row.subagent.padEnd(11)} │ ${m.padEnd(8)} │ ${(row.pass_rate * 100).toFixed(0).padStart(3)}%     │ $${row.cost.toFixed(3).padStart(6)} │ ${(row.ms / 1000).toFixed(0).padStart(5)}s   │`,
    );
  }
  console.log("└─────────────┴──────────┴──────────┴──────────┴──────────┘");

  await mkdir("evals/reports", { recursive: true });
  await writeFile("evals/reports/sweep.json", JSON.stringify(grid, null, 2));
  console.log("\n  → wrote evals/reports/sweep.json");

  // Print recommendation
  const recs: Partial<Subagents> = {};
  for (const sub of subagents) {
    if (args.pin[sub]) continue;
    const cells = grid.filter((g) => g.subagent === sub);
    // Cheapest model whose pass rate is within 5% of the best.
    const best = Math.max(...cells.map((c) => c.pass_rate));
    const cheapestGood = cells
      .filter((c) => c.pass_rate >= best - 0.05)
      .sort((a, b) => a.cost - b.cost)[0];
    recs[sub] = cheapestGood.model;
  }
  console.log("\n  Recommendation (cheapest model within 5% of best pass rate):");
  for (const [k, v] of Object.entries(recs)) console.log(`    ${k}: ${v}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
