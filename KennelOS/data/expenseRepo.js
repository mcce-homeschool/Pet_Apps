// expenseRepo.js — all Dexie access for the Expense (Financials) ledger, the
// single home for money spent across the program. An Expense is polymorphic like
// an Event: subject_type ∈ {dog, litter, pairing, kennel} + subject_id say what
// the cost attaches to (kennel-wide overhead lives on subject_type='kennel').
//
// The event↔cost link is one-directional and canonical: a cost entered on the
// event form is written HERE carrying `event_id`; the event/timeline read it back
// via getByEvent (Event stores no `cost` field of its own). The reverse — "log an
// event from a ledger row" — is a UI deep-link, not a stored back-pointer.
//
// Expenses are leaf records (nothing points at an Expense), so hardDelete is
// always allowed; its own FKs (event_id, subject_id) are guarded on their targets
// via referenceRegistry.js.
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { EXPENSE_REFERENCES } from './referenceRegistry.js';
import { EXPENSE_SUBJECT_TYPES, defaultExpenseCategoryFor } from './vocab.js';
import { getExpensesMigrated, markExpensesMigrated } from './settings.js';

const base = makeRepo('expenses', EXPENSE_REFERENCES);

const SUBJECT_TYPES = EXPENSE_SUBJECT_TYPES.map((s) => s.value);

function validateExpense(candidate) {
  if (!SUBJECT_TYPES.includes(candidate.subject_type)) {
    throw new Error(`Expense: subject_type must be one of ${SUBJECT_TYPES.join(', ')}.`);
  }
  if (candidate.subject_id == null || candidate.subject_id === '') {
    throw new Error('Expense: "subject_id" is required.');
  }
  if (!candidate.expense_date) {
    throw new Error('Expense: "expense_date" is required.');
  }
  const n = Number(candidate.amount);
  if (candidate.amount == null || candidate.amount === '' || !Number.isFinite(n)) {
    throw new Error('Expense: "amount" must be a number.');
  }
  if (n < 0) throw new Error('Expense: "amount" cannot be negative.');
}

// Normalize the money/category fields the same way on create and update, so a
// row is always stored with a real Number amount and a category (never blank).
function normalize(data) {
  return {
    ...data,
    amount: Number(data.amount),
    category: data.category || 'other',
    event_id: data.event_id || null
  };
}

export const expenseRepo = {
  ...base,

  async create(data) {
    validateExpense(data);
    return base.create(normalize(data));
  },

  async update(id, changes) {
    const existing = await db.expenses.get(id);
    if (!existing) throw new Error(`expenses: no record with id ${id}`);
    const merged = normalize({ ...existing, ...changes });
    validateExpense(merged);
    return base.update(id, merged);
  },

  // Every expense attached to one subject (a dog / litter / pairing / kennel),
  // newest first. Uses the [subject_type+subject_id] compound index.
  async getForSubject(subjectType, subjectId, { includeArchived = false } = {}) {
    const rows = await db.expenses
      .where('[subject_type+subject_id]')
      .equals([subjectType, subjectId])
      .toArray();
    const visible = includeArchived ? rows : rows.filter((r) => !r.is_archived);
    return visible.sort((a, b) => {
      if (a.expense_date !== b.expense_date) return a.expense_date < b.expense_date ? 1 : -1;
      return (a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1;
    });
  },

  // The cost(s) captured from a given event — the reverse of the canonical
  // expenses.event_id link. Normally 0 or 1; returns an array either way.
  async getByEvent(eventId, { includeArchived = false } = {}) {
    const rows = await db.expenses.where('event_id').equals(eventId).toArray();
    return includeArchived ? rows : rows.filter((r) => !r.is_archived);
  },

  // Convenience for the event form: the single active linked expense, or null.
  async getOneByEvent(eventId) {
    const rows = await expenseRepo.getByEvent(eventId);
    return rows[0] || null;
  },

  // Sum of a set of expenses' amounts (active rows only unless includeArchived
  // was used to load them). A tiny pure helper the panels/report reuse.
  total(rows) {
    return rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  },

  // One-time migration: fold every legacy Event.cost value into the ledger as a
  // linked Expense, then clear the field. Idempotent and guarded by a settings
  // flag, so it runs at most once and is a no-op after Reset App (no event has a
  // cost then). Safe to call on every boot.
  async migrateEventCosts() {
    if (getExpensesMigrated()) return;
    const events = await db.events.toArray();
    for (const ev of events) {
      if (ev.cost == null || ev.cost === '') continue;
      const amount = Number(ev.cost);
      // Skip if a linked expense already exists (double-run protection) or the
      // stored value isn't a real number.
      if (!Number.isFinite(amount)) { await db.events.update(ev.id, { cost: null }); continue; }
      const already = await db.expenses.where('event_id').equals(ev.id).count();
      if (already === 0) {
        await base.create({
          event_id: ev.id,
          subject_type: ev.subject_type,
          subject_id: ev.subject_id,
          amount,
          category: defaultExpenseCategoryFor(ev.event_type),
          expense_date: ev.event_date,
          vendor: '',
          notes: ''
        });
      }
      await db.events.update(ev.id, { cost: null });
    }
    markExpensesMigrated();
  }
};

export { ReferenceBlockedError } from './repoBase.js';
