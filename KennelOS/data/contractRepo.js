// contractRepo.js — all Dexie access for the Contract table. Generic enough to
// cover sale, stud service, co-ownership, and lease agreements — one table
// instead of four (Data Model v3 §5.7). A LEAF entity: nothing points at a
// Contract, so it is always hard-deletable (CONTRACT_REFERENCES is empty).
//
// Owns all three canonical links: related_sale_id, related_stud_service_id, and
// related_dog_id (the last for lease/co_own/other, where no linked Sale/StudService
// already supplies the dog). "Linking" a contract is a single write here — there
// is no reverse field on Dog/Sale/StudService to keep in sync (Stage4 Revision v2
// §5), but a linked Dog is added to DOG_REFERENCES so it can't be hard-deleted
// out from under a documented contract.
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { CONTRACT_REFERENCES } from './referenceRegistry.js';

const base = makeRepo('contracts', CONTRACT_REFERENCES);

const REQUIRED_FIELDS = ['contract_type'];

// Types with no linked Sale/StudService to reach a dog through — these are the
// only types related_dog_id is meaningful for. Canonical here (not just in the
// page) so create/update can normalize it regardless of caller.
export const DOG_LINK_TYPES = ['lease', 'co_own', 'other'];

function validateContract(candidate) {
  for (const f of REQUIRED_FIELDS) {
    if (candidate[f] == null || candidate[f] === '') {
      throw new Error(`Contract: "${f}" is required.`);
    }
  }
  // status is not a locked state machine (Stage4 Revision v2 §7) — any type can
  // be any status, moves in any direction, no confirmation dialogs here.
}

// related_dog_id only applies to DOG_LINK_TYPES — force it null otherwise so a
// stray dog link left over from an in-progress type change (e.g. lease -> sale)
// never persists and never surfaces on that dog's derived Contracts panel.
function normalizeDogLink(candidate) {
  if (!DOG_LINK_TYPES.includes(candidate.contract_type)) candidate.related_dog_id = null;
  return candidate;
}

export const contractRepo = {
  ...base,

  async create(data) {
    const record = normalizeDogLink({ status: 'draft', ...data });
    validateContract(record);
    return base.create(record);
  },

  async update(id, changes) {
    const existing = await db.contracts.get(id);
    if (!existing) throw new Error(`contracts: no record with id ${id}`);
    const merged = normalizeDogLink({ ...existing, ...changes });
    validateContract(merged);
    return base.update(id, { ...changes, related_dog_id: merged.related_dog_id });
  },

  // Derived reverse lookups — the sale/stud-service side never stores a pointer
  // back to its contract(s); this is the query that replaces it. Permits more
  // than one contract per sale/stud-service by design (e.g. sale + addendum).
  getBySale(saleId) {
    return db.contracts.where('related_sale_id').equals(saleId).toArray();
  },

  getByStudService(studServiceId) {
    return db.contracts.where('related_stud_service_id').equals(studServiceId).toArray();
  },

  getByDog(dogId) {
    return db.contracts.where('related_dog_id').equals(dogId).toArray();
  },

  // "The live contract" of a sale/stud-service — a derived rule, never a stored
  // flag (Stage4 Revision v2 §7): the most recent `signed` contract by
  // signed_date (falling back to created_at), or null if none is signed.
  governingContract(contracts) {
    const signed = contracts.filter((c) => c.status === 'signed');
    if (!signed.length) return null;
    return signed.slice().sort((a, b) =>
      (b.signed_date || b.created_at || '').localeCompare(a.signed_date || a.created_at || '')
    )[0];
  }
};

export { ReferenceBlockedError } from './repoBase.js';
