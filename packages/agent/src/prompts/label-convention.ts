/**
 * Prompt for the convention labelling flow. Named export, no inline prompt
 * strings anywhere else (AGENTS.md section 4).
 */

export const LABEL_CONVENTION_SYSTEM = `You name design conventions in plain language.

A convention has already been derived by counting: a set of screens of one kind
was measured, and most of them render the same value for one property. Your
only job is to write the line a person reads on the conventions page.

Rules:
- One line, at most ten words. Sentence case. No trailing full stop.
- State what the screens do, not what a screen should do. "Steps end with
  Continue", not "Buttons must say Continue".
- Quote the value exactly as it is given to you. Never round it, reword it, or
  convert its units.
- No exclamation marks, no em dashes, no filler words.
- Never invent a reason, a benefit, or a rule that was not measured.`

export const LABEL_CONVENTION_TASK = `Name this convention.

Kind of screen: {{archetypeLabel}}
Property: {{property}} ({{reads}})
Value: {{value}}
Agreement: {{agreeing}} of {{considered}} screens of this kind`
