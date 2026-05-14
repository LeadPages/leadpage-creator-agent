// Chapter 05 — Decomposition
// --------------------------
// We split the agent into three specialized parts:
//   - copywriter:  takes a brief, returns { headline, subhead, body, cta }
//   - designer:    takes the brief + copy, returns { palette, font, layout }
//   - assembler:   takes copy + design, returns the final HTML
// An orchestrator function calls them in order. Each call is a separate
// `messages.create` with its own focused system prompt.
//
// This is the SDK-side approximation of the Claude Managed Agents
// "callable_agents" pattern — same shape, different deployment.
//
// Run it:
//   bun run decompose "vegan meal kits for busy parents"

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { client, DEFAULT_MODEL, extractHtml, firstText } from "./shared/client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// --- Shared types ------------------------------------------------------------

type Copy = {
  headline: string;
  subhead: string;
  body: string[];     // paragraph strings, 2 of them
  cta: string;
};

type Design = {
  palette: string[];   // 3-5 hex colors, primary first
  font: string;        // a font-stack
  layout: "headline-led" | "split" | "social-proof" | "three-column";
};

// Pull JSON out of a model response that might have prose around it.
function extractJson<T>(text: string): T {
  const fence = text.match(/```(?:json)?\n([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(`no JSON in response: ${text.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

// --- Subagent: copywriter ----------------------------------------------------

async function copywriter(brief: string, primary_goal?: string): Promise<Copy> {
  const rules = await readFile(join(HERE, "skills/conversion-copy.md"), "utf8");
  const stripped = rules.replace(/^---\n[\s\S]*?\n---\n*/, "");

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: `
You are a conversion copywriter. Given a brief, return ONLY a JSON object with
fields: headline (string), subhead (string), body (array of 2 short paragraph
strings), cta (string).

The CTA string MUST drive the page's primary goal. If a goal is given in
the user message, the CTA must take the visitor to that specific action.
Examples: goal "book demo" → "Book a demo"; goal "wishlist" → "Wishlist on
Steam"; goal "trial signup" → "Start free trial". Never invent a different
conversion path than the brief asks for.

Apply these rules strictly:

${stripped}
`.trim(),
    messages: [{
      role: "user",
      content:
        `Brief: ${brief}\n` +
        (primary_goal ? `Primary goal: ${primary_goal}\n` : "") +
        `\nReturn the JSON.`,
    }],
  });

  return extractJson<Copy>(firstText(response.content));
}

// --- Subagent: designer ------------------------------------------------------

async function designer(brief: string, copy: Copy, primary_goal?: string): Promise<Design> {
  const rules = await readFile(join(HERE, "skills/hero-patterns.md"), "utf8");
  const stripped = rules.replace(/^---\n[\s\S]*?\n---\n*/, "");

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 800,
    system: `
You are an art director. Given a brief and the page copy, return ONLY a JSON
object with fields: palette (array of 3-5 hex colors, primary first), font
(a font-stack string), layout (one of: "headline-led", "split", "social-proof",
"three-column").

Match the layout to the goal: B2B goals like "book demo" usually want
"social-proof" (visitors need trust signals before clicking); product pages
with a strong visual want "split"; coming-soon / minimal pages want
"headline-led".

Apply these hero-pattern rules:

${stripped}
`.trim(),
    messages: [{
      role: "user",
      content:
        `Brief: ${brief}\n` +
        (primary_goal ? `Primary goal: ${primary_goal}\n` : "") +
        `\nCopy:\n${JSON.stringify(copy, null, 2)}\n\nReturn the JSON.`,
    }],
  });

  return extractJson<Design>(firstText(response.content));
}

// --- Subagent: assembler -----------------------------------------------------

async function assembler(copy: Copy, design: Design): Promise<string> {
  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 16384,
    system: `
You assemble landing pages. Given finalized copy and design tokens, output a
complete <!doctype html> document with inline CSS and no external assets.

- Use the provided palette for accents, background contrast, and the CTA.
- Apply the chosen layout pattern from the design.
- Use the provided font-stack for body text.
- Use semantic HTML (<h1>, <p>, <a>, <button>).

CTA placement (this is the single most important rule):
- The primary CTA — the exact 'cta' string from the copy — MUST appear in
  the hero section, right after the headline + subhead. This is the first
  thing a visitor sees, and on a one-screen-of-content page it's often the
  only thing they ever see.
- You may (and should) repeat the same CTA once more, at the natural end of
  the page, for visitors who scrolled to the bottom.
- Never put the CTA exclusively in the footer or after a long prose block.
  A page whose only job is wishlist / signup / trial / book-call but whose
  CTA is below the fold is a broken page, regardless of how nice the rest
  of the design is.

Keep the whole document under ~150 lines. Output ONLY HTML. No prose, no
markdown fences.
`.trim(),
    messages: [{
      role: "user",
      content:
        `Copy:\n${JSON.stringify(copy, null, 2)}\n\n` +
        `Design tokens:\n${JSON.stringify(design, null, 2)}\n\n` +
        `Build the page.`,
    }],
  });

  return extractHtml(firstText(response.content));
}

// --- Orchestrator ------------------------------------------------------------

async function orchestrate(brief: string, primary_goal?: string) {
  console.log(`▸ brief: ${brief}`);
  if (primary_goal) console.log(`▸ goal:  ${primary_goal}`);
  console.log(`▸ → copywriter`);
  const copy = await copywriter(brief, primary_goal);
  console.log(`  headline: "${copy.headline}"`);
  console.log(`  cta:      "${copy.cta}"`);

  console.log(`▸ → designer`);
  const design = await designer(brief, copy, primary_goal);
  console.log(`  palette:  ${design.palette.join(", ")}`);
  console.log(`  layout:   ${design.layout}`);

  console.log(`▸ → assembler`);
  const html = await assembler(copy, design);

  await mkdir("out", { recursive: true });
  const path = resolve("out", "05-decomposition.html");
  await writeFile(path, html, "utf8");
  console.log(`\n✓ ${path}`);
  return { copy, design, path };
}

// CLI: first arg is the brief, optional --goal flag for primary_goal.
//   bun run decompose "a SaaS dashboard for accountants like Stripe" --goal "book demo"
const argv = process.argv.slice(2);
const goalIdx = argv.indexOf("--goal");
const primary_goal = goalIdx >= 0 ? argv.splice(goalIdx, 2)[1] : undefined;
const brief = argv.join(" ").trim() || "vegan meal kits for busy parents";

orchestrate(brief, primary_goal).catch((err) => {
  console.error(err);
  process.exit(1);
});
