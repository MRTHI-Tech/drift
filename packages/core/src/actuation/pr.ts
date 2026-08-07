/**
 * What a pull request from Drift says.
 *
 * Composed rather than written by a model. The two things a reviewer needs are
 * already in Firestore and already true: the evidence line, which the judgment
 * phase wrote behind the reconciliation gate, and the substitution, which the
 * patch planner measured against the repo's own source. Asking a model to
 * restate either of them could only make one of them less true.
 *
 * Every body ends with the line `Opened by Drift.`, so a pull request from the
 * agent is never mistaken for one from a person.
 */

import type { Finding, Viewport } from "../types"
import { OPENED_BY_DRIFT } from "./constants"
import { evidenceSentence } from "./evidence"
import type { PatchDirection, PatchPlan } from "./patch"

/** One image a body embeds, already reachable at a URL GitHub can load. */
export interface EvidenceImage {
  url: string
  /** What the reader is looking at, in plain language. */
  caption: string
}

/** Who asked for this pull request. */
export type Opener = "run" | "resolution"

export interface PullRequestContent {
  title: string
  body: string
}

export interface ComposeInput {
  finding: Finding
  plan: PatchPlan
  route: string
  viewport: Viewport
  direction: PatchDirection
  before: EvidenceImage | null
  after: EvidenceImage | null
  opener: Opener
}

/** One line, sentence case, naming both values and the route. */
export function pullRequestTitle(input: ComposeInput): string {
  const where = input.direction === "conform" ? ` on ${input.route}` : " across the product"
  return `Use ${input.plan.to} instead of ${input.plan.from}${where}`
}

/** The whole body, in the order a reviewer reads it. */
export function pullRequestBody(input: ComposeInput): string {
  const { plan, finding } = input

  const sections: string[] = [
    evidenceSentence(finding),
    "",
    `Seen on ${input.route} at ${input.viewport}. ${openedLine(input.opener)}`,
    "",
    "## The change",
    "",
    changeLine(input),
    "",
    fileTable(plan),
  ]

  if (input.before || input.after) {
    sections.push("", "## Before and after", "")
    if (input.before) {
      sections.push(`${input.before.caption}`, "", `![Before](${input.before.url})`, "")
    }
    if (input.after) {
      sections.push(`${input.after.caption}`, "", `![After](${input.after.url})`, "")
    }
  }

  sections.push(
    "",
    "## What Drift changed and what it did not",
    "",
    "Drift substitutes literal values and label text. It does not restructure " +
      "code, move a value into a token, or decide where a value should come " +
      "from. Anything needing a judgment about code structure is left for you.",
    "",
    OPENED_BY_DRIFT,
  )

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n"
}

function openedLine(opener: Opener): string {
  return opener === "run"
    ? "Drift opened this without being asked, under the rules in its autonomy check."
    : "You resolved this finding, so Drift opened the change it implies."
}

function changeLine(input: ComposeInput): string {
  const { plan, finding } = input
  const source = finding.evidence.expectedSource

  const base = `\`${plan.from}\` becomes \`${plan.to}\``
  if (input.direction === "conform" && source) {
    return `${base}, which is the value of \`${source}\`.`
  }
  if (input.direction === "siblings") {
    return `${base}, which is what ${input.route} already renders.`
  }
  return `${base}.`
}

function fileTable(plan: PatchPlan): string {
  const rows = plan.files.map(
    (file) => `| \`${file.path}\` | ${file.occurrences} |`,
  )
  return ["| File | Occurrences |", "| --- | --- |", ...rows].join("\n")
}

/** The commit message the branch carries. Matches the title, imperative. */
export function commitMessage(input: ComposeInput): string {
  return pullRequestTitle(input)
}
