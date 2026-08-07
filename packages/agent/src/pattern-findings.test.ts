import type { Finding, FindingRepository, NewEntity } from "@drift/core"
import { describe, expect, it } from "vitest"

import { divergenceCandidates } from "./divergence"
import { HEADING_SELECTOR, NEXT_SELECTOR, PLANTED_LABEL, stepScreen } from "./fixtures"
import { patternFinding, persistPatternFindings } from "./pattern-findings"
import { buildProfile } from "./profile"
import type { JudgedDivergence } from "./reconcile"

const screen = stepScreen(6)
const profile = buildProfile({
  signature: screen.signature!,
  computedStyles: screen.computedStyles,
  text: screen.text,
})

const conventions = [
  {
    id: "conv1",
    projectId: "proj1",
    archetypeId: "arch1",
    property: "cta.label",
    value: "Continue",
    label: "Steps end with Continue",
    confidence: "medium" as const,
    evidenceScreenIds: ["screen2", "screen3", "screen4", "screen5"],
    exceptions: [],
    status: "derived" as const,
    updatedAt: new Date("2026-08-07T10:00:00Z"),
  },
  {
    id: "conv2",
    projectId: "proj1",
    archetypeId: "arch1",
    property: "heading.size",
    value: "24px",
    label: "Step headings are 24px",
    confidence: "high" as const,
    evidenceScreenIds: ["screen1", "screen2", "screen3", "screen4", "screen5"],
    exceptions: [],
    status: "derived" as const,
    updatedAt: new Date("2026-08-07T10:00:00Z"),
  },
]

const candidates = divergenceCandidates({ screenId: screen.id, profile, conventions })

const judged: JudgedDivergence[] = [
  { candidate: candidates[0]!, sentence: "This screen says Next. 4 sibling screens say Continue." },
  {
    candidate: candidates[1]!,
    sentence: "This screen's heading is 20px. 5 sibling screens use 24px.",
  },
]

const run = {
  projectId: "proj1",
  runId: "run1",
  screenId: screen.id,
  route: screen.route,
  createdAt: new Date("2026-08-07T10:00:00Z"),
}

function fakeFindings(): FindingRepository & { stored: Finding[] } {
  const stored: Finding[] = []

  return {
    stored,
    async createIfNew(input: NewEntity<Finding>) {
      const existing = stored.find(
        (finding) => finding.projectId === input.projectId && finding.dedupeKey === input.dedupeKey,
      )
      if (existing) return { created: false, finding: existing }

      const finding = { ...input, id: `finding${stored.length + 1}` }
      stored.push(finding)
      return { created: true, finding }
    },
  } as unknown as FindingRepository & { stored: Finding[] }
}

describe("patternFinding", () => {
  it("writes a pattern finding the schema recognises", () => {
    expect(patternFinding({ ...run, judged: judged[0]! })).toMatchObject({
      projectId: "proj1",
      runId: "run1",
      type: "pattern",
      screenId: "screen6",
      conventionId: "conv1",
      evidence: {
        selector: NEXT_SELECTOR,
        property: "cta.label",
        observedValue: PLANTED_LABEL,
        expectedValue: "Continue",
        expectedSource: "Steps end with Continue",
        siblingScreenIds: ["screen2", "screen3", "screen4", "screen5"],
        sentence: "This screen says Next. 4 sibling screens say Continue.",
      },
      severity: 3,
      status: "open",
      prNumber: null,
      resolvedAt: null,
    })
  })

  it("answers to the convention it came from, unlike a token finding", () => {
    expect(patternFinding({ ...run, judged: judged[1]! })).toMatchObject({
      conventionId: "conv2",
      evidence: { selector: HEADING_SELECTOR, property: "heading.size", observedValue: "20px" },
      severity: 2,
    })
  })
})

describe("persistPatternFindings", () => {
  it("writes both planted divergences on the first run", async () => {
    const findings = fakeFindings()

    const result = await persistPatternFindings({ ...run, findings, judged })

    expect(result.created).toHaveLength(2)
    expect(result.alreadyKnown).toBe(0)
  })

  it("writes nothing new on a second run over an unchanged screen", async () => {
    const findings = fakeFindings()
    await persistPatternFindings({ ...run, findings, judged })

    const second = await persistPatternFindings({
      ...run,
      runId: "run2",
      screenId: "screen6-again",
      findings,
      judged,
    })

    expect(second.created).toEqual([])
    expect(second.alreadyKnown).toBe(2)
    expect(findings.stored).toHaveLength(2)
  })

  it("leaves a dismissed finding dismissed", async () => {
    const findings = fakeFindings()
    await persistPatternFindings({ ...run, findings, judged })
    for (const finding of findings.stored) finding.status = "dismissed"

    const second = await persistPatternFindings({ ...run, runId: "run2", findings, judged })

    expect(second.created).toEqual([])
    expect(findings.stored.every((finding) => finding.status === "dismissed")).toBe(true)
  })

  it("keys on the route and the value, not on the run or the screen", () => {
    const first = patternFinding({ ...run, judged: judged[0]! })
    const later = patternFinding({
      ...run,
      runId: "run9",
      screenId: "screen99",
      judged: judged[0]!,
    })

    expect(later.dedupeKey).toBe(first.dedupeKey)
  })
})
