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

import type { StyleProperty } from "../constants"
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
