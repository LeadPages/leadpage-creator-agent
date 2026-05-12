// Two-layer grader.
//
// Layer 1: programmatic checks — fast, deterministic. Did the agent emit
//          valid-shaped HTML with the structural elements we asked for?
// Layer 2: LLM-as-judge — slower, opinionated. How good is the copy and
//          design, on a 1-5 rubric?
//
// The same pattern is used in the eval-driven-agent-development workshop —
// programmatic checks on the .pptx XML, LLM-as-judge on the rendered slides.

import { client, DEFAULT_MODEL, firstText } from "../src/shared/client.ts";

export type Task = {
  id: string;
  brief: string;
  must_mention: string[];
  primary_goal: string;
  constraints?: string[];
};

export type ProgrammaticScore = {
  has_doctype: boolean;
  has_h1: boolean;
  h1_word_count: number;
  has_cta_button: boolean;
  cta_word_count: number;
  body_paragraph_count: number;
  bytes: number;
  must_mention_hits: number;
  must_mention_total: number;
  pass: boolean;       // hard programmatic gate
  notes: string[];
};

export type JudgeScore = {
  conversion_quality: number;    // 1-5
  brand_fit:          number;    // 1-5
  layout_appropriate: number;    // 1-5
  rationale:          string;
  pass: boolean;                 // average >= 3.5
};

export type TaskResult = {
  task_id: string;
  html: string;
  programmatic: ProgrammaticScore;
  judge: JudgeScore;
  overall_pass: boolean;
};

// --- Layer 1: programmatic checks --------------------------------------------

export function gradeProgrammatic(task: Task, html: string): ProgrammaticScore {
  const notes: string[] = [];
  const has_doctype = /<!doctype html/i.test(html);
  if (!has_doctype) notes.push("missing <!doctype html>");

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1_text = h1Match ? stripTags(h1Match[1]) : "";
  const has_h1 = h1_text.length > 0;
  const h1_word_count = h1_text.split(/\s+/).filter(Boolean).length;
  if (!has_h1) notes.push("missing <h1>");
  if (has_h1 && (h1_word_count < 4 || h1_word_count > 16)) {
    notes.push(`h1 word count out of range: ${h1_word_count}`);
  }

  // Treat the first <button> or <a class="...cta...">, or any element whose
  // text contains a verb-like CTA, as the CTA.
  const ctaMatch =
    html.match(/<(?:button|a)[^>]*>([\s\S]*?)<\/(?:button|a)>/i) ||
    html.match(/<input[^>]*type=["']submit["'][^>]*value=["']([^"']+)["']/i);
  const cta_text = ctaMatch ? stripTags(ctaMatch[1] || ctaMatch[0]) : "";
  const has_cta_button = cta_text.length > 0;
  const cta_word_count = cta_text.split(/\s+/).filter(Boolean).length;
  if (!has_cta_button) notes.push("no CTA-like button/link");
  if (has_cta_button && cta_word_count > 6) {
    notes.push(`CTA too long (${cta_word_count} words)`);
  }

  // count <p> tags that contain a sentence
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((t) => t.split(/\s+/).length >= 8);
  const body_paragraph_count = paragraphs.length;

  const lower = html.toLowerCase();
  const mention_hits = task.must_mention.filter((w) => lower.includes(w.toLowerCase())).length;

  // Hard gate: must have h1, must have a CTA-ish thing, must hit at least
  // half of the required mentions. We're lenient on word counts — those go
  // into the notes for the judge to weigh.
  const pass =
    has_doctype &&
    has_h1 &&
    has_cta_button &&
    body_paragraph_count >= 1 &&
    mention_hits >= Math.ceil(task.must_mention.length / 2);

  return {
    has_doctype,
    has_h1,
    h1_word_count,
    has_cta_button,
    cta_word_count,
    body_paragraph_count,
    bytes: Buffer.byteLength(html),
    must_mention_hits: mention_hits,
    must_mention_total: task.must_mention.length,
    pass,
    notes,
  };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// --- Layer 2: LLM-as-judge ---------------------------------------------------

const JUDGE_SYSTEM = `
You are a senior conversion-optimization reviewer. You grade landing pages on
three axes (each 1-5, integer). Be honest — most pages don't deserve a 5.

1. conversion_quality (1-5): Is the headline outcome-led? Is the CTA specific?
   Are claims concrete? Would a real visitor know what this is and what to do?
2. brand_fit (1-5): Does the design match the brief — palette, voice, layout?
3. layout_appropriate (1-5): Is the chosen hero pattern right for this kind of
   page? (Coming-soon page should be tiny. Pricing page should have tiers.)

Return ONLY a JSON object: {"conversion_quality": N, "brand_fit": N,
"layout_appropriate": N, "rationale": "one short paragraph"}.
`.trim();

export async function gradeWithJudge(task: Task, html: string): Promise<JudgeScore> {
  // We give the judge a TRIMMED version of the HTML — strip <style> contents
  // and trim long inline scripts, so the rubric sees the structure/copy.
  const trimmed = html
    .replace(/<style[\s\S]*?<\/style>/gi, "<style>… (inline styles)</style>")
    .slice(0, 8000);

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 500,
    system: JUDGE_SYSTEM,
    messages: [{
      role: "user",
      content:
        `Brief: ${task.brief}\n` +
        `Must mention: ${task.must_mention.join(", ")}\n` +
        `Primary goal: ${task.primary_goal}\n\n` +
        `--- PAGE HTML ---\n${trimmed}\n--- END ---\n\nReturn the JSON.`,
    }],
  });

  const text = firstText(response.content);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const parsed = JSON.parse(text.slice(start, end + 1)) as Omit<JudgeScore, "pass">;
  const avg = (parsed.conversion_quality + parsed.brand_fit + parsed.layout_appropriate) / 3;
  return { ...parsed, pass: avg >= 3.5 };
}

// --- Combined ---------------------------------------------------------------

export async function gradeOne(task: Task, html: string): Promise<TaskResult> {
  const programmatic = gradeProgrammatic(task, html);
  // Don't waste judge tokens on structurally broken outputs.
  if (!programmatic.pass) {
    return {
      task_id: task.id,
      html,
      programmatic,
      judge: {
        conversion_quality: 0,
        brand_fit: 0,
        layout_appropriate: 0,
        rationale: "programmatic gate failed — judge skipped",
        pass: false,
      },
      overall_pass: false,
    };
  }
  const judge = await gradeWithJudge(task, html);
  return {
    task_id: task.id,
    html,
    programmatic,
    judge,
    overall_pass: programmatic.pass && judge.pass,
  };
}
