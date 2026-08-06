import { Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore"

/** Every stored entity carries its document id in memory but not in the document body. */
export interface Entity {
  id: string
}

/** An entity as callers hand it to a repository: everything except the id. */
export type NewEntity<T extends Entity> = Omit<T, "id">

/** A partial update to a stored entity. The id is never patchable. */
export type EntityPatch<T extends Entity> = Partial<NewEntity<T>>

/** Converts an in-memory entity into a Firestore document body. */
export function toDocument<T extends Entity>(entity: NewEntity<T> | EntityPatch<T>): DocumentData {
  return toStored(entity) as DocumentData
}

/**
 * Converts a Firestore snapshot into a typed object. Returns null for a
 * document that does not exist, so callers never handle a raw snapshot.
 */
export function fromDocument<T extends Entity>(snapshot: DocumentSnapshot): T | null {
  const data = snapshot.data()
  if (!data) return null
  return { ...(fromStored(data) as object), id: snapshot.id } as T
}

function toStored(value: unknown): unknown {
  if (value instanceof Date) return Timestamp.fromDate(value)
  if (Array.isArray(value)) return value.map(toStored)
  if (isPlainObject(value)) return mapValues(value, toStored)
  return value
}

function fromStored(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate()
  if (Array.isArray(value)) return value.map(fromStored)
  if (isPlainObject(value)) return mapValues(value, fromStored)
  return value
}

function mapValues(
  record: Record<string, unknown>,
  map: (value: unknown) => unknown,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value)]))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}
