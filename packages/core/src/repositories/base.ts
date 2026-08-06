import type { CollectionReference, Firestore, Query } from "firebase-admin/firestore"

import type { CollectionName } from "../constants"
import {
  fromDocument,
  toDocument,
  type Entity,
  type EntityPatch,
  type NewEntity,
} from "./document"

/** Reads and writes shared by every collection. Returns typed objects only. */
export interface BaseRepository<T extends Entity> {
  /** Writes a new document. Firestore assigns the id unless one is given. */
  create(input: NewEntity<T>, id?: string): Promise<T>
  /** Returns the document, or null when it does not exist. */
  get(id: string): Promise<T | null>
  /** Patches an existing document and returns it as stored. Throws if missing. */
  update(id: string, patch: EntityPatch<T>): Promise<T>
}

export function createBaseRepository<T extends Entity>(
  db: Firestore,
  name: CollectionName,
): BaseRepository<T> & { readonly collection: CollectionReference } {
  const collection = db.collection(name)

  return {
    collection,

    async create(input, id) {
      const ref = id ? collection.doc(id) : collection.doc()
      await ref.set(toDocument<T>(input))
      return { ...input, id: ref.id } as T
    },

    async get(id) {
      return fromDocument<T>(await collection.doc(id).get())
    },

    async update(id, patch) {
      const ref = collection.doc(id)
      await ref.update(toDocument<T>(patch))
      const updated = fromDocument<T>(await ref.get())
      if (!updated) {
        throw new Error(`${name}/${id} disappeared while being updated`)
      }
      return updated
    },
  }
}

/** Runs a query and maps every snapshot to a typed object. */
export async function readAll<T extends Entity>(query: Query): Promise<T[]> {
  const snapshot = await query.get()
  return snapshot.docs.flatMap((doc) => {
    const entity = fromDocument<T>(doc)
    return entity ? [entity] : []
  })
}
