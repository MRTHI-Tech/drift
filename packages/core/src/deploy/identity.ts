/**
 * Who sent a push request.
 *
 * The dashboard's push endpoint is on the public internet, because that is what
 * a Pub/Sub push subscription needs, so it is the only route in the app that is
 * not behind the session cookie. What stands in front of it instead is the
 * OIDC token Pub/Sub attaches to every push: a JWT Google signed, naming the
 * service account the subscription was created with and the endpoint it was
 * aimed at.
 *
 * All three of those are checked here. The signature, against Google's
 * published keys, so the token is one Google minted. The `email` claim, against
 * the one service account `deploy.md` creates, because anybody with a Google
 * account can mint a token with any audience they like and the audience alone
 * therefore proves nothing. The `aud` claim, against the endpoint's own URL, so
 * a token minted for some other service cannot be replayed at this one.
 *
 * Written against the platform: `node:crypto` verifies RS256 and reads a JWK
 * directly, and `fetch` gets the key set. Nothing here needs a library
 * (AGENTS.md section 7).
 */
import { createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto"

import { DEPLOYMENT } from "../constants"

/** Where Google publishes the keys its identity tokens are signed with. */
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"

/** Issuers Google's identity tokens carry. Both spellings are current. */
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"])

/** How long a fetched key set is reused before it is fetched again. */
const JWKS_TTL_MS = 60 * 60 * 1000

/** Clock skew tolerated on `exp` and `iat`, in seconds. */
const SKEW_SECONDS = 60

/** The service account Pub/Sub signs its push requests to the dashboard as. */
export function pushServiceAccountEmail(googleCloudProject: string): string {
  return `${DEPLOYMENT.pushServiceAccount}@${googleCloudProject}.iam.gserviceaccount.com`
}

/** The claims of a Google identity token this code reads. */
export interface IdTokenClaims {
  iss?: unknown
  aud?: unknown
  exp?: unknown
  iat?: unknown
  email?: unknown
  email_verified?: unknown
}

/** What a token has to say before the endpoint acts on it. */
export interface ExpectedClaims {
  /** The endpoint's own absolute URL, which is what Pub/Sub sets `aud` to. */
  audience: string
  /** The service account the push subscription was created with. */
  email: string
  /** Seconds since the epoch. Injectable so the check is testable. */
  now: number
}

export type ClaimCheck = { ok: true } | { ok: false; reason: string }

/**
 * Everything about a token that does not need a key. Separated from the
 * signature check because it is the part with the rules in it, and rules are
 * worth testing without a network or a keypair.
 */
export function checkClaims(claims: IdTokenClaims, expected: ExpectedClaims): ClaimCheck {
  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) {
    return { ok: false, reason: "The token was not issued by Google." }
  }

  if (typeof claims.exp !== "number" || claims.exp + SKEW_SECONDS < expected.now) {
    return { ok: false, reason: "The token has expired." }
  }

  if (typeof claims.iat === "number" && claims.iat - SKEW_SECONDS > expected.now) {
    return { ok: false, reason: "The token was issued in the future." }
  }

  if (claims.aud !== expected.audience) {
    return { ok: false, reason: "The token was minted for a different endpoint." }
  }

  if (claims.email !== expected.email) {
    return { ok: false, reason: "The token names a different service account." }
  }

  if (claims.email_verified !== true) {
    return { ok: false, reason: "The token's address is not verified." }
  }

  return { ok: true }
}

/** A JWT split into its parts, or null when it is not one. */
export interface DecodedJwt {
  header: { alg?: unknown; kid?: unknown }
  claims: IdTokenClaims
  /** Header and payload joined by a dot, which is what the signature covers. */
  signed: string
  signature: Buffer
}

/** Splits and base64url-decodes a compact JWT. No verification. */
export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null

  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string]

  const header = decodeSegment(encodedHeader)
  const claims = decodeSegment(encodedClaims)
  if (!header || !claims) return null

  return {
    header,
    claims,
    signed: `${encodedHeader}.${encodedClaims}`,
    signature: Buffer.from(encodedSignature, "base64url"),
  }
}

/**
 * The absolute URL Pub/Sub aimed this push at, which is what it sets `aud` to
 * when the subscription declares no audience of its own.
 *
 * Derived from the request rather than configured, so the check needs nothing
 * kept in step by hand. The scheme is forced to https because Cloud Run
 * terminates TLS at its front end and hands the container a plain HTTP request,
 * so the request's own scheme is the wrong one to compare against; the host,
 * meanwhile, is whatever the caller asked for, and is compared rather than
 * trusted.
 */
export function pushAudience(requestUrl: string, forwardedHost: string | null): string {
  const url = new URL(requestUrl)
  const host = forwardedHost?.trim() || url.host
  return `https://${host}${url.pathname}`
}

/** The bearer token of an `Authorization` header, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer (.+)$/.exec(header.trim())
  return match?.[1]?.trim() || null
}

export type Verification = { ok: true; email: string } | { ok: false; reason: string }

/**
 * The whole check: a token, the endpoint it arrived at, and the account it has
 * to be from. Returns a reason rather than throwing, because every failure here
 * is an answer to send rather than an error to report.
 */
export async function verifyPushToken(
  token: string,
  expected: ExpectedClaims,
): Promise<Verification> {
  const decoded = decodeJwt(token)
  if (!decoded) return { ok: false, reason: "The token is not a JWT." }

  if (decoded.header.alg !== "RS256") {
    return { ok: false, reason: "The token is not signed with RS256." }
  }
  if (typeof decoded.header.kid !== "string") {
    return { ok: false, reason: "The token names no signing key." }
  }

  let key: KeyObject | null
  try {
    key = await signingKey(decoded.header.kid)
  } catch (error) {
    // A key set that could not be fetched is not the caller's fault, so this
    // is the one failure the endpoint should retry rather than reject.
    throw new Error(
      `Could not read Google's signing keys: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!key) return { ok: false, reason: "The token's signing key is not one of Google's." }

  const signed = verify("RSA-SHA256", Buffer.from(decoded.signed), key, decoded.signature)
  if (!signed) return { ok: false, reason: "The token's signature does not check out." }

  const claims = checkClaims(decoded.claims, expected)
  if (!claims.ok) return { ok: false, reason: claims.reason }

  return { ok: true, email: String(decoded.claims.email) }
}

/** The fetched key set, held between requests so every push is not a round trip. */
let cache: { keys: Map<string, KeyObject>; fetchedAt: number } | null = null

/**
 * The public key with a given id. Refetches once if the id is unknown, because
 * Google rotates these and a key that is new to this process is the ordinary
 * reason for a miss.
 */
async function signingKey(kid: string): Promise<KeyObject | null> {
  const fresh = cache !== null && Date.now() - cache.fetchedAt < JWKS_TTL_MS
  if (!fresh || !cache?.keys.has(kid)) {
    cache = { keys: await fetchKeys(), fetchedAt: Date.now() }
  }
  return cache.keys.get(kid) ?? null
}

async function fetchKeys(): Promise<Map<string, KeyObject>> {
  const response = await fetch(JWKS_URL)
  if (!response.ok) {
    throw new Error(`${JWKS_URL} answered ${response.status}.`)
  }

  const body: unknown = await response.json()
  const keys = (body as { keys?: unknown }).keys
  if (!Array.isArray(keys)) {
    throw new Error(`${JWKS_URL} answered without a key set.`)
  }

  const parsed = new Map<string, KeyObject>()
  for (const jwk of keys) {
    if (typeof jwk !== "object" || jwk === null) continue
    const kid = (jwk as { kid?: unknown }).kid
    if (typeof kid !== "string") continue
    try {
      parsed.set(kid, createPublicKey({ key: jwk as JsonWebKey, format: "jwk" }))
    } catch {
      // One unreadable key in the set is not a reason to reject the rest.
    }
  }
  return parsed
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"))
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}
