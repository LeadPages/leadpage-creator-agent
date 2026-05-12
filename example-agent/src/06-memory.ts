// Chapter 06 — Memory
// -------------------
// We give the agent a brand-kit memory store: a place to remember a user's
// brand name, palette, voice, and any notes the user wants kept across
// sessions.
//
// In SDK land, "memory store" is a JSON file. The agent has two new tools:
//   - remember(key, value)     write to the kit
//   - recall(key) / recall_all() read from the kit
// On Claude Managed Agents this same shape becomes a memory_store resource
// attached to the session — see Chapter 10.
//
// Run it three times in a row to see the agent remember between runs:
//   bun run memory   "I'm building a page for FreshLeaf — vegan meal kits"
//   bun run memory   "make me another page for the FreshLeaf holiday gift box"
//   bun run memory   "show me what you know about FreshLeaf"

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { client, DEFAULT_MODEL } from "./shared/client.ts";

const STORE_PATH = resolve(".memory/brand-kit.json");

// --- The store --------------------------------------------------------------

type Memory = Record<string, unknown>;

async function loadStore(): Promise<Memory> {
  if (!existsSync(STORE_PATH)) return {};
  return JSON.parse(await readFile(STORE_PATH, "utf8"));
}

async function saveStore(mem: Memory): Promise<void> {
  await mkdir(".memory", { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(mem, null, 2), "utf8");
}

// --- Tools ------------------------------------------------------------------

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "remember",
    description:
      "Save a fact about the user's brand to persistent memory. The key is a short slug like 'palette' or 'voice'; the value is whatever you want stored. Overwrites any prior value at that key.",
    input_schema: {
      type: "object",
      properties: {
        key:   { type: "string", description: "A short slug, e.g. 'palette' or 'brand_name'." },
        value: { description: "Any JSON-serializable value." },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "recall_all",
    description:
      "Return everything currently in the brand-kit memory store. Call this near the start of a session to ground yourself in what the user has previously told you.",
    input_schema: { type: "object", properties: {} },
  },
];

async function runTool(name: string, input: unknown): Promise<unknown> {
  const mem = await loadStore();
  if (name === "remember") {
    const { key, value } = input as { key: string; value: unknown };
    mem[key] = value;
    await saveStore(mem);
    return { ok: true, key, stored: value };
  }
  if (name === "recall_all") {
    return mem;
  }
  throw new Error(`unknown tool: ${name}`);
}

// --- The agent --------------------------------------------------------------

const SYSTEM = `
You are a brand-aware landing-page assistant.

You have access to a persistent brand-kit memory store via two tools:
- recall_all(): returns everything you've previously stored
- remember(key, value): saves something for future sessions

Always:
1. Call recall_all FIRST to see what you already know about this user's brand.
2. If the user mentions a new fact (palette, brand name, voice, audience),
   call remember(key, value) to store it.
3. When asked a question about the brand, answer from memory if you can.

You don't need to generate HTML in this chapter — your job is to manage and
report the brand kit. Keep responses concise.
`.trim();

async function main() {
  const request = process.argv.slice(2).join(" ").trim() || "show me what you know";

  console.log(`▸ "${request}"`);
  console.log(`▸ memory file: ${STORE_PATH}`);

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: request },
  ];

  while (true) {
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const text = response.content.find((b) => b.type === "text");
      if (text && text.type === "text") console.log(`\n${text.text}`);
      break;
    }

    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const b of response.content) {
      if (b.type !== "tool_use") continue;
      console.log(`  → ${b.name}(${JSON.stringify(b.input).slice(0, 80)})`);
      const result = await runTool(b.name, b.input);
      results.push({
        type: "tool_result",
        tool_use_id: b.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: results });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
