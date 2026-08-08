/**
 * Cloud Storage access for screenshots. Bucket name from env (AGENTS.md
 * section 8), credentials from the same Firebase app Firestore uses.
 */
import { getStorage } from "firebase-admin/storage"

import { getDriftApp } from "./firestore"

/** The screenshot bucket name. Throws rather than guessing one. */
export function bucketName(): string {
  const name = process.env.STORAGE_BUCKET
  if (!name) {
    throw new Error("STORAGE_BUCKET is not set. See AGENTS.md section 8.")
  }
  return name
}

/** The screenshot bucket, on the shared Firebase app. */
export function getScreenshotBucket() {
  return getStorage(getDriftApp()).bucket(bucketName())
}

/** A stored object as `gs://bucket/object`, the form `screenshotPath` takes. */
export function storageUri(bucket: string, objectPath: string): string {
  return `gs://${bucket}/${objectPath}`
}

/**
 * Uploads one PNG and returns its `gs://` path. Not resumable: screenshots are
 * a few megabytes at most and a single request fails more cleanly.
 */
export async function uploadScreenshot(objectPath: string, body: Buffer): Promise<string> {
  const bucket = getScreenshotBucket()
  await bucket.file(objectPath).save(body, {
    contentType: "image/png",
    resumable: false,
  })
  return storageUri(bucket.name, objectPath)
}

/** A `gs://bucket/object` path, split. Null for anything else. */
export function parseStorageUri(uri: string): { bucket: string; objectPath: string } | null {
  if (!uri.startsWith("gs://")) return null

  const rest = uri.slice("gs://".length)
  const slash = rest.indexOf("/")
  if (slash <= 0 || slash === rest.length - 1) return null

  return { bucket: rest.slice(0, slash), objectPath: rest.slice(slash + 1) }
}

/**
 * The prefix every screenshot of one project sits under. Deterministic from the
 * project id alone, which is what makes a project's images findable without
 * reading a single `screens` document.
 */
export function projectScreenshotPrefix(projectId: string): string {
  return `screens/${projectId}/`
}

/**
 * Deletes every screenshot a project ever captured, by prefix rather than by
 * walking its screens. A screen document that was written and then lost would
 * otherwise leave its image behind forever, and the prefix does not depend on
 * any document surviving to be read.
 *
 * Returns the number of objects removed.
 */
export async function deleteProjectScreenshots(projectId: string): Promise<number> {
  const bucket = getScreenshotBucket()
  const prefix = projectScreenshotPrefix(projectId)

  const [files] = await bucket.getFiles({ prefix })
  if (files.length === 0) return 0

  await bucket.deleteFiles({ prefix, force: true })
  return files.length
}

/**
 * Reads one stored screenshot back. Used when a pull request needs the image of
 * a screen it is about; the bucket in the path is honoured rather than assumed,
 * so a screen captured before the bucket changed still reads.
 */
export async function downloadScreenshot(uri: string): Promise<Buffer> {
  const parsed = parseStorageUri(uri)
  if (!parsed) {
    throw new Error(`A screenshot path must be gs://bucket/object. Got ${uri}.`)
  }

  const file = getStorage(getDriftApp()).bucket(parsed.bucket).file(parsed.objectPath)
  const [body] = await file.download()
  return body
}
