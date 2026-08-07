import { describe, expect, it } from "vitest"

import { parseStorageUri, storageUri } from "./storage"

describe("parseStorageUri", () => {
  it("splits the bucket from the object", () => {
    expect(parseStorageUri("gs://drift-shots/proj1/run1/pricing-mobile.png")).toEqual({
      bucket: "drift-shots",
      objectPath: "proj1/run1/pricing-mobile.png",
    })
  })

  it("round-trips what storageUri writes", () => {
    const uri = storageUri("drift-shots", "proj1/run1/a.png")

    expect(parseStorageUri(uri)).toEqual({ bucket: "drift-shots", objectPath: "proj1/run1/a.png" })
  })

  it("refuses anything that is not a gs path", () => {
    expect(parseStorageUri("https://storage.googleapis.com/drift-shots/a.png")).toBeNull()
    expect(parseStorageUri("gs://drift-shots")).toBeNull()
    expect(parseStorageUri("gs://drift-shots/")).toBeNull()
    expect(parseStorageUri("gs:///a.png")).toBeNull()
    expect(parseStorageUri("")).toBeNull()
  })
})
