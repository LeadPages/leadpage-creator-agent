// Chapter 09 — Production-ready
// -----------------------------
// What changes when you stop running the agent from a terminal and start
// running it for other people:
//   - stream tokens as they're generated, so users see progress
//   - retry transient errors (rate limits, network blips, 5xx)
//   - GATE destructive tool calls — confirm before publish
//   - observability: structured logs of every tool call and turn
//   - MCP — call out to an external server (HTMLPub) instead of writing
//     files locally
//
// This file shows the streaming and retry loop. The MCP hookup is a sketch —
// real wiring depends on how your MCP server is exposed.
//
// Run it:
//   bun run stream "vegan meal kits for busy parents"

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import AnthropicSDK from "@anthropic-ai/sdk";
import { client, DEFAULT_MODEL } from "./shared/client.ts";

// --- Tools (same shape as Ch 03 plus a gated publish_page) ------------------

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "save_page",
    description: "Write the final HTML to disk and return its path.",
    input_schema: {
      type: "object",
      properties: { filename: { type: "string" }, html: { type: "string" } },
      required: ["filename", "html"],
    },
  },
  {
    name: "publish_page",
    description:
      "Publish the page to the public HTMLPub site (LIVE — visitors will see it). " +
      "Confirm with the user before calling. Returns the public URL.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        html: { type: "string" },
      },
      required: ["title", "html"],
    },
  },
];

// --- Tool execution with gating + retry -------------------------------------

async function gateConfirm(tool: string, input: unknown): Promise<boolean> {
  // In a CLI, ask the user. In a UI app, you'd raise a `user.tool_confirmation`
  // event and wait for the user to click yes/no. Both Claude Managed Agents
  // and the SDK loop have first-class support for this — see Chapter 10.
  process.stdout.write(
    `\n  GATE: agent wants to call ${tool}(${JSON.stringify(input).slice(0, 200)})\n        approve? [y/N] `,
  );
  // Read one line of input. Works in both bun and Node — no Bun-only APIs.
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("")).trim().toLowerCase();
  rl.close();
  return answer.startsWith("y");
}

async function runTool(name: string, input: unknown): Promise<unknown> {
  if (name === "save_page") {
    const { filename, html } = input as { filename: string; html: string };
    await mkdir("out", { recursive: true });
    const path = resolve("out", filename);
    await writeFile(path, html, "utf8");
    return { path };
  }
  if (name === "publish_page") {
    // Real wiring would call your MCP server / HTMLPub API here.
    // For this tutorial we mock the publish so you can run end-to-end.
    const { title } = input as { title: string };
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return { url: `https://your-page.htmlpub.com/${slug}-${Date.now().toString(36)}` };
  }
  throw new Error(`unknown tool: ${name}`);
}

// --- Retry helper -----------------------------------------------------------

async function withRetry<T>(label: string, fn: () => Promise<T>, max = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const e = err as { status?: number; message?: string };
      const retryable = e.status === 429 || (e.status ?? 0) >= 500 || /ECONNRESET|ETIMEDOUT|fetch failed/i.test(e.message ?? "");
      if (!retryable || attempt === max) throw err;
      const wait = 250 * Math.pow(2, attempt - 1); // 250, 500, 1000, 2000 ms
      console.log(`  [retry ${attempt}/${max - 1}] ${label} → ${e.status ?? "err"}, waiting ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// --- Streaming a single agent turn -------------------------------------------
//
// The Anthropic SDK gives us a high-level `.stream()` helper that yields
// events as the model produces them. We surface text deltas to stdout as
// they arrive — that's what makes a real UI feel responsive.

async function streamOneTurn(
  messages: Anthropic.Messages.MessageParam[],
  system: string,
): Promise<{ content: Anthropic.Messages.ContentBlock[]; stop_reason: string; usage: { input: number; output: number } }> {
  return withRetry("stream", async () => {
    const stream = client.messages.stream({
      model: DEFAULT_MODEL,
      max_tokens: 16384,
      system,
      tools: TOOLS,
      messages,
    });

    process.stdout.write("\n  ");
    let charsThisLine = 2;
    stream.on("text", (delta: string) => {
      for (const c of delta) {
        if (c === "\n") { process.stdout.write("\n  "); charsThisLine = 2; continue; }
        if (charsThisLine >= 78) { process.stdout.write("\n  "); charsThisLine = 2; }
        process.stdout.write(c);
        charsThisLine += 1;
      }
    });
    stream.on("inputJson", (delta: string) => {
      if (delta.length) process.stdout.write(".");
    });

    const finalMessage = await stream.finalMessage();
    process.stdout.write("\n");
    return {
      content: finalMessage.content,
      stop_reason: finalMessage.stop_reason ?? "end_turn",
      usage: { input: finalMessage.usage.input_tokens, output: finalMessage.usage.output_tokens },
    };
  });
}

// --- The loop ---------------------------------------------------------------

const SYSTEM = `
You design landing pages.

You have two tools:
- save_page(filename, html): write a draft to disk.
- publish_page(title, html):  PUBLISH the page LIVE on htmlpub.com. The user
  will be asked to approve before this runs.

When asked for a page, draft it with save_page first. If — and only if — the
user explicitly says "publish" or similar, follow with publish_page.
`.trim();

async function main() {
  const brief = process.argv.slice(2).join(" ").trim() || "vegan meal kits for busy parents";

  const events: Array<Record<string, unknown>> = []; // observability log
  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: `Create a landing page for: ${brief}. Save it as a draft. ` +
               `Then ask me whether to publish.`,
    },
  ];

  while (true) {
    const turn = await streamOneTurn(messages, SYSTEM);
    events.push({ ts: Date.now(), kind: "model_turn", stop_reason: turn.stop_reason, usage: turn.usage });
    messages.push({ role: "assistant", content: turn.content });

    if (turn.stop_reason !== "tool_use") break;

    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;

      // Gate destructive tools.
      if (block.name === "publish_page") {
        const ok = await gateConfirm(block.name, block.input);
        events.push({ ts: Date.now(), kind: "gate", tool: block.name, approved: ok });
        if (!ok) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "User declined to publish. Don't try again unless asked.",
            is_error: false,
          });
          continue;
        }
      }

      try {
        const result = await withRetry(`tool:${block.name}`, () => runTool(block.name, block.input));
        events.push({ ts: Date.now(), kind: "tool_ok", tool: block.name });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        events.push({ ts: Date.now(), kind: "tool_err", tool: block.name, message: (err as Error).message });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: ${(err as Error).message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  // Dump the observability log so you can see what happened.
  await mkdir("out", { recursive: true });
  await writeFile("out/09-trace.json", JSON.stringify(events, null, 2));
  console.log(`\n  → wrote out/09-trace.json (${events.length} events)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
