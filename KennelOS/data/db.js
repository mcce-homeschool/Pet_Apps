// db.js — Dexie schema definition (single source of truth for tables/indexes).
//
// Layering rule (see CLAUDE.md): pages never import this file directly and never
// call db.<table>.* — they go through the repo modules in /data. The repos are the
// only code that touches Dexie.
//
// Dexie is vendored locally (no CDN) so the app works offline after first load.
import Dexie from '../vendor/dexie.min.mjs';

// App-specific DB name: project pages on github.io share one origin as path
// prefixes, so a distinct name prevents collisions with anything else the user
// hosts on the same account (Data Model doc §2.1).
export const db = new Dexie('KennelOSBreedingApp');

// --- Schema ---------------------------------------------------------------
// Data Model Architecture Proposal v3 §2 collapses the version(1)/(2)/(3) ladder
// that carried Stages 1–3 into a SINGLE version(1) block covering all nine
// tables. That ladder only exists to protect real-data migrations, and nothing
// has shipped — there is no live data to migrate, so this is a deliberate,
// documented reset (v3 §2, Stage4 Revision v2 §1). The NEXT `.version(2)` block
// should be added only at the first real release; from then on, additive
// versioning applies as Dexie expects and this block is never edited again.
//
// Index notes:
//  - events '[subject_type+subject_id]' is a COMPOUND index, required for fast
//    "timeline for this dog/pairing/litter" lookups. Do not split into two.
//  - dogs '*co_owner_contact_ids' is a MULTI-ENTRY index so "dogs co-owned by X"
//    is a real query, not a full scan.
//  - Every canonical FK (Stage 4: sales/contracts/stud_services; Stage 4.5:
//    events.related_contact_id) is indexed, so every reverse lookup in
//    referenceRegistry.js is an index probe, never a scan.
//  - Only fields we actually query/filter on are indexed; all other fields still
//    persist, they just aren't indexed. `events.event_end_date` (Stage 4.5) is a
//    deliberate example: a plain nullable YYYY-MM-DD field, never queried/sorted
//    on directly, so it carries no index (Stage4.5 Addendum §C1).
//  - events '.reminder_date' (Stage 5, Build Brief §3.2) IS indexed: the reminder
//    engine's getReminders() range-probes it. This is the ONE index Stage 5 adds,
//    and the last one that gets to ride an edit to this collapsed version(1) block
//    (nothing has shipped — reconcile by Reset App + re-seed, no `.version(2)`).
//    Every further index after the first real release goes in an additive
//    `.version(2)` block that is never edited again (Build Brief §8).
//  - Stage 5 also adds two PLAIN fields — `events.reminder_dismissed` (boolean)
//    and `dogs.recorded_coi` (object) — that are deliberately UNindexed: they
//    persist and ride the JSON backup, but nothing queries them by key, so they
//    stay out of the index strings below (Build Brief §2.1/§3.2).
db.version(1).stores({
  dogs:          'id, sire_id, dam_id, litter_id, owner_contact_id, *co_owner_contact_ids, status, ownership_type, sex, breed, kennel_id, is_archived',
  events:        'id, [subject_type+subject_id], event_type, event_date, reminder_date, related_dog_id, related_contact_id, is_archived',
  contacts:      'id, kennel_id, waitlist_status, is_archived',
  kennels:       'id, is_archived',
  pairings:      'id, sire_id, dam_id, status, pairing_type, is_archived',
  litters:       'id, pairing_id, sire_id, dam_id, status, whelp_date, is_archived',
  sales:         'id, dog_id, buyer_contact_id, status, placement_type, is_archived',
  contracts:     'id, contract_type, status, related_sale_id, related_stud_service_id, related_dog_id, is_archived',
  stud_services: 'id, our_dog_id, partner_dog_id, partner_contact_id, direction, status, pairing_id, is_archived'
});

// --- First-run storage durability ----------------------------------------
// Ask the browser to keep this origin's data from being evicted under storage
// pressure (Data Model doc §2.1). Best-effort; safe to ignore if unsupported.
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    /* non-fatal — durability is a nicety, not a requirement */
  }
  return false;
}

// Convenience: the list of table names that actually exist in the current schema
// version. referenceRegistry / import-export use this so stage-aware code never
// probes a table that doesn't exist yet.
export function existingTableNames() {
  return db.tables.map((t) => t.name);
}
