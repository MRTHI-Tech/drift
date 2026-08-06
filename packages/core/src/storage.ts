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
