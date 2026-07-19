// companionExport.js — the Companion feature's allow-list bundle builder.
//
// THE LOAD-BEARING SECURITY INVARIANT of this feature. importExport.js
// deliberately iterates whatever tables exist (a full backup); this module does
// the EXACT OPPOSITE. Each builder constructs a fresh object naming every field
// explicitly and copies ONLY the listed fields. Hard rules (checked in review):
//   - No object spread of a record ({...dog}), no Object.assign from a record,
//     no "take the record and delete the private keys."
//   - Reads go through repos, never db.<table> directly (layering rule).
//   - No second family's data, no internal notes, no freeform Event.notes, no
//     lead/source fields. Money is limited to the recipient's OWN figures:
//     a prospect sees the litter's per-sex list price + deposit; a family sees
//     their own sale price/deposit/balance; a partner sees the one stud
//     fee_amount. (The prospective "NO price" rule was reversed by owner
//     decision — see the Companion Packages Enhancement Brief, decision 1.)
//   - A new field added to a source table does NOT appear in a bundle until
//     someone adds it here by name. Silence is the safe default.
// After building, assertOnlyKeys() runs a POSITIVE allow-list check (not a
// deny-list): if any unexpected top-level key is present, the send is aborted.
// Enrichment nested inside an allowed top-level key (a pup, a litter, a stud
// service) is safe as long as the top-level allow-lists stay exact and every
// nested field is likewise copied BY NAME.
//
// All three bundles are anchored on a Contact (the recipient) and discriminated
// by bundleType. Money is the app's native decimal, never cents — the shell
// formats it. Bundle evolution is additive; COMPANION_BUNDLE_VERSION bumps only
// on a breaking shape change.
import { dogRepo } from './dogRepo.js';
import { saleRepo } from './saleRepo.js';
import { contactRepo } from './contactRepo.js';
import { contractRepo } from './contractRepo.js';
import { studServiceRepo } from './studServiceRepo.js';
import { eventRepo } from './eventRepo.js';
import { pairingRepo } from './pairingRepo.js';
import { litterRepo } from './litterRepo.js';
import { getCompanionSettings } from './settings.js';

export const COMPANION_BUNDLE_VERSION = 1;

const FEE_STRUCTURES_WITH_PICK = ['pick_of_litter', 'flat_plus_pick'];
const EXTERNAL_OWNERSHIP = ['external', 'leased_in'];

// Curated per-type detail surfaced in a family's event history (brief decision
// 4 — a scoped relaxation of the "fixed type label only" rule). One safe field
// per type, never the freeform top-level notes, never illness/injury/evaluation
// or any other type not listed here.
const FAMILY_EVENT_TYPES = ['vaccination', 'preventative', 'weight_check', 'milestone', 'note'];

function nonEmpty(v) {
  return v != null && v !== '' ? v : null;
}

function dogMini(d) {
  return d ? { name: d.call_name || '', breed: d.breed || '' } : null;
}

// Parent identity for a family's parentage line — call + registered name only.
function parentName(d) {
  return d ? { registeredName: d.registered_name || '', callName: d.call_name || '' } : null;
}

// Completed breed-specific / health tests for a dog, projected to {name, result}
// and surfaced only when the result/rating is non-empty. Returns [] when nothing
// qualifies so callers omit the block entirely (no placeholder). Reads through
// eventRepo, never db.*.
async function completedTests(dogId) {
  const events = await eventRepo.getForSubject('dog', dogId);
  const out = [];
  for (const e of events) {
    const d = e.details || {};
    if (e.event_type === 'breed_specific_test' && nonEmpty(d.result) != null) {
      out.push({ name: d.test_name || '', result: d.result });
    } else if (e.event_type === 'ofa_pennhip' && nonEmpty(d.rating) != null) {
      out.push({ name: d.joint || '', result: d.rating });
    } else if (e.event_type === 'genetic_test' && nonEmpty(d.result) != null) {
      out.push({ name: d.panel_name || '', result: d.result });
    }
  }
  return out;
}

// Richer public projection of a dog than dogMini — registered/AKC name, call
// name, a photos link, and completed tests. Named copy only, no record spread.
async function dogCard(dog) {
  if (!dog) return null;
  return {
    registeredName: dog.registered_name || '',
    callName: dog.call_name || '',
    photosUrl: dog.url || '',
    tests: await completedTests(dog.id)
  };
}

// Whole weeks + trailing days between a YYYY-MM-DD birth date and an as-of
// calendar date. Ships the derived age, never the raw DOB.
function ageFrom(dob, asOfYMD) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const start = new Date(dob + 'T00:00:00');
  const end = new Date(asOfYMD + 'T00:00:00');
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (isNaN(days) || days < 0) return null;
  return { ageWeeks: Math.floor(days / 7), ageDays: days % 7 };
}

// One curated safe detail string per family-visible event type (brief decision
// 4). Never the freeform top-level notes. Returns null when the detail is empty
// (note carries a title only).
function familyEventDetail(e) {
  const d = e.details || {};
  switch (e.event_type) {
    case 'vaccination': return nonEmpty(d.vaccine);
    case 'preventative': return nonEmpty(d.product);
    case 'weight_check': {
      const lbs = nonEmpty(d.weight_lbs);
      const oz = nonEmpty(d.weight_oz);
      if (lbs == null && oz == null) return null;
      return [lbs != null ? `${lbs} lb` : null, oz != null ? `${oz} oz` : null].filter(Boolean).join(' ');
    }
    case 'milestone': return nonEmpty(d.description);
    default: return null;
  }
}

// Positive allow-list assertion — abort the send rather than emit a superset.
function assertOnlyKeys(obj, allowed, ctx) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      throw new Error(`Companion bundle (${ctx}) has unexpected key "${k}" — send aborted.`);
    }
  }
  return obj;
}

// Shared header copy. Layer 1 (per-type settings) supplies kennel identity +
// intro; Layer 2 (Contact.companion_note) overrides the per-type announcement
// when the owner has written a personal line for this recipient.
function headerCopy(type, contact) {
  const s = getCompanionSettings(type);
  const note = (contact.companion_note || '').trim();
  return {
    kennelName: s.kennelName || '',
    tagline: s.tagline || '',
    introText: s.introText || '',
    announcement: note || s.announcement || ''
  };
}

const PROSPECTIVE_KEYS = [
  'bundleVersion', 'bundleType', 'kennelName', 'tagline', 'introText', 'announcement',
  'familyName', 'litters', 'updatedAt'
];
const FAMILY_KEYS = [
  'bundleVersion', 'bundleType', 'kennelName', 'tagline', 'introText', 'announcement',
  'familyName', 'pups', 'contractUrls', 'updatedAt'
];
const PARTNER_KEYS = [
  'bundleVersion', 'bundleType', 'kennelName', 'tagline', 'introText', 'announcement',
  'partnerName', 'studServices', 'externalPairings', 'contracts', 'updatedAt'
];

// --- Prospective family: current availability, one card per litter with its
// available pups nested inside. Carries the litter's per-sex list price + deposit
// (owner decision 1 reversed the old "NO price" rule); still NO per-recipient
// private data — every prospect sees the same availability. -----------------
export async function buildProspectiveBundle(contact) {
  const h = headerCopy('prospective', contact);
  const dogs = await dogRepo.getAll();
  const available = dogs.filter((d) => d.status === 'puppy' && d.disposition === 'available');

  const litterIds = [...new Set(available.map((d) => d.litter_id).filter(Boolean))];
  const litters = [];
  for (const id of litterIds) {
    const l = await litterRepo.getById(id);
    if (!l) continue;
    const sireDog = l.sire_id ? await dogRepo.getById(l.sire_id) : null;
    const damDog = l.dam_id ? await dogRepo.getById(l.dam_id) : null;
    const pups = available
      .filter((d) => d.litter_id === id)
      .map((d) => ({
        sex: d.sex || '',
        callName: d.call_name || '',
        markings: d.color_markings || '',
        price: d.sex === 'male' ? nonEmpty(l.expected_price_male)
          : d.sex === 'female' ? nonEmpty(l.expected_price_female) : null,
        deposit: d.sex === 'male' ? nonEmpty(l.expected_deposit_male)
          : d.sex === 'female' ? nonEmpty(l.expected_deposit_female) : null
      }));
    litters.push({
      nickname: l.nickname || '',
      breed: (damDog && damDog.breed) || (sireDog && sireDog.breed) || '',
      whelpDate: l.whelp_date || null,
      readyDate: l.estimated_ready_date || null,
      sire: await dogCard(sireDog),
      dam: await dogCard(damDog),
      pups
    });
  }

  const bundle = {
    bundleVersion: COMPANION_BUNDLE_VERSION,
    bundleType: 'prospective',
    ...h,
    familyName: contact.name || '',
    litters,
    updatedAt: new Date().toISOString()
  };
  return assertOnlyKeys(bundle, PROSPECTIVE_KEYS, 'prospective');
}

// --- Current family: their placed dog(s), each with parentage, a computed age,
// ready/placement info, their own sale facts, and a curated per-type event
// history. A pointer to the governing contract document rides alongside. ------
export async function buildFamilyBundle(contact) {
  const h = headerCopy('family', contact);
  const sales = (await saleRepo.getByBuyer(contact.id)).filter((s) => !s.is_archived);
  const updatedAt = new Date().toISOString();
  const asOf = updatedAt.slice(0, 10);

  const pups = [];
  const contractUrls = [];

  for (const sale of sales) {
    const dog = await dogRepo.getById(sale.dog_id);
    if (dog) {
      const litter = dog.litter_id ? await litterRepo.getById(dog.litter_id) : null;
      const sireDog = litter && litter.sire_id ? await dogRepo.getById(litter.sire_id) : null;
      const damDog = litter && litter.dam_id ? await dogRepo.getById(litter.dam_id) : null;

      // getForSubject excludes archived and returns newest-first.
      const events = await eventRepo.getForSubject('dog', dog.id);
      const placement = events.find((e) => e.event_type === 'placement' && e.event_date);

      const eventSections = [];
      for (const t of FAMILY_EVENT_TYPES) {
        const items = events
          .filter((e) => e.event_type === t && e.event_date)
          .map((e) => ({ date: e.event_date, title: e.title || '', detail: familyEventDetail(e) }));
        if (items.length) eventSections.push({ type: t, items });
      }

      const price = nonEmpty(sale.price);
      const deposit = nonEmpty(sale.deposit_amount);
      const remainingBalance = (price != null && deposit != null)
        ? Number(price) - Number(deposit) : null;

      const pup = {
        callName: dog.call_name || '',
        sex: dog.sex || '',
        photosUrl: dog.url || '',
        sire: parentName(sireDog),
        dam: parentName(damDog),
        age: ageFrom(dog.date_of_birth, asOf),
        placementType: nonEmpty(sale.placement_type),
        saleStatus: nonEmpty(sale.status),
        price,
        deposit,
        remainingBalance,
        eventSections
      };
      if (litter && litter.nickname) pup.litterNickname = litter.nickname;
      if (placement) {
        const pd = placement.details || {};
        pup.placement = {
          date: placement.event_date,
          time: nonEmpty(pd.placement_time),
          method: nonEmpty(pd.dropoff_method)
        };
      } else if (litter && litter.estimated_ready_date) {
        pup.estimatedReadyDate = litter.estimated_ready_date;
      }
      pups.push(pup);
    }
    const gov = contractRepo.governingContract(await contractRepo.getBySale(sale.id));
    if (gov && gov.document_url) contractUrls.push(gov.document_url);
  }

  const bundle = {
    bundleVersion: COMPANION_BUNDLE_VERSION,
    bundleType: 'family',
    ...h,
    familyName: contact.name || '',
    pups,
    contractUrls,
    updatedAt
  };
  return assertOnlyKeys(bundle, FAMILY_KEYS, 'family');
}

// --- Partner: stud services (labeled Stud/Dam cards with completed tests),
// external-dog pairings, and lease/co_own/other contracts where this partner is
// the counterparty. ---------------------------------------------------------
export async function buildPartnerBundle(contact) {
  const h = headerCopy('partner', contact);

  const services = (await studServiceRepo.getByPartnerContact(contact.id)).filter((s) => !s.is_archived);
  const studServices = [];
  for (const ss of services) {
    const our = await dogRepo.getById(ss.our_dog_id);
    const partner = ss.partner_dog_id ? await dogRepo.getById(ss.partner_dog_id) : null;
    // Direction decides which side is the stud vs. the dam: outgoing = our dog
    // is the stud, incoming = our dog is the dam.
    const studDog = ss.direction === 'incoming' ? partner : our;
    const damDog = ss.direction === 'incoming' ? our : partner;

    let breedingDates = [];
    if (ss.pairing_id) {
      const evs = await eventRepo.getForSubject('pairing', ss.pairing_id);
      breedingDates = evs
        .filter((e) => e.event_type === 'breeding_tie' && e.event_date)
        .map((e) => e.event_date);
    }

    const hasPick = FEE_STRUCTURES_WITH_PICK.includes(ss.fee_structure);
    studServices.push({
      studDog: await dogCard(studDog),
      damDog: await dogCard(damDog),
      breedingDates,
      compensation: {
        fee_structure: ss.fee_structure || null,
        fee_amount: nonEmpty(ss.fee_amount),
        pick_status: hasPick ? (ss.pick_status || null) : null,
        sentDate: ss.sent_date || null,
        returnedDate: ss.returned_date || null
      }
    });
  }

  // Pairings involving this partner's external/leased-in dogs.
  const theirDogs = await contactRepo.getDogs(contact.id);
  const externalDogIds = theirDogs
    .filter((d) => EXTERNAL_OWNERSHIP.includes(d.ownership_type))
    .map((d) => d.id);
  const pairingsById = new Map();
  for (const dogId of externalDogIds) {
    for (const p of await pairingRepo.getForDog(dogId)) {
      if (!p.is_archived) pairingsById.set(p.id, p);
    }
  }
  const externalPairings = [];
  for (const p of pairingsById.values()) {
    const sire = p.sire_id ? await dogRepo.getById(p.sire_id) : null;
    const dam = p.dam_id ? await dogRepo.getById(p.dam_id) : null;
    externalPairings.push({
      sire: dogMini(sire),
      dam: dogMini(dam),
      status: p.status || null,
      plannedDate: p.planned_date || null
    });
  }

  const contracts = (await contractRepo.getByContact(contact.id))
    .filter((c) => !c.is_archived)
    .map((c) => ({
      type: c.contract_type || null,
      title: c.title || null,
      status: c.status || null,
      signedDate: c.signed_date || null,
      terms: c.terms_summary || null,
      document_url: c.document_url || null
    }));

  const bundle = {
    bundleVersion: COMPANION_BUNDLE_VERSION,
    bundleType: 'partner',
    ...h,
    partnerName: contact.name || '',
    studServices,
    externalPairings,
    contracts,
    updatedAt: new Date().toISOString()
  };
  return assertOnlyKeys(bundle, PARTNER_KEYS, 'partner');
}

// Convenience dispatcher used by the Send-Link UI.
export function buildBundle(type, contact) {
  if (type === 'prospective') return buildProspectiveBundle(contact);
  if (type === 'family') return buildFamilyBundle(contact);
  if (type === 'partner') return buildPartnerBundle(contact);
  throw new Error(`Unknown companion bundle type "${type}".`);
}
