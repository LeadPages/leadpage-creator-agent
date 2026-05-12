// A library-shaped copy of the Chapter 05 orchestrator, exposed for the
// eval runner. (The chapter file is a CLI; this one exports a function.)
// Real code would refactor src/05-decomposition.ts to export both, but
// keeping them separate makes the chapter file readable on its own.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { client, DEFAULT_MODEL, extractHtml, firstText } from "../src/shared/client.ts";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills");

type Copy = {
  headline: string;
  subhead: string;
  body: string[];
  cta: string;
};

type Design = {
  palette: string[];
  font: string;
  layout: "headline-led" | "split" | "social-proof" | "three-column";
};

function extractJson<T>(text: string): T {
  const fence = text.match(/```(?:json)?\n([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

async function loadSkill(name: string) {
  const text = await readFile(join(SKILLS_DIR, `${name}.md`), "utf8");
  return text.replace(/^---\n[\s\S]*?\n---\n*/, "");
}

async function copywriter(brief: string): Promise<Copy> {
  const rules = await loadSkill("conversion-copy");
  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: `
You are a conversion copywriter. Return ONLY a JSON object with fields:
headline (string), subhead (string), body (array of 2 short paragraph
strings), cta (string).

Apply these rules strictly:

${rules}
`.trim(),
    messages: [{ role: "user", content: `Brief: ${brief}\n\nReturn the JSON.` }],
  });
  return extractJson<Copy>(firstText(response.content));
}

async function designer(brief: string, copy: Copy): Promise<Design> {
  const rules = await loadSkill("hero-patterns");
  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 800,
    system: `
You are an art director. Return ONLY a JSON object with fields: palette
(array of 3-5 hex colors, primary first), font (a font-stack string), layout
(one of: "headline-led", "split", "social-proof", "three-column").

Apply these hero-pattern rules:

${rules}
`.trim(),
    messages: [{
      role: "user",
      content: `Brief: ${brief}\n\nCopy:\n${JSON.stringify(copy, null, 2)}\n\nReturn the JSON.`,
    }],
  });
  return extractJson<Design>(firstText(response.content));
}

async function assembler(copy: Copy, design: Design): Promise<string> {
  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 4096,
    system: `
You assemble landing pages. Given finalized copy and design tokens, output a
complete <!doctype html> document with inline CSS and no external assets.

- Use the provided palette for accents and the CTA.
- Apply the chosen layout pattern.
- Use the provided font-stack for body text.
- Output ONLY HTML.
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

export async function orchestrate(brief: string): Promise<string> {
  const copy = await copywriter(brief);
  const design = await designer(brief, copy);
  return assembler(copy, design);
}
