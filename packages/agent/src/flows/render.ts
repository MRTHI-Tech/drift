/**
 * Filling the placeholders in a prompt's task string, and turning a screenshot
 * into the part a model can read.
 *
 * Deliberately not a template engine. A placeholder with no value throws,
 * because a prompt that ships `{{route}}` where the route should be is a prompt
 * that quietly asks a different question than the one it was written for.
 */

const PLACEHOLDER = /\{\{(\w+)\}\}/g

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = values[key]
    if (value === undefined) {
      throw new Error(`The prompt has no value for {{${key}}}.`)
    }
    return String(value)
  })
}

/** A PNG as the data URI a Genkit media part carries. */
export function screenshotDataUri(screenshot: Buffer | string): string {
  const base64 = typeof screenshot === "string" ? screenshot : screenshot.toString("base64")
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`
}

/** A list a prompt can read, or a line saying there is none. */
export function lines(entries: readonly string[], empty = "none"): string {
  return entries.length === 0 ? empty : entries.join("\n")
}
