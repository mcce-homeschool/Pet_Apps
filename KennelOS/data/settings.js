// settings.js — tiny localStorage-backed settings store. This is the small,
// synchronous "UI prefs / last backup date" use case that localStorage is
// genuinely right for (Build Brief A3) — records live in IndexedDB, not here.

const KEYS = {
  lastBackupDate: 'kennelOS.lastBackupDate',
  persistRequested: 'kennelOS.persistRequested',
  sampleDataManifest: 'kennelOS.sampleDataManifest',
  sampleDataCleared: 'kennelOS.sampleDataCleared',
  myKennelId: 'kennelOS.myKennelId',
  myContactId: 'kennelOS.myContactId',
  myKennelSetupSkipped: 'kennelOS.myKennelSetupSkipped',
  companion: 'kennelOS.companion',
  expensesMigrated: 'kennelOS.expensesMigrated'
};

export function getLastBackupDate() {
  return localStorage.getItem(KEYS.lastBackupDate); // ISO string or null
}

export function setLastBackupDate(iso = new Date().toISOString()) {
  localStorage.setItem(KEYS.lastBackupDate, iso);
  return iso;
}

export function wasPersistRequested() {
  return localStorage.getItem(KEYS.persistRequested) === '1';
}

export function markPersistRequested() {
  localStorage.setItem(KEYS.persistRequested, '1');
}

// Sample-data manifest — the record of which IDs were created by the demo
// seed, so they can be found again for a clean bulk delete (see sampleData.js).
export function getSampleDataManifest() {
  const raw = localStorage.getItem(KEYS.sampleDataManifest);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSampleDataManifest(manifest) {
  localStorage.setItem(KEYS.sampleDataManifest, JSON.stringify(manifest));
}

export function removeSampleDataManifest() {
  localStorage.removeItem(KEYS.sampleDataManifest);
}

export function wasSampleDataCleared() {
  return localStorage.getItem(KEYS.sampleDataCleared) === '1';
}

export function markSampleDataCleared() {
  localStorage.setItem(KEYS.sampleDataCleared, '1');
}

// "My kennel" identity — the real Kennel/Contact created by the kennel-setup
// wizard (see kennelSetup.js). Stored as ids, not copied strings, so renaming
// either record later (e.g. from the Kennels page) stays the single source of
// truth; settings just remembers which records they are.
export function getMyKennelId() {
  return localStorage.getItem(KEYS.myKennelId);
}

export function setMyKennelId(id) {
  localStorage.setItem(KEYS.myKennelId, id);
}

export function getMyContactId() {
  return localStorage.getItem(KEYS.myContactId);
}

export function setMyContactId(id) {
  localStorage.setItem(KEYS.myContactId, id);
}

export function wasMyKennelSetupSkipped() {
  return localStorage.getItem(KEYS.myKennelSetupSkipped) === '1';
}

export function markMyKennelSetupSkipped() {
  localStorage.setItem(KEYS.myKennelSetupSkipped, '1');
}

// --- Companion messaging (per recipient type) ------------------------------
// The Companion feature's Layer-1 config: kennel identity + intro/announcement
// copy, one set per bundle type, edited in the Companion Messaging console and
// copied into every built bundle so header/landing text updates without touching
// the shell. App-level UI config, so it lives here (localStorage), never in
// IndexedDB — consistent with "nothing app-level goes in IndexedDB." The Layer-2
// per-recipient override is Contact.companion_note (a real record field).
export const COMPANION_TYPES = ['prospective', 'family', 'partner'];

const COMPANION_TYPE_LABELS = {
  prospective: 'Prospective families',
  family: 'Current families',
  partner: 'Partners'
};

const COMPANION_DEFAULTS = {
  prospective: {
    kennelName: '', tagline: '', announcement: '',
    introText: 'A peek at the puppies we have available right now. This is a snapshot as of the last link I sent — I’ll send a fresh link when things change. There’s no live sync.'
  },
  family: {
    kennelName: '', tagline: '', announcement: '',
    introText: 'This shows your puppy’s info as of the last link I sent. I’ll send a new link whenever anything changes — there’s no live sync.'
  },
  partner: {
    kennelName: '', tagline: '', announcement: '',
    introText: 'A summary of our arrangement as of the last link I sent. I’ll send a new link when anything changes — there’s no live sync.'
  }
};

export function companionTypeLabel(type) {
  return COMPANION_TYPE_LABELS[type] || type;
}

function readCompanionStore() {
  const raw = localStorage.getItem(KEYS.companion);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

// Merged with defaults so a caller always gets every field, even before the
// owner has saved anything.
export function getCompanionSettings(type) {
  const stored = readCompanionStore()[type] || {};
  return { ...(COMPANION_DEFAULTS[type] || {}), ...stored };
}

export function getAllCompanionSettings() {
  const out = {};
  for (const t of COMPANION_TYPES) out[t] = getCompanionSettings(t);
  return out;
}

export function setCompanionSettings(type, values) {
  const store = readCompanionStore();
  store[type] = { ...(store[type] || {}), ...values };
  localStorage.setItem(KEYS.companion, JSON.stringify(store));
  return getCompanionSettings(type);
}

// Financials migration flag — set once the one-time Event.cost → Expense fold
// has run (expenseRepo.migrateEventCosts). Cleared by Reset App along with every
// other key, after which the migration re-runs harmlessly (no event has a cost).
export function getExpensesMigrated() {
  return localStorage.getItem(KEYS.expensesMigrated) === '1';
}

export function markExpensesMigrated() {
  localStorage.setItem(KEYS.expensesMigrated, '1');
}

// Full app reset (Reset App to Start): drop every key this app owns in
// localStorage, so the next load has no memory of sample data, kennel setup,
// or backup history — same blank slate as a browser that's never visited.
export function clearAllSettings() {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key);
}
