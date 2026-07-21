// db.js — the only Dexie schema definition for Kennel Papers. Local-first,
// same posture as KennelOS/Receipts: all data lives in the browser (IndexedDB),
// no backend, works offline.
//
// Three tables (see docs/Kennel_Papers_Design_and_Maintenance_Guide.md §4-5):
//  - `dogs`: the join to KennelOS. A row's `id` IS the KennelOS Dog.id for a
//    synced dog (source:'kennelos'), or a fresh UUID for a manually-added local
//    dog (source:'local'). Fields other than id are a denormalized snapshot —
//    KennelOS stays the source of truth for them.
//  - `documents`: one row per filed document (pedigree/health test/registration/
//    contract/other), pointing at a dog and at its stored file.
//  - `files`: the archive — one row per stored PDF (blob + thumbnail + meta).
//
// ids are client-side UUIDs (crypto.randomUUID), like KennelOS/Receipts, except
// a synced dog's id (copied from KennelOS). Dates are YYYY-MM-DD strings;
// created_at/updated_at are full ISO. is_archived is filtered in JS (IndexedDB
// can't key on booleans) — trivial at this scale.
//
// Versioning rule (same as KennelOS/Receipts): once real data ships, schema
// changes are additive only — new tables/indexes go in a new
// db.version(N).stores({...}) block; shipped blocks are never edited again.
import Dexie from '../vendor/dexie.min.mjs';

export const db = new Dexie('KennelPapersApp');

db.version(1).stores({
  dogs:      'id, call_name, breed, status, source, is_archived',
  documents: 'id, dog_id, doc_type, doc_date, is_archived',
  files:     'id, created_at'
});

export default db;
