import Anthropic from "@anthropic-ai/sdk";
import type { ModelName } from "./types.ts";

// Re-export so chapter files can import the type from one place.
export type { ModelName };

// One Anthropic client per process. The SDK picks up ANTHROPIC_API_KEY from
// the environment — bun and Node both read `.env` automatically.
export const client = new Anthropic();

export const DEFAULT_MODEL: ModelName =
  (process.env.DEFAULT_MODEL as ModelName | undefined) ?? "claude-sonnet-4-6";

// A tiny helper for chapters 02-04: pull the first text block out of a
// response. Real apps would walk the content array properly — but most of
// the early chapters work with text-only responses, and this keeps the
// example code focused on the lesson.
export function firstText(
  content: Array<{ type: string; text?: string }>,
): string {
  const block = content.find((b) => b.type === "text");
  if (!block || typeof block.text !== "string") {
    throw new Error("no text block in response");
  }
  return block.text;
}

// Extract a complete HTML document from a model response that might wrap it
// in markdown fences or include some chatty preamble. The agent has been
// asked to emit a full <!doctype html> page; this is just a safety net.
export function extractHtml(text: string): string {
  const fence = text.match(/```(?:html)?\n([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = text.search(/<!doctype html|<html/i);
  if (start >= 0) return text.slice(start).trim();
  return text.trim();
}
