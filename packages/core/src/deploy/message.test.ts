import { describe, expect, it } from "vitest"

import { parseDeployEvent, parsePushEnvelope } from "./message"

function envelope(payload: unknown, extra: Record<string, unknown> = {}) {
  const parsed = parsePushEnvelope({
    message: {
      data: Buffer.from(JSON.stringify(payload)).toString("base64"),
      messageId: "1",
      ...extra,
    },
    subscription: "projects/p/subscriptions/drift-deploys-dashboard",
  })
  if (!parsed.value) throw new Error(parsed.problem.reason)
  return parsed.value
}

describe("parsePushEnvelope", () => {
  it("reads a push envelope and keeps the message id", () => {
    const parsed = parsePushEnvelope({
      message: { data: "e30=", messageId: "9", publishTime: "2026-08-07T09:00:00Z" },
      subscription: "projects/p/subscriptions/s",
    })

    expect(parsed.problem).toBeNull()
    expect(parsed.value?.message.messageId).toBe("9")
  })

  it("keeps fields Pub/Sub may add later", () => {
    const parsed = parsePushEnvelope({
      message: { data: "e30=", orderingKey: "acme/web" },
      deliveryAttempt: 2,
    })

    expect(parsed.problem).toBeNull()
  })

  it("refuses a body that is not one", () => {
    expect(parsePushEnvelope({ repo: "acme/web" }).problem?.reason).toMatch(/push envelope/)
    expect(parsePushEnvelope("hello").problem).not.toBeNull()
    expect(parsePushEnvelope(null).problem).not.toBeNull()
  })
})

describe("parseDeployEvent", () => {
  it("reads the repo, the commit, and the ref", () => {
    const parsed = parseDeployEvent(
      envelope({ repo: "acme/web", commit: "abc123", ref: "refs/heads/main" }),
    )

    expect(parsed.value).toEqual({ repo: "acme/web", commit: "abc123", ref: "refs/heads/main" })
  })

  it("needs only the repo", () => {
    expect(parseDeployEvent(envelope({ repo: "acme/web" })).value).toEqual({ repo: "acme/web" })
  })

  it("rejects a key it does not know, so a typo is never silently ignored", () => {
    const parsed = parseDeployEvent(envelope({ repo: "acme/web", commitSha: "abc123" }))

    expect(parsed.value).toBeNull()
    expect(parsed.problem?.reason).toMatch(/deploy event/)
  })

  it("rejects a repo that is not owner/name", () => {
    expect(parseDeployEvent(envelope({ repo: "web" })).problem?.reason).toMatch(/owner\/name/)
  })

  it("says which of the three things went wrong", () => {
    const noData = parsePushEnvelope({ message: {} })
    expect(parseDeployEvent(noData.value!).problem?.reason).toMatch(/no data/)

    const notJson = parsePushEnvelope({
      message: { data: Buffer.from("not json").toString("base64") },
    })
    expect(parseDeployEvent(notJson.value!).problem?.reason).toMatch(/not JSON/)
  })
})
