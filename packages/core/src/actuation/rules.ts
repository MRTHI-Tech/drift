/**
 * `drift.rules.md`, the file a coding agent reads before it writes a screen.
 *
 * Written for a machine that is about to generate code, so every line is an
 * instruction rather than an observation: "Label the last action Continue",
 * not "most screens say Continue". The counts stay, because an agent deciding
 * between two ways to write something should know how much of the product is
 * behind each rule, and because a rule with its evidence attached is one a
 * person can argue with.
 *
 * Composed rather than model-written. Every value in it was counted, and the
 * plain-language name beside each convention was already written when the
 * convention was derived. Nothing here needs a second opinion.
 *
 * Deliberately carries no timestamp. The file is regenerated on every
 * convention change, and a date in the header would make every regeneration a
 * diff even when the rules did not move.
 */

import {
  COMPONENT_ASPECT,
  COMPONENT_KIND_LABEL,
  COMPONENT_KIND_SINGULAR,
  parseComponentProperty,
} from "../analysis/components"
import type { Convention, CopyCase, CopyTally, Signature } from "../types"
import { RULES_HEADER } from "./constants"

/** One archetype as the rules file states it. */
export interface RulesArchetype {
  label: string
  conventions: readonly Convention[]
  /** Signatures of the archetype's screens, for the copy voice section. */
  signatures: readonly Signature[]
}

export interface RenderRulesInput {
  projectName: string
  archetypes: readonly RulesArchetype[]
  /** Conventions that hold everywhere rather than on one kind of screen. */
  productWide: readonly Convention[]
  /** Screen id to route, so an exception reads as a page rather than an id. */
  routes: ReadonlyMap<string, string>
}

/** How a set of screens writes, counted across their signatures. */
export interface CopyVoice {
  labelCase: CopyCase | null
  headingCase: CopyCase | null
  /** Share of labels opening with a verb, 0 to 1. */
  imperativeShare: number
  screens: number
}

/** The whole file, ready to commit. */
export function renderRulesFile(input: RenderRulesInput): string {
  const blocks: string[] = [
    `# Drift rules for ${input.projectName}`,
    "",
    RULES_HEADER,
    "",
    "These rules were measured from this product's rendered screens. Follow them",
    "when you add or change a screen. Where a rule and one file disagree, the rule",
    "is what the rest of the product already does.",
  ]

  const stated = input.archetypes.filter((archetype) => hasSomethingToSay(archetype))

  for (const archetype of stated) {
    blocks.push("", ...archetypeBlock(archetype, input.routes))
  }

  const productWide = live(input.productWide)
  if (productWide.length > 0) {
    blocks.push("", `## Everywhere`, "", ...ruleLines(productWide), "")
    blocks.push(...exceptionLines(productWide, input.routes))
  }

  if (stated.length === 0 && productWide.length === 0) {
    blocks.push(
      "",
      "No conventions have been measured yet. A convention needs three or more",
      "screens of a family agreeing, or three or more of one kind of component,",
      "before Drift states it.",
    )
  }

  return `${blocks.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`
}

/**
 * Copy voice across a set of screens: how their labels and headings are
 * capitalised, and how often a label opens with a verb. Reported only where the
 * screens agree, because a split family has no voice to state.
 */
export function summarizeCopyVoice(signatures: readonly Signature[]): CopyVoice {
  const labels = signatures.map((signature) => signature.copy.labels)
  const headings = signatures.map((signature) => signature.copy.headings)

  const labelCount = total(labels, (tally) => tally.count)
  const imperative = total(labels, (tally) => tally.imperative)

  return {
    labelCase: dominant(labels),
    headingCase: dominant(headings),
    imperativeShare: labelCount === 0 ? 0 : imperative / labelCount,
    screens: signatures.length,
  }
}

function archetypeBlock(
  archetype: RulesArchetype,
  routes: ReadonlyMap<string, string>,
): string[] {
  const conventions = live(archetype.conventions)
  const labels = conventions.filter((convention) => isLabel(convention.property))
  const type = conventions.filter((convention) => !isLabel(convention.property))
  const voice = voiceLines(summarizeCopyVoice(archetype.signatures))
  const exceptions = exceptionLines(conventions, routes)

  const block: string[] = [`## ${archetype.label}`]

  if (labels.length > 0) block.push("", "### Labels", "", ...ruleLines(labels))
  if (type.length > 0) block.push("", "### Type", "", ...ruleLines(type))
  if (voice.length > 0) block.push("", "### Copy voice", "", ...voice)
  if (exceptions.length > 0) block.push("", "### Recorded exceptions", "", ...exceptions)

  return block
}

function hasSomethingToSay(archetype: RulesArchetype): boolean {
  return (
    live(archetype.conventions).length > 0 ||
    voiceLines(summarizeCopyVoice(archetype.signatures)).length > 0
  )
}

/** Conventions the user has not removed. A removed convention states nothing. */
function live(conventions: readonly Convention[]): Convention[] {
  return conventions.filter((convention) => convention.status !== "removed")
}

function ruleLines(conventions: readonly Convention[]): string[] {
  return conventions.map((convention) => `- ${ruleLine(convention)}`)
}

/**
 * One convention as an instruction. The imperative comes from the property's
 * shape rather than from a model: a label is something you write, a size is
 * something you set.
 */
export function ruleLine(convention: Convention): string {
  const instruction = instructionFor(convention.property, convention.value)
  return `${instruction} ${evidenceNote(convention)}`
}

/** Subjects a convention can be stated about, by the first part of its property. */
const RULE_SUBJECTS: Record<string, string> = {
  cta: "the last action on the screen",
  heading: "the first heading",
  copy: "the screen's copy",
}

/** Aspects a convention can be stated over, by the last part of its property. */
const RULE_ASPECTS: Record<string, string> = {
  label: "label",
  size: "font size",
  radius: "corner radius",
  weight: "font weight",
  case: "capitalisation",
}

function instructionFor(property: string, value: string): string {
  const component = componentInstruction(property, value)
  if (component) return component

  const parts = property.split(".")
  const subject = RULE_SUBJECTS[parts[0] ?? ""]
  const aspect = RULE_ASPECTS[parts[parts.length - 1] ?? ""]

  if (!subject || !aspect) return `Set ${property} to ${value}.`
  if (aspect === "label") return `Label ${subject} "${value}".`

  return `Set the ${aspect} of ${subject} to ${value}.`
}

/**
 * A component convention as an instruction, or null when the property is not
 * one. Says "every", because that is what makes it a component convention
 * rather than a screen one: it holds wherever the control appears, and an
 * agent reading this file is about to write one somewhere new.
 */
function componentInstruction(property: string, value: string): string | null {
  const component = parseComponentProperty(property)
  if (!component) return null

  const aspect = COMPONENT_ASPECT[component.styleProperty] ?? component.styleProperty
  return `Set the ${aspect} of every ${COMPONENT_KIND_SINGULAR[component.kind]} to ${value}.`
}

/** What a convention is about, as a noun phrase an exception line can name. */
function aspectPhrase(property: string): string {
  const component = parseComponentProperty(property)
  if (component) {
    const aspect = COMPONENT_ASPECT[component.styleProperty] ?? component.styleProperty
    return `the ${aspect} of its ${COMPONENT_KIND_LABEL[component.kind].toLowerCase()}`
  }

  const parts = property.split(".")
  const subject = RULE_SUBJECTS[parts[0] ?? ""]
  const aspect = RULE_ASPECTS[parts[parts.length - 1] ?? ""]

  return subject && aspect ? `the ${aspect} of ${subject}` : property
}

function evidenceNote(convention: Convention): string {
  const screens = convention.evidenceScreenIds.length
  const measured = `Measured on ${screens} ${screens === 1 ? "screen" : "screens"}.`

  if (convention.status === "promoted") return `${measured} You chose this value.`
  if (convention.confidence === "low") {
    return `${measured} The rest of the family has not settled on one value.`
  }
  return measured
}

function voiceLines(voice: CopyVoice): string[] {
  const lines: string[] = []

  if (voice.labelCase) lines.push(`- Write action labels in ${caseName(voice.labelCase)}.`)
  if (voice.imperativeShare >= 0.6) {
    lines.push("- Open an action label with a verb, as most of these screens do.")
  }
  if (voice.headingCase) lines.push(`- Write headings in ${caseName(voice.headingCase)}.`)

  return lines
}

function exceptionLines(
  conventions: readonly Convention[],
  routes: ReadonlyMap<string, string>,
): string[] {
  return conventions.flatMap((convention) =>
    convention.exceptions.map((exception) => {
      const where = routes.get(exception.screenId) ?? `Screen ${exception.screenId}`
      return (
        `- ${where} is allowed to differ on ${aspectPhrase(convention.property)}. ` +
        `Leave it as it is. Reason: ${exception.reason}`
      )
    }),
  )
}

function isLabel(property: string): boolean {
  return property.endsWith(".label")
}

function caseName(value: CopyCase): string {
  switch (value) {
    case "sentence":
      return "sentence case"
    case "title":
      return "title case"
    case "upper":
      return "upper case"
    case "lower":
      return "lower case"
    default:
      return "no single case"
  }
}

/**
 * The case more than half the counted lines are in, across every screen. A
 * family split down the middle has no case to state, which is the same rule one
 * screen's own tally follows. `other` is never stated: a majority of lines that
 * match no case is the absence of a convention, not one.
 */
function dominant(tallies: readonly CopyTally[]): CopyCase | null {
  const count = total(tallies, (tally) => tally.count)
  if (count === 0) return null

  const cases: CopyCase[] = ["sentence", "title", "upper", "lower"]
  for (const value of cases) {
    if (total(tallies, (tally) => tally[value]) * 2 > count) return value
  }
  return null
}

function total(tallies: readonly CopyTally[], read: (tally: CopyTally) => number): number {
  return tallies.reduce((sum, tally) => sum + read(tally), 0)
}
