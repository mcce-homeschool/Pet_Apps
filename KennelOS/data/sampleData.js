// sampleData.js — the "Thornfield Kennels" demo packet: seed it, clear it.
// Companion to importExport.js in the data layer (Sample Data & Reset brief v2).
//
// Design (brief §2): seed through the repo layer so sample records go through
// the exact same validation real data does; track created IDs in one manifest
// object rather than an `is_sample` schema flag, so clearing needs no scan.
// v2 unifies all six tables that exist through Stage 3 (Dog, Event, Contact,
// Kennel, Pairing, Litter) into one seed/clear set — this replaces v1 entirely,
// it is not a diff.
import { db } from './db.js';
import { dogRepo } from './dogRepo.js';
import { HistoryEvent } from './eventRepo.js';
import { contactRepo } from './contactRepo.js';
import { kennelRepo } from './kennelRepo.js';
import { pairingRepo } from './pairingRepo.js';
import { litterRepo } from './litterRepo.js';
import { saleRepo } from './saleRepo.js';
import { contractRepo } from './contractRepo.js';
import { studServiceRepo } from './studServiceRepo.js';
import { monthsFromToday, daysFromToday } from './dateUtils.js';
import {
  findBlockingReferences, DOG_REFERENCES, PAIRING_REFERENCES, LITTER_REFERENCES,
  SALE_REFERENCES, STUD_SERVICE_REFERENCES
} from './referenceRegistry.js';
import {
  getSampleDataManifest,
  setSampleDataManifest,
  removeSampleDataManifest,
  wasSampleDataCleared,
  markSampleDataCleared
} from './settings.js';

export { getSampleDataManifest };

export function hasSampleData() {
  return getSampleDataManifest() != null;
}

// First-run gate (brief §4): only offer the choice when there are no rows in
// any Stage 1-2 table yet AND the manifest/cleared flag haven't been set —
// i.e. this browser has genuinely never made a choice before.
export async function shouldOfferFirstRunPrompt() {
  if (getSampleDataManifest() != null || wasSampleDataCleared()) return false;
  const [dogCount, contactCount, kennelCount] = await Promise.all([
    db.dogs.count(),
    db.contacts.count(),
    db.kennels.count()
  ]);
  return dogCount === 0 && contactCount === 0 && kennelCount === 0;
}

// Skip seeding: record the choice so the prompt never reappears.
export function declineSampleData() {
  markSampleDataCleared();
}

// --- Seeding ----------------------------------------------------------------

export async function seedSampleData() {
  const manifest = {
    seededAt: new Date().toISOString(),
    dogs: [], events: [], contacts: [], kennels: [], pairings: [], litters: [],
    sales: [], contracts: [], stud_services: []
  };

  // Kennels — Thornfield is the user's own kennel; Meadow Ridge is Dana Ruiz's
  // (Own-Kennel Identity addendum §5).
  const thornfield = await kennelRepo.create({
    kennel_name: 'Thornfield Kennels', prefix: 'THORN', location: 'Hartland, VT', is_own_kennel: true
  });
  const meadowRidge = await kennelRepo.create({
    kennel_name: 'Meadow Ridge Kennels', prefix: 'MDWR', location: 'Concord, NH', is_own_kennel: false
  });
  manifest.kennels.push(thornfield.id, meadowRidge.id);

  // Contacts
  const patricia = await contactRepo.create({
    name: 'Dr. Patricia Nguyen', contact_type: ['vet'], phone: '555-0101'
  });
  const dana = await contactRepo.create({
    name: 'Dana Ruiz', contact_type: ['breeder'], kennel_id: meadowRidge.id, phone: '555-0102'
  });
  const sam = await contactRepo.create({
    name: 'Sam Okafor', contact_type: ['co_owner'], phone: '555-0103'
  });
  const tessa = await contactRepo.create({
    name: 'Tessa Lin', contact_type: ['co_owner', 'buyer_referrer'], phone: '555-0104'
  });
  const marcus = await contactRepo.create({
    name: 'Marcus Webb', contact_type: ['buyer_referrer'], phone: '555-0105'
  });
  await contactRepo.archive(marcus.id);

  // Stage 4: buyers are Contacts, not a separate table (Data Model v3 §5.5).
  // Priya buys Hazel (waitlist fulfilled by a completed sale); Owen exercises
  // the empty-waitlist demo (active, no Sale record yet); Ellen owns the
  // external female used in the sample stud service.
  const priya = await contactRepo.create({
    name: 'Priya Shah', contact_type: ['buyer'], waitlist_status: 'fulfilled',
    first_contact_source: 'Instagram', phone: '555-0106', email: 'priya.shah@example.com'
  });
  const owen = await contactRepo.create({
    name: 'Owen Farrow', contact_type: ['buyer'], waitlist_status: 'active',
    first_contact_source: 'Referral', phone: '555-0107'
  });
  // address (Data Integrity Brief §5): the away-board resolves an in-person
  // stud service's location from the partner contact's address, so Ellen
  // needs one for studServiceBirch below to show a real location, not "—".
  const ellen = await contactRepo.create({
    name: 'Ellen Brooks', contact_type: ['breeder'], phone: '555-0108', address: 'Burlington, VT'
  });
  manifest.contacts.push(patricia.id, dana.id, sam.id, tessa.id, marcus.id, priya.id, owen.id, ellen.id);

  // Dogs — ancestors first so each generation can reference the last. Every
  // sample dog is Boston Terrier (brief §6).
  const BREED = 'Boston Terrier';

  const ash = await dogRepo.create({
    call_name: 'Ash', sex: 'male', breed: BREED,
    date_of_birth: '2016-04-02', date_of_death: '2024-08-15',
    ownership_type: 'owned', status: 'deceased', kennel_id: thornfield.id
  });
  const willow = await dogRepo.create({
    call_name: 'Willow', sex: 'female', breed: BREED,
    date_of_birth: '2017-09-14',
    ownership_type: 'owned', status: 'retired_breeding', kennel_id: thornfield.id
  });
  await dogRepo.archive(willow.id);

  // Juniper carries a recorded COI (Stage 5 §9) — genomic, from Embark. It's a
  // user-attested value on the Dog record, not computed by the app.
  const juniper = await dogRepo.create({
    call_name: 'Juniper', sex: 'female', breed: BREED,
    date_of_birth: '2019-11-03', sire_id: ash.id, dam_id: willow.id,
    ownership_type: 'owned', status: 'active_breeding', kennel_id: thornfield.id,
    recorded_coi: { value: 6.25, method: 'genomic', source: 'Embark', as_of_date: '2023-03-01' }
  });

  // Gunnar stays kennel_id: null — external, owned by Dana Ruiz. His kennel
  // identity flows through owner_contact_id, not kennel_id. His recorded COI uses
  // a DIFFERENT method/source (pedigree, AKC 5-gen) so the mixed-provenance
  // display is exercised (Stage 5 §9). breeder_kennel_id points at Meadow
  // Ridge — Dana's outside kennel — exercising the "acquired dog, outside
  // breeder" case (as opposed to Fern/Birch/Hazel below, whose in-house
  // breeder_kennel_id comes from the auto-prefill instead).
  const gunnar = await dogRepo.create({
    call_name: 'Gunnar', sex: 'male', breed: BREED,
    date_of_birth: '2018-06-01', dob_is_estimated: true,
    ownership_type: 'external', owner_contact_id: dana.id, status: 'external_reference',
    breeder_kennel_id: meadowRidge.id,
    recorded_coi: { value: 4.1, method: 'pedigree', source: 'AKC 5-gen', as_of_date: '2022-11-15' }
  });

  // Pairing P1 — the actual, whelped breeding that produced Fern/Birch/Hazel.
  const pairingP1 = await pairingRepo.create({
    sire_id: gunnar.id, dam_id: juniper.id, pairing_type: 'actual', method: 'natural',
    status: 'whelped', planned_date: '2025-06-18', expected_due_date: '2025-08-20'
  });

  // Litter — dam/sire authoritative on the litter itself, pairing_id links back
  // to P1 (data model §5.4). Status closed: all three puppies have moved on,
  // even though the individual dogs sit at different life stages.
  const litter = await litterRepo.create({
    pairing_id: pairingP1.id, dam_id: juniper.id, sire_id: gunnar.id,
    whelp_date: '2025-08-20', litter_registration_number: 'THORN-L-2025-01',
    puppies_born_total: 3, puppies_born_alive: 3, puppies_born_deceased: 0,
    status: 'closed'
  });

  // Fern/Birch/Hazel carry breeder_kennel_id: thornfield.id — Juniper (their dam)
  // is an owned dog whose own kennel_id is Thornfield, exercising the
  // dam-is-my-dog auto-prefill (dog.js / puppyForm.js) rather than a manual set.
  const fern = await dogRepo.create({
    call_name: 'Fern', sex: 'female', breed: BREED,
    date_of_birth: '2025-08-20', sire_id: gunnar.id, dam_id: juniper.id, litter_id: litter.id,
    ownership_type: 'owned', status: 'puppy', disposition: 'available', kennel_id: thornfield.id,
    breeder_kennel_id: thornfield.id
  });
  const birch = await dogRepo.create({
    call_name: 'Birch', sex: 'male', breed: BREED,
    date_of_birth: '2025-08-20', sire_id: gunnar.id, dam_id: juniper.id, litter_id: litter.id,
    ownership_type: 'owned', status: 'active_breeding', disposition: 'keeping', kennel_id: thornfield.id,
    breeder_kennel_id: thornfield.id
  });
  const hazel = await dogRepo.create({
    call_name: 'Hazel', sex: 'female', breed: BREED,
    date_of_birth: '2025-08-20', sire_id: gunnar.id, dam_id: juniper.id, litter_id: litter.id,
    ownership_type: 'owned', status: 'pet_home', disposition: 'placed', kennel_id: thornfield.id,
    breeder_kennel_id: thornfield.id
  });

  const percy = await dogRepo.create({
    call_name: 'Percy', sex: 'male', breed: BREED,
    date_of_birth: '2024-03-10',
    ownership_type: 'co_owned', co_owner_contact_ids: [sam.id, tessa.id], status: 'active_breeding',
    kennel_id: thornfield.id
  });

  // Nell — external female, Ellen Brooks' dog, the partner side of the sample
  // outgoing stud service below. Her kennel identity flows through
  // owner_contact_id, same pattern as Gunnar.
  const nell = await dogRepo.create({
    call_name: 'Nell', sex: 'female', breed: BREED,
    date_of_birth: '2022-05-14', dob_is_estimated: true,
    ownership_type: 'external', owner_contact_id: ellen.id, status: 'external_reference'
  });

  manifest.dogs.push(ash.id, willow.id, juniper.id, gunnar.id, fern.id, birch.id, hazel.id, percy.id, nell.id);

  // Pairing P2 — same pair, planned only, no litter yet. Exercises the "Create
  // Litter from this Pairing" empty state and an empty pairing timeline.
  const pairingP2 = await pairingRepo.create({
    sire_id: gunnar.id, dam_id: juniper.id, pairing_type: 'planned', status: 'planned',
    planned_date: monthsFromToday(4)
  });

  // Pairing P3 — the actual breeding produced by the sample Stud Service below.
  // StudService.pairing_id is the canonical link (Data Model v3 §5.8); there is
  // no Pairing.stud_service_id, so this pairing carries no back-pointer of its own.
  const pairingP3 = await pairingRepo.create({
    sire_id: birch.id, dam_id: nell.id, pairing_type: 'actual', method: 'ai_chilled',
    status: 'confirmed_pregnant', planned_date: '2026-05-01'
  });

  manifest.pairings.push(pairingP1.id, pairingP2.id, pairingP3.id);
  manifest.litters.push(litter.id);

  // Stage 4 — Stud Service: Birch (our dog) services Nell (Ellen's outside
  // female). Links to Pairing P3 via the canonical pairing_id.
  // type/sent_date/no returned_date (Data Integrity Brief §5): this IS the
  // sample's away-board row now — an ongoing in-person stay. The parallel
  // "Boarding for stud service" event that used to duplicate this trip is
  // gone; the board reads this record directly via studServiceRepo.getBoardRows().
  const studServiceBirch = await studServiceRepo.create({
    direction: 'outgoing', our_dog_id: birch.id, partner_dog_id: nell.id, partner_contact_id: ellen.id,
    fee_amount: 1200, fee_structure: 'flat_fee', pairing_id: pairingP3.id, type: 'in_person',
    sent_date: daysFromToday(-3),
    status: 'completed', result_notes: 'Successful AI breeding; pregnancy confirmed by ultrasound.'
  });
  const studServiceContract = await contractRepo.create({
    contract_type: 'stud_service', status: 'signed', related_stud_service_id: studServiceBirch.id,
    title: 'Stud Service Agreement — Birch × Nell', signed_date: '2026-04-15',
    terms_summary: 'Flat fee, one breeding attempt, health-tested sire.'
  });
  manifest.stud_services.push(studServiceBirch.id);
  manifest.contracts.push(studServiceContract.id);

  // Stage 4 — Sale: Hazel placed with Priya Shah (pet home, delivered). Contract
  // owns related_sale_id (canonical); there is no Sale.contract_id.
  const hazelSale = await saleRepo.create({
    dog_id: hazel.id, buyer_contact_id: priya.id, sale_date: '2025-12-20',
    price: 2500, deposit_amount: 500, deposit_date: '2025-11-01', balance_paid_date: '2025-12-20',
    placement_type: 'pet', status: 'delivered', lead_source: 'Instagram',
    notes: 'Went home with a family in Concord, NH — regular updates from the family.'
  });
  const hazelContract = await contractRepo.create({
    contract_type: 'sale', status: 'signed', related_sale_id: hazelSale.id,
    title: 'Puppy Purchase Agreement — Hazel', signed_date: '2025-12-15',
    terms_summary: 'Pet-home placement, spay/neuter clause, health guarantee.'
  });
  manifest.sales.push(hazelSale.id);
  manifest.contracts.push(hazelContract.id);

  // Events — spread across all three subject types to cover most of the catalog
  // (brief §6).
  const dogEvents = [
    // Juniper — annual vaccines with a now-OVERDUE reminder (Stage 5 §9): the
    // rabies booster reminder has slipped past its date and is still pending.
    { subject_id: juniper.id, event_type: 'vaccination', event_date: '2026-01-10', title: 'Annual vaccines',
      reminder_date: daysFromToday(-10),
      details: { vaccine: 'DHPP + Rabies', lot_number: 'B4471' } },
    { subject_id: juniper.id, event_type: 'heat_cycle', event_date: '2026-02-02', title: 'Heat cycle',
      details: { cycle_start: '2026-02-02' } },
    { subject_id: juniper.id, event_type: 'ofa_pennhip', event_date: '2022-05-19', title: 'Hip evaluation',
      details: { joint: 'Hips', method: 'OFA', rating: 'Good' } },
    { subject_id: juniper.id, event_type: 'title_earned', event_date: '2021-10-03', title: 'Earned CGC',
      details: { title_abbreviation: 'CGC', organization: 'AKC' } },
    // Gunnar
    { subject_id: gunnar.id, event_type: 'genetic_test', event_date: '2023-03-01', title: 'Panel results',
      details: { panel_name: 'Embark Breeder Panel', lab: 'Embark', result: 'Clear' } },
    { subject_id: gunnar.id, event_type: 'title_earned', event_date: '2020-09-12', title: 'Earned JH',
      details: { title_abbreviation: 'JH', organization: 'AKC' } },
    // Fern
    { subject_id: fern.id, event_type: 'milestone', event_date: '2025-10-15', title: 'Eyes open',
      details: { description: 'Eyes open' } },
    { subject_id: fern.id, event_type: 'weight_check', event_date: '2026-06-01', title: 'Weight check',
      details: { weight_lbs: 42 } },
    { subject_id: fern.id, event_type: 'vaccination', event_date: '2026-05-01', title: 'Puppy shots (2nd round)',
      details: { vaccine: 'DHPP', lot_number: 'C1029' } },
    { subject_id: fern.id, event_type: 'evaluation', event_date: '2026-06-15', title: 'Puppy evaluation',
      details: { evaluator: 'Dr. Patricia Nguyen', temperament_notes: 'Confident, food-motivated.', structure_notes: 'Level topline, good angulation.' } },
    // Fern — scheduled drop-off (Stage4.5 Addendum §D5): a second Thornfield
    // puppy going home next week, deliberately with NO Sale record yet — a
    // placement event never carries a stored link to one (§D1). Owen is already
    // the sample's active-waitlist buyer, so this doubles as his placement.
    { subject_id: fern.id, event_type: 'placement', event_date: daysFromToday(7), title: 'Scheduled pickup',
      related_contact_id: owen.id,
      details: { placement_time: '10:00 AM', location: 'Thornfield Kennels', notes: 'Fern going home with the Farrows.' } },
    // Birch — health-tested after promotion to breeding stock
    { subject_id: birch.id, event_type: 'milestone', event_date: '2025-10-15', title: 'Eyes open',
      details: { description: 'Eyes open' } },
    { subject_id: birch.id, event_type: 'weight_check', event_date: '2026-06-01', title: 'Weight check',
      details: { weight_lbs: 48 } },
    { subject_id: birch.id, event_type: 'vaccination', event_date: '2026-05-01', title: 'Puppy shots (2nd round)',
      details: { vaccine: 'DHPP', lot_number: 'C1029' } },
    { subject_id: birch.id, event_type: 'genetic_test', event_date: '2026-06-20', title: 'Panel results',
      details: { panel_name: 'Embark Breeder Panel', lab: 'Embark', result: 'Clear' } },
    // Birch's outgoing stud stay with Ellen no longer gets a parallel boarding
    // event (Data Integrity Brief §5 away-board de-dup) — studServiceBirch
    // above (type: in_person, sent_date set, no returned_date) is now the
    // sole source for that trip on the Location/Status Board.
    // Hazel
    { subject_id: hazel.id, event_type: 'vaccination', event_date: '2026-05-01', title: 'Puppy shots (2nd round)',
      details: { vaccine: 'DHPP', lot_number: 'C1029' } },
    { subject_id: hazel.id, event_type: 'note', event_date: '2025-12-20', title: 'Placed in pet home',
      details: {}, notes: 'Went home with a family in Concord, NH — regular updates from the family.' },
    // Percy — future-dated, tests the "upcoming" treatment. Also carries a
    // DUE-SOON reminder (Stage 5 §9): within the reminder view's 30-day window.
    { subject_id: percy.id, event_type: 'vet_visit', event_date: '2026-08-15', title: 'Annual checkup',
      reminder_date: daysFromToday(14),
      details: { reason: 'Annual checkup', vet: 'Dr. Patricia Nguyen' } },
    // Birch — an UPCOMING reminder (Stage 5 §9): beyond the 30-day window, so it
    // lands in the reminder view's "Upcoming" bucket. A preventative that also
    // demonstrates complete-and-chain (log the next dose, carrying a new reminder).
    { subject_id: birch.id, event_type: 'preventative', event_date: daysFromToday(-2), title: 'Heartworm preventative',
      reminder_date: daysFromToday(90),
      details: { product: 'Heartgard', dose: '1 chew' } },
    // Fern — a DISMISSED reminder (Stage 5 §9): already handled, so it's off the
    // pending buckets but visible under the reminder view's "Show dismissed"
    // toggle. Exercises reminder_dismissed (a plain field, not archive/status).
    { subject_id: fern.id, event_type: 'vaccination', event_date: '2026-06-01', title: 'Rabies booster',
      reminder_date: daysFromToday(20), reminder_dismissed: true,
      details: { vaccine: 'Rabies', lot_number: 'C2210' } }
  ];

  const pairingEvents = [
    { subject_id: pairingP1.id, event_type: 'breeding_tie', event_date: '2025-06-18', title: 'Breeding tie',
      details: { tie_date: '2025-06-18', method: 'Natural' } },
    { subject_id: pairingP1.id, event_type: 'progesterone_test', event_date: '2025-06-10', title: 'Progesterone test',
      details: { value: 15, lab: 'Antech' } },
    { subject_id: pairingP1.id, event_type: 'ultrasound', event_date: '2025-07-16', title: 'Ultrasound',
      details: { confirmed: 'Yes', estimated_count: 3 } },
    { subject_id: pairingP1.id, event_type: 'pregnancy_update', event_date: '2025-07-20', title: 'Pregnancy update',
      details: { note: 'Active, eating well, on schedule for an early-to-mid August whelp.' } }
  ];

  const litterEvents = [
    { subject_id: litter.id, event_type: 'whelping_summary', event_date: '2025-08-20', title: 'Whelping summary',
      details: { total_born: 3, live_born: 3, notes: 'Uncomplicated whelp, all three nursing well within the hour.' } }
  ];

  for (const e of dogEvents) {
    const saved = await HistoryEvent.create({ subject_type: 'dog', ...e });
    manifest.events.push(saved.id);
  }
  for (const e of pairingEvents) {
    const saved = await HistoryEvent.create({ subject_type: 'pairing', ...e });
    manifest.events.push(saved.id);
  }
  for (const e of litterEvents) {
    const saved = await HistoryEvent.create({ subject_type: 'litter', ...e });
    manifest.events.push(saved.id);
  }

  setSampleDataManifest(manifest);
  return manifest;
}

// --- Clearing -----------------------------------------------------------

const ENTITY_REPOS = {
  dog: dogRepo, pairing: pairingRepo, litter: litterRepo,
  sale: saleRepo, stud_service: studServiceRepo
};
const ENTITY_REGISTRIES = {
  dog: DOG_REFERENCES, pairing: PAIRING_REFERENCES, litter: LITTER_REFERENCES,
  sale: SALE_REFERENCES, stud_service: STUD_SERVICE_REFERENCES
};

// Human-readable label for a conflict message. Dogs already have a name; a
// pairing/litter/sale/stud-service doesn't, so build one from its own fields
// the same way the UI's own title does.
async function labelFor(entityType, id) {
  if (entityType === 'dog') {
    const d = await db.dogs.get(id);
    return d ? d.call_name : id;
  }
  if (entityType === 'sale') {
    const s = await db.sales.get(id);
    if (!s) return id;
    const [dog, buyer] = await Promise.all([db.dogs.get(s.dog_id), db.contacts.get(s.buyer_contact_id)]);
    return `Sale (${dog?.call_name || '—'} → ${buyer?.name || '—'})`;
  }
  if (entityType === 'stud_service') {
    const s = await db.stud_services.get(id);
    if (!s) return id;
    const [ours, partner] = await Promise.all([db.dogs.get(s.our_dog_id), db.dogs.get(s.partner_dog_id)]);
    return `StudService (${ours?.call_name || '—'} × ${partner?.call_name || '—'})`;
  }
  const row = await db.table(entityType === 'pairing' ? 'pairings' : 'litters').get(id);
  if (!row) return id;
  const [sire, dam] = await Promise.all([db.dogs.get(row.sire_id), db.dogs.get(row.dam_id)]);
  const label = `${sire?.call_name || '—'} × ${dam?.call_name || '—'}`;
  return entityType === 'pairing' ? `Pairing (${label})` : `Litter (${label})`;
}

// Contamination check (brief §5.2): find any real (non-manifest) record that
// now points at a manifest Dog/Pairing/Litter/Sale/StudService via one of the
// reference registries. Reuses the same registries the live hard-delete guard
// uses, so this stays accurate as more reference kinds are added. Contract is
// never checked here — CONTRACT_REFERENCES is empty (a leaf), so a manifest
// contract can never be contaminated.
async function findContaminatingReferences(manifest) {
  const manifestSets = {
    dogs: new Set(manifest.dogs),
    events: new Set(manifest.events || []),
    pairings: new Set(manifest.pairings || []),
    litters: new Set(manifest.litters || []),
    sales: new Set(manifest.sales || []),
    stud_services: new Set(manifest.stud_services || []),
    contracts: new Set(manifest.contracts || [])
  };

  // conflicts: Map key `${entityType}:${id}` -> { entityType, id, refs: [{label, row}] }
  const conflicts = new Map();

  for (const [entityType, ids] of [
    ['dog', manifest.dogs], ['pairing', manifest.pairings || []], ['litter', manifest.litters || []],
    ['sale', manifest.sales || []], ['stud_service', manifest.stud_services || []]
  ]) {
    const registry = ENTITY_REGISTRIES[entityType];
    for (const id of ids) {
      const blockers = await findBlockingReferences(registry, id);
      if (blockers.length === 0) continue;
      const real = [];
      for (const ref of registry) {
        const table = db.table(ref.table);
        const rows = ref.compoundIndex
          ? await table.where(ref.compoundIndex).equals([ref.discriminatorValue, id]).toArray()
          : await table.where(ref.field).equals(id).toArray();
        const manifestSet = manifestSets[ref.table] || new Set();
        for (const row of rows) {
          if (!manifestSet.has(row.id)) real.push({ label: ref.label, row });
        }
      }
      if (real.length) conflicts.set(`${entityType}:${id}`, { entityType, id, refs: real });
    }
  }
  return conflicts;
}

// clearSampleData({ archiveConflicting }):
//   - dry run (default): reports what's blocking, deletes nothing if blocked.
//   - archiveConflicting: true archives the conflicting sample records instead
//     of deleting them, then proceeds to delete everything else in the manifest.
export async function clearSampleData({ archiveConflicting = false } = {}) {
  const manifest = getSampleDataManifest();
  if (!manifest) return { cleared: false, reason: 'none', counts: {} };
  // Defensive: treat any missing array key as empty, in case of a future
  // partial-seed failure or a manifest written by an older app version.
  manifest.pairings = manifest.pairings || [];
  manifest.litters = manifest.litters || [];
  manifest.sales = manifest.sales || [];
  manifest.contracts = manifest.contracts || [];
  manifest.stud_services = manifest.stud_services || [];

  const conflicts = await findContaminatingReferences(manifest);

  if (conflicts.size > 0 && !archiveConflicting) {
    const details = [];
    for (const { entityType, id, refs } of conflicts.values()) {
      const label = await labelFor(entityType, id);
      for (const r of refs) details.push(`${label} is ${r.label}`);
    }
    return { cleared: false, reason: 'contaminated', conflicts: details, counts: {} };
  }

  // Archive conflicting records (grouped by entity type), tracking which ids
  // to exclude from the bulk delete below.
  const archivedIds = { dog: [], pairing: [], litter: [], sale: [], stud_service: [] };
  if (conflicts.size > 0) {
    for (const { entityType, id } of conflicts.values()) {
      await ENTITY_REPOS[entityType].archive(id);
      archivedIds[entityType].push(id);
    }
  }

  const dogIdsToDelete = manifest.dogs.filter((id) => !archivedIds.dog.includes(id));
  const pairingIdsToDelete = manifest.pairings.filter((id) => !archivedIds.pairing.includes(id));
  const litterIdsToDelete = manifest.litters.filter((id) => !archivedIds.litter.includes(id));
  const saleIdsToDelete = manifest.sales.filter((id) => !archivedIds.sale.includes(id));
  const studServiceIdsToDelete = manifest.stud_services.filter((id) => !archivedIds.stud_service.includes(id));

  const counts = {
    events: manifest.events.length,
    litters: litterIdsToDelete.length,
    pairings: pairingIdsToDelete.length,
    stud_services: studServiceIdsToDelete.length,
    sales: saleIdsToDelete.length,
    contracts: manifest.contracts.length,
    dogs: dogIdsToDelete.length,
    contacts: manifest.contacts.length,
    kennels: manifest.kennels.length,
    archived: archivedIds.dog.length + archivedIds.pairing.length + archivedIds.litter.length
      + archivedIds.sale.length + archivedIds.stud_service.length
  };

  // Dependency order: events -> contracts -> litters -> stud_services ->
  // pairings -> sales -> dogs -> contacts -> kennels. Contract references
  // sales/stud_services so it must clear first (it's a leaf itself — nothing
  // ever references a Contract, so it's never in archivedIds). Litters and
  // stud_services reference pairings/dogs, sales reference dogs/contacts, so
  // all of those clear before dogs/contacts. This is a known, self-contained,
  // unreferenced set, so it bypasses the single-record hardDelete guard (which
  // exists to protect one record at a time, not to bulk-clear a whole known
  // set — brief §5).
  await db.transaction('rw', db.events, db.contracts, db.litters, db.stud_services, db.pairings, db.sales, db.dogs, db.contacts, db.kennels, async () => {
    if (manifest.events.length) await db.events.bulkDelete(manifest.events);
    if (manifest.contracts.length) await db.contracts.bulkDelete(manifest.contracts);
    if (litterIdsToDelete.length) await db.litters.bulkDelete(litterIdsToDelete);
    if (studServiceIdsToDelete.length) await db.stud_services.bulkDelete(studServiceIdsToDelete);
    if (pairingIdsToDelete.length) await db.pairings.bulkDelete(pairingIdsToDelete);
    if (saleIdsToDelete.length) await db.sales.bulkDelete(saleIdsToDelete);
    if (dogIdsToDelete.length) await db.dogs.bulkDelete(dogIdsToDelete);
    if (manifest.contacts.length) await db.contacts.bulkDelete(manifest.contacts);
    if (manifest.kennels.length) await db.kennels.bulkDelete(manifest.kennels);
  });

  removeSampleDataManifest();
  markSampleDataCleared();

  return { cleared: true, counts };
}
