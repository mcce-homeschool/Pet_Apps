// dogRepo.js — CRUD + queries for dog rows (guide §4.1, §6). A dog row is
// either a synced snapshot of a KennelOS Dog (source:'kennelos', id copied
// from KennelOS, written only via upsertFromKennelOS by dogImport.js) or a
// manually-added local dog (source:'local', own UUID, not yet in KennelOS).
import { db } from './db.js';
import { documentRepo } from './documentRepo.js';

function nowIso() { return new Date().toISOString(); }

function validate(d) {
  if (!String(d.call_name || '').trim()) throw new Error('Dog: a call name is required.');
}

function normalize(data) {
  return {
    call_name: String(data.call_name || '').trim(),
    registered_name: String(data.registered_name || '').trim(),
    sex: data.sex || '',
    breed: String(data.breed || '').trim(),
    status: String(data.status || '').trim(),
    registration_number: String(data.registration_number || '').trim(),
    microchip_id: String(data.microchip_id || '').trim(),
    date_of_birth: data.date_of_birth || ''
  };
}

export const dogRepo = {
  async getAll({ includeArchived = false } = {}) {
    const rows = await db.dogs.toArray();
    const visible = includeArchived ? rows : rows.filter((r) => !r.is_archived);
    return visible.sort((a, b) => a.call_name.localeCompare(b.call_name));
  },

  async getById(id) {
    if (!id) return null;
    return (await db.dogs.get(id)) || null;
  },

  // Manual "add local dog" path — a dog not yet synced from KennelOS.
  async create(data) {
    const norm = normalize(data);
    validate(norm);
    const row = {
      id: crypto.randomUUID(),
      ...norm,
      source: 'local',
      synced_at: null,
      is_archived: false,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await db.dogs.put(row);
    return row;
  },

  async update(id, changes) {
    const existing = await db.dogs.get(id);
    if (!existing) throw new Error(`dogs: no record ${id}`);
    const merged = { ...existing, ...normalize({ ...existing, ...changes }) };
    validate(merged);
    merged.id = existing.id;
    merged.source = existing.source;
    merged.synced_at = existing.synced_at;
    merged.created_at = existing.created_at;
    merged.is_archived = 'is_archived' in changes ? changes.is_archived : existing.is_archived;
    merged.updated_at = nowIso();
    await db.dogs.put(merged);
    return merged;
  },

  // Used only by dogImport.js: writes a dog whose id IS the KennelOS id.
  // Preserves this app's own state (is_archived, created_at) across re-syncs —
  // KennelOS owns the snapshot fields, not the local archive flag.
  async upsertFromKennelOS(row) {
    const existing = await db.dogs.get(row.id);
    const norm = normalize(row);
    const merged = {
      id: row.id,
      ...norm,
      source: 'kennelos',
      synced_at: nowIso(),
      is_archived: existing ? existing.is_archived : false,
      created_at: existing ? existing.created_at : nowIso(),
      updated_at: nowIso()
    };
    await db.dogs.put(merged);
    return merged;
  },

  async archive(id) { return dogRepo.update(id, { is_archived: true }); },
  async unarchive(id) { return dogRepo.update(id, { is_archived: false }); },

  // Blocked while any document references this dog — the one referential
  // guard in the app (guide §15.3). Archive instead.
  async hardDelete(id) {
    const docs = await documentRepo.getByDog(id, { includeArchived: true });
    if (docs.length > 0) {
      throw new Error(`Can't delete this dog — ${docs.length} document(s) are filed under it. Archive it instead.`);
    }
    await db.dogs.delete(id);
  },

  // Restore only — upserts a full row as-is.
  async putRaw(row) {
    await db.dogs.put(row);
  }
};
