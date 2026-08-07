import { describe, expect, it } from "vitest"

import { parseModuleLiterals, stripComments } from "./literal"

describe("parseModuleLiterals", () => {
  it("reads an exported const object", () => {
    const source = `export const colors = { brand: "#4F46E5", surface: "#fff" }`

    expect(parseModuleLiterals(source)).toEqual({
      colors: { brand: "#4F46E5", surface: "#fff" },
    })
  })

  it("reads nested objects, numbers, arrays, and trailing commas", () => {
    const source = `
      export const theme = {
        spacing: { 1: "4px", 2: 8, },
        sizes: ["1rem", "2rem"],
        dark: true,
      } as const
    `

    expect(parseModuleLiterals(source).theme).toEqual({
      spacing: { 1: "4px", 2: 8 },
      sizes: ["1rem", "2rem"],
      dark: true,
    })
  })

  it("follows a shorthand property to the declaration it names", () => {
    const source = `
      const colors = { brand: "#000" }
      export default { colors }
    `

    expect(parseModuleLiterals(source).default).toEqual({ colors: { brand: "#000" } })
  })

  it("spreads something declared in the same file", () => {
    const source = `
      const base = { sm: "4px" }
      export const radius = { ...base, lg: "16px" }
    `

    expect(parseModuleLiterals(source).radius).toEqual({ sm: "4px", lg: "16px" })
  })

  it("drops an entry it cannot read and keeps the rest", () => {
    const source = `
      export const colors = {
        brand: withOpacity("#4F46E5"),
        surface: \`\${base}-500\`,
        text: "#0F172A",
      }
    `

    expect(parseModuleLiterals(source).colors).toEqual({ text: "#0F172A" })
  })

  it("ignores a reference to something outside the file", () => {
    const source = `
      import { palette } from "./palette"
      export const colors = { ...palette, text: "#0F172A" }
    `

    expect(parseModuleLiterals(source).colors).toEqual({ text: "#0F172A" })
  })

  it("does not follow a reference that loops", () => {
    const source = `
      const a = { ...b }
      const b = { ...a }
      export default { a }
    `

    expect(parseModuleLiterals(source).default).toEqual({ a: {} })
  })

  it("reads quoted and numeric keys", () => {
    const source = `export const spacing = { "0.5": "2px", 1: "4px" }`

    expect(parseModuleLiterals(source).spacing).toEqual({ "0.5": "2px", 1: "4px" })
  })

  it("skips a computed key rather than guessing at it", () => {
    const source = `export const colors = { [name]: "#fff", text: "#000" }`

    expect(parseModuleLiterals(source).colors).toEqual({ text: "#000" })
  })

  it("returns nothing for a file with no literal in it", () => {
    expect(parseModuleLiterals(`export const theme = createTheme()`)).toEqual({})
  })
})

describe("stripComments", () => {
  it("blanks comments and leaves the source the same length", () => {
    const source = `const a = 1 // one\n/* two */ const b = 2`
    const stripped = stripComments(source)

    expect(stripped).toHaveLength(source.length)
    expect(stripped).not.toContain("one")
    expect(stripped).not.toContain("two")
    expect(stripped).toContain("const b = 2")
  })

  it("leaves a comment marker inside a string alone", () => {
    const source = `const url = "https://example.com" // trailing`

    expect(stripComments(source)).toContain(`"https://example.com"`)
  })

  it("does not lose a comment's newlines", () => {
    const source = `/*\n\n*/const a = 1`

    expect(stripComments(source).split("\n")).toHaveLength(3)
  })
})
