// Chapter 04 — Skills
// -------------------
// A "skill" is a chunk of instructions the agent loads on demand. We give
// the agent two skills (conversion-copy and hero-patterns) and one new
// tool — load_skill — that reads a skill file off disk and returns its body.
//
// The system prompt stays small: it just tells the agent which skills exist
// and when to load them. The actual rules live in src/skills/*.md.
//
// Run it:
//   bun run skills "vegan meal kits for busy parents"

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { client, DEFAULT_MODEL } from "./shared/client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(HERE, "skills");

// --- Skill discovery ---------------------------------------------------------
// At startup we read the skill files and pull out their frontmatter so we
// can include short descriptions in the system prompt. The agent reads the
// descriptions to decide which one to load — we never preload the bodies.

type SkillMeta = { name: string; description: string; path: string };

async function discoverSkills(): Promise<SkillMeta[]> {
  const files = (await readdir(SKILLS_DIR)).filter((f) => f.endsWith(".md"));
  return Promise.all(
    files.map(async (file) => {
      const text = await readFile(join(SKILLS_DIR, file), "utf8");
      const match = text.match(/^---\n([\s\S]*?)\n---/);
      const meta: Record<string, string> = {};
      if (match) {
        for (const line of match[1].split("\n")) {
          const m = line.match(/^(\w+):\s*(.+)$/);
          if (m) meta[m[1]] = m[2].trim();
        }
      }
      return {
        name: meta.name || file.replace(/\.md$/, ""),
        description: meta.description || "(no description)",
        path: join(SKILLS_DIR, file),
      };
    }),
  );
}

// --- Tools -------------------------------------------------------------------

const SKILLS = await discoverSkills();

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "load_skill",
    description:
      "Load the body of a skill into context. Use this when you decide a skill is relevant " +
      "to the current task. Available skills:\n" +
      SKILLS.map((s) => `  - ${s.name}: ${s.description}`).join("\n"),
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: SKILLS.map((s) => s.name),
          description: "The name of the skill to load.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "save_page",
    description: "Write the final landing page HTML to disk and return its path.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        html: { type: "string" },
      },
      required: ["filename", "html"],
    },
  },
];

async function load_skill(input: { name: string }) {
  const skill = SKILLS.find((s) => s.name === input.name);
  if (!skill) return { error: `unknown skill: ${input.name}` };
  const body = await readFile(skill.path, "utf8");
  // Strip frontmatter — the body is what the model needs.
  const stripped = body.replace(/^---\n[\s\S]*?\n---\n*/, "");
  return { content: stripped };
}

async function save_page(input: { filename: string; html: string }) {
  await mkdir("out", { recursive: true });
  const path = resolve("out", input.filename);
  await writeFile(path, input.html, "utf8");
  return { path };
}

async function runTool(name: string, input: unknown): Promise<unknown> {
  switch (name) {
    case "load_skill":
      return load_skill(input as { name: string });
    case "save_page":
      return save_page(input as { filename: string; html: string });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// --- System prompt (much smaller now) ---------------------------------------

const SYSTEM = `
You design and write landing pages.

You have two tools:
- load_skill(name): pulls a chunk of instructions into context. Skills you can load are
  listed in the tool description. Load them when relevant — don't load everything up front.
- save_page(filename, html): writes the final document and stops the loop.

For every brief, follow this routine:
1. Decide which skills are relevant to this brief.
2. Load them with load_skill (call once per skill, before generating).
3. Generate the complete HTML.
4. Call save_page exactly once with the final document.

The HTML must be a complete <!doctype html> page with inline CSS, no external assets.
`.trim();

// --- Loop --------------------------------------------------------------------

async function main() {
  const topic = process.argv.slice(2).join(" ").trim() || "vegan meal kits for busy parents";

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: `Create a landing page for: ${topic}` },
  ];

  let savedPath: string | undefined;
  let turn = 0;
  const loadedSkills: string[] = [];

  while (true) {
    turn += 1;
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") break;

    const tool_results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "load_skill") {
        const skillName = (block.input as { name: string }).name;
        loadedSkills.push(skillName);
        console.log(`  turn ${turn} → load_skill(${skillName})`);
      } else {
        console.log(`  turn ${turn} → ${block.name}`);
      }
      const result = await runTool(block.name, block.input);
      if (block.name === "save_page") savedPath = (result as { path: string }).path;
      tool_results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: tool_results });
  }

  console.log(`\nturns: ${turn}, skills loaded: ${loadedSkills.join(", ") || "(none)"}`);
  if (savedPath) console.log(`✓ saved to ${savedPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
