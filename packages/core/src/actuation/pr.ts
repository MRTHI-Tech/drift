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

  sections.push("", "## What Drift changed and what it did not", "", boundaryLine(plan), "", OPENED_BY_DRIFT)

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n"
}

/**
 * What a reviewer is told about how far to trust the change, which depends
 * entirely on who wrote it.
 *
 * This section used to say one thing, because there was one class of patch and
 * the sentence was true of it. Then the Fixer was added and it went on saying
 * that Drift does not read code, in the one place on the page a reviewer looks
 * to calibrate how carefully to read the diff. A pull request that understates
 * what wrote it is worse than one that says nothing, so the two classes now
 * say two different things and both are true of the patch below them.
 */
function boundaryLine(plan: PatchPlan): string {
  if (plan.author === "mechanical") {
    return (
      "Drift found this value written in the source and substituted it, " +
      "character for character. It did not read the code around it, restructure " +
      "anything, or decide where the value should come from."
    )
  }

  return (
    "**Drift wrote this change by reading your code, so read it as a proposal " +
    "rather than a correction.** The value was not written anywhere in the " +
    "source, so a substitution could not reach it and Drift went looking for " +
    "where it comes from.\n\n" +
    "Before opening this, Drift checked that every edit applies to a file it " +
    "actually read, matches there exactly once, stays inside its size limits, " +
    "and arrives at the value this finding names. It did **not** check that the " +
    "result compiles, that your tests pass, or that this is the way you would " +
    "have chosen to fix it. Drift does not build your project and cannot know " +
    "any of those. That is why this is a draft."
  )
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
