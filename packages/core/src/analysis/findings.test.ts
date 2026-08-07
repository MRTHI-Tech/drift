import { describe, expect, it } from "vitest"

import type { NewEntity } from "../repositories/document"
import type { FindingRepository } from "../repositories/findings"
import type { Finding, FindingStatus } from "../types"
import { PLANTED_COLOR, PLANTED_PADDING, SCREEN_STYLES, THEME_SOURCE } from "./fixtures"
import { persistTokenFindings, tokenDedupeKey, tokenFinding } from "./findings"
import { diffScreenTokens } from "./token-diff"
import { parseTokenDefinitions } from "./tokens"

const tokens = parseTokenDefinitions(THEME_SOURCE, "theme.ts")
const candidates = diffScreenTokens(SCREEN_STYLES, tokens)

const run = {
  projectId: "proj1",
  runId: "run1",
  screenId: "screen1",
  route: "/",
  createdAt: new Date("2026-08-07T10:00:00Z"),
}

/**
 * A findings repository in memory, with the same dedupe gate the Firestore one
 * has: one finding per dedupe key, whatever its status, never deleted.
 */
function fakeFindings(): FindingRepository & { stored: Finding[] } {
  const stored: Finding[] = []

  const repository = {
    stored,
    async createIfNew(input: NewEntity<Finding>) {
      const existing = stored.find(
        (finding) =>
          finding.projectId === input.projectId && finding.dedupeKey === input.dedupeKey,
      )
      if (existing) return { created: false, finding: existing }

      const finding = { ...input, id: `finding${stored.length + 1}` }
      stored.push(finding)
      return { created: true, finding }
    },
  } as unknown as FindingRepository & { stored: Finding[] }

  return repository
}

describe("tokenFinding", () => {
  it("writes a token finding the schema recognises", () => {
    const finding = tokenFinding({ ...run, candidate: candidates[0]! })

    expect(finding).toEqual({
      projectId: "proj1",
      runId: "run1",
      type: "token",
      screenId: "screen1",
      conventionId: null,
      evidence: {
        selector: "[data-testid='hero-cta']",
        property: "background-color",
        observedValue: PLANTED_COLOR,
        expectedValue: "#4F46E5",
        expectedSource: "colors.brand.500",
        siblingScreenIds: [],
      },
      severity: 3,
      status: "open",
      dedupeKey: tokenDedupeKey("proj1", "/", candidates[0]!),
      prNumber: null,
      createdAt: run.createdAt,
      resolvedAt: null,
    })
  })

  it("keys on the route and the value, not on the run or the screen", () => {
    const first = tokenFinding({ ...run, candidate: candidates[1]! })
    const later = tokenFinding({
      ...run,
      runId: "run2",
      screenId: "screen2",
      createdAt: new Date("2026-08-08T10:00:00Z"),
      candidate: candidates[1]!,
    })

    expect(later.dedupeKey).toBe(first.dedupeKey)
    expect(first.evidence.observedValue).toBe(PLANTED_PADDING)
  })
})

describe("persistTokenFindings", () => {
  it("writes both planted violations on the first run", async () => {
    const findings = fakeFindings()

    const result = await persistTokenFindings({ ...run, findings, candidates })

    expect(result.created).toHaveLength(2)
    expect(result.alreadyKnown).toBe(0)
    expect(findings.stored.map((finding) => finding.evidence.property)).toEqual([
      "background-color",
      "padding",
    ])
  })

  it("writes nothing new on a second run over the same screen", async () => {
    const findings = fakeFindings()
    await persistTokenFindings({ ...run, findings, candidates })

    const second = await persistTokenFindings({
      ...run,
      runId: "run2",
      screenId: "screen2",
      findings,
      candidates: diffScreenTokens(structuredClone(SCREEN_STYLES), tokens),
    })

    expect(second.created).toEqual([])
    expect(second.alreadyKnown).toBe(2)
    expect(findings.stored).toHaveLength(2)
    expect(findings.stored.every((finding) => finding.runId === "run1")).toBe(true)
  })

  it("does not re-raise a finding the user has already resolved or dismissed", async () => {
    for (const status of ["resolved_conform", "resolved_exception", "dismissed"] satisfies
      FindingStatus[]) {
      const findings = fakeFindings()
      await persistTokenFindings({ ...run, findings, candidates })
      for (const finding of findings.stored) finding.status = status

      const second = await persistTokenFindings({ ...run, runId: "run2", findings, candidates })

      expect(second.created).toEqual([])
      expect(findings.stored).toHaveLength(2)
      expect(findings.stored.every((finding) => finding.status === status)).toBe(true)
    }
  })

  it("raises the new one when a second violation appears later", async () => {
    const findings = fakeFindings()
    await persistTokenFindings({ ...run, findings, candidates: [candidates[0]!] })

    const second = await persistTokenFindings({ ...run, runId: "run2", findings, candidates })

    expect(second.created).toHaveLength(1)
    expect(second.alreadyKnown).toBe(1)
    expect(second.created[0]?.evidence.observedValue).toBe(PLANTED_PADDING)
  })

  it("keeps a finding on one route apart from the same value on another", async () => {
    const findings = fakeFindings()
    await persistTokenFindings({ ...run, findings, candidates })

    const other = await persistTokenFindings({
      ...run,
      route: "/pricing",
      runId: "run2",
      findings,
      candidates,
    })

    expect(other.created).toHaveLength(2)
    expect(findings.stored).toHaveLength(4)
  })
})
