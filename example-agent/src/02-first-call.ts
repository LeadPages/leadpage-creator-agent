// Chapter 02 — First call
// ------------------------
// The simplest thing that could work: a single messages.create call.
// Give Claude a topic, get an HTML page back. No tools, no loop.
//
// Run it:
//   bun run first-call "vegan meal kits for busy parents"
//
// The page lands in out/02-first-call.html. Open it in a browser.

import { mkdir, writeFile } from "node:fs/promises";
import { client, DEFAULT_MODEL, extractHtml, firstText } from "./shared/client.ts";
import { PROMPT_NAIVE } from "./shared/prompts.ts";

async function main() {
  const topic = process.argv.slice(2).join(" ").trim() || "vegan meal kits for busy parents";

  console.log(`▸ topic: ${topic}`);
  console.log(`▸ model: ${DEFAULT_MODEL}`);
  console.log(`▸ calling Claude…`);

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 16384,
    system: PROMPT_NAIVE,
    messages: [
      { role: "user", content: `Create a landing page for: ${topic}` },
    ],
  });

  const html = extractHtml(firstText(response.content));

  await mkdir("out", { recursive: true });
  const path = "out/02-first-call.html";
  await writeFile(path, html, "utf8");

  console.log(`✓ wrote ${path}`);
  console.log(`  input tokens:  ${response.usage.input_tokens}`);
  console.log(`  output tokens: ${response.usage.output_tokens}`);
  console.log(`\nOpen it: open ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
