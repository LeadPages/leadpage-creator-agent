---
name: hero-patterns
description: Layout patterns for landing-page hero sections — when to use each, what each one needs to work. Load when picking the hero layout.
---

# Hero section patterns

There are four hero patterns we use. Pick the one whose shape matches the
strongest asset in the brief.

## 1. Headline-led (the default)

Big headline, short subhead, single CTA. No image — just typography on a clean
background. Use when:

- The product is a service or category the visitor already understands.
- You don't have a strong visual yet.
- You want fastest load and highest text-to-design ratio.

Layout:
```
+----------------------------+
|                            |
|   Headline (h1, large)     |
|                            |
|   Subhead (1 sentence)     |
|                            |
|   [ Primary CTA ]          |
|                            |
+----------------------------+
```

CSS: center the column, ~640px max-width, 80px vertical padding, large
type scale (clamp(36px, 5vw, 64px) for h1).

## 2. Split (text + visual)

Headline + subhead + CTA on the left, an image or product shot on the right.
Use when:

- The product *looks* like something — a UI, a physical object, a recipe.
- You have a strong visual.
- The viewer needs to understand "what is this?" visually before reading.

Layout (>=900px):
```
+-----------+---+--------------+
| Headline  |   |  [image]     |
| Subhead   |   |              |
| [CTA]     |   |              |
+-----------+---+--------------+
```

Stack on mobile.

## 3. Centered with social proof

Headline, subhead, CTA, then a row of customer logos or a 1-sentence quote
underneath. Use when:

- The objection is trust (B2B, financial, healthcare).
- You have real, recognizable logos.
- The audience is risk-averse.

```
+----------------------------+
|   Headline                 |
|   Subhead                  |
|   [ CTA ]                  |
| ──────────────────────────  |
|  used by [Acme] [Corp] ... |
+----------------------------+
```

## 4. Three-column features

A bold headline, then immediately three short feature columns with an icon
each. Use when:

- The product has three roughly equal pillars (price, speed, quality).
- The audience scans rather than reads.
- You explicitly want to compress the hero to one screen.

```
+----------------------------+
|   Headline                 |
+------+------+--------------+
| ⚡    | 🎯   | 🌱           |
| Fast | Pre- | Plant-       |
|      | cise | based        |
+------+------+--------------+
| [CTA — centered, below]    |
+----------------------------+
```

## Default rule

When the brief doesn't strongly suggest one of 2–4, use 1 (headline-led).
The most common mistake is over-designing a hero before the copy works.
