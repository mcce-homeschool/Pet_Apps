// csvImport.js â€” the generic CSV match-or-create engine (Build Brief A3/B2,
// Data Model doc Â§8). Lives in the data layer: it parses a file (via the
// vendored PapaParse), classifies every row against existing records as
// create / update / needs-review in a DRY RUN, and only writes on an explicit
// commit. The engine is entity-agnostic â€” each entity contributes a small
// *mapping* (column names, natural key, normalizers, repo). Stage 2 wires in
// Dog and Contact; later stages add their own mapping to this same engine
// rather than rebuilding it.
//
// The rule that shapes everything (Data Model Â§8): a natural key is only valid
// if it is NON-EMPTY. Keyless / partial-key rows are never auto-matched and
// never silently created â€” they land in "needs review," where the user decides.
import Papa from '../vendor/papaparse.min.mjs';
import { dogRepo } from './dogRepo.js';
import { contactRepo } from './contactRepo.js';
import { kennelRepo } from './kennelRepo.js';
import { pairingRepo } from './pairingRepo.js';
import { litterRepo } from './litterRepo.js';
import { saleRepo } from './saleRepo.js';
import { HistoryEvent } from './eventRepo.js';
import { studServiceRepo } from './studServiceRepo.js';
import {
  SEX, OWNERSHIP_TYPE, DOG_STATUS, CONTACT_TYPE, PAIRING_TYPE, PAIRING_METHOD, PAIRING_STATUS,
  LITTER_STATUS, PLACEMENT_TYPE, SALE_STATUS, eventTypesFor, STUD_SERVICE_DIRECTION, FEE_STRUCTURE, STUD_SERVICE_STATUS
} from './vocab.js';

// --- Parsing --------------------------------------------------------------
// Headers are normalized to lower_snake_case so "Registered Name", "registered
// name", and "registered_name" all resolve to the same key. Values are trimmed.
export function parseCsv(fileOrText) {
  return new Promise((resolve, reject) => {
    Papa.parse(fileOrText, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      transform: (v) => (typeof v === 'string' ? v.trim() : v),
      complete: (res) => resolve({ rows: res.data, fields: res.meta.fields || [], errors: res.errors || [] }),
      error: (err) => reject(err)
    });
  });
}

// --- Shared normalizers ---------------------------------------------------
// Read a column allowing a few aliases; returns '' when absent/blank.
function col(row, ...names) {
  for (const n of names) {
    const v = row[n];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// Coerce free text to a controlled-vocab value. Returns '' (blank), the value,
// or null (present but unrecognized â€” the caller decides how loud to be).
function normEnum(vocab, raw, extra = {}) {
  if (!raw) return '';
  const s = raw.trim();
  const k = s.toLowerCase().replace(/\s+/g, '_');
  if (extra[k]) return extra[k];
  const hit = vocab.find((v) => v.value === k || v.label.toLowerCase() === s.toLowerCase());
  return hit ? hit.value : null;
}

// Normalize a date to YYYY-MM-DD. Accepts ISO and US M/D/YYYY. Returns ''
// (blank), a valid YYYY-MM-DD string, or null (present but unrecognized).
function normDate(raw) {
  if (!raw) return '';
  const s = raw.trim();
  let y, m, d;
  let hit = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (hit) { [, y, m, d] = hit; }
  else if ((hit = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/))) { [, m, d, y] = hit; } // US M/D/Y
  else return null;
  const mm = Number(m), dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const ymd = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const check = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(check.getTime()) ? null : ymd;
}

// Split a delimited multi-value cell ("breeder; vet") into trimmed parts.
function splitList(raw) {
  if (!raw) return [];
  return raw.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
}

// Name -> existing Dog lookup shared by the Pairing/Litter mappings to resolve
// sire/dam relationship columns (Data Model Â§8, point 2). Same precedence as
// the Dog mapping's own byName index: registered_name wins ties, call_name
// fills gaps.
function buildDogNameIndex(dogs) {
  const byName = new Map();
  for (const d of dogs) {
    if (d.registered_name) byName.set(d.registered_name.trim().toLowerCase(), d);
    const ck = d.call_name?.trim().toLowerCase();
    if (ck && !byName.has(ck)) byName.set(ck, d);
  }
  return byName;
}

// Composite natural-key string: parts joined by a space. Callers only ever
// pass resolved dog ids (UUIDs) and YYYY-MM-DD dates here, neither of which
// contains a space, so distinct combinations never collide. Any blank/nullish
// part means no valid key (caller must treat the row as keyless).
function nkParts(...parts) {
  if (parts.some((p) => p === '' || p == null)) return null;
  return parts.map((p) => String(p).trim().toLowerCase()).join(' ');
}

// Natural-key string: name (case-insensitive, trimmed) + exact DOB, joined by a
// NUL that can't appear in real data, so distinct name/DOB pairs never collide.
function nk(name, dob) {
  return `${name.trim().toLowerCase()}\u0000${dob}`;
}

// =========================================================================
// Dog mapping
// =========================================================================
// Natural key: registered_name + date_of_birth, falling back to
// call_name + date_of_birth (Data Model Â§8). A row with no DOB, or with no
// name at all, cannot form a key â†’ needs review.
const DOG_MAPPING = {
  entity: 'dog',
  label: 'Dogs',
  // Columns the importer understands (for the on-page template/help).
  templateHeaders: [
    'call_name', 'registered_name', 'sex', 'date_of_birth', 'breed',
    'sire_registered_name', 'dam_registered_name', 'ownership_type', 'status',
    'color_markings', 'registry', 'registration_number', 'microchip_id', 'notes'
  ],
  requiredForCreate: ['call_name', 'sex', 'breed', 'ownership_type', 'status'],

  loadExisting: () => dogRepo.getAll({ includeArchived: true }),

  buildIndex(existing) {
    const byReg = new Map();   // registered_name+dob -> id
    const byCall = new Map();  // call_name+dob -> id
    const byName = new Map();  // any name -> id (for sire/dam resolution)
    for (const d of existing) {
      if (d.registered_name && d.date_of_birth) byReg.set(nk(d.registered_name, d.date_of_birth), d);
      if (d.call_name && d.date_of_birth) byCall.set(nk(d.call_name, d.date_of_birth), d);
      if (d.registered_name) byName.set(d.registered_name.trim().toLowerCase(), d);
      const ck = d.call_name?.trim().toLowerCase();
      if (ck && !byName.has(ck)) byName.set(ck, d);
    }
    return { byReg, byCall, byName };
  },

  classify(row, index, i) {
    const reasons = [];
    const reg = col(row, 'registered_name', 'reg_name');
    const call = col(row, 'call_name', 'name');
    const dobRaw = col(row, 'date_of_birth', 'dob', 'birthdate');
    const dob = normDate(dobRaw);
    if (dob === null) reasons.push(`Unrecognized date_of_birth "${dobRaw}".`);

    const sex = normEnum(SEX, col(row, 'sex'), { m: 'male', f: 'female' });
    if (sex === null) reasons.push(`Unrecognized sex "${col(row, 'sex')}".`);
    const ownership = normEnum(OWNERSHIP_TYPE, col(row, 'ownership_type', 'ownership'));
    if (ownership === null) reasons.push(`Unrecognized ownership_type "${col(row, 'ownership_type', 'ownership')}".`);
    const status = normEnum(DOG_STATUS, col(row, 'status'));
    if (status === null) reasons.push(`Unrecognized status "${col(row, 'status')}".`);

    // Full create-ready record (only non-blank, recognized fields set).
    const record = {};
    if (call) record.call_name = call;
    if (reg) record.registered_name = reg;
    if (sex) record.sex = sex;
    if (dob) record.date_of_birth = dob;
    const breed = col(row, 'breed');
    if (breed) record.breed = breed;
    if (ownership) record.ownership_type = ownership;
    if (status) record.status = status;
    for (const [key, ...aliases] of [
      ['color_markings', 'color', 'markings'], ['registry'], ['registration_number', 'reg_number'],
      ['microchip_id', 'microchip'], ['notes']
    ]) {
      const v = col(row, key, ...aliases);
      if (v) record[key] = v;
    }

    // Sire / dam: resolve names against EXISTING dogs (Data Model Â§8.2). A named
    // parent that doesn't resolve is flagged (never silently dropped).
    const unresolved = [];
    for (const [nameCol, idField, roleLabel] of [
      ['sire_registered_name', 'sire_id', 'Sire'], ['dam_registered_name', 'dam_id', 'Dam']
    ]) {
      const pName = col(row, nameCol, nameCol.replace('_registered_name', '_name'));
      if (!pName) continue;
      const hit = index.byName.get(pName.toLowerCase());
      if (hit) record[idField] = hit.id;
      else { unresolved.push(`${roleLabel} "${pName}" not found`); }
    }

    // Natural key â†’ match-or-create.
    const hasName = !!(reg || call);
    const validKey = hasName && !!dob;
    let status_ = 'create';
    let match = null;
    if (!validKey) {
      status_ = 'review';
      if (!hasName) reasons.push('No registered_name or call_name â€” cannot form a natural key.');
      if (!dob) reasons.push('No date_of_birth â€” cannot form a natural key.');
    } else {
      match = (reg && index.byReg.get(nk(reg, dob))) || (call && index.byCall.get(nk(call, dob))) || null;
      status_ = match ? 'update' : 'create';
    }

    // A create must satisfy the repo's required fields; if not, review it so the
    // user sees exactly what's missing instead of hitting a commit-time failure.
    if (status_ === 'create') {
      const missing = this.requiredForCreate.filter((f) => !record[f]);
      if (missing.length) { status_ = 'review'; reasons.push(`Missing required field(s) for a new dog: ${missing.join(', ')}.`); }
    }
    // Unresolved parents push a create/update row to review (fixable, or apply anyway).
    if (unresolved.length) { if (status_ !== 'review') status_ = 'review'; reasons.push(unresolved.join('; ') + '.'); }

    const display = reg || call || `(row ${i + 2})`;
    return {
      index: i, raw: row, entity: 'dog', display,
      record,                             // create payload
      changes: buildDogChanges(record),   // update payload (same recognized fields)
      status: status_, match, matchLabel: match ? (match.registered_name || match.call_name) : '',
      reasons,
      decision: status_ === 'review' ? 'skip' : status_,
      decisionTarget: match ? match.id : null
    };
  },

  // Human label for an existing record (used by the "match to existing" picker).
  describe: (d) => (d.registered_name || d.call_name || '(unnamed dog)') + (d.date_of_birth ? ` â€” ${d.date_of_birth}` : '') + (d.is_archived ? ' (archived)' : ''),

  repo: dogRepo
};

// For an update we apply the same recognized fields the create would set (blank
// CSV cells never overwrite existing data, since they were never added above).
function buildDogChanges(record) {
  return { ...record };
}

// =========================================================================
// Contact mapping
// =========================================================================
// Natural key: name (case-insensitive, trimmed). Nameless â†’ needs review.
const CONTACT_MAPPING = {
  entity: 'contact',
  label: 'Contacts',
  templateHeaders: ['name', 'contact_type', 'email', 'phone', 'address', 'kennel_name', 'notes'],
  requiredForCreate: ['name'],

  async loadExisting() {
    const [contacts, kennels] = await Promise.all([
      contactRepo.getAll({ includeArchived: true }),
      kennelRepo.getAll({ includeArchived: true })
    ]);
    this._kennels = kennels;
    return contacts;
  },

  buildIndex(existing) {
    const byName = new Map();
    for (const c of existing) if (c.name) byName.set(c.name.trim().toLowerCase(), c);
    const kennelByName = new Map();
    for (const k of this._kennels || []) if (k.kennel_name) kennelByName.set(k.kennel_name.trim().toLowerCase(), k);
    return { byName, kennelByName };
  },

  classify(row, index, i) {
    const reasons = [];
    const name = col(row, 'name', 'contact_name');
    const record = {};
    if (name) record.name = name;

    const typesRaw = splitList(col(row, 'contact_type', 'type', 'types'));
    if (typesRaw.length) {
      const types = [];
      for (const t of typesRaw) {
        const v = normEnum(CONTACT_TYPE, t);
        if (v) types.push(v);
        else reasons.push(`Unrecognized contact_type "${t}" (ignored).`);
      }
      if (types.length) record.contact_type = types;
    }
    for (const [key, ...aliases] of [['email'], ['phone', 'telephone'], ['address'], ['notes']]) {
      const v = col(row, key, ...aliases);
      if (v) record[key] = v;
    }
    // Kennel by name â†’ existing kennel only (left blank + flagged if unknown).
    const kName = col(row, 'kennel_name', 'kennel');
    if (kName) {
      const hit = index.kennelByName.get(kName.toLowerCase());
      if (hit) record.kennel_id = hit.id;
      else reasons.push(`Kennel "${kName}" not found (left blank).`);
    }

    let status_ = 'create';
    let match = null;
    if (!name) {
      status_ = 'review';
      reasons.push('No name â€” cannot form a natural key.');
    } else {
      match = index.byName.get(name.toLowerCase()) || null;
      status_ = match ? 'update' : 'create';
    }

    const display = name || `(row ${i + 2})`;
    return {
      index: i, raw: row, entity: 'contact', display,
      record, changes: { ...record },
      status: status_, match, matchLabel: match ? match.name : '',
      reasons,
      decision: status_ === 'review' ? 'skip' : status_,
      decisionTarget: match ? match.id : null
    };
  },

  describe: (c) => (c.name || '(unnamed contact)') + (c.is_archived ? ' (archived)' : ''),

  repo: contactRepo
};

// =========================================================================
// Pairing mapping
// =========================================================================
// Natural key: sire + dam + planned_date (Stage 3 Brief §5) — all three must
// resolve/parse, or the row is keyless and goes to needs-review. Sire/dam are
// relationship columns resolved against EXISTING dogs only (Data Model §8,
// point 2); an unresolved name is flagged, never silently dropped.
const PAIRING_MAPPING = {
  entity: 'pairing',
  label: 'Pairings',
  templateHeaders: [
    'sire_registered_name', 'dam_registered_name', 'pairing_type', 'method',
    'status', 'planned_date', 'expected_due_date', 'notes'
  ],
  requiredForCreate: ['sire_id', 'dam_id', 'pairing_type', 'status'],

  async loadExisting() {
    const [pairings, dogs] = await Promise.all([
      pairingRepo.getAll({ includeArchived: true }),
      dogRepo.getAll({ includeArchived: true })
    ]);
    this._dogNames = buildDogNameIndex(dogs);
    return pairings;
  },

  buildIndex(existing) {
    const byKey = new Map();
    for (const p of existing) {
      const key = nkParts(p.sire_id, p.dam_id, p.planned_date);
      if (key) byKey.set(key, p);
    }
    return { byKey, dogNames: this._dogNames };
  },

  classify(row, index, i) {
    const reasons = [];
    const unresolved = [];
    const record = {};

    const sireName = col(row, 'sire_registered_name', 'sire_name');
    const damName = col(row, 'dam_registered_name', 'dam_name');
    let sireId = '', damId = '';
    if (sireName) {
      const hit = index.dogNames.get(sireName.toLowerCase());
      if (hit) { sireId = hit.id; record.sire_id = hit.id; }
      else unresolved.push(`Sire "${sireName}" not found`);
    }
    if (damName) {
      const hit = index.dogNames.get(damName.toLowerCase());
      if (hit) { damId = hit.id; record.dam_id = hit.id; }
      else unresolved.push(`Dam "${damName}" not found`);
    }

    const pairingType = normEnum(PAIRING_TYPE, col(row, 'pairing_type', 'type'));
    if (pairingType === null) reasons.push(`Unrecognized pairing_type "${col(row, 'pairing_type', 'type')}".`);
    else if (pairingType) record.pairing_type = pairingType;

    const method = normEnum(PAIRING_METHOD, col(row, 'method'));
    if (method === null) reasons.push(`Unrecognized method "${col(row, 'method')}" (ignored).`);
    else if (method) record.method = method;

    const status = normEnum(PAIRING_STATUS, col(row, 'status'));
    if (status === null) reasons.push(`Unrecognized status "${col(row, 'status')}".`);
    else if (status) record.status = status;

    const plannedRaw = col(row, 'planned_date');
    const planned = normDate(plannedRaw);
    if (planned === null) reasons.push(`Unrecognized planned_date "${plannedRaw}".`);
    else if (planned) record.planned_date = planned;

    const dueRaw = col(row, 'expected_due_date');
    const due = normDate(dueRaw);
    if (due === null) reasons.push(`Unrecognized expected_due_date "${dueRaw}".`);
    else if (due) record.expected_due_date = due;

    const notes = col(row, 'notes');
    if (notes) record.notes = notes;

    // Natural key → match-or-create.
    const key = (sireId && damId && planned) ? nkParts(sireId, damId, planned) : null;
    let status_ = 'create';
    let match = null;
    if (!key) {
      status_ = 'review';
      if (!sireName) reasons.push('No sire_registered_name — cannot form a natural key.');
      if (!damName) reasons.push('No dam_registered_name — cannot form a natural key.');
      if (!planned) reasons.push('No planned_date — cannot form a natural key.');
    } else {
      match = index.byKey.get(key) || null;
      status_ = match ? 'update' : 'create';
    }

    if (status_ === 'create') {
      const missing = this.requiredForCreate.filter((f) => !record[f]);
      if (missing.length) { status_ = 'review'; reasons.push(`Missing required field(s) for a new pairing: ${missing.join(', ')}.`); }
      if (record.sire_id && record.dam_id && record.sire_id === record.dam_id) {
        status_ = 'review'; reasons.push('Sire and dam cannot be the same dog.');
      }
    }
    if (unresolved.length) { if (status_ !== 'review') status_ = 'review'; reasons.push(unresolved.join('; ') + '.'); }

    const display = `${sireName || '?'} × ${damName || '?'}${planned ? ` (${planned})` : ''}`;
    return {
      index: i, raw: row, entity: 'pairing', display,
      record, changes: { ...record },
      status: status_, match, matchLabel: match ? PAIRING_MAPPING.describe(match) : '',
      reasons,
      decision: status_ === 'review' ? 'skip' : status_,
      decisionTarget: match ? match.id : null
    };
  },

  describe: (p) => `${p.pairing_type || 'Pairing'} — ${p.planned_date || 'no date'}` + (p.is_archived ? ' (archived)' : ''),

  repo: pairingRepo
};

// =========================================================================
// Litter mapping
// =========================================================================
// Natural key: dam + sire + whelp_date (Stage 3 Brief §5). Same relationship-
// column resolution rule as Pairing above.
const LITTER_MAPPING = {
  entity: 'litter',
  label: 'Litters',
  templateHeaders: [
    'dam_registered_name', 'sire_registered_name', 'whelp_date',
    'litter_registration_number', 'puppies_born_total', 'puppies_born_alive',
    'puppies_born_deceased', 'status', 'notes'
  ],
  requiredForCreate: ['dam_id', 'sire_id', 'status'],

  async loadExisting() {
    const [litters, dogs] = await Promise.all([
      litterRepo.getAll({ includeArchived: true }),
      dogRepo.getAll({ includeArchived: true })
    ]);
    this._dogNames = buildDogNameIndex(dogs);
    return litters;
  },

  buildIndex(existing) {
    const byKey = new Map();
    for (const l of existing) {
      const key = nkParts(l.dam_id, l.sire_id, l.whelp_date);
      if (key) byKey.set(key, l);
    }
    return { byKey, dogNames: this._dogNames };
  },

  classify(row, index, i) {
    const reasons = [];
    const unresolved = [];
    const record = {};

    const damName = col(row, 'dam_registered_name', 'dam_name');
    const sireName = col(row, 'sire_registered_name', 'sire_name');
    let damId = '', sireId = '';
    if (damName) {
      const hit = index.dogNames.get(damName.toLowerCase());
      if (hit) { damId = hit.id; record.dam_id = hit.id; }
      else unresolved.push(`Dam "${damName}" not found`);
    }
    if (sireName) {
      const hit = index.dogNames.get(sireName.toLowerCase());
      if (hit) { sireId = hit.id; record.sire_id = hit.id; }
      else unresolved.push(`Sire "${sireName}" not found`);
    }

    const whelpRaw = col(row, 'whelp_date');
    const whelp = normDate(whelpRaw);
    if (whelp === null) reasons.push(`Unrecognized whelp_date "${whelpRaw}".`);
    else if (whelp) record.whelp_date = whelp;

    const regNum = col(row, 'litter_registration_number', 'registration_number');
    if (regNum) record.litter_registration_number = regNum;

    for (const key of ['puppies_born_total', 'puppies_born_alive', 'puppies_born_deceased']) {
      const raw = col(row, key);
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) reasons.push(`Unrecognized ${key} "${raw}" (ignored).`);
      else record[key] = n;
    }

    const status = normEnum(LITTER_STATUS, col(row, 'status'));
    if (status === null) reasons.push(`Unrecognized status "${col(row, 'status')}".`);
    else if (status) record.status = status;

    const notes = col(row, 'notes');
    if (notes) record.notes = notes;

    // Natural key → match-or-create.
    const key = (damId && sireId && whelp) ? nkParts(damId, sireId, whelp) : null;
    let status_ = 'create';
    let match = null;
    if (!key) {
      status_ = 'review';
      if (!damName) reasons.push('No dam_registered_name — cannot form a natural key.');
      if (!sireName) reasons.push('No sire_registered_name — cannot form a natural key.');
      if (!whelp) reasons.push('No whelp_date — cannot form a natural key.');
    } else {
      match = index.byKey.get(key) || null;
      status_ = match ? 'update' : 'create';
    }

    if (status_ === 'create') {
      const missing = this.requiredForCreate.filter((f) => !record[f]);
      if (missing.length) { status_ = 'review'; reasons.push(`Missing required field(s) for a new litter: ${missing.join(', ')}.`); }
    }
    if (unresolved.length) { if (status_ !== 'review') status_ = 'review'; reasons.push(unresolved.join('; ') + '.'); }

    const display = `${damName || '?'} × ${sireName || '?'}${whelp ? ` (${whelp})` : ''}`;
    return {
      index: i, raw: row, entity: 'litter', display,
      record, changes: { ...record },
      status: status_, match, matchLabel: match ? LITTER_MAPPING.describe(match) : '',
      reasons,
      decision: status_ === 'review' ? 'skip' : status_,
      decisionTarget: match ? match.id : null
    };
  },

  describe: (l) => `Litter — ${l.whelp_date || 'no date'}` + (l.is_archived ? ' (archived)' : ''),

  repo: litterRepo
};

// =========================================================================
// Sale mapping (Stage 4)
// =========================================================================
// Natural key: dog + buyer + sale_date (Stage4 Revision v2 §6) — a dateless
// sale routes to needs-review by design (sale_date is optional on the entity,
// so this is expected, not a bug). Dog is resolved against EXISTING dogs only
// (same rule as sire/dam elsewhere). buyer_name is DIFFERENT from every other
// relationship column in this file: it resolves against Contacts, but an
// unmatched name is NOT flagged for review — it's created inline as a Contact
// (never a Buyer — there is no Buyer table, Data Model v3 §5.5) at commit time,
// via the mapping.prepareRecord hook below.
const SALE_MAPPING = {
  entity: 'sale',
  label: 'Sales',
  templateHeaders: [
    'dog_registered_name', 'buyer_name', 'sale_date', 'placement_type', 'status',
    'price', 'deposit_amount', 'deposit_date', 'balance_paid_date', 'lead_source', 'notes'
  ],
  requiredForCreate: ['dog_id', 'placement_type', 'status'],

  async loadExisting() {
    const [sales, dogs, contacts] = await Promise.all([
      saleRepo.getAll({ includeArchived: true }),
      dogRepo.getAll({ includeArchived: true }),
      contactRepo.getAll({ includeArchived: true })
    ]);
    this._dogNames = buildDogNameIndex(dogs);
    this._contactsById = new Map(contacts.map((c) => [c.id, c]));
    this._contactByName = new Map();
    for (const c of contacts) if (c.name) this._contactByName.set(c.name.trim().toLowerCase(), c);
    return sales;
  },

  buildIndex(existing) {
    const byKey = new Map();
    for (const s of existing) {
      const buyerName = (this._contactsById.get(s.buyer_contact_id)?.name || '').trim().toLowerCase();
      const key = nkParts(s.dog_id, buyerName || null, s.sale_date);
      if (key) byKey.set(key, s);
    }
    return { byKey, dogNames: this._dogNames, contactByName: this._contactByName };
  },

  classify(row, index, i) {
    const reasons = [];
    const record = {};

    const dogNameRaw = col(row, 'dog_registered_name', 'dog_name');
    let dogId = '';
    if (dogNameRaw) {
      const hit = index.dogNames.get(dogNameRaw.toLowerCase());
      if (hit) { dogId = hit.id; record.dog_id = hit.id; }
      else reasons.push(`Dog "${dogNameRaw}" not found.`);
    }

    const buyerName = col(row, 'buyer_name', 'buyer');
    let buyerNameKey = '';
    let toCreateBuyer = '';
    if (buyerName) {
      buyerNameKey = buyerName.trim().toLowerCase();
      const hit = index.contactByName.get(buyerNameKey);
      if (hit) record.buyer_contact_id = hit.id;
      else toCreateBuyer = buyerName.trim(); // created inline on commit — never flagged
    }

    const placementType = normEnum(PLACEMENT_TYPE, col(row, 'placement_type', 'placement'));
    if (placementType === null) reasons.push(`Unrecognized placement_type "${col(row, 'placement_type', 'placement')}".`);
    else if (placementType) record.placement_type = placementType;

    const status = normEnum(SALE_STATUS, col(row, 'status'));
    if (status === null) reasons.push(`Unrecognized status "${col(row, 'status')}".`);
    else if (status) record.status = status;

    const saleRaw = col(row, 'sale_date');
    const saleDate = normDate(saleRaw);
    if (saleDate === null) reasons.push(`Unrecognized sale_date "${saleRaw}".`);
    else if (saleDate) record.sale_date = saleDate;

    for (const [key, ...aliases] of [
      ['deposit_amount'], ['price'], ['lead_source'], ['notes']
    ]) {
      const v = col(row, key, ...aliases);
      if (v) record[key] = key === 'price' || key === 'deposit_amount' ? Number(v) : v;
    }
    for (const key of ['deposit_date', 'balance_paid_date']) {
      const raw = col(row, key);
      const d = normDate(raw);
      if (d === null && raw) reasons.push(`Unrecognized ${key} "${raw}" (ignored).`);
      else if (d) record[key] = d;
    }

    // Natural key → match-or-create. Uses the buyer NAME (not id) so a
    // not-yet-created buyer still matches consistently within this import.
    const key = (dogId && buyerNameKey && saleDate) ? nkParts(dogId, buyerNameKey, saleDate) : null;
    let status_ = 'create';
    let match = null;
    if (!key) {
      status_ = 'review';
      if (!dogNameRaw) reasons.push('No dog_registered_name — cannot form a natural key.');
      if (!buyerName) reasons.push('No buyer_name — cannot form a natural key.');
      if (!saleDate) reasons.push('No sale_date — cannot form a natural key.');
    } else {
      match = index.byKey.get(key) || null;
      status_ = match ? 'update' : 'create';
    }

    if (status_ === 'create') {
      const missing = this.requiredForCreate.filter((f) => !record[f]);
      if (missing.length) { status_ = 'review'; reasons.push(`Missing required field(s) for a new sale: ${missing.join(', ')}.`); }
    }
    if (!dogId && dogNameRaw) status_ = 'review'; // unresolved dog is always flagged, unlike buyer
    if (toCreateBuyer) reasons.push(`Buyer "${toCreateBuyer}" not found — will be created as a new Contact.`);

    const display = `${dogNameRaw || '?'} → ${buyerName || '?'}${saleDate ? ` (${saleDate})` : ''}`;
    return {
      index: i, raw: row, entity: 'sale', display,
      record, changes: { ...record },
      status: status_, match, matchLabel: match ? SALE_MAPPING.describe(match) : '',
      reasons,
      decision: status_ === 'review' ? 'skip' : status_,
      decisionTarget: match ? match.id : null,
      _buyerNameToCreate: toCreateBuyer || null
    };
  },

  // Runs just before commit writes the row (create or update). The one place a
  // Sale row differs from every other mapping: an unmatched buyer_name becomes
  // a real Contact here, never a silent drop and never a "needs review" stall.
  async prepareRecord(r) {
    if (!r._buyerNameToCreate) return;
    const contact = await contactRepo.create({ name: r._buyerNameToCreate, contact_type: ['buyer'] });
    r.record.buyer_contact_id = contact.id;
    r.changes.buyer_contact_id = contact.id;
  },

  describe: (s) => `Sale — ${s.sale_date || 'no date'}` + (s.is_archived ? ' (archived)' : ''),

  repo: saleRepo
};

// =========================================================================
// Event mapping (Stage4.5 Addendum §A1.1) — dog-subject only
// =========================================================================
// Natural key: dog + event_type + event_date, title as a tiebreak on collision
// (multiple existing events sharing that same dog/type/date). Pairing/litter
// subject events are out of scope for this importer (Data Model §8's worked
// example is dog-only; subject resolution for those has no registered-name key
// — flagged as a future item, not half-built here).
const EVENT_MAPPING = {
  entity: 'event',
  label: 'Events',
  templateHeaders: [
    'dog_registered_name', 'event_type', 'event_date', 'event_end_date', 'title',
    'related_contact_name', 'details_json', 'notes'
  ],
  requiredForCreate: ['subject_id', 'event_type', 'event_date', 'title'],

  async loadExisting() {
    const [events, dogs, contacts] = await Promise.all([
      HistoryEvent.getAll({ includeArchived: true }),
      dogRepo.getAll({ includeArchived: true }),
      contactRepo.getAll({ includeArchived: true })
    ]);
    this._dogNames = buildDogNameIndex(dogs);
    this._contactByName = new Map();
    for (const c of contacts) if (c.name) this._contactByName.set(c.name.trim().toLowerCase(), c);
    return events.filter((e) => e.subject_type === 'dog');
  },

  buildIndex(existing) {
    // Multiple events can legitimately share dog+type+date (e.g. two vaccines
    // logged same day) — the key maps to an ARRAY, resolved by title below.
    const byKey = new Map();
    for (const e of existing) {
      const key = nkParts(e.subject_id, e.event_type, e.event_date);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(e);
    }
    return { byKey, dogNames: this._dogNames, contactByName: this._contactByName };
  },

  classify(row, index, i) {
    const reasons = [];
    const record = { subject_type: 'dog' };

    const dogNameRaw = col(row, 'dog_registered_name', 'dog_name');
    let dogId = '';
    if (dogNameRaw) {
      const hit = index.dogNames.get(dogNameRaw.toLowerCase());
      if (hit) { dogId = hit.id; record.subject_id = hit.id; }
      else reasons.push(`Dog "${dogNameRaw}" not found.`);
    }

    const eventTypeRaw = col(row, 'event_type', 'type');
    const eventType = normEnum(eventTypesFor('dog'), eventTypeRaw);
    if (eventType === null) reasons.push(`Unrecognized event_type "${eventTypeRaw}" for a dog-subject event.`);
    else if (eventType) record.event_type = eventType;

    const dateRaw = col(row, 'event_date');
    const eventDate = normDate(dateRaw);
    if (eventDate === null) reasons.push(`Unrecognized event_date "${dateRaw}".`);
    else if (eventDate) record.event_date = eventDate;

    const endRaw = col(row, 'event_end_date');
    const eventEnd = normDate(endRaw);
    if (eventEnd === null && endRaw) reasons.push(`Unrecognized event_end_date "${endRaw}" (ignored).`);
    else if (eventEnd) record.event_end_date = eventEnd;

    const title = col(row, 'title');
    if (title) record.title = title;

    const relatedName = col(row, 'related_contact_name');
    if (relatedName) {
      const hit = index.contactByName.get(relatedName.toLowerCase());
      if (hit) record.related_contact_id = hit.id;
      else reasons.push(`Related contact "${relatedName}" not found — leave the CSV column blank or add the contact first (never auto-created).`);
    }

    const detailsRaw = col(row, 'details_json');
    let detailsError = false;
    if (detailsRaw) {
      try {
        const parsed = JSON.parse(detailsRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record.details = parsed;
        else { detailsError = true; reasons.push(`details_json is not a JSON object: "${detailsRaw}".`); }
      } catch (e) {
        detailsError = true;
        reasons.push(`Malformed details_json: ${e.message}.`);
      }
    } else {
      record.details = {};
    }

    const notes = col(row, 'notes');
    if (notes) record.notes = notes;

    // Natural key → match-or-create; title is the tiebreak when dog+type+date
    // collides across more than one existing event.
    const key = (dogId && eventType && eventDate) ? nkParts(dogId, eventType, eventDate) : null;
    let status_ = 'create';
    let match = null;
    if (!key) {
      status_ = 'review';
      if (!dogNameRaw) reasons.push('No dog_registered_name — cannot form a natural key.');
      if (!eventTypeRaw) reasons.push('No event_type — cannot form a natural key.');
      if (!dateRaw) reasons.push('No event_date — cannot form a natural key.');
    } else {
      const candidates = index.byKey.get(key) || [];
      if (candidates.length === 0) {
        status_ = 'create';
      } else if (candidates.length === 1) {
        match = candidates[0];
        status_ = 'update';
      } else {
        const titleMatches = title
          ? candidates.filter((c) => (c.title || '').trim().toLowerCase() === title.trim().toLowerCase())
          : [];
        if (titleMatches.length === 1) {
          match = titleMatches[0];
          status_ = 'update';
        } else {
          status_ = 'review';
          match = candidates[0];
          reasons.push('Multiple existing events share this dog + type + date, and the title didn\'t uniquely resolve which one to update — choose "Update match" and pick the right one, or create a new one.');
        }
      }
    }

    if (status_ === 'create') {
      const missing = this.requiredForCreate.filter((f) => !record[f]);
      if (missing.length) { status_ = 'review'; reasons.push(`Missing required field(s) for a new event: ${missing.join(', ')}.`); }
    }
    if (!dogId && dogNameRaw) status_ = 'review'; // unresolved dog is always flagged, never auto-created
    if (relatedName && !record.related_contact_id) status_ = 'review'; // unresolved contact is always flagged, never auto-created
    if (detailsError) status_ = 'review';

    const display = `${dogNameRaw || '?'} — ${eventTypeRaw || '?'}${eventDate ? ` (${eventDate})` : ''}`;
    return {
      index: i, raw: row, entity: 'event', display,
      record, changes: { ...record },
      status: status_, match, matchLabel: match ? EVENT_MAPPING.describe(match) : '',
      reasons,
      decision: status_ === 'review' ? 'skip' : status_,
      decisionTarget: match ? match.id : null
    };
  },

  describe: (e) => `${descriptorLabel(eventTypesFor('dog'), e.event_type)} — ${e.event_date || 'no date'}${e.title ? `: ${e.title}` : ''}` + (e.is_archived ? ' (archived)' : ''),

  repo: HistoryEvent
};

// Small local helper so EVENT_MAPPING.describe doesn't need to import the
// shared `descriptor()` (would require pulling in badge/label plumbing it
// doesn't otherwise need) — just the label lookup.
function descriptorLabel(vocab, value) {
  return vocab.find((v) => v.value === value)?.label || value || 'Event';
}

// =========================================================================
// StudService mapping (Stage4.5 Addendum §A1.2)
// =========================================================================
// Natural-key wrinkle, stated plainly: StudService has no date field, so its
// natural key is our_dog + partner_dog + direction — which collapses REPEAT
// arrangements between the same pair. Rather than silently overwrite, any
// existing match is always routed to needs-review as an ambiguous match (the
// user decides update-vs-create), never auto-treated as an update.
const STUD_SERVICE_MAPPING = {
  entity: 'stud_service',
  label: 'Stud Services',
  templateHeaders: [
    'direction', 'our_dog_registered_name', 'partner_dog_registered_name',
    'partner_contact_name', 'fee_amount', 'fee_structure', 'status', 'result_notes'
  ],
  requiredForCreate: ['direction', 'our_dog_id', 'partner_dog_id', 'partner_contact_id', 'status'],

  async loadExisting() {
    const [studServices, dogs, contacts] = await Promise.all([
      studServiceRepo.getAll({ includeArchived: true }),
      dogRepo.getAll({ includeArchived: true }),
      contactRepo.getAll({ includeArchived: true })
    ]);
    this._dogNames = buildDogNameIndex(dogs);
    this._dogsById = new Map(dogs.map((d) => [d.id, d]));
    this._contactByName = new Map();
    for (const c of contacts) if (c.name) this._contactByName.set(c.name.trim().toLowerCase(), c);
    return studServices;
  },

  buildIndex(existing) {
    const byKey = new Map();
    for (const s of existing) {
      const key = nkParts(s.our_dog_id, s.partner_dog_id, s.direction);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(s);
    }
    return { byKey, dogNames: this._dogNames, contactByName: this._contactByName, dogsById: this._dogsById };
  },

  classify(row, index, i) {
    const reasons = [];
    const record = {};

    const direction = normEnum(STUD_SERVICE_DIRECTION, col(row, 'direction'));
    if (direction === null) reasons.push(`Unrecognized direction "${col(row, 'direction')}".`);
    else if (direction) record.direction = direction;

    const ourDogName = col(row, 'our_dog_registered_name', 'our_dog_name');
    let ourDogId = '';
    if (ourDogName) {
      const hit = index.dogNames.get(ourDogName.toLowerCase());
      if (hit) { ourDogId = hit.id; record.our_dog_id = hit.id; }
      else reasons.push(`Our dog "${ourDogName}" not found.`);
    }

    const partnerDogName = col(row, 'partner_dog_registered_name', 'partner_dog_name');
    let partnerDogId = '';
    if (partnerDogName) {
      const hit = index.dogNames.get(partnerDogName.toLowerCase());
      if (hit) { partnerDogId = hit.id; record.partner_dog_id = hit.id; }
      else reasons.push(`Partner dog "${partnerDogName}" not found — add it (even as an external reference) before importing, or it can be created inline from the Stud Service Detail screen.`);
    }

    const partnerContactName = col(row, 'partner_contact_name');
    let toCreateContact = '';
    if (partnerContactName) {
      const hit = index.contactByName.get(partnerContactName.trim().toLowerCase());
      if (hit) record.partner_contact_id = hit.id;
      else toCreateContact = partnerContactName.trim(); // created inline on commit — never flagged
    }

    const feeRaw = col(row, 'fee_amount');
    if (feeRaw !== '') {
      const n = Number(feeRaw);
      if (!Number.isFinite(n)) reasons.push(`Unrecognized fee_amount "${feeRaw}" (ignored).`);
      else record.fee_amount = n;
    }

    const feeStructure = normEnum(FEE_STRUCTURE, col(row, 'fee_structure'));
    if (feeStructure === null) reasons.push(`Unrecognized fee_structure "${col(row, 'fee_structure')}" (ignored).`);
    else if (feeStructure) record.fee_structure = feeStructure;

    const status = normEnum(STUD_SERVICE_STATUS, col(row, 'status'));
    if (status === null) reasons.push(`Unrecognized status "${col(row, 'status')}".`);
    else if (status) record.status = status;

    const resultNotes = col(row, 'result_notes');
    if (resultNotes) record.result_notes = resultNotes;

    // pairing_id is deliberately never set via CSV (Addendum §A1.2) — link it
    // later from the Stud Service Detail screen.

    const key = (ourDogId && partnerDogId && direction) ? nkParts(ourDogId, partnerDogId, direction) : null;
    let status_ = 'create';
    let match = null;
    if (!key) {
      status_ = 'review';
      if (!ourDogName) reasons.push('No our_dog_registered_name — cannot form a natural key.');
      if (!partnerDogName) reasons.push('No partner_dog_registered_name — cannot form a natural key.');
      if (!direction) reasons.push('No direction — cannot form a natural key.');
    } else {
      const candidates = index.byKey.get(key) || [];
      if (candidates.length === 0) {
        status_ = 'create';
      } else {
        // Always ambiguous — a repeat arrangement is indistinguishable from an
        // update of the existing one by key alone (Addendum §A1.2). Surface it,
        // don't guess: the user picks "Update match" (and which one) or "Create new".
        status_ = 'review';
        match = candidates[0];
        reasons.push('An existing stud service already matches this dog pair + direction. Is this an update to that arrangement, or a new repeat service? Choose "Update match" (pick the right one if more than one exists) or "Create new".');
      }
    }

    if (status_ === 'create') {
      const missing = this.requiredForCreate.filter((f) => !record[f]);
      if (missing.length) { status_ = 'review'; reasons.push(`Missing required field(s) for a new stud service: ${missing.join(', ')}.`); }
    }
    if (!ourDogId && ourDogName) status_ = 'review';
    if (!partnerDogId && partnerDogName) status_ = 'review';
    if (toCreateContact) reasons.push(`Partner contact "${toCreateContact}" not found — will be created as a new Contact.`);

    const display = `${ourDogName || '?'} × ${partnerDogName || '?'}${direction ? ` (${direction})` : ''}`;
    return {
      index: i, raw: row, entity: 'stud_service', display,
      record, changes: { ...record },
      status: status_, match, matchLabel: match ? STUD_SERVICE_MAPPING.describe(match) : '',
      reasons,
      decision: status_ === 'review' ? 'skip' : status_,
      decisionTarget: match ? match.id : null,
      _partnerContactNameToCreate: toCreateContact || null
    };
  },

  // The one auto-create in this mapping, mirroring the Sale buyer_name
  // exception (Addendum §A1.2) — an unmatched partner contact becomes a real
  // Contact here, never a silent drop and never a "needs review" stall.
  async prepareRecord(r) {
    if (!r._partnerContactNameToCreate) return;
    const contact = await contactRepo.create({ name: r._partnerContactNameToCreate, contact_type: ['breeder'] });
    r.record.partner_contact_id = contact.id;
    r.changes.partner_contact_id = contact.id;
  },

  describe(s) {
    const ours = this._dogsById?.get(s.our_dog_id);
    const partner = this._dogsById?.get(s.partner_dog_id);
    return `${ours?.call_name || '—'} × ${partner?.call_name || '—'} (${s.direction || '?'})` + (s.is_archived ? ' (archived)' : '');
  },

  repo: studServiceRepo
};

const MAPPINGS = {
  dog: DOG_MAPPING, contact: CONTACT_MAPPING, pairing: PAIRING_MAPPING, litter: LITTER_MAPPING,
  sale: SALE_MAPPING, event: EVENT_MAPPING, stud_service: STUD_SERVICE_MAPPING
};

export function getMapping(entity) {
  const m = MAPPINGS[entity];
  if (!m) throw new Error(`Unknown import entity "${entity}".`);
  return m;
}

// --- Dry-run plan ---------------------------------------------------------
// Classify every row against current records. Returns { rows, summary }.
export async function buildPlan(entity, rows) {
  const mapping = getMapping(entity);
  const existing = await mapping.loadExisting();
  const index = mapping.buildIndex(existing);
  const plan = rows.map((row, i) => mapping.classify(row, index, i));
  return { rows: plan, summary: summarize(plan), existing };
}

export function summarize(plan) {
  const s = { create: 0, update: 0, review: 0, skip: 0 };
  for (const r of plan) {
    s[r.status] = (s[r.status] || 0) + 1;
  }
  return s;
}

// --- Commit ---------------------------------------------------------------
// Applies each row's *decision* (create / update / skip). Rows are independent:
// one failure is recorded and the rest still import.
export async function commitPlan(entity, plan) {
  const mapping = getMapping(entity);
  const result = { created: 0, updated: 0, skipped: 0, failed: [] };
  for (const r of plan) {
    try {
      // Optional per-mapping hook: mutate r.record/r.changes just before the
      // write (Sale uses this to create an unmatched buyer as a Contact inline
      // — the one place a relationship column isn't resolve-or-review).
      if (mapping.prepareRecord) await mapping.prepareRecord(r);
      if (r.decision === 'create') {
        await mapping.repo.create(r.record);
        result.created++;
      } else if (r.decision === 'update') {
        const id = r.decisionTarget || r.match?.id;
        if (!id) throw new Error('No target record to update.');
        await mapping.repo.update(id, r.changes);
        result.updated++;
      } else {
        result.skipped++;
      }
    } catch (e) {
      result.failed.push({ index: r.index, display: r.display, message: e.message || String(e) });
    }
  }
  return result;
}
