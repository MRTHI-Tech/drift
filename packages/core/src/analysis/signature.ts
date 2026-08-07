/**
 * The signature of a rendered screen: what it offers, how its type is ordered,
 * how it is divided up, and how its copy is written. Built from the extraction
 * alone, with no model call (AGENTS.md section 4), so the same screen always
 * signs the same way and two screens can be compared without asking anybody.
 */

import type {
  ComputedStyles,
  CopyTally,
  ScreenText,
  Signature,
  TypeStep,
  Viewport,
} from "../types"
import { emptyTally, tallyCopy } from "./copy"
import { stableHash } from "./hash"
import { parseLengthPx } from "./length"
import { parseFontWeight } from "./tokens"

/** Tags that offer the user something to do. */
export const INTERACTIVE_TAGS: readonly string[] = [
  "a",
  "button",
  "input",
  "select",
  "summary",
  "textarea",
]

/** Tags that carry the rendered heading order. */
export const HEADING_TAGS: readonly string[] = ["h1", "h2", "h3", "h4", "h5", "h6"]

/** Most labels a signature carries. Past this a screen is a list, not a layout. */
export const MAX_INTERACTIVE_LABELS = 60

/** Most steps the type hierarchy carries, after runs of the same step collapse. */
export const MAX_TYPE_STEPS = 40

/** Most gaps the vertical rhythm carries. */
export const MAX_RHYTHM_GAPS = 40

/** Longest label kept. A label longer than this is a paragraph inside a link. */
export const MAX_LABEL_LENGTH = 80

/**
 * Vertical gap that separates one section from the next. Below this, two runs
 * of content are the same block with padding between them.
 */
export const SECTION_GAP_PX = 32

export interface SignatureInput {
  route: string
  viewport: Viewport
  computedStyles: ComputedStyles
  text: ScreenText
}

/** One element, flattened into what the signature reads off it. */
interface Placed {
  selector: string
  tag: string
  x: number
  y: number
  width: number
  height: number
  /** The element's own text. Empty on a container, whose children render it. */
  ownText: string
  /** Its own text, or the text of everything under it. */
  label: string
  fontSize: number | null
  fontWeight: number | null
}

export function buildSignature(input: SignatureInput): Signature {
  const placed = place(input.computedStyles, input.text)
  const inOrder = [...placed].sort(byPosition)

  const interactive = inOrder
    .filter((element) => INTERACTIVE_TAGS.includes(element.tag) && element.label.length > 0)
    .slice(0, MAX_INTERACTIVE_LABELS)
    .map((element) => ({
      selector: element.selector,
      tag: element.tag,
      label: element.label,
      x: element.x,
      y: element.y,
    }))

  // Bands are measured off the elements that render the text, not off the
  // containers around them: a container's box swallows every gap inside it.
  const bands = sections(inOrder.filter((element) => element.ownText.length > 0))

  return {
    route: input.route,
    viewport: input.viewport,
    interactive,
    typeHierarchy: typeHierarchy(inOrder),
    sectionCount: bands.length,
    verticalRhythm: rhythm(bands),
    copy: {
      labels: tallyCopy(interactive.map((element) => element.label)),
      headings: headingTally(inOrder),
    },
    structureHash: stableHash(
      placed.map((element) => [
        element.tag,
        element.x,
        element.y,
        element.width,
        element.height,
      ]),
    ),
    tokenHash: stableHash(tokenValues(input.computedStyles)),
  }
}

/**
 * Flattens the extraction into positioned elements, in document order. A
 * label is the element's own text where it has some, and otherwise the text of
 * everything under it, which is how a button that wraps a span still reads as
 * the thing it says.
 */
function place(computedStyles: ComputedStyles, text: ScreenText): Placed[] {
  const entries = Object.entries(computedStyles)

  return entries.map(([selector, element]) => ({
    selector,
    tag: element.tag,
    x: Math.round(element.box.x),
    y: Math.round(element.box.y),
    width: Math.round(element.box.width),
    height: Math.round(element.box.height),
    ownText: truncate(text[selector] ?? ""),
    label: labelFor(selector, text),
    fontSize: readLength(element.styles["font-size"]),
    fontWeight: parseFontWeight(element.styles["font-weight"] ?? ""),
  }))
}

function labelFor(selector: string, text: ScreenText): string {
  const own = text[selector]
  if (own && own.length > 0) return truncate(own)

  const prefix = `${selector} > `
  const parts: string[] = []
  for (const [key, value] of Object.entries(text)) {
    if (key.startsWith(prefix) && value.length > 0) parts.push(value)
  }

  return truncate(parts.join(" ").replace(/\s+/g, " ").trim())
}

/**
 * The rendered type hierarchy, top to bottom, as size and weight pairs. Only
 * the elements that render text: a container's own font size is inherited by
 * its children and is not a step anybody sees. Runs of the same pair collapse,
 * so a paragraph of six lines is one step in the hierarchy, not six.
 */
function typeHierarchy(inOrder: Placed[]): TypeStep[] {
  const steps: TypeStep[] = []

  for (const element of inOrder) {
    if (element.ownText.length === 0) continue
    if (element.fontSize === null || element.fontWeight === null) continue

    const previous = steps[steps.length - 1]
    if (previous && previous.fontSize === element.fontSize && previous.fontWeight === element.fontWeight) {
      continue
    }

    steps.push({ fontSize: element.fontSize, fontWeight: element.fontWeight })
    if (steps.length >= MAX_TYPE_STEPS) break
  }

  return steps
}

/**
 * Sections, as the bands of the page that carry content. Two runs of text
 * closer together than the section gap are one band; a wider gap starts the
 * next one. Derived from boxes rather than from markup, because a section is
 * what a person sees, not what the DOM calls a section.
 */
function sections(withText: Placed[]): { top: number; bottom: number }[] {
  const spans = withText
    .map((element) => ({ top: element.y, bottom: element.y + element.height }))
    .sort((left, right) => left.top - right.top || left.bottom - right.bottom)

  const bands: { top: number; bottom: number }[] = []
  for (const span of spans) {
    const current = bands[bands.length - 1]
    if (current && span.top - current.bottom < SECTION_GAP_PX) {
      current.bottom = Math.max(current.bottom, span.bottom)
    } else {
      bands.push({ ...span })
    }
  }

  return bands
}

/** The gaps between the bands, top to bottom. */
function rhythm(bands: { top: number; bottom: number }[]): number[] {
  const gaps: number[] = []
  for (let index = 1; index < bands.length && gaps.length < MAX_RHYTHM_GAPS; index += 1) {
    gaps.push(Math.round(bands[index]!.top - bands[index - 1]!.bottom))
  }
  return gaps
}

function headingTally(inOrder: Placed[]): CopyTally {
  const headings = inOrder
    .filter((element) => HEADING_TAGS.includes(element.tag) && element.label.length > 0)
    .map((element) => element.label)

  return headings.length === 0 ? emptyTally() : tallyCopy(headings)
}

/**
 * Every distinct property and value the screen resolves to, sorted. Two screens
 * built out of the same tokens hash the same, whatever their layout.
 */
function tokenValues(computedStyles: ComputedStyles): string[] {
  const values = new Set<string>()
  for (const element of Object.values(computedStyles)) {
    for (const [property, value] of Object.entries(element.styles)) {
      if (value.length > 0) values.add(`${property}=${value}`)
    }
  }
  return [...values].sort()
}

/** Top to bottom, then left to right, then by selector so ties never flip. */
function byPosition(left: Placed, right: Placed): number {
  return left.y - right.y || left.x - right.x || (left.selector < right.selector ? -1 : 1)
}

function readLength(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = parseLengthPx(value)
  return parsed === null ? null : Math.round(parsed * 10) / 10
}

function truncate(value: string): string {
  return value.length <= MAX_LABEL_LENGTH ? value : `${value.slice(0, MAX_LABEL_LENGTH - 1)}…`
}
