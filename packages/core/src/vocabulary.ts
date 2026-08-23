/**
 * What a property is called in front of a person, and what kind of thing it is.
 *
 * Findings arrive naming their property in one of two vocabularies. A token
 * finding names the CSS property it was read from, `background-color`. A
 * pattern finding names the profile property it was measured against,
 * `cta.voice`. Both are correct and neither is English, and a list showing one
 * row saying `background-color` above another saying `cta.voice` is asking a
 * person to learn two naming schemes before they can read it.
 *
 * So this is the one place that turns either into a name and a kind. The name
 * is what a person reads. The kind is what lets them group, filter, and think
 * about six colours as one thing rather than six.
 *
 * It is a table rather than a rule, because there is no rule: `cta.radius` and
 * `border-radius` are the same kind of decision with unrelated names, and the
 * only thing that knows that is somebody writing it down.
 *
 * With one exception, and it is an exception because there genuinely is a rule
 * for it. A component property is a kind and a CSS property joined by a dot,
 * and both halves are already named: the kind by `COMPONENT_KIND_SINGULAR` and
 * the property by the table below. Nine kinds against eight properties is
 * seventy-two rows somebody would have to write and keep, to say seventy-two
 * times what composing them says once.
 */

import {
  COMPONENT_ASPECT,
  COMPONENT_KIND_SINGULAR,
  parseComponentProperty,
} from "./analysis/components"

/** The kinds a person sorts findings into. Ordered as the filter shows them. */
export const FINDING_KINDS = [
  "colour",
  "type",
  "spacing",
  "shape",
  "wording",
  "layout",
] as const

export type FindingKind = (typeof FINDING_KINDS)[number]

/** How a kind is written in the interface. */
export const FINDING_KIND_LABEL: Record<FindingKind, string> = {
  colour: "Colour",
  type: "Type",
  spacing: "Spacing",
  shape: "Shape",
  wording: "Wording",
  layout: "Layout",
}

/** What a person is told a property is. */
export interface PropertyReading {
  kind: FindingKind
  /** Sentence case, plain language, no dots and no hyphens. */
  label: string
}

/**
 * Every property Drift can raise a finding about. A property missing from here
 * still reads, it just reads as itself, which is the old behaviour and is
 * better than an empty cell.
 */
const READINGS: Record<string, PropertyReading> = {
  // Read off computed styles, as the token diff names them.
  color: { kind: "colour", label: "Text colour" },
  "background-color": { kind: "colour", label: "Background colour" },
  "font-size": { kind: "type", label: "Type size" },
  "font-weight": { kind: "type", label: "Type weight" },
  "line-height": { kind: "type", label: "Line height" },
  margin: { kind: "spacing", label: "Outer spacing" },
  padding: { kind: "spacing", label: "Inner spacing" },
  "border-radius": { kind: "shape", label: "Corner radius" },
  "box-shadow": { kind: "shape", label: "Shadow" },
  display: { kind: "layout", label: "Layout mode" },
  gap: { kind: "spacing", label: "Space between blocks" },
  "max-width": { kind: "layout", label: "Content width" },
  "border-width": { kind: "shape", label: "Border weight" },
  "border-style": { kind: "shape", label: "Border style" },

  // Measured against a convention, as the profile names them.
  "cta.label": { kind: "wording", label: "Button wording" },
  "cta.voice": { kind: "wording", label: "Button voice" },
  "cta.size": { kind: "type", label: "Button type size" },
  "cta.radius": { kind: "shape", label: "Button corner radius" },
  "heading.size": { kind: "type", label: "Heading size" },
  "heading.weight": { kind: "type", label: "Heading weight" },
  "heading.tone": { kind: "wording", label: "Heading tone" },
  "content.layout": { kind: "layout", label: "Container layout" },
  "content.padding": { kind: "spacing", label: "Container padding" },
  "content.gap": { kind: "spacing", label: "Space between blocks" },
  "content.width": { kind: "layout", label: "Container width" },
}

/**
 * The reading for a property, or the property itself under the kind that
 * covers the least. An unknown property is a property Drift has just learned
 * to measure and nobody has named yet, which should look plain rather than
 * broken.
 */
export function propertyReading(property: string): PropertyReading {
  return READINGS[property] ?? componentReading(property) ?? { kind: "layout", label: property }
}

/**
 * The reading of a component property, composed from its two halves, or null
 * when the property is not one.
 *
 * The kind of decision comes from the CSS half, because that is what it is: a
 * button's corner radius and a container's corner radius are the same kind of
 * decision about different things, which is exactly what the table above
 * already says about `cta.radius` and `border-radius`.
 */
function componentReading(property: string): PropertyReading | null {
  const component = parseComponentProperty(property)
  if (!component) return null

  const aspect = COMPONENT_ASPECT[component.styleProperty]
  const underlying = READINGS[component.styleProperty]
  if (!aspect || !underlying) return null

  const subject = COMPONENT_KIND_SINGULAR[component.kind]
  return { kind: underlying.kind, label: sentenceCase(`${subject} ${aspect}`) }
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Whether a property has been given a name, for tests that guard the table. A
 * component property counts as named when both of its halves are.
 */
export function isNamedProperty(property: string): boolean {
  return property in READINGS || componentReading(property) !== null
}
