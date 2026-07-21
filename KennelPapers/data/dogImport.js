// dogImport.js — dog sync from a KennelOS JSON backup (guide §7). Manual, on
// demand, non-destructive. Mirrors KennelOS's own dry-run import discipline:
// parse -> build a preview plan -> user confirms -> commit (upsert only,
// never deletes).
//
// Source: a KennelOS JSON backup file, i.e. what KennelOS's own
// importExport.exportAll() writes: { schema_version, format_version,
// exported_at, collections }, where collections.dogs is the full stored dog
// rows INCLUDING id. That id is the only reliable source of KennelOS's UUID —
// KennelOS's CSV path matches by natural key and never exposes it.
import { dogRepo } from './dogRepo.js';

// The snapshot fields KennelOS owns (kept in lock-step with guide §4.1).
const SNAPSHOT_FIELDS = [
  'call_name', 'registered_name', 'sex', 'breed', 'status',
  'registration_number', 'microchip_id', 'date_of_birth'
];

function snapshotOf(row) {
  const out = {};
  for (const f of SNAPSHOT_FIELDS) out[f] = row[f] ?? '';
  return out;
}

function snapshotsDiffer(a, b) {
  return SNAPSHOT_FIELDS.some((f) => (a[f] ?? '') !== (b[f] ?? ''));
}

// Reads and validates a KennelOS backup File, returning its raw dog rows.
// Throws a friendly error if the file isn't a recognizable KennelOS backup.
export async function parse(file) {
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a KennelOS backup (not valid JSON).");
  }
  if (!obj || typeof obj !== 'object' || !obj.collections || typeof obj.collections !== 'object') {
    throw new Error("That file isn't a KennelOS backup (missing \"collections\").");
  }
  const dogs = obj.collections.dogs;
  if (!Array.isArray(dogs)) {
    throw new Error("That file isn't a KennelOS backup (no dogs in it).");
  }
  return dogs;
}

// Compares incoming KennelOS dog rows against what's already here, by id.
// Returns { create, update, unchanged, missingHere } — no writes yet.
export async function buildPlan(incomingDogs) {
  const here = await dogRepo.getAll({ includeArchived: true });
  const hereById = new Map(here.map((d) => [d.id, d]));
  const incomingIds = new Set(incomingDogs.map((d) => d.id));

  const create = [];
  const update = [];
  const unchanged = [];

  for (const incoming of incomingDogs) {
    const existing = hereById.get(incoming.id);
    if (!existing) {
      create.push(incoming);
    } else if (existing.source !== 'kennelos' || snapshotsDiffer(snapshotOf(existing), snapshotOf(incoming))) {
      update.push(incoming);
    } else {
      unchanged.push(incoming);
    }
  }

  // Dogs synced here before but absent from this file (archived/deleted in
  // KennelOS, or a stale export). Reported only — never auto-removed.
  const missingHere = here.filter((d) => d.source === 'kennelos' && !incomingIds.has(d.id));

  return { create, update, unchanged, missingHere };
}

// Writes the plan's create + update rows via dogRepo.upsertFromKennelOS.
// Never deletes. Returns the counts actually written.
export async function commit(plan) {
  let written = 0;
  for (const row of [...plan.create, ...plan.update]) {
    await dogRepo.upsertFromKennelOS(row);
    written++;
  }
  return { written };
}
