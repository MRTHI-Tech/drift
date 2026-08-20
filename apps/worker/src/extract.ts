/**
 * The computed-style walker and the pure shaping of what it returns.
 *
 * `collectElements` runs inside the page, so it is self-contained: it may not
 * reference anything in module scope. Everything after it is a pure function
 * over plain data, which is where the tests are.
 */
import {
  STYLE_PROPERTIES,
  type BoundingBox,
  type ComputedStyles,
  type ElementAttributes,
  type ScreenText,
  type StyleProperty,
  type StyleValues,
} from "@drift/core"

/**
 * Most a single screen contributes. A screen past this is a list page whose
 * tail repeats itself; the cap keeps one screen from dominating a run.
 */
export const MAX_ELEMENTS = 1200

/**
 * Byte budget for `computedStyles` plus `text` in one document. Firestore caps
 * a document at 1 MiB including every field and index entry, so a screen that
 * would push past this loses its tail rather than failing to persist at all.
 */
export const MAX_EXTRACTION_BYTES = 700_000

/** One element exactly as the page reported it, before any shaping. */
export interface RawElement {
  tag: string
  selector: string
  box: BoundingBox
  styles: Record<string, string>
  text: string
  /** `type` and `role`, each present only when the element carries it. */
  attributes: Record<string, string>
}

export interface WalkerOptions {
  /** CSS properties to resolve, in the order they are stored. */
  properties: readonly string[]
  maxElements: number
}

/** What one screen contributes to its `screens` document. */
export interface Extraction {
  computedStyles: ComputedStyles
  text: ScreenText
  elementCount: number
  /** True when the walker stopped at the cap and the tail was not recorded. */
  truncated: boolean
}

/** The arguments the walker runs with. */
export function walkerOptions(): WalkerOptions {
  return { properties: STYLE_PROPERTIES, maxElements: MAX_ELEMENTS }
}

/**
 * Walks every visible element under `body` in document order and records its
 * tag, a stable selector, its box, the resolved style properties, and its own
 * visible text.
 *
 * Runs inside the page under `page.evaluate`, which serialises the function
 * source. Keep every helper nested and reference no imports.
 */
export function collectElements({ properties, maxElements }: WalkerOptions): RawElement[] {
  // tsx compiles this file through esbuild with `keepNames`, which wraps every
  // named nested function in a `__name` helper that exists only in the Node
  // module. The page gets the function source, not the module, so it has to
  // find that helper here.
  const scope = globalThis as unknown as { __name?: (value: unknown) => unknown }
  scope.__name ??= (value) => value

  const skipTags = new Set([
    "script",
    "style",
    "link",
    "meta",
    "noscript",
    "template",
    "base",
    "title",
    "head",
  ])

  const stablePattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
  const longDigitRun = /\d{4}/

  const isStable = (value: string): boolean =>
    stablePattern.test(value) && !longDigitRun.test(value)

  const isUnique = (selector: string): boolean => {
    try {
      return document.querySelectorAll(selector).length === 1
    } catch {
      return false
    }
  }

  // A data-testid or an id, but only when it is unique and does not look
  // generated. A React auto-id such as `:r3:` would move between renders and
  // make every later comparison miss.
  const anchorFor = (element: Element): string | null => {
    const testId = element.getAttribute("data-testid")
    if (testId && isStable(testId)) {
      const selector = `[data-testid="${testId}"]`
      if (isUnique(selector)) return selector
    }
    const id = element.getAttribute("id")
    if (id && isStable(id)) {
      const selector = `#${id}`
      if (isUnique(selector)) return selector
    }
    return null
  }

  const typeIndex = (element: Element): number => {
    let index = 1
    let sibling = element.previousElementSibling
    while (sibling) {
      if (sibling.tagName === element.tagName) index += 1
      sibling = sibling.previousElementSibling
    }
    return index
  }

  // Anchored at the nearest stable ancestor, otherwise a full nth-of-type path
  // from body. Both forms address exactly one element.
  const selectorFor = (element: Element): string => {
    const parts: string[] = []
    let node: Element | null = element

    while (node && node !== document.body) {
      const anchor = anchorFor(node)
      if (anchor) {
        parts.unshift(anchor)
        return parts.join(" > ")
      }
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${typeIndex(node)})`)
      node = node.parentElement
    }

    if (node === document.body) parts.unshift("body")
    return parts.join(" > ")
  }

  const ownText = (element: Element): string => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return (element.value || element.placeholder || "").replace(/\s+/g, " ").trim()
    }
    let text = ""
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue ?? ""
    }
    return text.replace(/\s+/g, " ").trim()
  }

  const collected: RawElement[] = []

  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (collected.length >= maxElements) break

    const tag = element.tagName.toLowerCase()
    if (skipTags.has(tag)) continue
    // Keep the svg itself, drop its internals: paths carry no design tokens.
    if (element instanceof SVGElement && tag !== "svg") continue

    const style = window.getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden") continue
    if (Number(style.opacity) === 0) continue

    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue

    const box = {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
    }
    // Parked off the top or left of the document: a visually hidden element.
    if (box.x + box.width <= 0 || box.y + box.height <= 0) continue

    const styles: Record<string, string> = {}
    for (const property of properties) {
      styles[property] = style.getPropertyValue(property).trim()
    }

    // What the element is, as distinct from how it looks. Two attributes, and
    // only when set, so a document does not grow for the elements that carry
    // neither, which is nearly all of them.
    const attributes: Record<string, string> = {}
    const type = element.getAttribute("type")
    if (type) attributes.type = type.toLowerCase()
    const role = element.getAttribute("role")
    if (role) attributes.role = role.toLowerCase()

    collected.push({
      tag,
      selector: selectorFor(element),
      box,
      styles,
      text: ownText(element),
      attributes,
    })
  }

  return collected
}

/**
 * Shapes what the page returned into the two records a `screens` document
 * carries. Selectors address one element each, but a duplicate is kept once
 * rather than trusted: the first occurrence in document order wins.
 */
export function buildExtraction(raw: RawElement[], maxElements = MAX_ELEMENTS): Extraction {
  const computedStyles: ComputedStyles = {}
  const text: ScreenText = {}

  for (const element of raw.slice(0, maxElements)) {
    if (element.selector.length === 0) continue
    if (element.selector in computedStyles) continue

    const attributes = pickAttributes(element.attributes)
    computedStyles[element.selector] = {
      tag: element.tag,
      box: roundBox(element.box),
      styles: pickStyles(element.styles),
      ...(attributes ? { attributes } : {}),
    }

    const collapsed = element.text.replace(/\s+/g, " ").trim()
    if (collapsed.length > 0) text[element.selector] = collapsed
  }

  return {
    computedStyles,
    text,
    elementCount: Object.keys(computedStyles).length,
    truncated: raw.length >= maxElements,
  }
}

/**
 * Drops elements off the end until the extraction fits the byte budget.
 * Document order, so what survives is the top of the screen, which is the part
 * a comparison cares about most.
 */
export function capExtraction(
  extraction: Extraction,
  maxBytes = MAX_EXTRACTION_BYTES,
): Extraction {
  const computedStyles: ComputedStyles = {}
  const text: ScreenText = {}
  let bytes = 0
  let dropped = false

  for (const [selector, element] of Object.entries(extraction.computedStyles)) {
    const line = extraction.text[selector]
    const size = sizeOf(selector, element) + (line === undefined ? 0 : sizeOf(selector, line))
    if (bytes + size > maxBytes) {
      dropped = true
      break
    }
    bytes += size
    computedStyles[selector] = element
    if (line !== undefined) text[selector] = line
  }

  if (!dropped) return extraction

  return {
    computedStyles,
    text,
    elementCount: Object.keys(computedStyles).length,
    truncated: true,
  }
}

function sizeOf(key: string, value: unknown): number {
  return Buffer.byteLength(JSON.stringify({ [key]: value }), "utf8")
}

/** Exactly the locked property list, in its locked order. */
function pickStyles(styles: Record<string, string>): StyleValues {
  const picked = {} as Record<StyleProperty, string>
  for (const property of STYLE_PROPERTIES) {
    picked[property] = styles[property] ?? ""
  }
  return picked
}

/**
 * The recorded attributes, or null when the element carries none of them.
 *
 * Null rather than an empty object so a `screens` document does not carry an
 * empty field for every div on the page, which is most of them.
 */
function pickAttributes(attributes: Record<string, string>): ElementAttributes | null {
  const picked: ElementAttributes = {}
  if (attributes.type) picked.type = attributes.type
  if (attributes.role) picked.role = attributes.role
  return picked.type || picked.role ? picked : null
}

/** One decimal place: sub-pixel jitter would read as drift on every run. */
function roundBox(box: BoundingBox): BoundingBox {
  return {
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
  }
}

function round(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round(value * 10) / 10
  // Firestore stores -0, and it reads back as a different value from 0.
  return rounded === 0 ? 0 : rounded
}
