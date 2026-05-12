// Shared types used across chapters. Kept small on purpose — start small,
// grow only when a chapter actually needs more.

export type Brief = {
  // The product or service the page is for, in plain English.
  // e.g. "vegan meal kits for busy parents"
  topic: string;
  // Optional: a target audience the copywriter should write for.
  audience?: string;
  // Optional: a single primary action the page is asking visitors to take.
  goal?: string;
};

export type Brand = {
  name?: string;
  // Two-to-five hex colors, primary first.
  palette: string[];
  // A short voice description, e.g. "warm, confident, no jargon".
  voice?: string;
};

export type Page = {
  html: string;
  // Filled in by the saveAsset tool when we add one.
  path?: string;
};

export type ModelName =
  | "claude-haiku-4-5-20251001"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7";
