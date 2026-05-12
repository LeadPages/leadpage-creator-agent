// Chapter 03 — Tools
// ------------------
// The first real agent. We give Claude two tools:
//   - fetch_brand_colors(domain)  → mock palette for a domain
//   - save_page(filename, html)   → writes the page to disk
// Then we run the loop: keep talking to Claude until it stops asking for
// tool calls.
//
// Run it:
//   bun run tools "vegan meal kits for busy parents"

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { client, DEFAULT_MODEL } from "./shared/client.ts";
import { PROMPT_WITH_TOOLS } from "./shared/prompts.ts";

// --- Tool definitions (what we tell Claude exists) ---------------------------

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "fetch_brand_colors",
    description:
      "Look up a brand's color palette by domain. Returns up to 5 hex colors, primary first. Use only if the user mentions an existing brand.",
    input_schema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: 'The brand\'s domain, e.g. "stripe.com"',
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "save_page",
    description:
      "Write the final landing page HTML to disk and return its absolute path. Call once at the end with the complete document.",
    input_schema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: 'A short filename like "vegan-meal-kits.html"',
        },
        html: {
          type: "string",
          description: "The complete <!doctype html> document.",
        },
      },
      required: ["filename", "html"],
    },
  },
];

// --- Tool implementations (what actually runs) -------------------------------

// Real apps would call an image-analysis service or scrape the brand's site.
// For the tutorial we hardcode a few well-known brands so the behavior is
// stable and offline — the lesson is about the agent loop, not the scrape.
const KNOWN_BRANDS: Record<string, string[]> = {
  "stripe.com": ["#635bff", "#0a2540", "#fff", "#7a73ff", "#425466"],
  "linear.app": ["#5e6ad2", "#0f0f12", "#fff", "#8a8df0", "#1c1c20"],
  "anthropic.com": ["#d97757", "#f0eee6", "#1f1f1d", "#3a3a36", "#f4ddc8"],
};

async function fetch_brand_colors(input: { domain: string }) {
  const palette = KNOWN_BRANDS[input.domain.toLowerCase()];
  if (palette) return { palette };
  return { palette: ["#1d1b18", "#d96e2b", "#faf8f4", "#4a463f", "#e6dfd1"], note: "domain not in cache, returning a warm editorial palette" };
}

async function save_page(input: { filename: string; html: string }) {
  await mkdir("out", { recursive: true });
  const path = resolve("out", input.filename);
  await writeFile(path, input.html, "utf8");
  return { path };
}

// One dispatcher so the loop stays readable.
async function runTool(name: string, input: unknown): Promise<unknown> {
  switch (name) {
    case "fetch_brand_colors":
      return fetch_brand_colors(input as { domain: string });
    case "save_page":
      return save_page(input as { filename: string; html: string });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// --- The agent loop ----------------------------------------------------------

async function main() {
  const topic = process.argv.slice(2).join(" ").trim() || "vegan meal kits for busy parents";

  // We accumulate the conversation in this array and pass it back on every
  // turn. The model's "memory" is just this array.
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: `Create a landing page for: ${topic}` },
  ];

  let savedPath: string | undefined;
  let turn = 0;

  while (true) {
    turn += 1;
    console.log(`\n── turn ${turn} ──`);

    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      system: PROMPT_WITH_TOOLS,
      tools: TOOLS,
      messages,
    });

    console.log(`  stop_reason: ${response.stop_reason}`);
    console.log(`  ${response.usage.input_tokens} in · ${response.usage.output_tokens} out`);

    // Push the assistant's response onto the conversation so the next turn
    // can reference it.
    messages.push({ role: "assistant", content: response.content });

    // If the model didn't ask for any tool calls, we're done.
    if (response.stop_reason !== "tool_use") {
      const text = response.content.find((b) => b.type === "text");
      if (text && text.type === "text") {
        console.log(`\n${text.text}`);
      }
      break;
    }

    // Otherwise, run every tool call in the response and collect the results.
    const tool_uses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    const tool_results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const use of tool_uses) {
      console.log(`  → ${use.name}(${Object.keys(use.input as object).join(", ")})`);
      try {
        const result = await runTool(use.name, use.input);
        if (use.name === "save_page") savedPath = (result as { path: string }).path;
        tool_results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        tool_results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `Error: ${(err as Error).message}`,
          is_error: true,
        });
      }
    }

    // Hand the tool results back to the model on the next turn.
    messages.push({ role: "user", content: tool_results });
  }

  if (savedPath) {
    console.log(`\n✓ saved to ${savedPath}`);
    console.log(`  open ${savedPath}`);
  } else {
    console.warn("\n⚠ agent finished without calling save_page");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
