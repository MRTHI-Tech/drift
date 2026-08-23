/**
 * What kind of component an element is, and what makes two of them look alike.
 *
 * Drift's conventions have always been stated over a screen's three anchors:
 * its terminal action, its first heading, and the container those sit in. That
 * catches a screen drifting from its family and misses the thing a person
 * notices first, which is one kind of control not looking like the others. A
 * radio that is a circle here and a square there, an input underlined on one
 * screen and boxed on the next, icons drawn at two weights: none of that is
 * about screens at all, and comparing screens will never find it.
 *
 * A component kind is identity without a name. Two elements are the same kind
 * of thing because of what they are, not because they share a selector or a
 * test id, which matters because most applications have neither: a real
 * project measured here had twelve anchored selectors across twelve screens,
 * and eleven of them were the document root.
 *
 * The list is closed and short on purpose, the same way the word lists in
 * `copy.ts` are closed. Every entry is a control somebody can point at and
 * name, so a convention stated over one reads as a sentence about the product
 * rather than about the DOM. A tag Drift cannot place is not a component, and
 * saying nothing about it is the correct outcome.
 */

import { confidenceOf } from "./confidence"
import type { StyleProperty } from "../constants"
import type { Confidence } from "../types"
import type { ElementStyles } from "../types"

/** The kinds Drift can recognise. */
export const COMPONENT_KINDS = [
  "button",
  "textInput",
  "radio",
  "checkbox",
  "toggle",
  "select",
  "datePicker",
  "icon",
  "tab",
] as const

export type ComponentKind = (typeof COMPONENT_KINDS)[number]

/** How a kind is written in the interface. */
export const COMPONENT_KIND_LABEL: Record<ComponentKind, string> = {
  button: "Buttons",
  textInput: "Text inputs",
  radio: "Radio buttons",
  checkbox: "Checkboxes",
  toggle: "Toggles",
  select: "Dropdowns",
  datePicker: "Date pickers",
  icon: "Icons",
  tab: "Tabs",
}

/**
 * One of a kind, as a sentence names it. The plural above heads a list; this
 * is what a finding says when it is about a single control, and the two are
 * kept apart rather than derived from each other because "Radio buttons"
 * without its s is not a radio button.
 */
export const COMPONENT_KIND_SINGULAR: Record<ComponentKind, string> = {
  button: "button",
  textInput: "text input",
  radio: "radio button",
  checkbox: "checkbox",
  toggle: "toggle",
  select: "dropdown",
  datePicker: "date picker",
  icon: "icon",
  tab: "tab",
}

/**
 * The `type` of an input, and what it makes the input. Types absent from here
 * are inputs Drift has no opinion about, such as `hidden` or `file`.
 */
const INPUT_TYPES: Record<string, ComponentKind> = {
  text: "textInput",
  email: "textInput",
  password: "textInput",
  search: "textInput",
  tel: "textInput",
  url: "textInput",
  number: "textInput",
  radio: "radio",
  checkbox: "checkbox",
  date: "datePicker",
  "datetime-local": "datePicker",
  month: "datePicker",
  week: "datePicker",
  time: "datePicker",
}

/**
 * An ARIA role, and what it makes an element. This is the half that matters
 * for a component library, where a radio is a div that says it is one.
 */
const ROLES: Record<string, ComponentKind> = {
  button: "button",
  radio: "radio",
  checkbox: "checkbox",
  switch: "toggle",
  tab: "tab",
  combobox: "select",
  listbox: "select",
  textbox: "textInput",
}

/**
 * The kind of component an element is, or null when it is not one.
 *
 * The role wins where an element carries one, because an element that declares
 * what it is has been told what it is by whoever wrote it, and that is better
 * evidence than its tag. A `div` with `role="radio"` is a radio; a `button`
 * with `role="tab"` is a tab, which is exactly how every tab bar in every
 * component library is built.
 */
export function componentKind(element: ElementStyles): ComponentKind | null {
  const role = element.attributes?.role
  if (role && role in ROLES) return ROLES[role]!

  const tag = element.tag.toLowerCase()

  if (tag === "input") {
    const type = element.attributes?.type ?? "text"
    return INPUT_TYPES[type] ?? null
  }

  if (tag === "button") return "button"
  if (tag === "textarea") return "textInput"
  if (tag === "select") return "select"
  if (tag === "svg") return "icon"

  return null
}

/**
 * The properties that decide whether two of a kind look alike.
 *
 * Short per kind, and different per kind, because the question is different.
 * What separates a circular radio from a square one is its radius and nothing
 * else; what separates an underlined input from a boxed one is where its
 * border is. Comparing every recorded property instead would find that two
 * buttons sit at different margins, which is true, is not drift, and would
 * bury the answer somebody wanted.
 */
export const COMPONENT_PROPERTIES: Record<ComponentKind, readonly StyleProperty[]> = {
  button: ["border-radius", "background-color", "font-size", "font-weight", "padding"],
  textInput: ["border-width", "border-style", "border-radius", "background-color", "font-size"],
  radio: ["border-radius", "border-width", "border-style", "background-color"],
  checkbox: ["border-radius", "border-width", "border-style", "background-color"],
  toggle: ["border-radius", "background-color"],
  select: ["border-width", "border-style", "border-radius", "background-color", "font-size"],
  datePicker: ["border-width", "border-style", "border-radius", "background-color", "font-size"],
  icon: ["color"],
  tab: ["border-radius", "border-width", "border-style", "background-color", "font-weight"],
}

/**
 * What each property is called when a component convention is read aloud.
 *
 * Eight rows, covering every property any kind is judged on. Separate from the
 * vocabulary's own table because the same CSS property reads differently once
 * it is attached to a control: `color` on a paragraph is its text colour, and
 * on an icon it is simply the icon's colour. The subject supplies the rest of
 * the sentence, so this half only has to name the aspect.
 */
export const COMPONENT_ASPECT: Partial<Record<StyleProperty, string>> = {
  color: "colour",
  "background-color": "background colour",
  "font-size": "type size",
  "font-weight": "type weight",
  padding: "inner spacing",
  "border-radius": "corner radius",
  "border-width": "border weight",
  "border-style": "border style",
}

const KINDS = new Set<string>(COMPONENT_KINDS)

/**
 * The dotted name a component convention is stored and reported under.
 *
 * `radio.border-radius`, in the shape `cta.radius` already uses: a subject, a
 * dot, an aspect. The CSS property keeps its own name rather than being
 * translated, because the value stored beside it is the CSS value and the two
 * have to stay readable as one fact.
 */
export function componentProperty(kind: ComponentKind, property: string): string {
  return `${kind}.${property}`
}

/**
 * The kind and the CSS property behind a dotted name, or null for a property
 * that is not one of these.
 *
 * Strict on both halves: a name parses only when the kind exists and the
 * property is one that kind is actually judged on. Anything else is a property
 * from the other vocabulary, or from no vocabulary, and guessing at it would
 * put a made-up sentence in front of somebody.
 */
export function parseComponentProperty(
  property: string,
): { kind: ComponentKind; styleProperty: StyleProperty } | null {
  const dot = property.indexOf(".")
  if (dot < 0) return null

  const kind = property.slice(0, dot)
  const styleProperty = property.slice(dot + 1)
  if (!KINDS.has(kind)) return null

  const judged: readonly string[] = COMPONENT_PROPERTIES[kind as ComponentKind]
  if (!judged.includes(styleProperty)) return null

  return { kind: kind as ComponentKind, styleProperty: styleProperty as StyleProperty }
}

/** Whether a property names a component convention rather than a screen one. */
export function isComponentProperty(property: string): boolean {
  return parseComponentProperty(property) !== null
}

/**
 * A component convention in plain language, composed rather than model-written.
 *
 * Naming is on the list of things a model may write (AGENTS.md section 4), and
 * this is the case where it has nothing to add: the subject is a control with
 * a name, the aspect is one of eight, and the value is the value. A sentence
 * assembled from those three is the same sentence a model would return, minus
 * the call and minus the chance of it coming back in a voice Drift would not
 * use.
 */
export function componentConventionLabel(
  kind: ComponentKind,
  property: string,
  value: string,
): string {
  const aspect = COMPONENT_ASPECT[property as StyleProperty] ?? property
  return `${COMPONENT_KIND_LABEL[kind]} have a ${aspect} of ${value}`
}

/** One component found on one screen. */
export interface ComponentInstance {
  kind: ComponentKind
  screenId: string
  selector: string
  /** Only the properties that define this kind, in the order declared. */
  values: Record<string, string>
}

/**
 * Every component on one screen, in selector order so the same screen always
 * yields the same list. An element whose kind holds no value for a property it
 * should have is kept without it, the same way a profile leaves out a property
 * a screen does not render.
 */
export function screenComponents(
  screenId: string,
  computedStyles: Record<string, ElementStyles>,
): ComponentInstance[] {
  const found: ComponentInstance[] = []

  for (const selector of Object.keys(computedStyles).sort()) {
    const element = computedStyles[selector]
    if (!element) continue

    const kind = componentKind(element)
    if (!kind) continue

    const values: Record<string, string> = {}
    for (const property of COMPONENT_PROPERTIES[kind]) {
      const value = element.styles[property]
      if (value && value.length > 0) values[property] = value.trim()
    }
    if (Object.keys(values).length === 0) continue

    found.push({ kind, screenId, selector, values })
  }

  return found
}

/**
 * How many instances have to agree before a component convention exists.
 *
 * Three, matching the floor a screen convention answers to, but counted over
 * instances rather than screens because the unit here is the component. A
 * product with three buttons that agree has a button convention; that is a
 * small product, not a weak convention. What it must not be is one: a single
 * radio proves nothing about how radios are drawn.
 */
export const MIN_INSTANCES_PER_COMPONENT_CONVENTION = 3

/** One component convention as counting produced it, before it is named. */
export interface ComponentConventionProposal {
  kind: ComponentKind
  property: string
  value: string
  confidence: Confidence
  /** Instances rendering this value. Never fewer than the floor. */
  agreeing: number
  /** Instances of this kind holding any value for the property. */
  considered: number
  /** The screens those instances sit on, deduped and sorted. */
  evidenceScreenIds: string[]
}

/**
 * What each kind of component agrees on, across every screen it appears on.
 *
 * Product-wide by construction: the input is every instance from every screen,
 * and no archetype is consulted. That is the point of it. Two screens that
 * resemble each other are compared already; two that do not are never
 * compared, and a radio does not care which screen it is on.
 *
 * Counting, not judging, and the same two floors as a screen convention. A
 * value needs the floor to agree, and it has to be the single most common one:
 * two values tied for first mean the product has not settled, so there is
 * nothing to state.
 */
export function deriveComponentConventions(
  instances: readonly ComponentInstance[],
  floor: number = MIN_INSTANCES_PER_COMPONENT_CONVENTION,
): ComponentConventionProposal[] {
  const proposals: ComponentConventionProposal[] = []

  for (const kind of COMPONENT_KINDS) {
    const ofKind = instances.filter((instance) => instance.kind === kind)
    if (ofKind.length === 0) continue

    for (const property of COMPONENT_PROPERTIES[kind]) {
      const holders = ofKind.filter((instance) => instance.values[property] !== undefined)
      if (holders.length === 0) continue

      const winner = plurality(holders, property)
      if (!winner) continue
      if (winner.instances.length < floor) continue

      proposals.push({
        kind,
        property,
        value: winner.value,
        confidence: confidenceOf(winner.instances.length, holders.length),
        agreeing: winner.instances.length,
        considered: holders.length,
        evidenceScreenIds: [
          ...new Set(winner.instances.map((instance) => instance.screenId)),
        ].sort(),
      })
    }
  }

  return proposals
}

/**
 * The single most common value of one property, or null when two tie for
 * first. A tie is not a weak convention, it is the absence of one.
 */
function plurality(
  instances: readonly ComponentInstance[],
  property: string,
): { value: string; instances: ComponentInstance[] } | null {
  const groups = new Map<string, ComponentInstance[]>()
  for (const instance of instances) {
    const value = instance.values[property]
    if (value === undefined) continue
    const found = groups.get(value)
    if (found) found.push(instance)
    else groups.set(value, [instance])
  }

  // Sorted by value so a tie is detected the same way every time.
  const ranked = [...groups].sort(([left], [right]) => (left < right ? -1 : 1))
  let best: { value: string; instances: ComponentInstance[] } | null = null
  let tied = false

  for (const [value, found] of ranked) {
    if (!best || found.length > best.instances.length) {
      best = { value, instances: found }
      tied = false
    } else if (found.length === best.instances.length) {
      tied = true
    }
  }

  return tied ? null : best
}

/**
 * A component convention as it stands once it has been stored: the counting,
 * plus the two things only the stored document knows.
 *
 * `exceptScreenIds` is the reason this type exists. Counting cannot know that
 * somebody has already looked at a screen and said it is allowed to differ,
 * and once they have, Drift does not ask again (AGENTS.md section 6).
 */
export interface StatedComponentConvention extends ComponentConventionProposal {
  /** The stored convention this came from, for the finding to point at. */
  conventionId?: string
  /** Screens a person has excused from it, permanently. */
  exceptScreenIds?: readonly string[]
}

/** One component that departs from what its kind agreed on. */
export interface ComponentDivergence {
  kind: ComponentKind
  property: string
  /** The convention it departs from, or null when it was never stored. */
  conventionId: string | null
  screenId: string
  selector: string
  /** Exactly as the extraction recorded it. */
  observedValue: string
  /** What the rest of this kind renders. */
  expectedValue: string
  agreeing: number
  considered: number
}

/**
 * Every instance that departs from a convention its kind actually holds to.
 *
 * Only high-confidence conventions raise anything, and that restriction is the
 * whole difference between this being useful and being noise. Run against a
 * real project first, the unrestricted version derived "buttons have a corner
 * radius of 999px" from 23 of 41 instances and then reported the other 18 as
 * drift. They were not. That product has two button shapes on purpose, a pill
 * for its primary action and a softer rectangle for the options a person picks
 * between, and a fifty-six percent majority is a description of that split
 * rather than a standard either side departs from.
 *
 * So a habit is still derived, because the rules file is worth telling that
 * most buttons are pills, and only a standard is worth interrupting somebody
 * over. `confidenceOf` already draws that line at four fifths.
 *
 * An instance that supported the convention is never a divergence from it,
 * which is checked by value rather than assumed: the same screen can hold one
 * radio that agrees and one that does not, and only the second is a finding.
 *
 * A screen carrying an exception is passed over entirely, and the exception is
 * on the whole screen rather than on one element because that is the shape a
 * person records it in. Once somebody has said a screen is allowed to differ,
 * Drift does not ask again (AGENTS.md section 6).
 */
export function componentDivergences(
  instances: readonly ComponentInstance[],
  conventions: readonly StatedComponentConvention[],
): ComponentDivergence[] {
  const divergences: ComponentDivergence[] = []

  for (const convention of conventions) {
    if (convention.confidence !== "high") continue
    const excused = new Set(convention.exceptScreenIds ?? [])

    for (const instance of instances) {
      if (instance.kind !== convention.kind) continue
      if (excused.has(instance.screenId)) continue

      const observed = instance.values[convention.property]
      if (observed === undefined) continue
      if (observed === convention.value) continue

      divergences.push({
        kind: convention.kind,
        property: convention.property,
        conventionId: convention.conventionId ?? null,
        screenId: instance.screenId,
        selector: instance.selector,
        observedValue: observed,
        expectedValue: convention.value,
        agreeing: convention.agreeing,
        considered: convention.considered,
      })
    }
  }

  return divergences
}

