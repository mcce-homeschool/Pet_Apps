# KennelOS — End-State Design & Maintenance Guide

A single, current-state reference for the KennelOS dog-breeding records app. This
describes what the app **is today** and how to work on it safely. It is meant to be
the first doc a maintenance session reads: it consolidates the architecture,
data model, module map, invariants, and the common "how do I change X" recipes.

The stage-by-stage build briefs in this folder remain the historical record and the
finest-grained source of intent; where a field-level or rule-level detail matters,
the code and `Data_Model_Architecture_Proposal_v3.md` are authoritative. This guide
is the map, not a replacement for them.

---

## 1. What the app is

A **local-first, static, multi-page web app** for managing a dog-breeding program:
dogs and pedigrees, contacts, kennels, pairings and litters, sales/placements,
stud services, contracts, a polymorphic health/history event log, reminders, a
dashboard, and analytics reports.

- **No backend, no build step.** Plain ES modules served over HTTP. Hosted on
  GitHub Pages; all data lives in the browser (IndexedDB via Dexie).
- **Single user, single device** is the design centre. Data moves between devices
  only through explicit JSON backup/restore or CSV import/export.
- **Offline-capable PWA.** A service worker precaches the app shell so it works
  offline after the first load.

---

## 2. Architecture non-negotiables

These are load-bearing. Changing any of them is a design decision, not a routine edit.

1. **Multi-page static, no SPA router.** One `.html` per screen, each pulling in
   shared JS. Navigation is real links between pages.
2. **Strict layering: pages → repos → Dexie.** Pages never import `db.js` and never
   call `db.*`. Only the repo modules in `data/` touch Dexie. (Verified: zero page
   references `db.` directly.)
3. **ES modules over HTTP.** Must be served (`python3 -m http.server`, `npx serve`,
   or GitHub Pages) — never opened as `file://`, which CORS-blocks module imports.
4. **No CDN / no network deps.** Everything third-party is vendored under
   `KennelOS/vendor/` and loaded by relative path (Dexie, PapaParse). The app must
   work fully offline after first load.
5. **One thin repo per entity**, uniform surface (see §6). New entity = new repo +
   new page; you don't reshape existing ones.

---

## 3. Directory layout

```
CLAUDE.md                      Session brief (read first)
docs/                          Design docs (this file is the end-state map)
KennelOS/
  index.html                   App root / landing
  app.js                       Shared shell bootstrap (nav, PWA, first-run flow)
  nav.js                       Top-nav definition + rendering
  sw.js                        Service worker (app-shell precache, offline)
  manifest.json                PWA manifest
  vendor/                      Vendored deps: dexie.min.mjs, papaparse.min.mjs
  resources/
    common_tests_by_breed_seed.csv   Optional breed→test seed data
  data/                        THE DATA LAYER (repos + shared data logic)
    db.js                      Dexie schema — the only schema definition
    repoBase.js                makeRepo factory (shared repo surface)
    referenceRegistry.js       FK declarations + hard-delete guard
    dogRepo / contactRepo / kennelRepo / pairingRepo / litterRepo /
      saleRepo / contractRepo / studServiceRepo / eventRepo   Entity repos
    dateUtils.js               todayYMD / date helpers (single "what is today")
    vocab.js                   Controlled vocabularies + event-type catalog
    csvImport.js               Generic CSV match-or-create engine + mappings
    importExport.js            JSON backup / restore
    appReset.js                Full "reset to first run" teardown
    sampleData.js              "Thornfield Kennels" demo seed/clear
    seedImport.js              Optional breed+test vocabulary seed
    kennelSetup.js             First-run "your kennel/owner" wizard logic
    settings.js                localStorage-backed UI prefs / identity keys
    nudgeState.js              Device-local dismissal ledger for derived nudges
    nudges.js                  Derived-nudge engine — computeNudges() (see §19)
    awayBoard.js                "Away from home" union: boarding events +
                                in-person stud services, one view-model (see §19)
  assets/                      Shared UI helpers + reusable components
    ui.js                      esc(), badge(), fmtDate(), param(), fillSelect()…
    listView.js                Reusable list screen (cells return HTML)
    reportView.js              Reusable report screen (values return text)
    timeline.js                Subject health/history timeline
    pedigree.js                Ancestor-tree renderer
    eventForm.js               Add/edit event modal
    puppyForm.js               Litter → puppy roster entry
    contactPicker.js           Inline "＋ New contact" decorator for pickers
    importView.js              Shared CSV import dry-run/commit UI
    sampleDataUI.js            First-run sample-data prompt + banner
    kennelSetupUI.js           Kennel-setup prompt/wizard + seed prefill
    reportView / listView …    (see §13)
  pages/                       One .js + .html per screen (see §13 catalog)
```

---

## 4. Data model

### 4.1 Entities and their required fields

Every record also carries `id` (UUID), `is_archived` (bool), `created_at`,
`updated_at`. Dates are `YYYY-MM-DD` strings except `created_at`/`updated_at`
(full ISO). Required = enforced in the repo's validator; everything else is optional
and commonly blank at entry time.

| Entity | Required | Notable other fields |
|---|---|---|
| **Dog** | `call_name`, `sex`, `breed`, `ownership_type`, `status` | `registered_name`, `date_of_birth`, `date_of_death`, `sire_id`, `dam_id`, `litter_id`, `breeder_kennel_id` (the kennel that *produced* this dog — own or an outside contact's; distinct from `kennel_id` below, which of the user's own kennels it belongs to *now*; auto-prefilled from the litter's dam's own `kennel_id` when that dam is owned/co-owned), `owner_contact_id`, `co_owner_contact_ids[]`, `kennel_id`, `color_markings`, `registry`, `registration_number`, `microchip_id`, `planned_tests[]`, `recorded_coi{value,method,source,as_of_date}`, `disposition` (`undecided`/`keeping`/`available`/`placed` — breeder intent, orthogonal to `status`; feeds the Today "Available puppies" feed and the promote-lifecycle nudge, §19), `notes`. Owner required when `ownership_type ∈ {external, leased_in}`. |
| **Contact** | `name` | `contact_type[]` (multi), `email`, `phone`, `address`, `kennel_id`, `waitlist_status`, `first_contact_source`, `notes`. Buyers are Contacts — **there is no Buyer table**. `address` also resolves an in-person stud service's away-board location (§19). |
| **Kennel** | `kennel_name` | `is_own_kennel`, `preferred_tests[]`, `preferred_breeds[]`, `promote_nudge_enabled` (bool, default off), `promote_age_male_months`/`promote_age_female_months` (numbers — the promote-lifecycle nudge's per-kennel thresholds, §19). Lightweight; added inline from Contact form. |
| **Pairing** | `sire_id`, `dam_id`, `pairing_type`, `status` | `method`, `planned_date`, `expected_due_date`, `notes`. Sire ≠ dam (hard block). |
| **Litter** | `dam_id`, `sire_id`, `status` | `pairing_id`, `whelp_date`, `litter_registration_number`, `puppies_born_total/alive/deceased`, `notes`. Litter's own sire/dam are authoritative. Puppy roster is **derived** (`Dog WHERE litter_id`). |
| **Sale** | `dog_id`, `buyer_contact_id`, `placement_type`, `status` | `sale_date`, `price`, `deposit_amount`, `deposit_date`, `balance_paid_date`, `lead_source`, `notes`. Its own table (not a Dog field) so reserve/return/re-place stay distinct facts. |
| **Contract** | `contract_type` | `status` (defaults `draft`), `related_sale_id`, `related_stud_service_id`, `signed_date`, `notes`. Generic across sale/stud/co-ownership/lease. Leaf entity. |
| **StudService** | `direction`, `our_dog_id`, `partner_dog_id`, `partner_contact_id`, `status` | `pairing_id`, `fee_amount`, `fee_structure`, `result_notes`, `type` (`in_person`/`ai` — coarse physical-travel flag; `in_person` + `sent_date`/`returned_date` window feeds the away-board, §19), plus optional logistics dates. Covers both `incoming` and `outgoing`. |
| **Event** | `subject_type`, `subject_id`, `event_type`, `event_date`, `title` | `event_end_date`, `reminder_date`, `reminder_dismissed`, `related_dog_id`, `related_contact_id`, `details{}`, `cost`, `notes`. See §8. |

### 4.2 Relationship direction — the sixth design principle

**Every relationship has exactly ONE canonical stored side; the reverse is always a
derived query, never a second stored pointer.** This is why:

- Litter→Pairing is stored as `Litter.pairing_id`; a pairing's litter is the query
  `litterRepo.getForPairing`. There is no `Pairing.litter_id`.
- StudService→Pairing is stored as `StudService.pairing_id` (mirrors the litter
  link); `studServiceRepo.getByPairing` is the reverse. There is no
  `Pairing.stud_service_id`.
- Contract→Sale / Contract→StudService are stored on the Contract
  (`related_sale_id`, `related_stud_service_id`). Sales/stud-services carry no
  contract pointer; `contractRepo.getBySale`/`getByStudService` are the reverse.
- A Dog's children, a Contact's dogs, a Kennel's contacts — all derived queries over
  the indexed FK, never stored back-pointers.

When you need "the reverse of X," write a query. Do not add a mirror field.

### 4.3 Two decisions that are settled — do not re-litigate

- **One `Dog` table** for breeding stock, puppies, and external dogs. A life-stage
  change is a `status` update on the same record, never a new row.
- **One `Event` table** for all dated history, polymorphic via
  `subject_type`/`subject_id`. No per-type event tables.

---

## 5. Dexie schema (`data/db.js`)

DB name: `KennelOSBreedingApp`. All nine tables live in a **single collapsed
`version(1)` block**. Indexes:

```
dogs:          id, sire_id, dam_id, litter_id, breeder_kennel_id,
               owner_contact_id, *co_owner_contact_ids, status, ownership_type,
               sex, breed, kennel_id, is_archived
events:        id, [subject_type+subject_id], event_type, event_date,
               reminder_date, related_dog_id, related_contact_id, is_archived
contacts:      id, kennel_id, waitlist_status, is_archived
kennels:       id, is_archived
pairings:      id, sire_id, dam_id, status, pairing_type, is_archived
litters:       id, pairing_id, sire_id, dam_id, status, whelp_date, is_archived
sales:         id, dog_id, buyer_contact_id, status, placement_type, is_archived
contracts:     id, contract_type, status, related_sale_id,
               related_stud_service_id, is_archived
stud_services: id, our_dog_id, partner_dog_id, partner_contact_id, direction,
               status, pairing_id, is_archived
```

Index notes:
- `events.[subject_type+subject_id]` is a **compound** index (fast per-subject
  timeline). Do not split it.
- `dogs.*co_owner_contact_ids` is a **multi-entry** index ("dogs co-owned by X").
- `events.reminder_date` is indexed for the reminder engine's range probe. Every
  other canonical FK is indexed so reverse lookups are index probes, not scans.
- **Unindexed but persisted:** `events.event_end_date`, `events.reminder_dismissed`,
  `dogs.recorded_coi`, plus every non-indexed field. They persist and ride backups;
  they simply aren't queryable by key.
- `is_archived` is filtered in JS, not by index (IndexedDB can't key on booleans;
  trivial at kennel scale).

### The versioning rule

The single `version(1)` block is editable **only** because nothing has shipped that
needs migration — reconcile any change by Reset App + re-seed. **At the first real
release this changes permanently:** from then on, schema changes are *additive only*
— new tables/indexes go in a new `db.version(2).stores({...})` block, and shipped
version blocks are **never edited again**. If you are adding an index/table after
real data exists, you must use a new version block.

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
- Only hard, non-interactive rules live in the repo (required fields, cycle
  prevention, sire≠dam). Soft/interactive warnings (sex mismatch, date ordering,
  "leaving deceased") belong to the page UI — a repo can't prompt.
- Derived reverse-lookup helpers live on the repo (e.g. `dogRepo.getChildren`,
  `contactRepo.getDogs`, `contractRepo.getBySale`).

Notable repo specifics:
- **dogRepo**: pedigree cycle prevention in `validateDog` (walks ancestors with a
  visited-set); `addPlannedTests` (additive, dedupe-on-write); `getBreeds`.
- **eventRepo** (exported as both `HistoryEvent` and `eventRepo`): see §8.
- **contractRepo.governingContract(contracts)**: derived "live contract" = most
  recent `signed` by `signed_date` (fallback `created_at`), or null. Never stored.
- **kennelRepo**: `preferred_tests`/`preferred_breeds` authoring (dedupe-on-write;
  remove drops membership only, never purges a token another event may need);
  `getVocabulary`/`getBreedVocabulary` union over own-kennels.

> Module naming trap: the Event repo's JS object is `HistoryEvent`/`eventRepo`,
> **never a bare `Event`** — that would collide with the DOM global.

---

## 7. Referential integrity (`data/referenceRegistry.js`)

Hard delete is the rare "undo a data-entry mistake" action; **soft delete (archive)
is the normal remove and never cascades**.

- Each entity has a declared array of every FK that can point at it
  (`DOG_REFERENCES`, `CONTACT_REFERENCES`, …). `Contract` is a leaf (empty array).
- `findBlockingReferences(registry, id)` counts matching rows per entry and returns
  human-readable `{label, count}` blockers. `hardDelete` throws
  `ReferenceBlockedError` if any exist.
- The guard **skips any table not present in the current schema** — honest per stage,
  and can't rot: adding a referencing table later is one appended line here.
- The polymorphic Event is matched via the compound index with a discriminator
  (`{compoundIndex:'[subject_type+subject_id]', discriminatorValue:'dog'|'pairing'}`).
- The blocking message is generated entirely from the registry, so it always matches
  the tables that actually exist — no hand-maintained carve-outs.

**When you add an FK anywhere, add its line to the registry** or hard-delete will
silently allow orphaning.

---

## 8. The Event model

One polymorphic table for all dated history. `subject_type ∈ {dog, pairing, litter}`
+ `subject_id` say what it's attached to. The type catalog lives in `vocab.js`
`EVENT_TYPES`; each type carries:
- `subjects[]` — which subject types may log it (`eventTypesFor(subjectType)` filters).
- `duration` — `'instant'` (single date) or `'span'` (`event_date` start,
  optional `event_end_date` end). Spans today: `medication`, `heat_cycle`, `boarding`.
- `badge` — colour class.
- `fields[]` — the small type-specific form written into `details{}`. Field types:
  `text`, `textarea`, `number`, `date`, `combobox` (suggest-not-enforce).
- `relatedContact: true` — surfaces the top-level `related_contact_id` FK (boarding,
  placement). Contacts on events are the canonical FK, never a `details` value.

Test-bearing types (`genetic_test`, `breed_specific_test`, `ofa_pennhip`) feed the
shared test vocabulary; `testTokensOf(event)` derives the test-name token(s).

### eventRepo reads (all siblings — deliberately never fused)

- `getForSubject(type, id)` — the timeline, newest first (compound index).
- `getBoardRows()` — dogs currently away via boarding events: `event_type='boarding'`,
  not archived, not yet ended. Whereabouts only — **not** all spans. This is ONE half
  of the away-board; `data/awayBoard.js` `getAwayBoardRows()` unions it with
  `studServiceRepo.getBoardRows()` (in-person stud services) into one view-model —
  see §19. Nothing here changed; callers just moved to the union.
- `getUpcoming()` — instant-duration events at/after today, any subject
  ("Upcoming Deliverables").
- `getScheduledPlacements()` — future `placement` events only.
- `getReminders()` / `getDismissedReminders()` — events with a non-null
  `reminder_date`, not archived, split by `reminder_dismissed`. `reminder_date` is
  the app's **one** future-dated mechanism. Bucketing into overdue/due-soon/upcoming
  is a display concern (30-day window), computed in the page, not the repo.
- Reminder mutations: `dismissReminder`/`undismissReminder` (not archiving, not a
  status change) and `snoozeReminder` (snooze **is** a `reminder_date` edit — there
  is no separate snooze field).

The overdue/due-soon boundary (`DUE_SOON_DAYS = 30`) is duplicated as a UI constant
in `reminders.js` and `dashboard.js`; keep them equal if you change it.

---

## 9. CSV import (`data/csvImport.js`)

Generic, entity-agnostic match-or-create engine used through the shared
`assets/importView.js` UI. Every import is a **dry-run preview** (create / update /
needs-review) before any write.

Flow: `parseCsv` (PapaParse; headers → lower_snake_case, values trimmed) →
`buildPlan(entity, rows)` → user reviews/adjusts decisions → `commitPlan`.

Rules that shape everything:
- **Natural key must be non-empty.** Keyless/partial-key rows are always
  "needs review" — never auto-matched, never silently created.
- Name match is case-insensitive + trimmed; dates exact. Enum/date cells normalize
  to a value, `''` (blank), or `null` (present but unrecognized → flagged).
- Relationship columns (sire/dam/dog names) resolve against **existing** records
  only; an unresolved name is flagged, never invented.
- **Two deliberate exceptions** auto-create a Contact inline at commit (never a
  stall): Sale's `buyer_name` and StudService's `partner_contact_name`, via each
  mapping's `prepareRecord` hook.

Per-entity natural keys: Dog = name+DOB; Contact = name; Pairing = sire+dam+planned;
Litter = dam+sire+whelp; Sale = dog+buyer+sale_date; Event (dog-subject only) =
dog+type+date (title tiebreak); StudService = our_dog+partner_dog+direction (has no
date, so any existing match is always routed to review — a repeat vs. an update is
ambiguous by key alone).

To add an entity to the importer: write one mapping object
(`{entity, label, templateHeaders, requiredForCreate, loadExisting, buildIndex,
classify, describe, repo, prepareRecord?}`) and register it in `MAPPINGS`. Don't
rebuild the engine.

> Keep this file clean UTF-8 (no BOM). It contains user-facing review strings.

---

## 10. JSON backup / restore (`data/importExport.js`)

The cross-device data path. This module may use `db` directly (it's in the data
layer, doing cross-table transaction work).

- `exportAll()` iterates **whatever tables exist** (no hardcoded list) → `{ schema_version,
  format_version, exported_at, collections }`. `downloadBackup()` saves it and stamps
  `lastBackupDate`.
- `inspectBackup(obj)` validates shape and reports counts + unknown tables before any
  write.
- `restoreBackup(obj, mode)`:
  - `'replace'` — clears **every** known table first, then loads the file's rows, so
    the result is exactly the backup (a table the file omits ends up empty).
  - `'merge'` — upserts the file's rows by id, leaving other records intact.
  - Unknown collections (tables not in this schema version) are skipped, not errors.

`BACKUP_FORMAT_VERSION` bumps only when the on-disk shape changes in a
migration-requiring way.

---

## 11. First-run, sample data, seed, settings

- **settings.js** — the primary `localStorage` user. Pages never touch `localStorage`
  directly. Keys (all under `kennelOS.*`): `lastBackupDate`, `persistRequested`,
  `sampleDataManifest`, `sampleDataCleared`, `myKennelId`, `myContactId`,
  `myKennelSetupSkipped`. `clearAllSettings()` drops them all (used by Reset App).
- **nudgeState.js** — a second, deliberately separate `localStorage` module (one key,
  `kennelOS.nudgeDismissals`): the derived-nudge dismissal ledger (§19). Kept out of
  `settings.js`/`clearAllSettings()` on purpose — `appReset.js` calls its own
  `clearAll()` directly — and never exported in JSON backups: dismissals are
  device-local UI state, not portable domain data.
- **sampleData.js** — the "Thornfield Kennels" demo. Seeds through the **repo layer**
  (same validation as real data) and tracks created IDs in one manifest object (not
  an `is_sample` schema flag), so clearing is a lookup, not a scan.
- **seedImport.js** — optional breed+test vocabulary seed (from
  `resources/common_tests_by_breed_seed.csv` or a user file). Appends to
  `Kennel.preferred_tests` / `preferred_breeds`; creates **no** records.
  Deliberately **not** routed through the csvImport engine (different shape). Used by
  both the standalone import page and the kennel-setup wizard.
- **kennelSetup.js** — the "your kennel and owner name" wizard; creates real
  Kennel/Contact records and remembers them by id in settings.
- **appReset.js** — `resetApp()` clears every table + all settings → the exact blank
  slate a never-visited browser sees.

First-run flow (`app.js`): request durable storage once → offer sample data; if
declined (or after sample data is later cleared), offer kennel setup.

---

## 12. Service worker / PWA (`sw.js`)

App-shell cache so the app installs and works offline after first load.

- `CACHE_NAME` (currently `kennelos-shell-v19`) + a `PRECACHE_URLS` list of **every**
  app file (html/js/css/icons/vendor/resources).
- `install` precaches the list (**`cache.addAll` is atomic** — one missing/renamed
  file fails the whole install). `activate` deletes old caches. Fetch is
  **cache-first** for same-origin GETs, with runtime caching of anything new.

**The discipline that matters:** whenever you add, rename, or remove an app file, you
must (1) update `PRECACHE_URLS` and (2) bump `CACHE_NAME`. Because fetch is
cache-first, an installed client only picks up changes when `CACHE_NAME` changes.
Forgetting to precache a new module silently breaks offline for whatever imports it.

There is a maintenance check for this — see §16.

---

## 13. UI layer

### The two rendering frameworks — different escaping contracts

This distinction is the single easiest thing to get wrong. Learn it:

- **`assets/reportView.js`** — columns provide `value:(r)=>string` returning **plain
  text**; the framework escapes it (`esc`) before injecting. Return raw text; do not
  pre-escape. `badge` columns render a controlled-vocab badge. Has CSV export.
- **`assets/listView.js`** — columns provide `cell:(r)=>htmlString` returning **HTML**;
  the framework injects it **raw**. **The caller must `esc()` every user-controlled
  value inside `cell`.** Supports filters, "show archived", collapsible columns,
  grouping, optional CSV export.

When in doubt: `value` = text (auto-escaped), `cell` = HTML (you escape).

### Shared helpers (`assets/ui.js`)

`esc(s)` (HTML-escape — use it on every interpolated user value in hand-built
innerHTML), `badge`/`badges`, `fmtDate` (YYYY-MM-DD → localized), `param(name)`
(read `?id=`), `fillSelect`, `confirmAction`. `todayYMD` is re-exported here but its
one implementation lives in `data/dateUtils.js`.

### Other components

- **timeline.js** — a subject's event list with add/edit/archive/delete; spans render
  as a date range; escapes all values.
- **pedigree.js** — derived ancestor tree from `sire_id`/`dam_id`; SVG connectors over
  positioned nodes. Bounded by a `generations` depth cap (default 3), which makes it
  cycle-safe regardless of data.
- **eventForm.js** — add/edit-event modal; renders the type's `fields` into `details`,
  handles spans/reminders, persists empty optional dates as `null` (important: keeps
  them out of the reminder index). Supports applying one payload to multiple subjects.
- **puppyForm.js**, **importView.js**, **sampleDataUI.js**, **kennelSetupUI.js** —
  roster entry, the CSV dry-run/commit UI, and the two first-run prompt/banners.
- **contactPicker.js** — `attachNewContactButton(selectEl, {onCreated})` decorates any
  contact `<select>` with a "＋ New" button: minimal inline-create modal (name
  required), creates via `contactRepo.create`, appends+selects the option, fires a
  native `change` event. `onCreated` runs **before** that dispatch so a caller that
  re-renders the select from its own in-memory contact list (e.g. `sale.js`) sees the
  new contact already there. Wired into sale (buyer), stud-service (partner), and
  `eventForm.js` (boarding/placement related contact) — one helper, built once.

### Navigation (`nav.js`)

Organized **by job, not by table**: five workflow hubs in the main bar —
**Today / Dogs / Breeding / People / Placements & Contracts** — plus a "More" corner
menu for **Reports** and **Import/Export**. Detail/edit/import pages are not nav
entries; `HUB_CHILDREN` maps them to the hub tab that should light up. Links are
stored app-root-relative and prefixed at render time so they resolve from `index.html`
or `/pages/` and any GitHub Pages sub-path.

### Page catalog (`pages/`, one `.js` + `.html` each)

Hubs & landing: `today`, `dogs`, `breeding`, `contacts`, `sales`, `reports`,
`import-export`, plus root `index.html`.
Dogs: `dog` (detail), `roster`, `pedigree`.
Breeding: `pairings`/`pairing`, `litters`/`litter`, `active-breeding`, `live-births`.
People: `contact`.
Placements/contracts: `sale`/`sales`, `stud-service`/`stud-services`,
`contract`/`contracts`.
Today cluster: `dashboard`, `reminders`, `upcoming`, `board`, `scheduled-placements`.
Reports: `litters-report`, `stud-services-report`, `placements-report`,
`health-tests-report`.
Import pages: `dog-import`, `contact-import`, `pairing-import`, `litter-import`,
`sale-import`, `event-import`, `stud-service-import`, `kennel-tests-import`.

---

## 14. Data conventions (quick reference)

- `id` = `crypto.randomUUID()`, client-side. No auto-increment.
- Soft delete only (`is_archived`). Never cascades, never destroys history.
- Date-only fields are `YYYY-MM-DD` strings compared **lexicographically**. Only
  `created_at`/`updated_at` are full ISO. "Today" is local wall-clock (`todayYMD`).
- Pickers exclude archived by default (toggle to include). Status/type = colored
  badges sourced from `vocab.js`.
- Controlled vocabularies live only in `vocab.js`; dropdowns and badges both read
  from it so they never drift.

---

## 15. Deliberately NOT built

Don't assume these exist; several are explicitly deferred "open doors":

- App-computed COI / relatedness / pairing-COI prediction (only a user-recorded
  `Dog.recorded_coi` exists).
- Genotype / Mendelian carrier-risk analysis; test-completeness audit.
- A recurrence-rule engine (recurrence = the "log the next one" workflow on the
  event; `reminder_date` is the only future-dated field).
- A financial ledger.
- Photos / attachments (no `attachments` table, no Photos tab, no thumbnails).
- Pairing/litter-subject events in the CSV importer (dog-subject only).

---

## 16. Invariants checklist (before you commit)

1. **Layering:** no page imports `db.js` or calls `db.*`; no page touches
   `localStorage` (go through a repo / `settings.js`).
2. **One canonical direction:** you added a query for a reverse relationship, not a
   mirror field.
3. **New FK ⇒ registry line** in `referenceRegistry.js`.
4. **Escaping:** every user value in hand-built innerHTML is `esc()`'d; `listView`
   `cell` functions escape; `reportView` `value` functions return plain text.
5. **New/renamed/removed app file ⇒ update `sw.js` `PRECACHE_URLS` **and** bump
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
6. **Schema:** pre-first-release you may edit `version(1)`; after real data ships,
   additive `version(N)` blocks only, never edit a shipped block.
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

There is no build, no test runner, and no linter wired in. Verification is:
`node --check` for syntax, serving locally and exercising the flow in a browser, and
the precache sanity check above. State resets via **Reset App to Start** (or clearing
site data); sample data via the first-run prompt or Import/Export.

---

## 18. Common maintenance recipes

**Add a field to an existing entity** — add it to the entity's form/detail page and
(if you'll query/filter/sort on it) to that table's index string in `db.js`. Plain
persisted fields need no schema change. Add validation to the repo only if it's a
hard rule. If it's an FK, add a `referenceRegistry.js` line. Update CSV mapping +
sample data if relevant.

**Add an event type** — add one entry to `EVENT_TYPES` in `vocab.js` (`value`,
`label`, `badge`, `subjects`, `duration`, `fields`, and `relatedContact` if it needs a
contact FK). The event form, timeline, badges, and (for dog-subject types) the event
importer pick it up automatically.

**Add a report** — build a page that loads records and calls `createReportView` with
`columns` (`value` returns text), `filters`, `search`, and `csvFilename`; link it from
`pages/reports.html`. Add the new page to `sw.js` (recipe §16.5).

**Add a new entity** — new `db.js` table (new version block if post-release), new
`<entity>Repo.js` via `makeRepo` with a validator, a `referenceRegistry.js` array (and
lines wherever it's referenced), list/detail pages, a CSV mapping if it imports, nav
wiring if it deserves a hub, sample-data coverage, and `sw.js` precache entries. Follow
the build order: schema → repo → list/detail → events/relationships → completeness
features.

**Add a new page** — always finish by adding it to `sw.js` `PRECACHE_URLS` and bumping
`CACHE_NAME`, or it won't work offline.

---

## 19. Derived nudges & the away-board union

Two small `data/` modules, added by the Data Integrity & Workflow-Streamlining brief
(`KennelOS/docs/Data_Integrity_Workflows_Brief_v1.md`), sit on top of the repos above.
Neither owns storage of its own beyond the one localStorage ledger below — both are
pure composition over existing repos.

**`data/nudges.js`** — `computeNudges()` reads current record state ONLY (no ledger
awareness) and returns zero or more:
```
{ key, title, detail, subjectHref, actions: [{ label, run: async () => {} }] }
```
Four rules, each producing its own stable `key` so a dismissal survives re-computation:
- **Stud-service status** — `sent_date` passed + `status='arranged'` → suggest
  `in_progress`; `returned_date` passed + `status ∈ {arranged, in_progress}` → suggest
  `completed` (never both; completed wins if both conditions hold).
- **Promote-lifecycle** — opt-in per kennel (`Kennel.promote_nudge_enabled`): a
  `status='puppy'`, `disposition='keeping'` dog past its kennel's
  `promote_age_male_months`/`promote_age_female_months` (by sex) gets a "promote to
  active breeding?" suggestion. No kennel, disabled, or non-`keeping` disposition ⇒
  silent — this is a decide-not-auto-promote nudge, never a mutation on its own.
- **Stud → pairing** — a stud service that's `completed` or overdue-returned with no
  `pairing_id` yet suggests creating one, deep-linking to
  `pairing.html?new=1&stud_service=<id>` (existing prefill/back-fill flow, unchanged).
  **Auto-dismisses**: once `pairing_id` is set the rule produces nothing at all — the
  link itself is the done-signal, no ledger entry needed.
- **Heat → pairing** — a concluded `heat_cycle` event (`event_end_date < today`) with
  no live pairing recorded for that dam since the heat started suggests creating one
  via `pairing.html?new=1&dam=<dogId>` (`pairing.js` new-mode gained the `dam` query
  param alongside its existing `stud_service` one).

The stud→pairing and heat→pairing rules share one dedup helper
(`pairingExistsForDam`): a pairing counts as "already handled" if it's for the same
dam, not `cancelled`/`failed`, and opened (`planned_date`, falling back to
`created_at`) on or after the window in question.

**`data/nudgeState.js`** — the dismissal ledger (see §11 above): `isDismissed`,
`dismiss`, `clearAll`. A computed nudge has no backing row to persist "dismissed" on,
so dismissal is device-local UI state, deliberately kept **out of** JSON backups.

**Rendering (`pages/today.js`)** owns the split the brief specifies: it calls
`computeNudges()`, filters out `isDismissed(key)` itself, renders what's left in a
"Nudges" section (above Reminders), wires each nudge's own action button(s), and adds
one generic "Dismiss" button per row that isn't part of any nudge's `actions` — the
same mechanism for every nudge, owned by the renderer, not each rule.

**`data/awayBoard.js`** — `getAwayBoardRows()` unions two sources into one
normalized view-model (`{ dogId, location, reason, contactId, outDate, returnDate,
dropoffTime, pickupTime, sourceType, sourceId, href }`):
`eventRepo.getBoardRows()` (boarding events — unchanged) plus the new
`studServiceRepo.getBoardRows()` (stud services where `type='in_person'` and today
falls in `[sent_date, returned_date]`, open-ended if `returned_date` is null; away dog
is always `our_dog_id`; location resolves from the partner contact's `address`).
Consumed by `pages/board.js`, `pages/today.js` (`renderBoard`), and
`pages/dashboard.js` (the away-count tile) — all three moved off
`eventRepo.getBoardRows()` directly onto this union. Boarding events still cover
non-stud reasons (grow-out, foster, owner travel); only the stud-reason boarding
*duplicate* went away — `sampleData.js` no longer authors a parallel boarding event
for its sample in-person stud service, it just sets `type`/`sent_date` on the
StudService record itself.

No schema/index/reference-registry change: `StudService.type` and the three `Kennel`
fields are plain unindexed additions (§5); the one new cross-entity link (stud→pairing
via a nudge action) already existed as `StudService.pairing_id`.

---

*This guide reflects the current end state. When you make a structural change, update
the relevant section here so the next maintenance session starts from the truth.*
