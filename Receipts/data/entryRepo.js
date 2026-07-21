// entryRepo.js — CRUD for captured cost entries (receipts and trip/mileage logs).
// A thin repo over Dexie, mirroring KennelOS's repo posture (validate, then
// write; soft-delete via is_archived; deleting an entry also removes its photo).
//
// Entry shape:
//   id, kind: 'receipt' | 'trip'
//   entry_date  (YYYY-MM-DD)          → KennelOS expense_date
//   subject_type: 'kennel' | 'dog'    → KennelOS subject_type
//   subject_name (string, blank = default kennel in KennelOS)
//   category (EXPENSE_CATEGORIES value)
//   vendor, notes
//   amount (number|null)              — flat receipts
//   miles, mileage_rate (number|null) — trips; KennelOS derives amount = miles×rate
//   photo_id (string|null)            → photoRepo
//   exported_at (ISO|null)            — set when included in a CSV export
//   created_at, updated_at, is_archived
import { db } from './db.js';
import { photoRepo } from './photoRepo.js';
import { nextReceiptNumber, getDefaultBusiness } from './settings.js';

function nowIso() { return new Date().toISOString(); }

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// The effective dollar amount of an entry: for a trip it's derived from
// miles × rate (matching KennelOS's expenseRepo), else the flat amount.
export function effectiveAmount(entry) {
  if (entry.kind === 'trip' && entry.miles != null) {
    const r = entry.mileage_rate;
    return (r != null) ? Math.round((entry.miles * r + Number.EPSILON) * 100) / 100 : null;
  }
  return entry.amount;
}

function validate(e) {
  if (e.kind !== 'receipt' && e.kind !== 'trip') throw new Error('Entry: kind must be "receipt" or "trip".');
  if (!e.entry_date) throw new Error('Entry: a date is required.');
  if (e.subject_type !== 'kennel' && e.subject_type !== 'dog') throw new Error('Entry: subject must be kennel or dog.');
  if (e.subject_type === 'dog' && !String(e.subject_name || '').trim()) {
    throw new Error('Entry: name the dog this cost is for.');
  }
  if (e.kind === 'trip') {
    if (e.odometer_start != null && e.odometer_end != null && e.odometer_end < e.odometer_start) {
      throw new Error('Entry: the ending odometer must be at or above the starting odometer.');
    }
    if (e.miles == null || e.miles < 0) throw new Error('Entry: a trip needs a non-negative miles value.');
    if (e.mileage_rate == null || e.mileage_rate < 0) throw new Error('Entry: a trip needs a rate per mile.');
  } else {
    if (e.amount == null || e.amount < 0) throw new Error('Entry: a receipt needs a non-negative amount.');
  }
}

// Coerce the raw form object into a clean stored record.
function normalize(data) {
  const kind = data.kind === 'trip' ? 'trip' : 'receipt';
  const isTrip = kind === 'trip';
  // Odometer start/end (trip only). When both are present, miles is DERIVED as
  // end − start; otherwise fall back to a directly-entered miles value.
  const odoStart = isTrip ? numOrNull(data.odometer_start) : null;
  const odoEnd = isTrip ? numOrNull(data.odometer_end) : null;
  let miles = isTrip ? numOrNull(data.miles) : null;
  if (isTrip && odoStart != null && odoEnd != null) {
    miles = Math.round((odoEnd - odoStart) * 10) / 10;
  }
  return {
    kind,
    entry_date: data.entry_date || '',
    subject_type: data.subject_type === 'dog' ? 'dog' : 'kennel',
    subject_name: String(data.subject_name || '').trim(),
    category: isTrip ? 'mileage' : (data.category || 'other'),
    vendor: String(data.vendor || '').trim(),
    notes: String(data.notes || '').trim(),
    amount: isTrip ? null : numOrNull(data.amount),
    miles,
    mileage_rate: isTrip ? numOrNull(data.mileage_rate) : null,
    // Odometer readings + the vehicle driven and by whom (trip only). These stay
    // in this app for your mileage log; they do NOT ride to KennelOS (which gets
    // only miles × rate).
    odometer_start: odoStart,
    odometer_end: odoEnd,
    vehicle: isTrip ? String(data.vehicle || '').trim() : '',
    driver: isTrip ? String(data.driver || '').trim() : '',
    // The receipt number ties this entry to its KennelOS row (assigned on create
    // if blank). `business` buckets the entry for this app's own filtering/export
    // scoping — it deliberately does NOT ride to KennelOS.
    receipt_number: String(data.receipt_number || '').trim(),
    business: String(data.business || '').trim(),
    photo_id: data.photo_id || null
  };
}

export const entryRepo = {
  async getAll({ includeArchived = false } = {}) {
    const rows = await db.entries.toArray();
    const visible = includeArchived ? rows : rows.filter((r) => !r.is_archived);
    // Newest cost first (by entry_date, then capture time).
    return visible.sort((a, b) => {
      if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? 1 : -1;
      return (a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1;
    });
  },

  async getById(id) {
    return (await db.entries.get(id)) || null;
  },

  async create(data) {
    const norm = normalize(data);
    validate(norm);
    // Auto-assign a receipt number if none was supplied, and default the business
    // to the configured default when the caller left it blank.
    if (!norm.receipt_number) norm.receipt_number = nextReceiptNumber();
    if (!norm.business && !('business' in data)) norm.business = getDefaultBusiness();
    const row = { id: crypto.randomUUID(), ...norm, exported_at: null, is_archived: false, created_at: nowIso(), updated_at: nowIso() };
    await db.entries.put(row);
    return row;
  },

  async update(id, changes) {
    const existing = await db.entries.get(id);
    if (!existing) throw new Error(`entries: no record ${id}`);
    const merged = { ...existing, ...normalize({ ...existing, ...changes }) };
    validate(merged);
    merged.id = existing.id;
    merged.created_at = existing.created_at;
    merged.exported_at = 'exported_at' in changes ? changes.exported_at : existing.exported_at;
    merged.is_archived = 'is_archived' in changes ? changes.is_archived : existing.is_archived;
    merged.updated_at = nowIso();
    await db.entries.put(merged);
    return merged;
  },

  // Hard delete (with its photo). This app has no referential web, so a real
  // delete is safe — but we also keep an archive path for "hide, keep the photo".
  async remove(id) {
    const e = await db.entries.get(id);
    if (e?.photo_id) await photoRepo.remove(e.photo_id);
    await db.entries.delete(id);
  },

  async archive(id) {
    return entryRepo.update(id, { is_archived: true });
  },

  // Stamp a set of entries as exported (called after a successful CSV export).
  async markExported(ids, stampIso = nowIso()) {
    for (const id of ids) {
      const e = await db.entries.get(id);
      if (e) await db.entries.update(id, { exported_at: stampIso, updated_at: nowIso() });
    }
  }
};
