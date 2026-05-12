# Leadpage Creator — the tutorial's running example

A TypeScript project you build alongside the tutorial in `../site/`. Each chapter
has a matching source file under `src/`.

## Setup (10 minutes, see Chapter 01)

```bash
bun install
cp .env.example .env             # then put your ANTHROPIC_API_KEY in .env
```

If you don't have bun: `curl -fsSL https://bun.sh/install | bash`. If you'd
rather use Node, every command works with `npx tsx <file>` too.

## Run each chapter's example

```bash
bun run first-call   "vegan meal kits for busy parents"     # Chapter 02
bun run tools        "vegan meal kits for busy parents"     # Chapter 03
bun run skills       "vegan meal kits for busy parents"     # Chapter 04
bun run decompose    "vegan meal kits for busy parents"     # Chapter 05
bun run memory                                              # Chapter 06
bun run eval                                                # Chapter 07
bun run sweep                                               # Chapter 08
bun run stream       "vegan meal kits for busy parents"     # Chapter 09
bun run deploy                                              # Chapter 10
```

Each command writes its output to `out/<chapter>.html` (or, for evals, to
`evals/reports/`). Open them in a browser to see what your agent produced.

## Layout

```
src/
  shared/
    client.ts            shared Anthropic client + helpers
    prompts.ts           the system prompt(s) used by multiple chapters
    types.ts             the shared types (Brief, Brand, Page, etc.)
  02-first-call.ts       a single messages.create call
  03-tools.ts            the agent loop with two tools
  04-skills.ts           skill-loading pattern (instructions on demand)
  skills/                two example skills
    conversion-copy.md
    hero-patterns.md
  05-decomposition.ts    orchestrator + copywriter + designer subagents
  06-memory.ts           persistent brand-kit memory
  08-rightmodel.ts       sweep models × thinking levels over the eval set
  09-production.ts       streaming, retries, MCP, observability
  10-managed-agent.ts    deploy as a Claude Managed Agent
evals/
  dataset.json           6 landing-page briefs
  grader.ts              two-layer grader (programmatic + LLM-as-judge)
  run.ts                 eval runner — call it after each chapter
```
