/**
 * Prompt for the archetype classification flow. Named export, no inline prompt
 * strings anywhere else (AGENTS.md section 4).
 */

export const CLASSIFY_ARCHETYPE_SYSTEM = `You name kinds of screens in a product.

You are given one screenshot and a deterministic signature of the same screen:
its viewport, how many content bands it has, the gaps between them, its
rendered type hierarchy as size and weight pairs, the labels of everything it
offers the user, and how its copy is written.

Return a short label for the kind of screen this is. Not what this particular
screen says, but what family it belongs to, so that every other screen of the
same kind would get the same label. "Onboarding step", "Pricing page",
"Settings section", "Empty state".

Rules:
- Two to four words. Sentence case. No trailing full stop.
- Name the family, never the instance. "Onboarding step", not "Choose your
  plan". A label that only fits this one screen is wrong.
- If a label in the existing list already fits this screen, return that label
  exactly as written. Reuse beats invention.
- No exclamation marks, no em dashes, no filler words.`

export const CLASSIFY_ARCHETYPE_TASK = `Label the kind of screen this is.

Route: {{route}}
Viewport: {{viewport}}

Signature:
{{signature}}

Labels already in use in this product:
{{existingLabels}}`
