import { applicationDefault, getApps, initializeApp, type App } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"

const APP_NAME = "drift"

/** Firestore database id. `(default)` unless the env says otherwise. */
export function databaseId(): string {
  return process.env.FIRESTORE_DATABASE ?? "(default)"
}

/**
 * The Firestore client every repository runs against. Native mode, one
 * database, credentials from the ambient Google application default
 * credentials. Cached so repeated calls reuse a single connection.
 */
export function getDriftFirestore(): Firestore {
  return getFirestore(getDriftApp(), databaseId())
}

/** The one Firebase app Firestore and Cloud Storage both run against. */
export function getDriftApp(): App {
  const existing = getApps().find((app) => app.name === APP_NAME)
  if (existing) return existing

  const projectId = process.env.GOOGLE_CLOUD_PROJECT
  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT is not set. See AGENTS.md section 8.")
  }

  return initializeApp({ credential: applicationDefault(), projectId }, APP_NAME)
}
