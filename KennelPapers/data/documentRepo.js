// documentRepo.js — CRUD for document rows (guide §4.2, §6). A document
// belongs to exactly one dog and points at exactly one stored file. The
// reverse of "a dog's documents" is always this repo's getByDog query — never
// a stored back-pointer on the dog.
import { db } from './db.js';
import { fileRepo } from './fileRepo.js';

function nowIso() { return new Date().toISOString(); }

function validate(d) {
  if (!d.dog_id) throw new Error('Document: a dog is required.');
  if (!d.doc_type) throw new Error('Document: a document type is required.');
  if (!d.file_id) throw new Error('Document: a file is required.');
}

function normalize(data) {
  return {
    dog_id: data.dog_id,
    doc_type: data.doc_type || 'other',
    title: String(data.title || '').trim(),
    doc_date: data.doc_date || '',
    issuer_or_lab: String(data.issuer_or_lab || '').trim(),
    result: String(data.result || '').trim(),
    registry: String(data.registry || '').trim(),
    registration_number: String(data.registration_number || '').trim(),
    tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : [],
    notes: String(data.notes || '').trim(),
    file_id: data.file_id
  };
}

export const documentRepo = {
  async getAll({ includeArchived = false } = {}) {
    const rows = await db.documents.toArray();
    const visible = includeArchived ? rows : rows.filter((r) => !r.is_archived);
    return visible.sort((a, b) => {
      if (a.doc_date !== b.doc_date) return (a.doc_date || '') < (b.doc_date || '') ? 1 : -1;
      return (a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1;
    });
  },

  async getById(id) {
    if (!id) return null;
    return (await db.documents.get(id)) || null;
  },

  // The reverse query powering the grouped list and the per-dog document pack.
  async getByDog(dogId, { includeArchived = false } = {}) {
    const rows = await db.documents.where('dog_id').equals(dogId).toArray();
    const visible = includeArchived ? rows : rows.filter((r) => !r.is_archived);
    return visible.sort((a, b) => (a.doc_date || '') < (b.doc_date || '') ? 1 : -1);
  },

  async create(data) {
    const norm = normalize(data);
    validate(norm);
    const row = { id: crypto.randomUUID(), ...norm, is_archived: false, created_at: nowIso(), updated_at: nowIso() };
    await db.documents.put(row);
    return row;
  },

  async update(id, changes) {
    const existing = await db.documents.get(id);
    if (!existing) throw new Error(`documents: no record ${id}`);
    const merged = { ...existing, ...normalize({ ...existing, ...changes }) };
    validate(merged);
    merged.id = existing.id;
    merged.created_at = existing.created_at;
    merged.is_archived = 'is_archived' in changes ? changes.is_archived : existing.is_archived;
    merged.updated_at = nowIso();
    await db.documents.put(merged);
    return merged;
  },

  async archive(id) { return documentRepo.update(id, { is_archived: true }); },
  async unarchive(id) { return documentRepo.update(id, { is_archived: false }); },

  // Hard delete — also removes the linked file (a file is owned by exactly
  // one document).
  async remove(id) {
    const doc = await db.documents.get(id);
    if (doc?.file_id) await fileRepo.remove(doc.file_id);
    await db.documents.delete(id);
  },

  // Restore only — upserts a full row as-is.
  async putRaw(row) {
    await db.documents.put(row);
  }
};
