// Chapter 10 — Ship as a Claude Managed Agent
// -------------------------------------------
// This file is a walkthrough rather than a runnable script — the Managed
// Agents API is in beta and requires your org to be opted in. Read it
// top-to-bottom: each block shows the SDK call you'd make, in order.
//
// The four primitives:
//   Agent          your config (system prompt, tools, model, skills, MCP)
//   Environment    the sandbox the agent runs in (data files, network access)
//   Session        one conversation
//   Events         the messages flowing through a session
//
// Run it (when CMA is enabled on your org):
//   bun run deploy

import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";

const client = new Anthropic();

// --- 1. Create the agent ----------------------------------------------------
//
// In SDK land we kept the system prompt in a `.ts` file and the tools in
// inline TypeScript. On CMA, those move into the agent definition and the
// platform takes over invoking tools and routing events.

async function createAgent() {
  const conversionCopy = await readFile("src/skills/conversion-copy.md", "utf8");
  const heroPatterns = await readFile("src/skills/hero-patterns.md", "utf8");

  // The shape below mirrors the public Managed Agents API. Field names may
  // evolve while the API is in beta — check the docs at
  // https://platform.claude.com/docs/en/managed-agents/api for the current
  // schema if anything below doesn't compile.

  // @ts-expect-error — beta surface; types are added when the SDK ships them.
  const agent = await client.beta.agents.create({
    name: "leadpage-creator",
    description: "Generates and publishes landing pages from short briefs.",
    model: "claude-sonnet-4-6",
    system_prompt: `
You design and write landing pages. You have skills (conversion-copy,
hero-patterns) and tools (publish_page). Follow the same routine as your
SDK twin: load relevant skills, generate, then publish — but only after
user confirmation.
`.trim(),
    skills: [
      { name: "conversion-copy", content: conversionCopy },
      { name: "hero-patterns",   content: heroPatterns },
    ],
    tools: [
      {
        name: "publish_page",
        description: "Publish a landing page LIVE to htmlpub.com — gated.",
        confirmation_required: true,
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            html:  { type: "string" },
          },
          required: ["title", "html"],
        },
      },
    ],
    // sub_agents would go here if we wanted CMA-level decomposition:
    // sub_agents: [
    //   { name: "copywriter", model: "claude-haiku-4-5-20251001", ... },
    //   { name: "designer",   model: "claude-sonnet-4-6",         ... },
    // ],
    mcp_servers: [
      // Tools exposed by HTMLPub's MCP server. The platform calls them on
      // your behalf and routes results back to the agent.
      // { url: "https://htmlpub.com/mcp", auth: { vault_id: "vault_..." } },
    ],
  });

  console.log(`✓ agent created: ${agent.id}`);
  return agent.id as string;
}

// --- 2. Create the environment ---------------------------------------------
//
// The environment is the sandbox container the agent runs in. It can hold
// data files the agent can grep, an outbound-network allowlist, and any
// MCP-server allowlists.

async function createEnvironment() {
  // @ts-expect-error — beta surface
  const env = await client.beta.environments.create({
    name: "leadpage-creator-env",
    description: "Sandbox for the leadpage-creator agent.",
    // Files appear in ./data/ inside the sandbox.
    data_files: [
      // { path: "data/brand-kits.json", source: "file://./.memory/brand-kit.json" },
    ],
    // The agent can write to ./out/ in the sandbox.
    allowed_network_egress: ["htmlpub.com"],
  });
  console.log(`✓ environment created: ${env.id}`);
  return env.id as string;
}

// --- 3. Create a session and send the first event --------------------------

async function startSession(agentId: string, envId: string, memoryStoreId?: string) {
  // @ts-expect-error — beta surface
  const session = await client.beta.sessions.create({
    agent_id: agentId,
    environment_id: envId,
    title: "vegan meal kits, FreshLeaf",
    resources: memoryStoreId
      ? [{
          type: "memory_store",
          memory_store_id: memoryStoreId,
          prompt: "Track the user's brand kit; remember palette, voice, audience.",
          access: "read_write",
        }]
      : [],
  });
  console.log(`✓ session created: ${session.id}`);

  // @ts-expect-error — beta surface
  await client.beta.sessions.events.send({
    session_id: session.id,
    event: {
      type: "user.message",
      content: [{
        type: "text",
        text: "Create a landing page for vegan meal kits for busy parents. " +
              "Save as a draft and ask me before publishing.",
      }],
    },
  });

  return session.id as string;
}

// --- 4. Stream events back -------------------------------------------------

async function streamEvents(sessionId: string) {
  // @ts-expect-error — beta surface
  const stream = await client.beta.sessions.events.stream({
    session_id: sessionId,
    max_items: -1,
  });

  for await (const event of stream) {
    // Event shapes (representative):
    //   { type: "assistant.text_delta", text: "..." }
    //   { type: "assistant.tool_use",   tool: "publish_page", input: {...} }
    //   { type: "tool_confirmation_required", id, tool, input }
    //   { type: "assistant.message_stop" }
    if (event.type === "assistant.text_delta") {
      process.stdout.write(event.text);
    } else if (event.type === "tool_confirmation_required") {
      console.log(`\n  GATE → ${event.tool}(${JSON.stringify(event.input).slice(0, 80)})`);
      // In a real UI: pop a modal. Here we approve and continue.
      // @ts-expect-error — beta surface
      await client.beta.sessions.events.send({
        session_id: sessionId,
        event: {
          type: "user.tool_confirmation",
          tool_use_id: event.id,
          approved: true,
        },
      });
    } else if (event.type === "assistant.message_stop") {
      console.log("\n  [end of message]");
    }
  }
}

// --- 5. Orchestrate the deploy ---------------------------------------------

async function main() {
  console.log("▸ deploying leadpage-creator to Claude Managed Agents…\n");

  const agentId = await createAgent();
  const envId = await createEnvironment();

  // Optional: re-use a memory store so the agent remembers brand kits.
  let memoryStoreId: string | undefined;
  try {
    // @ts-expect-error — beta surface
    const mem = await client.beta.memoryStores.create({
      name: "leadpage-creator-brands",
      description: "Per-user brand kits.",
    });
    memoryStoreId = mem.id;
    console.log(`✓ memory store: ${memoryStoreId}`);
  } catch (err) {
    console.log("  (memory store skipped — preview not enabled on this org)");
  }

  const sessionId = await startSession(agentId, envId, memoryStoreId);
  console.log("\n--- live transcript ---\n");
  await streamEvents(sessionId);
}

main().catch((err) => {
  console.error(err);
  console.error("\nIf you see 'forbidden' / 'beta not enabled', your org isn't in the");
  console.error("Managed Agents preview yet — request access from your Anthropic contact,");
  console.error("or run the SDK version from Chapter 09 instead.");
  process.exit(1);
});
