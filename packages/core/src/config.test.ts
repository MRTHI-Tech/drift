import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { DriftConfigError, loadDriftConfig, parseDriftConfig } from "./config"

const minimal = { routes: ["/", "/pricing"] }

async function writeConfig(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drift-config-"))
  const path = join(dir, "drift.config.json")
  await writeFile(path, contents, "utf8")
  return path
}

describe("parseDriftConfig", () => {
  it("accepts a minimal config and fills the defaults", () => {
    expect(parseDriftConfig(minimal)).toEqual({
      routes: ["/", "/pricing"],
      viewports: ["mobile", "desktop"],
      authCookieName: null,
      seedData: false,
      tokenDefinitionsPath: null,
    })
  })

  it("keeps every value a full config supplies", () => {
    const full = {
      routes: ["/dashboard"],
      viewports: ["desktop"],
      authCookieName: "__session",
      seedData: true,
      tokenDefinitionsPath: "app/globals.css",
    }
    expect(parseDriftConfig(full)).toEqual(full)
  })

  it("rejects a config with no routes", () => {
    expect(() => parseDriftConfig({ routes: [] })).toThrow(DriftConfigError)
  })

  it("rejects a route that is not an absolute path", () => {
    expect(() => parseDriftConfig({ routes: ["pricing"] })).toThrow(/must start with \//)
  })

  it("rejects duplicate routes", () => {
    expect(() => parseDriftConfig({ routes: ["/", "/"] })).toThrow(/unique/)
  })

  it("rejects an unknown viewport", () => {
    expect(() => parseDriftConfig({ ...minimal, viewports: ["watch"] })).toThrow(DriftConfigError)
  })

  it("rejects an empty viewport list", () => {
    expect(() => parseDriftConfig({ ...minimal, viewports: [] })).toThrow(DriftConfigError)
  })

  it("rejects a non-boolean seedData", () => {
    expect(() => parseDriftConfig({ ...minimal, seedData: "yes" })).toThrow(DriftConfigError)
  })

  it("rejects unknown keys, so a typo is never silently ignored", () => {
    expect(() => parseDriftConfig({ ...minimal, routs: ["/"] })).toThrow(DriftConfigError)
  })

  it("rejects values that are not objects", () => {
    expect(() => parseDriftConfig(null)).toThrow(DriftConfigError)
    expect(() => parseDriftConfig("routes")).toThrow(DriftConfigError)
    expect(() => parseDriftConfig([])).toThrow(DriftConfigError)
  })

  it("names the offending field in the message", () => {
    expect(() => parseDriftConfig({ routes: ["pricing"] })).toThrow(/routes\.0/)
  })
})

describe("loadDriftConfig", () => {
  it("reads and parses a config from disk", async () => {
    const path = await writeConfig(JSON.stringify(minimal))
    await expect(loadDriftConfig(path)).resolves.toMatchObject({ routes: ["/", "/pricing"] })
  })

  it("reports a missing file", async () => {
    await expect(loadDriftConfig(join(tmpdir(), "drift-absent.json"))).rejects.toThrow(
      /Could not read the config/,
    )
  })

  it("reports invalid JSON", async () => {
    const path = await writeConfig("{ routes: }")
    await expect(loadDriftConfig(path)).rejects.toThrow(/not valid JSON/)
  })

  it("reports a config that parses but does not validate", async () => {
    const path = await writeConfig(JSON.stringify({ routes: [] }))
    await expect(loadDriftConfig(path)).rejects.toThrow(DriftConfigError)
  })
})
