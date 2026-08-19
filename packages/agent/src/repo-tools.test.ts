import type { SourceFile } from "@drift/core"
import { describe, expect, it } from "vitest"

import { MAX_READ_LINES, MAX_SEARCH_HITS } from "./constants"
import { listRepoFiles, readRepoFile, searchRepo } from "./repo-tools"

const FILES: SourceFile[] = [
  {
    path: "app/pricing/page.tsx",
    text: [
      'import { theme } from "@/theme"',
      "",
      "export default function Pricing() {",
      '  return <button style={{ backgroundColor: "#FF0000" }}>Next</button>',
      "}",
    ].join("\n"),
  },
  {
    path: "app/checkout/step.tsx",
    text: 'export const shade = "#ff0000"\n',
  },
  {
    path: "theme.ts",
    text: 'export const colors = { danger: "#EF4444" }\n',
  },
]

describe("searchRepo", () => {
  it("finds a value however it is spelled in source", () => {
    const { hits } = searchRepo(FILES, "#ff0000")

    expect(hits.map((hit) => hit.path)).toEqual(["app/pricing/page.tsx", "app/checkout/step.tsx"])
  })

  it("numbers lines the way an editor does", () => {
    const { hits } = searchRepo(FILES, "backgroundColor")

    expect(hits[0]).toMatchObject({ path: "app/pricing/page.tsx", line: 4 })
  })

  it("says when there was more than it returned", () => {
    const many: SourceFile[] = [
      { path: "big.ts", text: Array.from({ length: 40 }, () => "const x = 1").join("\n") },
    ]

    const { hits, total, truncated } = searchRepo(many, "const x")

    expect(hits).toHaveLength(MAX_SEARCH_HITS)
    expect(total).toBe(40)
    expect(truncated).toBe(true)
  })

  it("finds nothing for an empty query rather than everything", () => {
    expect(searchRepo(FILES, "")).toEqual({ hits: [], total: 0, truncated: false })
  })
})

describe("readRepoFile", () => {
  it("returns the text exactly as the file holds it", () => {
    const slice = readRepoFile(FILES, "theme.ts")

    // Including the trailing newline the file ends with: what the gate matches
    // against is the file, not a tidied version of it.
    expect(slice?.text).toBe('export const colors = { danger: "#EF4444" }\n')
    expect(slice?.total).toBe(2)
  })

  it("returns a window when one is asked for", () => {
    const slice = readRepoFile(FILES, "app/pricing/page.tsx", 3, 4)

    expect(slice).toMatchObject({ from: 3, to: 4 })
    expect(slice?.text).toBe(
      'export default function Pricing() {\n  return <button style={{ backgroundColor: "#FF0000" }}>Next</button>',
    )
  })

  it("has nothing to say about a file it was not given", () => {
    expect(readRepoFile(FILES, "app/secrets/keys.ts")).toBeNull()
  })

  it("never returns more than the read cap, however wide the window", () => {
    const long: SourceFile[] = [
      { path: "long.ts", text: Array.from({ length: 500 }, (_u, i) => `// ${i}`).join("\n") },
    ]

    const slice = readRepoFile(long, "long.ts", 1, 500)

    expect(slice?.text.split("\n")).toHaveLength(MAX_READ_LINES)
    expect(slice?.total).toBe(500)
  })

  it("survives a window that starts past the end", () => {
    const slice = readRepoFile(FILES, "theme.ts", 900)

    expect(slice?.text).toBe("")
    expect(slice?.from).toBe(900)
  })
})

describe("listRepoFiles", () => {
  it("lists every path, sorted", () => {
    expect(listRepoFiles(FILES)).toEqual([
      "app/checkout/step.tsx",
      "app/pricing/page.tsx",
      "theme.ts",
    ])
  })

  it("narrows to a prefix", () => {
    expect(listRepoFiles(FILES, "app/pricing")).toEqual(["app/pricing/page.tsx"])
  })
})
