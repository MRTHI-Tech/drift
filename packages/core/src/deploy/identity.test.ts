import { describe, expect, it } from "vitest"

import {
  bearerToken,
  checkClaims,
  decodeJwt,
  pushAudience,
  pushServiceAccountEmail,
  type IdTokenClaims,
} from "./identity"

const NOW = 1_770_000_000
const EXPECTED = {
  audience: "https://drift-dashboard-abc.a.run.app/api/pubsub/deploy",
  email: "drift-pubsub@drift-dev.iam.gserviceaccount.com",
  now: NOW,
}

function claims(overrides: IdTokenClaims = {}): IdTokenClaims {
  return {
    iss: "https://accounts.google.com",
    aud: EXPECTED.audience,
    exp: NOW + 3600,
    iat: NOW - 10,
    email: EXPECTED.email,
    email_verified: true,
    ...overrides,
  }
}

describe("pushServiceAccountEmail", () => {
  it("is the account deploy.md creates, so neither end has to be told", () => {
    expect(pushServiceAccountEmail("drift-dev")).toBe(
      "drift-pubsub@drift-dev.iam.gserviceaccount.com",
    )
  })
})

describe("checkClaims", () => {
  it("accepts a token Pub/Sub minted for this endpoint", () => {
    expect(checkClaims(claims(), EXPECTED)).toEqual({ ok: true })
  })

  it("accepts the issuer's other spelling", () => {
    expect(checkClaims(claims({ iss: "accounts.google.com" }), EXPECTED).ok).toBe(true)
  })

  it("refuses a token minted for another endpoint", () => {
    const check = checkClaims(claims({ aud: "https://elsewhere.example/hook" }), EXPECTED)

    expect(check).toEqual({ ok: false, reason: "The token was minted for a different endpoint." })
  })

  it("refuses a token from any other account, whatever its audience says", () => {
    const check = checkClaims(claims({ email: "someone@gmail.com" }), EXPECTED)

    expect(check).toEqual({ ok: false, reason: "The token names a different service account." })
  })

  it("refuses an unverified address", () => {
    expect(checkClaims(claims({ email_verified: false }), EXPECTED).ok).toBe(false)
  })

  it("refuses an expired token but tolerates a minute of clock skew", () => {
    expect(checkClaims(claims({ exp: NOW - 30 }), EXPECTED).ok).toBe(true)
    expect(checkClaims(claims({ exp: NOW - 120 }), EXPECTED)).toEqual({
      ok: false,
      reason: "The token has expired.",
    })
  })

  it("refuses a token issued well into the future", () => {
    expect(checkClaims(claims({ iat: NOW + 600 }), EXPECTED).ok).toBe(false)
  })

  it("refuses an issuer that is not Google", () => {
    expect(checkClaims(claims({ iss: "https://accounts.example.com" }), EXPECTED).ok).toBe(false)
  })
})

describe("decodeJwt", () => {
  it("splits a compact JWT into its header, claims, and signature", () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url")
    const payload = Buffer.from(JSON.stringify({ email: "a@b.c" })).toString("base64url")
    const decoded = decodeJwt(`${header}.${payload}.c2ln`)

    expect(decoded?.header.kid).toBe("k1")
    expect(decoded?.claims.email).toBe("a@b.c")
    expect(decoded?.signed).toBe(`${header}.${payload}`)
  })

  it("returns null for anything that is not one", () => {
    expect(decodeJwt("nope")).toBeNull()
    expect(decodeJwt("a.b")).toBeNull()
    expect(decodeJwt("!!!.!!!.sig")).toBeNull()
  })
})

describe("bearerToken", () => {
  it("reads the token out of an Authorization header", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi")
  })

  it("is null for a header that carries no bearer token", () => {
    expect(bearerToken(null)).toBeNull()
    expect(bearerToken("Basic abc")).toBeNull()
    expect(bearerToken("Bearer ")).toBeNull()
  })
})

describe("pushAudience", () => {
  it("is https and the host the request was addressed to", () => {
    expect(
      pushAudience("http://drift-dashboard-abc.a.run.app/api/pubsub/deploy", null),
    ).toBe("https://drift-dashboard-abc.a.run.app/api/pubsub/deploy")
  })

  it("prefers the forwarded host, which is what Cloud Run sets", () => {
    expect(pushAudience("http://localhost:8080/api/pubsub/deploy", "drift.example.com")).toBe(
      "https://drift.example.com/api/pubsub/deploy",
    )
  })

  it("drops the query, which is not part of an audience", () => {
    expect(pushAudience("https://drift.example.com/api/pubsub/deploy?x=1", null)).toBe(
      "https://drift.example.com/api/pubsub/deploy",
    )
  })
})
