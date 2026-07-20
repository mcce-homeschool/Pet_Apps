# KennelOS — End-State Design & Maintenance Guide

The single current-state reference for the KennelOS dog-breeding records app. It
describes what the app **is today** and how to change it safely: architecture, data
model, module map, invariants, and the common "how do I change X" recipes. Read it
first.

Where a field-level or rule-level detail matters, the **code is authoritative**;
`Data_Model_Architecture_Proposal_v3.md` is the next-finest reference, and the
`StageN_*` briefs in this folder are historical archaeology only. Where a doc and the
code disagree, the code wins and the doc is what gets fixed.

---

## 1. What the app is

A **local-first, static, multi-page web app** for managing a dog-breeding program:
dogs and pedigrees, contacts, kennels, pairings and litters, sales/placements, stud
services, contracts, a polymorphic health/history event log, an expense/income ledger,
reminders, a dashboard, analytics reports, CSV/JSON import-export, and a read-only
Companion share-out for buyers and partners.

- **No backend, no build step.** Plain ES modules served over HTTP. Hosted on GitHub
  Pages; all data lives in the browser (IndexedDB via Dexie).
- **Single user, single device** is the design centre. Data moves between devices only
  through explicit JSON backup/restore or CSV import/export.
- **Offline-capable PWA.** A service worker precaches the app shell so it works offline
  after the first load.

---

## 2. Architecture non-negotiables

These are load-bearing. Changing any of them is a design decision, not a routine edit.

1. **Multi-page static, no SPA router.** One `.html` per screen, each pulling in shared
   JS. Navigation is real links between pages.
2. **Strict layering: pages → repos → Dexie.** Pages never import `db.js` and never
   call `db.*`. Only the repo modules in `data/` touch Dexie.
3. **ES modules over HTTP.** Must be served (`python3 -m http.server`, `npx serve`, or
   GitHub Pages) — never opened as `file://`, which CORS-blocks module imports.
4. **No CDN / no network deps.** Everything third-party is vendored under
   `KennelOS/vendor/` and loaded by relative path (Dexie, PapaParse, lz-string). The
   app must work fully offline after first load.
5. **One thin repo per entity**, uniform surface (see §6). New entity = new repo + new
   page; you don't reshape existing ones.

---

## 3. Directory layout

```
CLAUDE.md                      Session brief (read first)
docs/                          Design docs (this file is the end-state map)
KennelOS/
  index.html                   App root / landing
  companion-view.html          Recipient-facing Companion share shell (§20) — a
                               self-contained, read-only static file; NOT part of
                               the app's page/nav set, but IS precached
  app.js                       Shared shell bootstrap (nav, PWA, first-run flow)
  nav.js                       Top-nav definition + rendering
  sw.js                        Service worker (app-shell precache, offline)
  manifest.json                PWA manifest
  vendor/                      Vendored deps: dexie.min.mjs, papaparse.min.mjs,
                               lz-string.min.mjs
  resources/
    common_tests_by_breed_seed.csv   Optional breed→test seed data
  data/                        THE DATA LAYER (repos + shared data logic)
    db.js                      Dexie schema — the only schema definition
    repoBase.js                makeRepo factory (shared repo surface)
    referenceRegistry.js       FK declarations + hard-delete guard
    dogRepo / contactRepo / kennelRepo / pairingRepo / litterRepo /
      saleRepo / contractRepo / studServiceRepo / eventRepo / expenseRepo   Entity repos
    incomeView.js              Derived income aggregator (Sale + outgoing StudService)
    litterFinances.js          Derived per-litter P&L (income vs cost)
    dateUtils.js               todayYMD / date helpers (single "what is today")
    vocab.js                   Controlled vocabularies + event-type catalog
    csvImport.js               Generic CSV match-or-create engine + mappings
    importExport.js            JSON backup / restore
    companionExport.js         Companion allow-list bundle builder (§20)
    appReset.js                Full "reset to first run" teardown
    sampleData.js              "Thornfield Kennels" demo seed/clear
    seedImport.js              Optional breed+test vocabulary seed
    kennelSetup.js             First-run "your kennel/owner" wizard logic
    wizardState.js             Guided-tour status/index state machine (§11)
    wizardSteps.js             Guided-tour step catalog — data only (§11)
    settings.js                localStorage-backed UI prefs / identity keys
    nudgeState.js              Device-local dismissal ledger for derived nudges
    nudges.js                  Derived-nudge engine — computeNudges() (§19)
    awayBoard.js               "Away from home" union: boarding events + in-person
                               stud services, one view-model (§19)
  assets/                      Shared UI helpers + reusable components
    app.css                    All styles
    ui.js                      esc(), badge(), fmtDate(), param(), fillSelect()…
    listView.js                Reusable list screen (cells return HTML)
    reportView.js              Reusable report screen (values return text)
    timeline.js                Subject health/history timeline
    pedigree.js                Ancestor-tree + offspring renderer
    eventForm.js               Add/edit event modal
    puppyForm.js               Litter → puppy roster entry
    contactPicker.js           Inline "＋ New contact" decorator for pickers
    importView.js              Shared CSV import dry-run/commit UI
    sampleDataUI.js            First-run sample-data prompt + banner
    kennelSetupUI.js           Kennel-setup prompt/wizard + seed prefill
    wizardUI.js                Guided-tour overlay/spotlight/tooltip + resume pill (§11)
    expensePanel.js            Reusable per-subject expense ledger panel (§21)
  pages/                       One .js + .html per screen (see §13 catalog)
```

---

## 4. Data model

### 4.1 Entities and their required fields

Every record also carries `id` (UUID), `is_archived` (bool), `created_at`,
`updated_at`. Dates are `YYYY-MM-DD` strings except `created_at`/`updated_at` (full
ISO). Required = enforced in the repo's validator; everything else is optional and
commonly blank at entry time.

| Entity | Required | Notable other fields |
|---|---|---|
| **Dog** | `call_name`, `sex`, `breed`, `ownership_type`, `status` | `registered_name`, `date_of_birth`, `date_of_death`, `sire_id`, `dam_id`, `litter_id`, `breeder_kennel_id` (the kennel that *produced* this dog — own or an outside contact's; distinct from `kennel_id`, which of the user's own kennels it belongs to *now*; auto-prefilled from the litter's dam's own `kennel_id` when that dam is owned/co-owned), `owner_contact_id`, `co_owner_contact_ids[]`, `kennel_id`, `color_markings`, `registry`, `registration_number`, `microchip_id`, `url` (plain, unindexed — a link for this dog, e.g. a registry page or listing), `planned_tests[]`, `recorded_coi{value,method,source,as_of_date}`, `disposition` (`undecided`/`keeping`/`available`/`placed` — breeder intent; **puppy-only**, valid only while `status='puppy'` and forced null otherwise. Enforced in `dogRepo` create/update and mirrored in the UI: the dog form shows it only for a puppy, `sale.js` won't set one on a non-puppy, the profile hides the row otherwise. Feeds the Today "Active litters" card, the promote-lifecycle nudge, and the litter-lifecycle nudges, §19), `notes`. Owner required when `ownership_type ∈ {external, leased_in}`. |
| **Contact** | `name` | `contact_type[]` (multi), `email`, `phone`, `address`, `kennel_id`, `waitlist_status`, `first_contact_source`, `notes`, `companion_note` (plain, unindexed — a per-recipient message **meant for the recipient's eyes**, shown on their companion share page; deliberately distinct from the private `notes`; §20). Buyers are Contacts — **there is no Buyer table**. `address` also resolves an in-person stud service's away-board location (§19). |
| **Kennel** | `kennel_name` | `is_own_kennel`, `prefix`, `location`, `website` (plain, unindexed — a link for this kennel, mirrors `Dog.url`), `logo_data_url` (plain, unindexed — a downscaled PNG/SVG **data URL** for the kennel's logo, uploaded/removed on the kennel detail page, rendered on its invoices/receipts (§24) and puppy records (§23); rides the JSON backup), `preferred_tests[]`, `preferred_breeds[]`, `promote_nudge_enabled` (bool, default off), `promote_age_male_months`/`promote_age_female_months` (the promote-lifecycle nudge's per-kennel thresholds, §19). Lightweight; added inline from the Contact form. |
| **Pairing** | `sire_id`, `dam_id`, `pairing_type`, `status` | `method`, `planned_date` (shown as "Planned first date" — the first planned/tie date), `last_observed_date` (plain, unindexed — a subsequent observed tie/breeding date), `expected_due_date` (prefilled on the detail page as 63 days after `planned_date` when still empty, never clobbering a deliberate edit), `notes`. Sire ≠ dam (hard block). |
| **Litter** | `dam_id`, `sire_id`, `status` | `nickname` (plain, unindexed — optional friendly label, e.g. "Party of Five"; when set it leads the detail-page title and shows as its own column on the Litters list and report, searchable across all three; falls back to `dam × sire` when blank), `pairing_id`, `whelp_date`, `accept_deposits_date` (plain, unindexed — when the breeder begins accepting deposits; on the detail page it sits between `whelp_date` and `estimated_ready_date`, and surfaces in the **prospective** companion bundle between "Born" and "Estimated ready" when set, §20), `estimated_ready_date` (plain, unindexed — prefilled as 8 weeks/56 days after `whelp_date` when still empty, never clobbering a deliberate edit), `litter_registration_number`, `puppies_born_total/alive/deceased/abnormalities` (the last a count, not mutually exclusive with alive/deceased), `expected_price_male`/`expected_price_female`/`expected_deposit_male`/`expected_deposit_female` (plain, unindexed — per-litter defaults, grouped by sex on the detail page; `sale.js` prefills a new Sale's `price` and `deposit_amount` from the matching-sex pair by the puppy's `sex`, only into fields still empty), `notes`. The litter's own sire/dam are authoritative. Puppy roster is **derived** (`Dog WHERE litter_id`). |
| **Sale** | `dog_id`, `buyer_contact_id`, `placement_type`, `status` | `sale_date`, `price`, `deposit_amount`, `deposit_date`, `balance_due_date`, `balance_paid_date`, `transport_fee` (plain, unindexed — a flat delivery/transport charge, decimal), `deferred_boarding_amount`/`deferred_boarding_frequency`/`deferred_boarding_duration_days` (plain, unindexed — a boarding rate for a buyer who delayed pickup: decimal amount + `BOARDING_FREQUENCY_OPTIONS` Day/Week/Month + a free-text **count of frequency units** (despite the `_days` name, the value is the number of units — `2` with frequency `Week` means two weeks), rendered as "amount per frequency × count"; the family companion bundle multiplies `amount × count` into a deferred-pickup total feeding the computed remaining balance (§20); never cents, never an Expense — see §21), `lead_source`, `referred_by_contact_id` (indexed FK → the Contact who referred this buyer; `CONTACT_REFERENCES`; on save `saleRepo` auto-tags that contact `buyer_referrer` via `contactRepo.ensureType`), `payment_method`/`payment_reference`/`invoice_number`/`invoice_notes` (plain, unindexed — invoice/receipt document fields set from the Financials generator modal; §24), `notes`. On the detail page (`sale.js`) all fee fields render/edit above all date fields. Its own table (not a Dog field) so reserve/return/re-place stay distinct facts. |
| **Contract** | `contract_type` | `status` (defaults `draft`), `related_sale_id`, `related_stud_service_id`, `related_dog_id` (canonical Dog link, used only for `lease`/`co_own`/`other` types — where no linked Sale/StudService reaches a dog; forced `null` for other types via `contractRepo.DOG_LINK_TYPES`/`normalizeLinks`), `related_contact_id` (canonical counterparty link — lessee/co-owner/partner — for the same `lease`/`co_own`/`other` types via `CONTACT_LINK_TYPES`; sale/stud contracts reach their counterparty through the linked Sale/StudService, so it stays `null` there; scopes a contract into the **partner** companion bundle, §20), `document_url` (plain, unindexed — a share link to the signed document, e.g. a Drive "anyone with the link" URL; carried as a *pointer* into the buyer bundle, §20), `signed_date`, `lease_start_date`/`lease_end_date` (lease type; UI shows them and hides Related sale/stud fields when `contract_type='lease'`), `title`, `terms_summary`, `notes`. Generic across sale/stud/co-ownership/lease. Leaf for its own hard-delete (nothing points *at* a contract), but it points *at* its Dog via `related_dog_id` (guarded under `DOG_REFERENCES`) and its counterparty via `related_contact_id` (guarded under `CONTACT_REFERENCES`). |
| **StudService** | `direction`, `our_dog_id`, `partner_dog_id`, `partner_contact_id`, `status` | `pairing_id`, `fee_amount`, `fee_structure`, `pick_status` (plain, unindexed — suggested `pending`/`claimed`, free text allowed; meaningful **only** when `fee_structure ∈ {pick_of_litter, flat_plus_pick}`, forced `null` otherwise; feeds the partner companion bundle's compensation, §20), `pick_value_amount` (plain, unindexed decimal — the breeder's own estimated dollar value of the pick puppy, for income tracking; gated the same way as `pick_status`; deliberately **separate** from `fee_amount` (the actual cash); internal only — never in the partner bundle), `result_notes`, `type` (`in_person`/`ai` — coarse physical-travel flag; `in_person` + `sent_date`/`returned_date` window feeds the away-board, §19), `referred_by_contact_id` (indexed FK → the referring Contact; `CONTACT_REFERENCES`; on save `studServiceRepo` auto-tags `stud_referrer` via `contactRepo.ensureType`), `payment_method`/`payment_reference`/`invoice_number`/`invoice_notes` (plain, unindexed — invoice/receipt document fields, mirroring Sale's; only the outgoing direction is invoiceable, since incoming stud is an expense; §24), plus optional logistics dates. Covers both `incoming` and `outgoing`. |
| **Event** | `subject_type`, `subject_id`, `event_type`, `event_date`, `title` | `event_end_date`, `reminder_date`, `reminder_dismissed`, `related_dog_id`, `related_contact_id`, `details{}`, `notes`. See §8. **No `cost` field** — a cost entered on the event form is written to the Expense ledger (`expenses.event_id` = the event) and read back via `expenseRepo.getByEvent`; see the Expense row and §21. |
| **Expense** | `subject_type` (`dog`/`litter`/`pairing`/`kennel`), `subject_id`, `amount`, `category`, `expense_date` | `event_id` (nullable FK → the Event a cost was captured from — the one canonical event↔cost link; reverse is `expenseRepo.getByEvent`), `vendor`, `notes`. The Financials ledger: the single home for money spent. Polymorphic like Event; `kennel`-subject rows are kennel-wide overhead. Leaf entity (`EXPENSE_REFERENCES` empty). See §21. |

### 4.2 Relationship direction — the sixth design principle

**Every relationship has exactly ONE canonical stored side; the reverse is always a
derived query, never a second stored pointer.** So:

- Litter→Pairing is stored as `Litter.pairing_id`; a pairing's litter is
  `litterRepo.getForPairing`. There is no `Pairing.litter_id`.
- StudService→Pairing is stored as `StudService.pairing_id`;
  `studServiceRepo.getByPairing` is the reverse. There is no `Pairing.stud_service_id`.
- Contract→Sale / →StudService / →Dog / →Contact are stored on the Contract
  (`related_sale_id`, `related_stud_service_id`, `related_dog_id`,
  `related_contact_id` — the last two for `lease`/`co_own`/`other` contracts).
  Sales/stud-services/dogs/contacts carry no contract pointer;
  `contractRepo.getBySale`/`getByStudService`/`getByDog`/`getByContact` are the reverse.
- A Dog's children, a Contact's dogs, a Kennel's contacts — all derived queries over
  the indexed FK.
- Expense→Event is stored as `Expense.event_id` (the money owns the link); an event's
  cost is `expenseRepo.getByEvent`. There is no `Event.expense_id`/`Event.cost`.
  Expense→subject (dog/litter/pairing/kennel) is the polymorphic
  `[subject_type+subject_id]`; a subject's expenses are `expenseRepo.getForSubject`.

When you need "the reverse of X," write a query. Do not add a mirror field.

### 4.3 Two decisions that are settled — do not re-litigate

- **One `Dog` table** for breeding stock, puppies, and external dogs. A life-stage
  change is a `status` update on the same record, never a new row.
- **One `Event` table** for all dated history, polymorphic via
  `subject_type`/`subject_id`. No per-type event tables.

---

## 5. Dexie schema (`data/db.js`)

DB name: `KennelOSBreedingApp`. All ten tables live in a **single collapsed
`version(1)` block**. Indexes:

```
dogs:          id, sire_id, dam_id, litter_id, breeder_kennel_id,
               owner_contact_id, *co_owner_contact_ids, status, ownership_type,
               sex, breed, kennel_id, is_archived
events:        id, [subject_type+subject_id], event_type, event_date,
               reminder_date, related_dog_id, related_contact_id, is_archived
expenses:      id, event_id, [subject_type+subject_id], category,
               expense_date, is_archived
contacts:      id, kennel_id, waitlist_status, is_archived
kennels:       id, is_archived
pairings:      id, sire_id, dam_id, status, pairing_type, is_archived
litters:       id, pairing_id, sire_id, dam_id, status, whelp_date, is_archived
sales:         id, dog_id, buyer_contact_id, referred_by_contact_id, status,
               placement_type, is_archived
contracts:     id, contract_type, status, related_sale_id,
               related_stud_service_id, related_dog_id, related_contact_id, is_archived
stud_services: id, our_dog_id, partner_dog_id, partner_contact_id,
               referred_by_contact_id, direction, status, pairing_id, is_archived
```

Index notes:
- `events.[subject_type+subject_id]` **and** `expenses.[subject_type+subject_id]` are
  **compound** indexes (fast per-subject timeline / ledger). Do not split them.
- `expenses.event_id` is indexed so `expenseRepo.getByEvent` is an index probe.
  `expenses.category`/`expense_date` back the Financials report's filters.
- `sales.referred_by_contact_id` and `stud_services.referred_by_contact_id` are the
  referral FKs, guarded in `CONTACT_REFERENCES`.
- `dogs.*co_owner_contact_ids` is a **multi-entry** index ("dogs co-owned by X").
- `events.reminder_date` is indexed for the reminder engine's range probe. Every other
  canonical FK is indexed so reverse lookups are index probes, not scans.
- **Unindexed but persisted:** `events.event_end_date`, `events.reminder_dismissed`,
  `dogs.recorded_coi`, plus every non-indexed field. They persist and ride backups;
  they simply aren't queryable by key.
- `is_archived` is filtered in JS, not by index (IndexedDB can't key on booleans;
  trivial at kennel scale).

### The versioning rule

The single `version(1)` block is editable **only** because nothing has shipped that
needs migration — reconcile any change by Reset App + re-seed. **At the first real
release this changes permanently:** from then on, schema changes are *additive only* —
new tables/indexes go in a new `db.version(2).stores({...})` block, and shipped version
blocks are **never edited again**. If you add an index/table after real data exists, use
a new version block.

---

## 6. The repo layer

`repoBase.js`'s `makeRepo(tableName, references)` gives every entity the same thin
surface; each entity repo wraps it to add validation and derived queries.

Uniform surface:
- `getById(id)`
- `getAll({ includeArchived = false })` — archived filtered in JS
- `create(data)` — assigns `id` (UUID), `is_archived=false`, timestamps
- `update(id, changes)` — merges, preserves `id`/`created_at`, bumps `updated_at`
- `archive(id)` / `unarchive(id)` — soft delete (the normal "remove")
- `getDeleteBlockers(id)` — reference blockers without deleting (for UI)
- `hardDelete(id)` — blocked if any reference exists (throws `ReferenceBlockedError`)

Conventions each entity repo follows:
- `create`/`update` run a `validate<Entity>` first, then delegate to base. Update
  validates the **merged** result so partial updates are checked as a whole.
- Only hard, non-interactive rules live in the repo (required fields, cycle prevention,
  sire≠dam). Soft/interactive warnings (sex mismatch, date ordering, "leaving
  deceased") belong to the page UI — a repo can't prompt.
- Derived reverse-lookup helpers live on the repo (e.g. `dogRepo.getChildren`,
  `contactRepo.getDogs`, `contractRepo.getBySale`).

Notable repo specifics:
- **dogRepo**: pedigree cycle prevention in `validateDog` (walks ancestors with a
  visited-set); `addPlannedTests` (additive, dedupe-on-write); `getBreeds`.
- **eventRepo** (exported as both `HistoryEvent` and `eventRepo`): see §8.
- **saleRepo.isOpenSale(sale)**: true when a sale is non-archived and its status is not
  in `{delivered, returned, cancelled}`. Drives family-companion membership (§20) and
  the "open sale" filter.
- **contractRepo.governingContract(contracts)**: derived "live contract" = most recent
  `signed` by `signed_date` (fallback `created_at`), or null. Never stored.
  **contractRepo.isLivePartnerContract(c, today)**: non-archived, counterparty set, not
  a terminal status (`declined`/`cancelled`/`void`), and — for a lease — not past
  `lease_end_date`. Drives partner-companion membership and the partner bundle's
  contract block (§20), so the two can't drift.
- **kennelRepo**: `preferred_tests`/`preferred_breeds` authoring (dedupe-on-write;
  remove drops membership only, never purges a token another event may need);
  `getVocabulary`/`getBreedVocabulary` union over own-kennels.
- **expenseRepo**: `getForSubject`, `getByEvent`/`getOneByEvent`, `total(rows)`, and the
  one-time `migrateEventCosts()` (folds any legacy `Event.cost` into the ledger, guarded
  by the `expensesMigrated` settings flag; called from `app.js` boot). See §21.
- **contactRepo.ensureType(id, type)**: adds a `contact_type` role if missing (no-op
  otherwise). `saleRepo`/`studServiceRepo` call it on save to auto-tag a
  `referred_by_contact_id` as `buyer_referrer`/`stud_referrer`.

Two derived aggregators live in `data/` but are not repos and own no table:
- **incomeView** (`incomeView.js`): `getIncomeRows({includeArchived})` and
  `summarize(rows)` read Sale + outgoing StudService and classify each money component
  earned/anticipated for the Financials Income & Overview views. Each sale row also
  carries `dog_id`/`litter_id` (the puppy's litter) so income rolls up per litter. Also
  exports `incomeLineItems(sourceType, record)` — the cash line items (drops the
  non-cash `pick`, tags each with its label) the invoice/receipt generator builds from,
  so a document can't show a component the ledger wouldn't. Stores nothing; recomputed on
  every load. See §21 and §24.
- **litterFinances** (`litterFinances.js`): `getLitterFinances()` — one P&L row per
  litter for the **Litter P&L** report: puppy-sale income (earned/anticipated via
  incomeView, grouped by `litter_id`) vs the full litter cost (litter-subject expenses
  **plus** each puppy's dog-subject expenses) and the net. Stores nothing. See §21.

> Module naming trap: the Event repo's JS object is `HistoryEvent`/`eventRepo`, **never
> a bare `Event`** — that would collide with the DOM global.

---

## 7. Referential integrity (`data/referenceRegistry.js`)

Hard delete is the rare "undo a data-entry mistake" action; **soft delete (archive) is
the normal remove and never cascades**.

- Each entity has a declared array of every FK that can point at it (`DOG_REFERENCES`,
  `CONTACT_REFERENCES`, …). `findBlockingReferences(registry, id)` counts matching rows
  per entry and returns human-readable `{label, count}` blockers; `hardDelete` throws
  `ReferenceBlockedError` if any exist.
- `CONTACT_REFERENCES` covers owner/co-owner of a dog, buyer + referrer on a sale,
  partner + referrer on a stud service, contact on a boarding event, and the
  lease/co_own/other contract counterparty — so a contact documented anywhere can't be
  hard-deleted out from under it.
- `EVENT_REFERENCES` is `[{ expenses.event_id }]`: an event carrying a linked expense is
  hard-delete-blocked (archive it, or clear the Cost first). `eventRepo` is
  `makeRepo('events', EVENT_REFERENCES)`.
- `DOG_/LITTER_/PAIRING_/KENNEL_REFERENCES` each carry an `expenses.subject_id` entry
  (compound-index + discriminator), so a subject can't be hard-deleted out from under its
  expenses.
- `Contract` and `Expense` are leaves (empty `CONTRACT_REFERENCES` /
  `EXPENSE_REFERENCES` — nothing points *at* them).
- The guard **skips any table not present in the current schema** — so it can't rot;
  adding a referencing table later is one appended line.
- The polymorphic Event/Expense subject is matched via the compound index with a
  discriminator (`{compoundIndex:'[subject_type+subject_id]', discriminatorValue:'dog'|
  'pairing'|…}`).
- The blocking message is generated entirely from the registry, so it always matches the
  tables that actually exist — no hand-maintained carve-outs.

**When you add an FK anywhere, add its line to the registry** or hard-delete will
silently allow orphaning.

---

## 8. The Event model

One polymorphic table for all dated history. `subject_type ∈ {dog, pairing, litter}` +
`subject_id` say what it's attached to. The type catalog lives in `vocab.js`
`EVENT_TYPES`; each type carries:

> **Cost lives in the ledger, not on the Event.** The event form shows a "Cost" (+
> "Cost category") field, but on save it upserts an `Expense` carrying `event_id` = this
> event and the event's own subject; clearing the field removes that linked expense. The
> timeline reads the amount back via `expenseRepo.getByEvent`. See §21.
- `subjects[]` — which subject types may log it (`eventTypesFor(subjectType)` filters).
- `duration` — `'instant'` (single date) or `'span'` (`event_date` start, optional
  `event_end_date` end). Spans: `medication`, `heat_cycle`, `boarding`.
- `badge` — colour class.
- `fields[]` — the small type-specific form written into `details{}`. Field types:
  `text`, `textarea`, `number` (optional `step`), `date`, `combobox`
  (suggest-not-enforce), `select` (enforced, options[] only).
- `relatedContact: true` — surfaces the top-level `related_contact_id` FK (boarding,
  placement). Contacts on events are the canonical FK, never a `details` value.

**Placement specifics:** `dropoff_method` (`select`, enforced choice from
`PLACEMENT_METHODS` — Flight nanny / Ground transport / Local pickup / Other) sits first
in the form, directly above `placement_time`. A deferred-pickup boarding rate lives on
**`Sale`**, not here — see §5's Sale row and §21's money note.

Test-bearing types (`genetic_test`, `breed_specific_test`, `ofa_pennhip`) feed the
shared test vocabulary; `testTokensOf(event)` derives the test-name token(s).

**Litter-wide cascade** (`litter.js`'s "Log event for whole litter" → `openEventForm`'s
`cascadeTargets`): normally every checked puppy gets one Event with the *same*
`details{}`. `weight_check` is the one exception — `eventForm.js`'s
`PER_TARGET_CASCADE_FIELDS` names `weight_lbs`/`weight_oz` as per-target, so each checked
puppy gets its own weight inputs while `time_of_day` stays a single shared field. Add a
type to that map to give any other field the same per-puppy treatment.

### eventRepo reads (all siblings — deliberately never fused)

- `getForSubject(type, id)` — the timeline, newest first (compound index).
- `getBoardRows()` — dogs currently away via boarding events: `event_type='boarding'`,
  not archived, not yet ended. Whereabouts only — **not** all spans. This is ONE half of
  the away-board; `data/awayBoard.js` `getAwayBoardRows()` unions it with
  `studServiceRepo.getBoardRows()` (in-person stud services) into one view-model — §19.
- `getUpcoming()` — instant-duration events at/after today, any subject ("Upcoming
  Deliverables").
- `getScheduledPlacements()` — future `placement` events only.
- `getReminders()` / `getDismissedReminders()` — events with a non-null `reminder_date`,
  not archived, split by `reminder_dismissed`. `reminder_date` is the app's **one**
  future-dated mechanism. Bucketing into overdue/due-soon/upcoming is a display concern
  (30-day window), computed in the page, not the repo.
- Reminder mutations: `dismissReminder`/`undismissReminder` (not archiving, not a status
  change) and `snoozeReminder` (snooze **is** a `reminder_date` edit — there is no
  separate snooze field).

The overdue/due-soon boundary (`DUE_SOON_DAYS = 30`) is duplicated as a UI constant in
`reminders.js` and `dashboard.js`; keep them equal if you change it.

---

## 9. CSV import (`data/csvImport.js`)

Generic, entity-agnostic match-or-create engine used through the shared
`assets/importView.js` UI. Every import is a **dry-run preview** (create / update /
needs-review) before any write.

Flow: `parseCsv` (PapaParse; headers → lower_snake_case, values trimmed) →
`buildPlan(entity, rows)` → user reviews/adjusts decisions → `commitPlan`.

Rules that shape everything:
- **Natural key must be non-empty.** Keyless/partial-key rows are always "needs review" —
  never auto-matched, never silently created.
- Name match is case-insensitive + trimmed; dates exact. Enum/date cells normalize to a
  value, `''` (blank), or `null` (present but unrecognized → flagged).
- Relationship columns (sire/dam/dog names) resolve against **existing** records only; an
  unresolved name is flagged, never invented.
- **Two deliberate exceptions** auto-create a Contact inline at commit (never a stall):
  Sale's `buyer_name` and StudService's `partner_contact_name`, via each mapping's
  `prepareRecord` hook.

Per-entity natural keys: Dog = name+DOB; Contact = name; Pairing = sire+dam+planned;
Litter = dam+sire+whelp; Sale = dog+buyer+sale_date; Event (dog-subject only) =
dog+type+date (title tiebreak); StudService = our_dog+partner_dog+direction (no date, so
any existing match is always routed to review).

To add an entity to the importer: write one mapping object (`{entity, label,
templateHeaders, requiredForCreate, loadExisting, buildIndex, classify, describe, repo,
prepareRecord?}`) and register it in `MAPPINGS`. Don't rebuild the engine.

> Keep this file clean UTF-8 (no BOM). It contains user-facing review strings.

---

## 10. JSON backup / restore (`data/importExport.js`)

The cross-device data path. This module may use `db` directly (it's in the data layer,
doing cross-table transaction work).

- `exportAll()` iterates **whatever tables exist** (no hardcoded list) → `{ schema_version,
  format_version, exported_at, collections }`. `downloadBackup()` saves it and stamps
  `lastBackupDate`.
- `inspectBackup(obj)` validates shape and reports counts + unknown tables before any
  write.
- `restoreBackup(obj, mode)`:
  - `'replace'` — clears **every** known table first, then loads the file's rows, so the
    result is exactly the backup (a table the file omits ends up empty).
  - `'merge'` — upserts the file's rows by id, leaving other records intact.
  - Unknown collections (tables not in this schema version) are skipped, not errors.

`BACKUP_FORMAT_VERSION` bumps only when the on-disk shape changes in a migration-requiring
way.

---

## 11. First-run, sample data, seed, settings

- **settings.js** — the primary `localStorage` user. Pages never touch `localStorage`
  directly. Keys (all under `kennelOS.*`): `lastBackupDate`, `persistRequested`,
  `sampleDataManifest`, `sampleDataCleared`, `myKennelId`, `myContactId`,
  `myKennelSetupSkipped`, `companion` (the Companion feature's per-type message templates
  — Layer 1, §20 — one JSON object keyed by recipient type via
  `getCompanionSettings`/`setCompanionSettings`), `invoiceDefaults` (the invoice
  generator's default accepted payment methods, §24, via
  `getInvoiceDefaults`/`setInvoiceDefaults`). `clearAllSettings()` drops them all (used by
  Reset App).
- **nudgeState.js** — a second, deliberately separate `localStorage` module (one key,
  `kennelOS.nudgeDismissals`): the derived-nudge dismissal ledger (§19). Kept out of
  `settings.js`/`clearAllSettings()` on purpose — `appReset.js` calls its own `clearAll()`
  directly — and never exported in JSON backups: dismissals are device-local UI state, not
  portable domain data.
- **sampleData.js** — the "Thornfield Kennels" demo. Seeds through the **repo layer** (same
  validation as real data) and tracks created IDs in one manifest object (not an
  `is_sample` schema flag), so clearing is a lookup, not a scan. Deliberately **broad**
  (Tutorial Sample-Data Coverage Spec §6, Phase 2) so a first-run tour can point at a live
  example on every hub: a two-breed program (Boston Terriers **and** Boxers), a priced,
  actively-selling **Autumn litter** with an open sale (transport fee + deferred-boarding
  balance math), an **expected** litter, a lease (leased-in Boxer + `lease` contract) and a
  `co_own` contract, an **incoming AI** stud service, and dates tuned so seven of the eight
  Today nudges (§19) are live on a fresh seed — the litter→**close** rule is intentionally
  not live (it needs a `sold` litter whose placed pups are all `delivered`, which conflicts
  with the reopen/sold anchors and the packet size, per the spec's §9.3). Companion has ≥1
  recipient on all three tabs (prospective / current families / partners). Editing this file
  still bumps `CACHE_NAME` (§ service worker); it adds no new file or FK.
- **seedImport.js** — optional breed+test vocabulary seed (from
  `resources/common_tests_by_breed_seed.csv` or a user file). Appends to
  `Kennel.preferred_tests` / `preferred_breeds`; creates **no** records. Deliberately
  **not** routed through the csvImport engine (different shape). Used by both the standalone
  import page and the kennel-setup wizard.
- **kennelSetup.js** — the "your kennel and owner name" wizard; creates real
  Kennel/Contact records and remembers them by id in settings.
- **appReset.js** — `resetApp()` clears every table + all settings → the exact blank slate
  a never-visited browser sees.

First-run flow (`app.js`): request durable storage once → offer sample data; if declined
(or after sample data is later cleared), offer kennel setup. When sample data **is** seeded,
`maybeOfferWizardStart()` then offers the **guided tour** (below).

**Guided tour (first-run wizard).** A spotlight coach-mark tour of the seeded Thornfield
packet — a pure UI/state feature that reads existing records (never writes app data) and
persists its own progress in `localStorage` via `settings.js` (`wizardStatus` +
`wizardStepIndex`), no Dexie table, no schema, no `referenceRegistry.js` entry. Three
modules: **`data/wizardState.js`** (the status/index state machine + `isTourAvailable()`,
which gates the tour on the Thornfield seed being the active dataset — same two settings
signals as the sample-data banner), **`data/wizardSteps.js`** (the static ordered
`WIZARD_STEPS` catalog, authored from `Tutorial_Coverage_Matrix_v1.md` §B/§F — data only,
like `vocab.js`), and **`assets/wizardUI.js`** (the box-shadow spotlight overlay, tooltip,
nav "Take the tour" entry, and free-navigation "Resume tour" pill). `app.js`'s shared
`boot()` calls `runWizardStep()` unconditionally on every page — the only wizard hook; no
page file is wizard-aware. Detail-page steps carry an `anchor` slug that `wizardUI.js`
resolves to the current seed's real id at runtime via the `manifest.named` map the seed
writes (the seed uses runtime `crypto.randomUUID()` ids, so links can only resolve
per-seed). See `docs/Wizard_Runtime_Spec_v1.md` for the full design.

---

## 12. Service worker / PWA (`sw.js`)

App-shell cache so the app installs and works offline after first load.

- `CACHE_NAME` (currently `kennelos-shell-v73`) + a `PRECACHE_URLS` list of **every** app
  file (html/js/css/icons/vendor/resources).
- `install` precaches the list (**`cache.addAll` is atomic** — one missing/renamed file
  fails the whole install). `activate` deletes old caches. Fetch is **cache-first** for
  same-origin GETs, with runtime caching of anything new.

**The discipline that matters:** whenever you add, rename, or remove an app file — or edit
an existing one — you must (1) update `PRECACHE_URLS` and (2) bump `CACHE_NAME`. Because
fetch is cache-first, an installed client only picks up changes when `CACHE_NAME` changes.
Forgetting to precache a new module silently breaks offline for whatever imports it.

There is a maintenance check for this — see §16.

---

## 13. UI layer

### The two rendering frameworks — different escaping contracts

This distinction is the single easiest thing to get wrong. Learn it:

- **`assets/reportView.js`** — columns provide `value:(r)=>string` returning **plain text**;
  the framework escapes it (`esc`) before injecting. Return raw text; do not pre-escape.
  `badge` columns render a controlled-vocab badge. Has CSV export.
- **`assets/listView.js`** — columns provide `cell:(r)=>htmlString` returning **HTML**; the
  framework injects it **raw**. **The caller must `esc()` every user-controlled value inside
  `cell`.** Columns can be marked `sortable: true` with a `sortFn:(a,b)=>number` comparator
  to enable click-to-sort headers. Supports filters, "show archived", collapsible columns,
  grouping, optional CSV export.

When in doubt: `value` = text (auto-escaped), `cell` = HTML (you escape).

### Shared helpers (`assets/ui.js`)

`esc(s)` (HTML-escape — use it on every interpolated user value in hand-built innerHTML),
`badge`/`badges`, `fmtDate` (YYYY-MM-DD → localized), `param(name)` (read `?id=`),
`confirmAction` (and the styled modal dialogs). `todayYMD` is re-exported here but its one
implementation lives in `data/dateUtils.js`.

### Other components

- **timeline.js** — a subject's event list with add/edit/archive/delete; spans render as a
  date range; escapes all values.
- **pedigree.js** — derived ancestor tree from `sire_id`/`dam_id`; SVG connectors over
  positioned nodes. Bounded by a `generations` depth cap (default 3), which makes it
  cycle-safe regardless of data. Below the tree it renders a derived **Offspring** section —
  dogs whose `sire_id`/`dam_id` is the root — grouped by litter, sorted, with per-pup sex
  indicators.
- **eventForm.js** — add/edit-event modal; renders the type's `fields` into `details`,
  handles spans/reminders, persists empty optional dates as `null` (keeps them out of the
  reminder index). Supports applying one payload to multiple subjects. Also exports
  `openEventFromQuery(subjectType, subjectId, onSaved)` — since Event has no standalone page
  (polymorphic subject, §2), this is how `pages/today.js`'s Reminders and Due outs rows
  deep-link "into" an event: each row's button navigates to the subject's own page
  (`dog.html`/`pairing.html`/`litter.html`) with an extra query param, and that page's
  `main()` calls this once after loading its record. `openEvent=<id>` opens that exact event
  in edit mode; `logEvent=<event_type>` opens a fresh event of that type. Wired into
  `dog.js`/`pairing.js`/`litter.js` main() alongside their `new=1` prefill params.
- **puppyForm.js**, **importView.js**, **sampleDataUI.js**, **kennelSetupUI.js** — roster
  entry, the CSV dry-run/commit UI, and the two first-run prompt/banners.
- **contactPicker.js** — `attachNewContactButton(selectEl, {onCreated})` decorates any
  contact `<select>` with a "＋ New" button: minimal inline-create modal (name required),
  creates via `contactRepo.create`, appends+selects the option, fires a native `change`
  event. `onCreated` runs **before** that dispatch so a caller that re-renders the select
  from its own in-memory contact list (e.g. `sale.js`) sees the new contact already there.
  Wired into sale (buyer), stud-service (partner), and `eventForm.js` (boarding/placement
  related contact).
- **expensePanel.js** — the reusable per-subject expense ledger panel (§21).

### Navigation (`nav.js`)

Organized **by job, not by table**: six workflow hubs in the main bar — **Today / Dogs /
Breeding / People / Placements & Contracts / Financials** — plus a "More" corner menu for
**Reports**, **Companion** (§20), and **Import/Export**. Financials is a first-class hub,
not a report (money is operational; Reports are analytics queries). Detail/edit/import pages
are not nav entries; `HUB_CHILDREN` maps them to the hub tab that should light up. Links are
stored app-root-relative and prefixed at render time so they resolve from `index.html` or
`/pages/` and any GitHub Pages sub-path.

### Page catalog (`pages/`, one `.js` + `.html` each)

Hubs & landing: `today`, `dogs`, `breeding`, `contacts`, `sales`, `financials` (the
Financials hub — Overview / Income / Expenses toggle, §21), `reports`, `companion` (the
Companion Messaging console, §20), `import-export`, plus root `index.html`.
Dogs: `dog` (detail), `roster`, `pedigree`.
Breeding: `pairings`/`pairing`, `litters`/`litter`, `active-breeding`, `live-births`.
People: `contact`, `kennels` (list — identity CRUD only: name/prefix/location/own + archive/
delete) / `kennel` (detail — hosts that kennel's Expenses ledger plus, for own kennels, its
program configuration: the preferred-tests panel and the lifecycle-nudge thresholds). Both
map to the People hub in `HUB_CHILDREN`.
Placements/contracts: `sale`/`sales`, `stud-service`/`stud-services`, `contract`/`contracts`,
`puppy-record` (print-only puppy record, §23 — not a nav entry, reached from `sale`/`sales`).
Financials print docs: `invoice` (print-only invoice/receipt generator, §24 — not a nav
entry, reached from the Financials hub's "Invoice / Receipt" generator modal).
Today cluster: `dashboard`, `reminders`, `upcoming`, `board`, `scheduled-placements`.
Reports: `litters-report`, `stud-services-report`, `placements-report`,
`health-tests-report`, `litter-finances-report` (Litter P&L; `data/litterFinances.js`).
Import pages: `dog-import`, `contact-import`, `pairing-import`, `litter-import`,
`sale-import`, `event-import`, `stud-service-import`, `kennel-tests-import`.

---

## 14. Data conventions (quick reference)

- `id` = `crypto.randomUUID()`, client-side. No auto-increment.
- Soft delete only (`is_archived`). Never cascades, never destroys history.
- Date-only fields are `YYYY-MM-DD` strings compared **lexicographically**. Only
  `created_at`/`updated_at` are full ISO. "Today" is local wall-clock (`todayYMD`).
- Money is the app's native **decimal, never cents** — the shell/documents format it.
- Pickers exclude archived by default (toggle to include). Status/type = colored badges
  sourced from `vocab.js`.
- Controlled vocabularies live only in `vocab.js`; dropdowns and badges both read from it so
  they never drift.

---

## 15. Deliberately NOT built

Don't assume these exist; several are explicitly deferred "open doors":

- App-computed COI / relatedness / pairing-COI prediction (only a user-recorded
  `Dog.recorded_coi` exists).
- Genotype / Mendelian carrier-risk analysis; test-completeness audit.
- A recurrence-rule engine (recurrence = the "log the next one" workflow on the event;
  `reminder_date` is the only future-dated field).
- Photos / attachments (no `attachments` table, no Photos tab, no thumbnails). The only
  image field is `Kennel.logo_data_url` (§4).
- Pairing/litter-subject events in the CSV importer (dog-subject only).

---

## 16. Invariants checklist (before you commit)

1. **Layering:** no page imports `db.js` or calls `db.*`; no page touches `localStorage`
   (go through a repo / `settings.js`).
2. **One canonical direction:** you added a query for a reverse relationship, not a mirror
   field.
3. **New FK ⇒ registry line** in `referenceRegistry.js`.
4. **Escaping:** every user value in hand-built innerHTML is `esc()`'d; `listView` `cell`
   functions escape; `reportView` `value` functions return plain text.
5. **New/renamed/removed/edited app file ⇒ update `sw.js` `PRECACHE_URLS` **and** bump
   `CACHE_NAME`.** Sanity check:
   ```bash
   # from KennelOS/ — lists any app file missing from the precache, and any
   # precache entry with no file on disk. Both lists should be empty.
   python3 - <<'PY'
   import re, os
   sw = open('sw.js').read()
   urls = re.findall(r"'([^']+)'", sw.split('PRECACHE_URLS')[1].split(']')[0])
   real = [os.path.join(r,f).replace('./','') for r,_,fs in os.walk('.') for f in fs
           if f.endswith(('.js','.html','.css')) and '/vendor' not in r]
   print("missing from precache:", sorted(set(real)-set(urls)-{'sw.js'}) or "OK")
   print("listed but absent   :", [u for u in urls if u!='./' and not os.path.exists(u)] or "OK")
   PY
   ```
6. **Schema:** pre-first-release you may edit `version(1)`; after real data ships, additive
   `version(N)` blocks only, never edit a shipped block.
7. **Encoding:** source files are clean UTF-8, no BOM (matters most for files with
   user-facing strings like `csvImport.js`).
8. `node --check <file>.js` parses everything you touched (no bundler to catch it).

---

## 17. Local development

```bash
cd KennelOS
python3 -m http.server 8000      # or: npx serve
# open http://localhost:8000/  — never file://
```

There is no build, no test runner, and no linter wired in. Verification is: `node --check`
for syntax, serving locally and exercising the flow in a browser, and the precache sanity
check above. State resets via **Reset App to Start** (or clearing site data); sample data
via the first-run prompt or Import/Export.

---

## 18. Common maintenance recipes

**Add a field to an existing entity** — add it to the entity's form/detail page and (if
you'll query/filter/sort on it) to that table's index string in `db.js`. Plain persisted
fields need no schema change. Add validation to the repo only if it's a hard rule. If it's
an FK, add a `referenceRegistry.js` line. Update CSV mapping + sample data if relevant.

**Add an event type** — add one entry to `EVENT_TYPES` in `vocab.js` (`value`, `label`,
`badge`, `subjects`, `duration`, `fields`, and `relatedContact` if it needs a contact FK).
The event form, timeline, badges, and (for dog-subject types) the event importer pick it up
automatically.

**Add a report** — build a page that loads records and calls `createReportView` with
`columns` (`value` returns text), `filters`, `search`, and `csvFilename`; link it from
`pages/reports.html`. Add the new page to `sw.js` (recipe §16.5).

**Add a new entity** — new `db.js` table (new version block if post-release), new
`<entity>Repo.js` via `makeRepo` with a validator, a `referenceRegistry.js` array (and lines
wherever it's referenced), list/detail pages, a CSV mapping if it imports, nav wiring if it
deserves a hub, sample-data coverage, and `sw.js` precache entries. Build order: schema →
repo → list/detail → events/relationships → completeness features.

**Add a new page** — always finish by adding it to `sw.js` `PRECACHE_URLS` and bumping
`CACHE_NAME`, or it won't work offline.

---

## 19. Derived nudges & the away-board union

Two small `data/` modules sit on top of the repos as pure composition — neither owns storage
beyond the one localStorage ledger below.

**`data/nudges.js`** — `computeNudges()` reads current record state ONLY (no ledger
awareness) and returns zero or more:
```
{ key, title, detail, subjectHref, actions: [{ label, run: async () => {} }] }
```
Eight rules, each producing its own stable `key` so a dismissal survives re-computation:
- **Stud-service status** — `sent_date` passed + `status='arranged'` → suggest
  `in_progress`; `returned_date` passed + `status ∈ {arranged, in_progress}` → suggest
  `completed` (never both; completed wins if both hold).
- **Promote-lifecycle** — opt-in per kennel (`Kennel.promote_nudge_enabled`): a
  `status='puppy'`, `disposition='keeping'` dog past its kennel's
  `promote_age_male_months`/`promote_age_female_months` (by sex) gets a "promote to active
  breeding?" suggestion. No kennel, disabled, or non-`keeping` disposition ⇒ silent —
  decide-not-auto-promote, never a mutation on its own.
- **Stud → pairing** — a stud service that's `completed` or overdue-returned with no
  `pairing_id` yet suggests creating one, deep-linking to
  `pairing.html?new=1&stud_service=<id>`. Auto-dismisses: once `pairing_id` is set the rule
  produces nothing — the link is the done-signal, no ledger entry needed.
- **Heat → pairing** — a concluded `heat_cycle` event (`event_end_date < today`) with no
  live pairing recorded for that dam since the heat started suggests creating one via
  `pairing.html?new=1&dam=<dogId>`.
- **Overdue pairing** — a pairing in a pre-whelp status
  (`planned`/`bred`/`confirmed_pregnant`) whose `expected_due_date` has passed, with no
  litter recorded against it (`litterRepo.getForPairing`), suggests either fix: mark the
  pairing `whelped` directly, or deep-link to `litter.html?new=1&pairing=<id>`.
- **Litter → sold** — a non-archived `ready` litter whose whole roster is resolved to
  `placed`/`keeping`, with **at least one** actually `placed` (an all-`keeping` litter sold
  nothing, so it never fires), suggests marking the litter `sold`.
- **Litter → reopen** — a `sold` or `closed` litter with any puppy back to `available`
  suggests reopening it to `ready`.
- **Litter → close** — a `sold` litter with no `available` puppy where **every** `placed`
  puppy has a `delivered` sale suggests marking it `closed`. A placed puppy with no delivered
  sale — including one with no sale row at all — blocks the nudge.

The three litter-lifecycle rules are aggregate facts over a litter's derived roster (and, for
close, its sales), so `computeNudges()` groups the already-loaded `dogRepo.getAll()` result by
`litter_id` in one pass and adds `saleRepo.getAll()` to its parallel load rather than
re-scanning per record. Their actions mutate only `Litter.status` via `litterRepo.update`;
nothing auto-mutates. The stud→pairing and heat→pairing rules share one dedup helper
(`pairingExistsForDam`): a pairing counts as "already handled" if it's for the same dam, not
`cancelled`/`failed`, and opened (`planned_date`, falling back to `created_at`) on or after
the window in question.

**`data/nudgeState.js`** — the dismissal ledger (§11): `isDismissed`, `dismiss`, `clearAll`.
A computed nudge has no backing row to persist "dismissed" on, so dismissal is device-local UI
state, deliberately kept **out of** JSON backups.

**Rendering (`pages/today.js`)** owns the split: it calls `computeNudges()`, filters out
`isDismissed(key)` itself, renders what's left in a "Nudges" section (above Reminders), wires
each nudge's own action button(s), and adds one generic "Dismiss" button per row — the same
mechanism for every nudge, owned by the renderer.

**`data/awayBoard.js`** — `getAwayBoardRows()` unions two sources into one normalized
view-model (`{ dogId, location, reason, contactId, outDate, returnDate, dropoffTime,
pickupTime, sourceType, sourceId, href }`): `eventRepo.getBoardRows()` (boarding events) plus
`studServiceRepo.getBoardRows()` (stud services where `type='in_person'` and today falls in
`[sent_date, returned_date]`, open-ended if `returned_date` is null; away dog is always
`our_dog_id`; location resolves from the partner contact's `address`). Consumed by
`pages/board.js`, `pages/today.js` (`renderBoard`), and `pages/dashboard.js` (the away-count
tile). Boarding events still cover non-stud reasons (grow-out, foster, owner travel); a
stud-reason stay is authored on the StudService record itself, not duplicated as a boarding
event.

`StudService.type` and the three `Kennel` nudge fields are plain unindexed fields (§5); the
stud→pairing nudge action reuses the existing `StudService.pairing_id` link. No schema, index,
or reference-registry change.

---

## 20. Companion share-out (buyers & partners)

A **one-way, point-in-time export** of a curated slice of a recipient's own data, delivered as
a **no-account, read-only link** — not sync, not a login, not a live view. The main app stays
single-user/offline/all-local; this adds *recipients*.

### What it is

**Three bundle types**, all **anchored on a Contact** (the recipient) and discriminated by
`bundleType`:

- **`prospective`** — a prospective family (a client/waitlister with no sale): current
  availability as **one card per litter with its available pups nested inside** (`litters[]`,
  each with `nickname`, `breed`, `whelpDate`, `acceptDepositsDate` (from
  `Litter.accept_deposits_date`, rendered between "Born" and "Estimated ready" only when
  set), `readyDate`, a `dogCard` for `sire`/`dam`, and `pups[]`). Each pup carries `sex`,
  `callName`, `markings`, and its **sex-keyed list `price` + `deposit`**
  (`Litter.expected_price_*`/`expected_deposit_*`). The availability is the same for every
  prospect — **no per-recipient private data**.
- **`family`** — a current family (a buyer with an **open** sale per `saleRepo.isOpenSale`):
  **one rich card per placed pup** (`pups[]`, from `saleRepo.getByBuyer` filtered by
  `isOpenSale` → dog — terminal sales `delivered`/`returned`/`cancelled` never appear,
  matching membership). Each pup carries `callName`, `sex`, `photosUrl` (`Dog.url`),
  `litterNickname` (when set), `sire`/`dam` (call + registered name), a **computed `age`
  `{ageWeeks, ageDays}`** as-of the generation date (**never the raw DOB**), a `placement`
  block or an `estimatedReadyDate`, sale facts (`placementType`/`saleStatus` sent as raw
  values, the shell maps them to their proper-cased vocab labels; `price`, `deposit`,
  `transportFee` (shown only when present), `deferredPickup` (shown only when a
  `deferred_boarding_amount` is present — `{total, amount, frequency, duration}`, where
  `total = amount × count`; the shell shows the total with the rate breakdown beneath it), a
  **computed** `remainingBalance` = `price + transportFee + deferredPickup.total − deposit`
  (absent parts count as 0; never stored), and `balanceDueDate` (`Sale.balance_due_date`)),
  and an `eventSections[]` **curated per-type event history**. When the sale carries a
  **complete** deferred pickup (amount + frequency + duration) a `deferred_pickup_boarding`
  section is **pinned to the top** of `eventSections`, listing the dog's `boarding` events as
  `{startDate, endDate}` scheduled ranges (only the two dates copied — never boarding notes).
  Plus top-level `contracts[]` = the sale's non-archived contracts as `{signedDate,
  documentUrl}` (shell shows the signed date or "Not Signed" + a "View/sign contract here"
  link; legacy links carry a flat `contractUrls` list the shell still renders). Event history
  surfaces a **title + one curated safe field per type** — `vaccination`→`vaccine`,
  `preventative`→`product`, `weight_check`→weight, `milestone`→`description`, `note`→title
  only — **never** the freeform top-level `notes`, and **never** illness/injury/evaluation or
  any type not on that list.
- **`partner`** — a stud/lease/co-own partner: `studServices` (labeled **Stud/Dam `dogCard`
  blocks** carrying registered/call name + completed tests, each followed by an **Agreement
  Details** section — the service `type` (`in_person`/`ai`, proper-cased), `sentDate`/
  `returnedDate` relabeled **Begins/Ends**, `fee_structure` as **Terms**, plus the
  native-decimal `fee_amount` when the structure includes a flat fee and the `pick_status`
  when it includes a pick of litter — and a **Contract** section carrying the service's own
  governing/most-recent contract as `contract` = `{signedDate, documentUrl}`), and the
  top-level `contracts` (lease/co_own/other contracts where `related_contact_id` = them). Each
  is **projected per type** by `projectContract()`: all carry `type`, `title`, `status`,
  `signedDate` (shown "Not Signed" when null), `terms`, and `document_url`; a **`lease`** also
  carries `startDate`/`endDate` and `dog` (the leased dog as `dogRef` = `{registeredName,
  callName}`); a **`co_own`** also carries `dog`. The shell titles the card by type when it
  holds a single type ("Lease agreement" / "Co-ownership"), else "Contracts". These are
  reduced to the **live contract per distinct agreement, not the full history**: only
  `contractRepo.isLivePartnerContract(c, today)` contracts survive, grouped by
  `(contract_type, related_dog_id)`, and each group collapses to `governingContract()` (most
  recent signed) or the most-recent-by-`created_at` fallback. The **same
  `isLivePartnerContract` predicate drives partner membership** in `companion.js`, so who
  appears and what their bundle shows can't drift.
- **`dogCard` / completed tests** (shared projection): prospective sire/dam and partner
  stud/dam use `dogCard(dog)` → `{registeredName, callName, photosUrl, tests}`, where `tests`
  is `completedTests(dogId)` reading `eventRepo.getForSubject('dog', …)` and projecting
  `breed_specific_test` (`test_name`:`result`), `ofa_pennhip` (`joint`:`rating`), and
  `genetic_test` (`panel_name`:`result`) **only when the result/rating is non-empty** (else
  `[]`, block omitted).

### Console — one package type at a time

The **Companion Messaging console** (`pages/companion.*`, in the "More" menu) is scoped by
`?type=` seg-tabs — one per `COMPANION_TYPES` value (Prospective families / Current families /
Partners), the same URL-param tab pattern as the Contacts group tabs; no param defaults to the
first type. The active tab drives the whole page: the single template card shown, a
plain-language **filter blurb** above it, the **recipients list** (only contacts that match
the type), and the bundle type "Prepare link" builds (there is no per-row type picker — the
tab **is** the type).

Each recipient row is **collapsed by default** to a one-line header (name + a `note` badge
when `companion_note` is set + email/phone); clicking the header reveals the note editor, Save
note / Preview / Prepare link actions, and the built link. **Preview** builds the same bundle
"Prepare link" would (persisting any unsaved note first) and opens a modal showing the channel
body text plus the real `companion-view.html` shell loaded in an iframe off that bundle's hash
— a byte-for-byte render of what the recipient will see, sending nothing. Both actions share
`buildSendArtifacts`, so the preview can never drift from the send.

**Membership predicates** (`companion.js`): a **prospective** is a Contact with
`waitlist_status === 'active'`; a **family** is a buyer with an **open** sale per
`saleRepo.isOpenSale(s)`; a **partner** is a Contact who is the `partner_contact_id` on a
non-archived StudService whose `returned_date` is empty or `>= today`, **or** the
`related_contact_id` on a `lease`/`co_own`/`other` contract that is live per
`contractRepo.isLivePartnerContract(c, today)`. A Contact can appear under more than one tab —
that's expected. The prospective filter is display-only, but the **family** and **partner**
predicates are shared with the bundle builder, so membership and bundle contents stay in
lockstep.

### Two-layer messaging

Layer 1 is per-type config (`kennelName`/`tagline`/`introText`/`announcement`/`closer`, plus
the `include` component map — below) in `settings.js` under the `companion` key, edited in the
console's template card. Layer 2 is **`Contact.companion_note`**, a per-recipient personal
line. Both are carried in the bundle **separately** — `announcement` (broadcast) and
`personalNote` (the note) — and the shell shows them **alongside each other**. The shell
**prepends the recipient's name** to the intro text ("Hi {name} — …"; there is no separate
greeting card), renders the personal note in the header card's accent box, the broadcast
announcement as its own card beneath, and the `closer` sign-off as the final card **just above
the snapshot date**. The bundle copies the resolved copy inline, so header/landing text updates
without a shell deploy.

### Per-type component allow-list (`include`)

A third piece of Layer-1 config: a flat map of boolean flags, one set per bundle type, stored
under `companion[type].include` and edited as the "What to include" checkboxes in each template
card. **All flags default `true`** — everything shows — and `getCompanionSettings` deep-merges
the map over the defaults so a flag the owner never set (or one added in a later version) falls
back to on, never silently hiding a component. Each builder reads its type's `include` and
**only ever subtracts**: a disabled component's field is emitted `null`/`''`/`[]` (or the
section is skipped), never a new key — so the allow-list invariant below is untouched and no
`COMPANION_BUNDLE_VERSION` bump is needed. **Master/child flags:** a master gates a group
(`parents`, `pricing`, `studServices`) and the builder ANDs each child with its master, so a
child only emits when both are on; the console greys out a child whose master is unchecked.

The flags, by type:
- **prospective:** `parents` (→ `parentRegisteredName`, `parentCallName`, `parentPhotos`,
  `parentTests`), `pricing` (→ `pricingPrice`, `pricingDeposit`), `litterDates` (born /
  accept-deposits / estimated-ready), `markings`. When every `dogCard` field is off the card is
  omitted entirely; when no pup carries a price/deposit the shell drops the deposit disclaimer.
- **family:** `age`, `parentage`, `photos`, `readyPlacement`, `financials` (price, deposit,
  transport, deferred-pickup, remaining balance, balance-due — **not** placement type / sale
  status, which always show), the five history flags `histVaccination`/`histPreventative`/
  `histWeight`/`histMilestone`/`histNote`, `histBoarding` (deferred-pickup boarding section),
  `contract`.
- **partner:** `studServices` (master → `studRegisteredName`, `studCallName`, `studPhotos`,
  `studTests` for the Stud/Dam cards, plus `studAgreement` for the Agreement Details/
  compensation and `studContract` for the per-service contract), and top-level `contracts`
  (lease / co-own / other).

### The load-bearing invariant: the allow-list builder

`data/companionExport.js` is the **security spine**. `importExport.js` deliberately iterates
whatever tables exist (a full backup); this builder does the **exact opposite**:
`buildProspectiveBundle`/`buildFamilyBundle`/`buildPartnerBundle(contact)` each **construct a
fresh object naming every field explicitly**, reading through repos (never `db.*`), copying
**only** listed fields — **no record spread, no filter-over-a-record**. After building,
`assertOnlyKeys()` runs a **positive** allow-list check and **aborts the send** if any
unexpected top-level key is present. A new field added to a source table does **not** appear in
a bundle until someone adds it here by name — including fields nested inside a pup/litter/
service, safe only because each is copied by name and the **top-level** `*_KEYS` allow-lists
stay exact. Money is limited to the recipient's **own** figures: a prospect sees the litter's
per-sex list price/deposit, a family sees their own sale price/deposit/balance, a partner sees
the one stud `fee_amount`.

### Transport & the shell

- The bundle rides the **URL fragment**: `JSON.stringify` → **lz-string**
  (`vendor/lz-string.min.mjs`, vendored + version-locked, v1.5.0) →
  `companion-view.html#<hash>`. Send is a **real `sms:`/`mailto:` anchor** the user taps (their
  tap is the activating gesture — never a post-async `window.location` assignment). **Channel
  by size:** email is the default; SMS is blocked above `MAX_SMS_HASH_LEN` and steered to
  email; email warns above `MAX_EMAIL_HASH_LEN` (the console's `prepareLink`).
- **`companion-view.html`** is the recipient shell — one self-contained, read-only static file
  at the app root (inlined, version-locked lz-string; branches on `bundleType` and
  `bundleVersion`; **tolerates additive fields**; theme-aware; shows a prominent "snapshot as
  of" line). It is **infrastructure**: it must stay **backward-compatible with every
  `bundleVersion` ever sent** — bundle evolution is additive, `bundleVersion` bumps only on a
  breaking shape change, and a shell fix must not break links sent last month.

### No revocation / no expiry

A hash-link, once sent, is permanent. The sensitive document is **never in the hash** — only
`document_url`, a pointer; access is governed by the owner's Drive sharing, which they revoke
independently. `updatedAt` renders prominently so a stale link is self-evident.

### Model touch-points (all covered in §4/§5/§7)

`Contract.related_contact_id` (indexed FK, `CONTACT_REFERENCES`, `getByContact`),
`Contract.document_url`, `StudService.pick_status`, `Contact.companion_note` — the last three
plain/unindexed. `companionExport.js` and the console/shell are pure composition + projection;
no two-way pointers, every reverse stays a query.

---

## 21. Financials — income & the Expense ledger

The Financials hub has **three views**, switched by a top toggle
(`financials.html?view=overview|income|expenses`; a bare URL opens Overview, a `?bucket=` link
still opens Expenses):

- **Expenses** — the Expense ledger (money spent).
- **Income** — a **derived** view of money coming in, sectioned earned vs anticipated.
- **Overview** — Earned income / Anticipated income / Total expenses / **Net (earned − spent)**
  tiles, plus a component breakdown of income beside a category breakdown of expenses.

### The Expense ledger (money spent)

The single home for money spent. One `expenses` table (§4/§5), polymorphic like Event:
`subject_type ∈ {dog, litter, pairing, kennel}` + `subject_id`. Kennel-wide overhead (facility,
bulk food, registration dues, marketing) lives on `subject_type='kennel'`; there is deliberately
**no `general` subject** — program overhead is logged against your own kennel, so there is never
a null `subject_id`. Revenue is **not stored** here (it stays on `Sale.price`/`deposit_amount`
and `StudService.fee_amount`); this table is costs only.

Buying a new dog is deliberately an **expense, never a Sale** — `Sale` and `StudService` stay
strictly income-side records (owner decision). `EXPENSE_CATEGORIES` carries a `dog_purchase`
("New dog purchase") category; the dog's own `acquisition` event type (dog-subject, instant,
`source` field for the seller) is an **option** on that dog's timeline, never auto-created, and
its default Cost category (`defaultExpenseCategoryFor`) is `dog_purchase` — logging one with a
Cost amount upserts the linked `Expense` the normal event↔cost way.

### The event↔cost link (one canonical direction)

`Expense.event_id` is the **only** stored link between an event and its cost:

- **Event form → ledger.** The event form's "Cost" (+ "Cost category") field is a convenience
  writer: on save (`assets/eventForm.js`) it upserts an `Expense` carrying `event_id` = the
  saved event and the event's own subject; clearing the Cost hard-deletes that linked expense.
  Cascade (litter-wide) events create one linked expense per created event. Event stores **no
  `cost` field**.
- **Ledger → event (display).** `timeline.js` reads amounts back via `expenseRepo.getByEvent`
  and shows a `🔗 event` tag on linked ledger rows.
- **Ledger → event (create).** In `assets/expensePanel.js`, a dog/litter/pairing expense with
  no `event_id` offers "Log event →": it opens the event form for that subject and, on save,
  back-fills the new event's id onto the expense. No mirror field — the reverse is always the
  `getByEvent` query.

### Income (derived — `data/incomeView.js`)

There is **no income table and no `is_earned` field.** `data/incomeView.js` is a read-only
aggregator: it reads the Sale table and the **outgoing** StudService table — the only two places
money-in is recorded — and normalizes each into one view-model row per record, classifying every
money component as **earned** or **anticipated** on each load. Storing this (or a mirror flag)
would be a forbidden stored back-pointer (§7); it is always recomputed.

Classification (owner decisions):

- **Sale.** `price` splits into a deposit portion (`deposit_amount`) and a balance portion
  (`price − deposit`); `transport_fee` and deferred-pickup boarding (`deferred_boarding_amount ×
  count`, the count in `deferred_boarding_duration_days`) ride with the balance. A component is
  **earned** once its paid-date is recorded (`deposit_date` / `balance_paid_date`) or the status
  has advanced past it (`deposit_paid`/`paid_in_full`/`delivered`), else **anticipated**. On a
  **returned/cancelled** sale only amounts already recorded as paid survive (as earned); the
  unpaid remainder is dropped, never anticipated. A part-paid open sale therefore appears in
  **both** the Earned and Anticipated boxes, each with its own portion.
- **StudService (outgoing only** — incoming is money *we* pay, an expense). `fee_amount` is
  **earned** when `completed`, **anticipated** while `arranged`/`in_progress`, dropped when
  `failed`/`cancelled`. `pick_value_amount` is a **non-cash estimate**, surfaced on its own
  `pick` line and kept **out** of the earned/anticipated cash totals and the Net figure.

Vocabs (`vocab.js`): `INCOME_STATES` (earned/anticipated badges), `INCOME_SOURCE_TYPES`
(sale/stud badges), `INCOME_COMPONENTS` (deposit/balance/transport/boarding/stud_fee/pick — the
summary's per-component breakdown, mirroring the expense category one).

Income surfaces (`pages/financials.js`): the Income view shows a summary card
(earned/anticipated totals + component breakdown) then **two grouped boxes** — **Earned** and
**Anticipated** — each a `reportView` table (one row per sale/stud, source/year filters, CSV
export). Clicking a row opens a compact **Adjust** modal that writes the money/status/paid-date
fields straight back through `saleRepo.update` / `studServiceRepo.update` (with an **Open full
record →** link), so an anticipated amount can be flipped to earned from the hub. No new FK,
table, or `referenceRegistry` entry — income is purely derived.

**Per-litter income** (sales reach a litter via the puppy's `dog.litter_id`): the **Litter
detail page** has a deliberately simple "Sales & Income" panel — each puppy sale's **total
value** (`price + transport + deferred boarding`) and status, with a total, and **no**
earned/anticipated split or net (owner decision — that detail lives only on the report). The
**Litter P&L report** (`litter-finances-report`, `data/litterFinances.js`) is the full picture:
earned/anticipated income vs the litter's own expenses **plus** each puppy's dog-subject
expenses, and the net.

### Surfaces

- **`assets/expensePanel.js`** — the reusable per-subject ledger panel (running total,
  add/edit/archive/delete, its own add-expense modal). Mounted on the dog, litter, pairing, and
  **kennel** detail pages (the last via `pages/kennel.*`, reached from the Kennels list's
  "Open →").
- **`pages/financials.*`** — the **Financials hub** (its own top-level nav tab, not a report),
  with the **Overview / Income / Expenses** top toggle. The **"+ Add Expense"** button (logs a
  cost against any dog / litter / pairing / kennel) shows only on the Expenses view.
  - **Expenses view:** a summary card (grand total + per-category breakdown) over the standard
    `reportView` ledger table (category/subject-type/year filters + CSV export). **Sectioned by
    category:** a `seg-tabs` row built from `EXPENSE_CATEGORIES` (never hand-listed), one tab per
    category via `financials.html?view=expenses&bucket=<value>` pre-filtering the loaded ledger,
    plus **All** (default, no `bucket`). The ledger loads newest-to-oldest by `expense_date`
    before any bucket filter.
  - **Income view:** summary card + two grouped Earned/Anticipated `reportView` boxes with the
    row-level Adjust modal.
  - **Overview view:** the Net tiles + income/expense breakdown.

### Migration & safety

- `expenseRepo.migrateEventCosts()` folds any pre-existing `Event.cost` into linked expenses
  once (guarded by the `expensesMigrated` settings flag; run from `app.js` boot; idempotent; a
  no-op after Reset App since no event then has a cost).
- **Companion export is safe by construction** — `companionExport.js` is a positive allow-list
  (§20), so `expenses` never appears in any bundle. Financials do not leak.
- **Hard-delete guards** (§7): an event with a linked expense, and a subject with any expense,
  are archive-only until the expense is removed.

---

## 22. Referral tracking (Sale / StudService "Referred by")

`Sale.referred_by_contact_id` and `StudService.referred_by_contact_id` are indexed FKs → Contact
(§4/§5), guarded in `CONTACT_REFERENCES`. Each page's form has a "Referred by" picker (any
contact; the stud page uses a general picker, not its breeder-only partner one). On save the repo
calls `contactRepo.ensureType` to auto-tag the referrer with the `buyer_referrer` /
`stud_referrer` role (`CONTACT_TYPE` vocab). The tag is a convenience label; the canonical link
stays the FK on the Sale/StudService, and a contact's referrals are the reverse query over the
indexed FK.

---

## 23. Puppy Record (print-only PDF)

`pages/puppy-record.html`/`.js` (`?sale=<id>`) is a printable, one-page-style record for a puppy
being sold: puppy info, sire/dam (with their genetic + breed-specific test results as a
pipe-separated line), a **Health History** grid — one card per health-relevant event type
(`vaccination`, `preventative`, `genetic_test`, `ofa_pennhip`, `breed_specific_test`, `illness`,
`medication`, `surgery`, `vet_visit`, `injury`, `abnormalities`, `weight_check` — deliberately
excludes admin/lifecycle types like `milestone`/`placement`/`note`) — and the buyer's contact
info off the Sale. Every row is omitted (not shown as a blank/"—") when its field is empty. Reads
only, through `saleRepo`/`dogRepo`/`contactRepo`/`litterRepo`/`eventRepo` (layering rule, §2) — no
new repo or table.

**"Download" is the browser's own Print → Save as PDF** (`window.print()`, gated by an `@media
print` block that hides nav/back/print-button), not a vendored PDF library. Entry points: a
"Puppy Record (PDF)" button on `sale.js`'s header actions, and a "Print Puppy Record" button on
`sales.js` that opens a modal — a dropdown of every **non-delivered** sale (`status !==
'delivered'`), ordered by dog name, buyer name shown alongside for disambiguation — whose Print
button opens the record in a new tab with `?autoprint=1`, which triggers `window.print()` itself
once rendered.

The header also renders the resolving own-kennel's `logo_data_url` (§24) above the kennel name
when one is set.

---

## 24. Invoice & Receipt (print-only PDF)

`pages/invoice.html`/`.js` (`?source=sale|stud&id=<id>&doc=invoice|receipt&cfg=<json>`) is a
printable one-page financial document for a single income record, covering **all five cash income
types** — **Deposit, Remaining Purchase Price, Transport Fee, Boarding Fee** (the four Sale
components) and **Stud Fee** (the outgoing StudService component; customer-facing labels from
`INVOICE_LINE_LABELS`, distinct from the Financials-view `INCOME_COMPONENTS` labels). Non-cash
`pick` value is never billable, so it never appears. Reads only, through
`saleRepo`/`studServiceRepo`/`dogRepo`/`contactRepo`/`litterRepo`/`kennelRepo` (layering rule §2)
— no new repo or table. "Download" is the browser's own **Print → Save as PDF** (`window.print()`,
gated by an `@media print` block), same posture as the Puppy Record.

- **Line base amounts** come from `incomeView.incomeLineItems(source, record)` (§6/§21), so the
  document can never show a component the Income view wouldn't classify. The per-line **choices**
  ride the `cfg` param (a compact URL-encoded JSON the generator modal builds): each included line
  carries `{ key, mode: 'full'|'partial', collected, dueDate }`.
- **Full vs Partial** (per line, owner's model): **Partial** prints "<Name> (partial)" with the
  entered `collected` as its amount; **Full** prints the record's full base amount, and
  `collected` is treated as *already collected* — on an **invoice** it is subtracted in the totals
  (Subtotal → "Less amount already collected" → **Balance**), on a **receipt** the line shows the
  remaining `base − collected`, the collected figure is not printed, and the label reads "<Name>
  **(balance)**". There is no payment ledger, so `collected` defaults to 0 for manual entry.
- **Invoice specifics:** no Paid/Due status column; a per-line **Due by** date (the modal prefills
  the *soonest* of the sale's `balance_due_date` and any scheduled `placement` event date for the
  puppy, still editable per line) — **except Deposit, whose Due by is always "Immediately"**, so
  the modal shows a static "Due immediately" note for that line instead of a date picker; footnote
  markers on **sale** invoices (`*` on Deposit, `**` on Remaining Purchase Price / Transport /
  Boarding — stud fees carry neither) render the two standing disclaimers (deposit
  non-refundability; balance-due-date basis) in the footer; the payment block reads **"Payment may
  be made using one of the following methods:"** over a checkbox-style list of the **accepted
  methods** — a global default in `settings.getInvoiceDefaults().acceptedMethods`, editable per
  document in the modal (checkbox set from `PAYMENT_METHODS`) with a **Save as my default** button
  (`setInvoiceDefaults`).
- **Receipt specifics:** keeps the **Payment received** box (method used / reference / date) and
  stamps **Paid**; totals "Total paid".
- **Issuer** is the resolving own kennel (`dog.kennel_id` if own, else the first own kennel — the
  Puppy Record fallback), with its `logo_data_url`, `location`, `website`, and the owner Contact's
  name/email/phone (via `getMyContactId`). **Recipient** is the sale's buyer or the stud partner
  contact. A document number defaults to a stable `INV-/RCT-<yyyymmdd>-<id>` when `invoice_number`
  is blank.
- **Persisted fields** (`invoice_number`, `invoice_notes`, and — for receipts —
  `payment_method`/`payment_reference`, §4) are written on the Sale / StudService by the generator
  modal so they prefill next time and ride backups. Everything else (Full/Partial, collected, due
  dates, accepted methods) is per-generation and rides `cfg` / `settings`. Nothing here is a new
  FK, table, or `referenceRegistry` entry — the fields are plain and the document is pure
  projection.

The generator modal lives on the Financials hub (`financials.js`, the "Invoice / Receipt" button
on every view), lists every income record (from `getIncomeRows`), and opens the print page in a new
tab. The document **never prints itself** — the owner triggers the browser's Print → Save as PDF
with the page's "Print / Save as PDF" button.
