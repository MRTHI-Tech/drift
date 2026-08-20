/**
 * A rendered screen and the token file it was built from, as fixtures.
 *
 * The screen conforms to the tokens everywhere except two planted violations:
 * a hardcoded colour on the hero CTA, and an off-scale padding on the card.
 * Everything that reads this fixture asserts exactly those two, so a change
 * that starts finding a third has broken something.
 */

import type { ComputedStyles, ScreenText, StyleValues } from "../types"

/** The watched repo's `theme.ts`, as source. */
export const THEME_SOURCE = `// Acme design tokens.
export const colors = {
  brand: { 500: "#4F46E5", 600: "#4338CA" },
  surface: { base: "#FFFFFF", raised: "#F8FAFC" },
  text: { primary: "#0F172A", muted: "#64748B" },
} as const

export const spacing = {
  0: "0px",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  6: "1.5rem",
  8: "2rem",
}

export const fontSize = {
  sm: "0.875rem",
  base: "1rem",
  lg: "1.25rem",
  xl: "2rem",
}

export const fontWeight = { regular: 400, medium: 500, bold: 700 }

export const radius = { sm: "4px", md: "8px", lg: "16px" }

export default { colors, spacing, fontSize, fontWeight, radius }
`

/** The same tokens as a `tokens.json`. */
export const TOKENS_JSON = JSON.stringify({
  colors: {
    brand: { 500: "#4F46E5", 600: "#4338CA" },
    surface: { base: "#FFFFFF", raised: "#F8FAFC" },
    text: { primary: "#0F172A", muted: "#64748B" },
  },
  spacing: { 0: "0px", 1: "0.25rem", 2: "0.5rem", 3: "0.75rem", 4: "1rem", 6: "1.5rem", 8: "2rem" },
  fontSize: { sm: "0.875rem", base: "1rem", lg: "1.25rem", xl: "2rem" },
  fontWeight: { regular: 400, medium: 500, bold: 700 },
  radius: { sm: "4px", md: "8px", lg: "16px" },
})

/** The first planted violation: a colour that is close to brand.500 but is not it. */
export const PLANTED_COLOR = "rgb(124, 58, 237)"

/** The second: a padding that is not on the spacing scale. */
export const PLANTED_PADDING = "13px"

/**
 * One element's resolved styles: everything conforming to the tokens above
 * except what is overridden. Exported so a test can build a small screen of
 * its own without restating nine properties to change one.
 */
export function styleValues(overrides: Partial<StyleValues> = {}): StyleValues {
  return styles(overrides)
}

function styles(overrides: Partial<StyleValues> = {}): StyleValues {
  return {
    color: "rgb(15, 23, 42)",
    "background-color": "rgba(0, 0, 0, 0)",
    "font-size": "16px",
    "font-weight": "400",
    "line-height": "24px",
    margin: "0px",
    padding: "0px",
    "border-radius": "0px",
    "box-shadow": "none",
    display: "block",
    gap: "normal",
    "max-width": "none",
    "border-width": "0px",
    "border-style": "none",
    ...overrides,
  }
}

/**
 * One screen's extraction. Document order, as the walker records it: the CTA
 * carrying the hardcoded colour comes before the card carrying the padding.
 */
export const SCREEN_STYLES: ComputedStyles = {
  body: {
    tag: "body",
    box: { x: 0, y: 0, width: 390, height: 1200 },
    styles: styles({ "background-color": "rgb(255, 255, 255)" }),
  },
  "[data-testid='hero']": {
    tag: "section",
    box: { x: 0, y: 0, width: 390, height: 320 },
    styles: styles({ padding: "32px 16px" }),
  },
  "[data-testid='hero'] > h1:nth-of-type(1)": {
    tag: "h1",
    box: { x: 16, y: 32, width: 358, height: 40 },
    styles: styles({ "font-size": "32px", "font-weight": "700", "line-height": "40px" }),
  },
  "[data-testid='hero'] > p:nth-of-type(1)": {
    tag: "p",
    box: { x: 16, y: 88, width: 358, height: 24 },
    styles: styles({ color: "rgb(100, 116, 139)" }),
  },
  "[data-testid='hero-cta']": {
    tag: "button",
    box: { x: 16, y: 136, width: 160, height: 44 },
    styles: styles({
      color: "rgb(255, 255, 255)",
      // Planted: a hardcoded purple that is not brand.500.
      "background-color": PLANTED_COLOR,
      "font-weight": "500",
      padding: "12px 24px",
      "border-radius": "8px",
    }),
  },
  "[data-testid='card']": {
    tag: "article",
    box: { x: 16, y: 240, width: 358, height: 180 },
    styles: styles({
      "background-color": "rgb(248, 250, 252)",
      // Planted: 13px is on no scale.
      padding: PLANTED_PADDING,
      "border-radius": "16px",
    }),
  },
  "[data-testid='card'] > h2:nth-of-type(1)": {
    tag: "h2",
    box: { x: 32, y: 256, width: 326, height: 28 },
    styles: styles({ "font-size": "20px", "font-weight": "700" }),
  },
  "[data-testid='card'] > a:nth-of-type(1)": {
    tag: "a",
    box: { x: 32, y: 380, width: 120, height: 20 },
    styles: styles({ color: "rgb(79, 70, 229)", "font-size": "14px", "font-weight": "500" }),
  },
  "[data-testid='footer']": {
    tag: "footer",
    box: { x: 0, y: 900, width: 390, height: 120 },
    styles: styles({ "background-color": "rgb(255, 255, 255)", padding: "24px 16px" }),
  },
  "[data-testid='footer'] > p:nth-of-type(1)": {
    tag: "p",
    box: { x: 16, y: 924, width: 358, height: 20 },
    styles: styles({ color: "rgb(100, 116, 139)", "font-size": "14px" }),
  },
}

/** The visible text of the same screen, keyed by the same selectors. */
export const SCREEN_TEXT: ScreenText = {
  "[data-testid='hero'] > h1:nth-of-type(1)": "Ship your design system",
  "[data-testid='hero'] > p:nth-of-type(1)": "Drift watches the deployed product for you.",
  "[data-testid='hero-cta']": "Get started",
  "[data-testid='card'] > h2:nth-of-type(1)": "How it works",
  "[data-testid='card'] > a:nth-of-type(1)": "Read the docs",
  "[data-testid='footer'] > p:nth-of-type(1)": "Acme, 2026",
}
