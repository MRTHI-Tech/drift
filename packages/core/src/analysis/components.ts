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

/** One component that departs from what its kind agreed on. */
export interface ComponentDivergence {
  kind: ComponentKind
  property: string
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
 */
export function componentDivergences(
  instances: readonly ComponentInstance[],
  conventions: readonly ComponentConventionProposal[],
): ComponentDivergence[] {
  const divergences: ComponentDivergence[] = []

  for (const convention of conventions) {
    if (convention.confidence !== "high") continue

    for (const instance of instances) {
      if (instance.kind !== convention.kind) continue

      const observed = instance.values[convention.property]
      if (observed === undefined) continue
      if (observed === convention.value) continue

      divergences.push({
        kind: convention.kind,
        property: convention.property,
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

