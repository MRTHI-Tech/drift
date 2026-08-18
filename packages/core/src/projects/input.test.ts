import { describe, expect, it } from "vitest"

import { normalizeProjectInput, normalizeRepo, projectNameFromRepo } from "./input"

const valid = {
  userId: "user1",  name: "Woven",
  repo: "MRTHI-Tech/woven",
  previewUrl: "https://woven-preview.a.run.app",
}

describe("normalizeProjectInput", () => {
  it("fills the two defaults nobody is asked for", () => {
    const result = normalizeProjectInput(valid)

    expect(result).toEqual({
      ok: true,
      value: {
        ...valid,
        defaultBranch: "main",
        configPath: "drift.config.json",
        installationId: null,
      },
    })
  })

  /**
   * A project watched through `GITHUB_TOKEN` has no installation, and that is
   * the state every project created before the app existed is in. Null is
   * therefore the default rather than a problem to report.
   */
  it("defaults the installation to null, which is the token path", () => {
    const result = normalizeProjectInput(valid)

    expect(result.ok && result.value.installationId).toBeNull()
  })

  it("carries the installation through when the repo was picked from one", () => {
    const result = normalizeProjectInput({ ...valid, installationId: 154734085 })

    expect(result.ok && result.value.installationId).toBe(154734085)
  })

  it("trims every field before it is stored", () => {
    const result = normalizeProjectInput({
      userId: "user1",      name: "  Woven  ",
      repo: "  MRTHI-Tech/woven  ",
      previewUrl: "  https://woven.example  ",
    })

    expect(result.ok && result.value).toMatchObject({
      userId: "user1",      name: "Woven",
      repo: "MRTHI-Tech/woven",
      previewUrl: "https://woven.example",
    })
  })

  it("reports every bad field at once rather than the first", () => {
    const result = normalizeProjectInput({ userId: "user1", name: "", repo: "", previewUrl: "" })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues.map((issue) => issue.field)).toEqual([
      "repo",
      "name",
      "previewUrl",
    ])
  })

  it("rejects a repo that is not owner/name", () => {
    const result = normalizeProjectInput({ ...valid, repo: "woven" })

    expect(!result.ok && result.issues[0]).toEqual({
      field: "repo",
      message: "A repo reads owner/name. This reads woven.",
    })
  })

  it("rejects a preview URL that is not a URL", () => {
    const result = normalizeProjectInput({ ...valid, previewUrl: "woven.example" })

    expect(!result.ok && result.issues[0]?.field).toBe("previewUrl")
  })

  it("rejects a preview URL that is neither http nor https", () => {
    const result = normalizeProjectInput({ ...valid, previewUrl: "ftp://woven.example" })

    expect(!result.ok && result.issues[0]?.message).toContain("http or https")
  })

  it("rejects a config path anchored at the filesystem root", () => {
    const result = normalizeProjectInput({ ...valid, configPath: "/drift.config.json" })

    expect(!result.ok && result.issues[0]?.field).toBe("configPath")
  })

  it("keeps a config path in a subdirectory", () => {
    const result = normalizeProjectInput({ ...valid, configPath: "config/drift.config.json" })

    expect(result.ok && result.value.configPath).toBe("config/drift.config.json")
  })
})

describe("normalizeRepo", () => {
  it("keeps an owner/name that is already one", () => {
    expect(normalizeRepo("MRTHI-Tech/woven")).toBe("MRTHI-Tech/woven")
  })

  it("reduces the URL somebody copied out of the address bar", () => {
    expect(normalizeRepo("https://github.com/MRTHI-Tech/woven")).toBe("MRTHI-Tech/woven")
  })

  it("drops the path past the repo", () => {
    expect(normalizeRepo("https://github.com/MRTHI-Tech/woven/tree/main/app")).toBe(
      "MRTHI-Tech/woven",
    )
  })

  it("reduces an SSH remote", () => {
    expect(normalizeRepo("git@github.com:MRTHI-Tech/woven.git")).toBe("MRTHI-Tech/woven")
  })

  it("drops a trailing slash and a .git", () => {
    expect(normalizeRepo("https://github.com/MRTHI-Tech/woven.git/")).toBe("MRTHI-Tech/woven")
  })
})

describe("projectNameFromRepo", () => {
  it("takes the repo's own name, in sentence case", () => {
    expect(projectNameFromRepo("MRTHI-Tech/woven")).toBe("Woven")
  })

  it("reads a hyphenated name as words", () => {
    expect(projectNameFromRepo("acme/design-system")).toBe("Design system")
  })

  it("has nothing to suggest for a repo that is not one yet", () => {
    expect(projectNameFromRepo("acme")).toBe("")
  })
})
