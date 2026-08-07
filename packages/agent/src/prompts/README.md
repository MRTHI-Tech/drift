# Prompts

One file per flow that calls a model, each exporting named prompt strings. No
inline prompt strings anywhere else in the codebase (AGENTS.md section 4).

| File | Flow |
| --- | --- |
| `classify-archetype.ts` | `classifyArchetypeFlow` |
| `judge-pattern-drift.ts` | `judgePatternDriftFlow` |
| `label-convention.ts` | `labelConventionFlow` |

`deriveConventionsFlow` has no file here and must not grow one. Deriving a
convention is counting, and convention derivation is not on the list of model
calls in AGENTS.md section 4. That flow aggregates deterministically and calls
`labelConventionFlow` for the names, which is the one part of it a model may
touch.

Placeholders in the task strings are filled in by `fill()` in
`packages/agent/src/flows/render.ts`, not by a template engine. A placeholder
with no value is an error rather than an empty string, so a prompt never
silently ships a hole where a fact should be.

PR and rules-file prose lands here in a later phase.
