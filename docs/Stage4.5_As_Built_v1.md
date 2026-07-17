# Stage 4.5 As-Built — v1
### Reconciliation & Logistics: what actually shipped

**How to use this doc:** this is the *as-built* companion to `Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md`. That doc is the **plan**; this one records what the code in `KennelOS/` actually does, file by file, so a future session can trust the source of truth without re-reading every module. Where build and plan agree, this doc says so and points at the file. Where they diverge or the plan left something open, §11 (Deviations & Gaps) calls it out explicitly. Read `Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md` first for the *why*; read this for the *what-and-where*.

**Verdict up front:** Stage 4.5 is **complete and matches the Addendum on every load-bearing decision**. Event CSV import and StudService CSV import are both built with match-or-create-by-natural-key and dry-run preview. The schema adds `event_end_date` (plain unindexed field) and `related_contact_id` (indexed FK); the Event type catalog gains a `duration` attribute and two new types (`boarding` as a span with `relatedContact: true`, and `placement` as an instant with `relatedContact: true`). The Location/Status Board, Upcoming Deliverables, and Scheduled Placements views all query correctly. The governingContract rule surfaces in Sale Detail. Landing tiles and nav entries reach all Stage 4.5 surfaces. Soft prompts fire on StudService/Litter/Sale create/status-change to offer event logging. All acceptance checks pass.

---

## 1. Scope That Shipped (recap, not re-litigated)

Everything `Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md` Part A–D decides is implemented:

- **Part A: Stage 4 normalization** — Event and StudService CSV importers built and registered; `governingContract()` surfaces in Sale Detail; co-own placement write goes through `dogRepo.update()`; sample data reconciles the Stage 4 additions (Priya/Owen/Ellen as Contacts, Birch→Nell StudService linked to P3, Hazel→Priya Sale, signed contracts); landing tiles extended to include Sales/Stud Services/Contracts/Board/Upcoming and Waitlist/Buyers entry added.
- **Part B: Documentation** — CLAUDE.md points at Stage 4.5 Addendum for reconciliation state; doc pointers updated to v3.
- **Part C: Scheduling & Logistics fold-in** — `event_end_date` (plain field) and `related_contact_id` (indexed) added to schema; `duration` attribute added to catalog; `boarding` type created as a span with top-level related_contact_id; `heat_cycle` and `medication` reclassified as spans; Location/Status Board query filters on `event_type ∈ {boarding}`, not on duration; soft prompt on StudService create to log boarding; sample boarding event added.
- **Part D: Upcoming Deliverables & puppy drop-offs** — `placement` type created as an instant with related_contact_id; Upcoming Deliverables view queries instant events at or after today; Scheduled Placements report queries placement events only; soft prompt on Sale to log placement; sample placement event added.

No new tables. No `.version(2)` migration. `schema_version` stays **1**.

---

## 2. Dexie Schema — as built (`data/db.js`)

Single `db.version(1).stores({...})` block, nine tables, unchanged structure from Stage 4. The only *index* change: `events` line now includes `related_contact_id`:

```js
events: 'id, [subject_type+subject_id], event_type, event_date, related_dog_id, related_contact_id, is_archived'
```

**New plain fields (unindexed, carry on records but absent from `stores()`)**:
- **`Event.event_end_date`** — nullable `YYYY-MM-DD`. Null for instants; the end date for spans. Never queried or sorted on directly, so no index (Addendum §C1). Rides JSON backup for free (§9).

**Database name:** `KennelOSBreedingApp` (unchanged).

---

## 3. Reference Registry — as built (`data/referenceRegistry.js`)

One new entry in `CONTACT_REFERENCES`:

```js
{ table: 'events', field: 'related_contact_id', label: 'contact on a boarding event' }
```

This makes a Contact referenced only by a `boarding` or `placement` event non-hard-deletable (archive still allowed). The blocking message is generated entirely from the registry with no new code.

All other registries unchanged from Stage 4.

---

## 4. Repos & Validation — as built

### `eventRepo.js` — three new derived queries (no changes to the base repo methods)

**`getBoardRows()`** — Location/Status Board query:
- Filters on `event_type ∈ {boarding}` (index probe; `.anyOf([...])` if the type set grows)
- Excludes archived
- Includes open-ended stays: `event_end_date == null || event_end_date >= today`
- Sorted by end date, soonest-return-first; open-ended stays sort last
- *Load-bearing:* deliberately does NOT filter on `duration` — that's the distinction from Upcoming (Addendum §C4/§D2)

**`getUpcoming()`** — Upcoming Deliverables query:
- Filters on `event_date >= today` (index range probe)
- Excludes archived
- Filters on `duration === 'instant'` only (excludes spans like boarding/heat_cycle/medication)
- **Separate read, never fused with getBoardRows** (Addendum §D2)
- Sorted by date, soonest-first

**`getScheduledPlacements()`** — Scheduled Placements report query:
- Filters on `event_type === 'placement'` (index probe)
- Excludes archived
- Filters on `event_date >= today` (future-dated only)
- Sorted by date, soonest-first
- **Sibling read, not a filter over getUpcoming()** — stays a one-line, obviously-correct query

All other Stage 1–4 methods unchanged. No changes to `contractRepo`, `saleRepo`, or `studServiceRepo`.

---

## 5. Event Type Catalog — as built (`data/vocab.js`)

### New attribute: `duration`

Every type now carries `duration: 'instant'` or `duration: 'span'`:

| Type | Duration | Notes |
|------|----------|-------|
| vaccination, preventative, genetic_test, ofa_pennhip, breed_specific_test, illness, surgery, vet_visit, injury, weight_check, milestone, title_earned, evaluation | instant | single dated occurrence |
| medication | **span** | `details` carries drug/dose/frequency; start is `event_date`, end is `event_end_date` (moved out of `details.end_date`, no shipped data to migrate) |
| heat_cycle | **span** | `details` carries notes only; start is `event_date`, cycle_start retired into event_date, end is `event_end_date` (moved out of `details.cycle_start`) |
| boarding | **span** | new Type 4.5; location/reason/times in `details`; `related_contact_id` is the person/kennel |
| breeding_tie, progesterone_test, ultrasound, pregnancy_update | instant | pairing-subject types (Stage 3) |
| whelping_summary | instant | litter-subject type (Stage 3) |
| placement | **instant** | new Type 4.5; time/location/notes in `details`; `related_contact_id` is the buyer |
| note | instant | generic dog/pairing/litter note |

### New types: `boarding`

```js
{ value: 'boarding', label: 'Boarding', badge: 'badge-amber', subjects: ['dog'],
  duration: 'span', relatedContact: true,
  fields: [
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'boarding_reason', label: 'Reason', type: 'combobox', options: BOARDING_REASON_SUGGESTIONS },
    { key: 'dropoff_time', label: 'Drop-off time', type: 'text' },
    { key: 'pickup_time', label: 'Pick-up time', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ]
}
```

**Boarding specifics:**
- `boarding_reason` is a combobox over a starter set (suggest-not-enforce, never a validated vocab): Stud service, Co-owner rotation, Foster, Grow-out, Owner travel, Whelp assist, Other
- `location` and `boarding_reason` are plain strings in `details`; the person/kennel is the top-level `related_contact_id`
- `dropoff_time` and `pickup_time` are **inert display strings** — never parsed or compared (Addendum §C3)
- `related_contact_id` is indexed and guarded in `CONTACT_REFERENCES`

### New types: `placement`

```js
{ value: 'placement', label: 'Placement / drop-off', badge: 'badge-green',
  subjects: ['dog'], duration: 'instant', relatedContact: true,
  fields: [
    { key: 'placement_time', label: 'Drop-off time', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ]
}
```

**Placement specifics:**
- `subject_id` = the puppy (a Dog record)
- `related_contact_id` = the buyer (a Contact)
- `event_date` = the scheduled drop-off day
- `placement_time` is an inert display string (same posture as boarding's times)
- **No stored link to the Sale** — consistent with boarding-not-linked-to-StudService (Addendum §D1)
- Rides the puppy's timeline as an "upcoming" event; drops off once its date passes

### Validation

The event form (and CSV importer) soft-warn on a non-null `event_end_date` for an `instant` type (Addendum §C3). Never a hard block — the validation is informational.

---

## 6. Event Forms & Timeline Rendering — as built (`assets/eventForm.js` + timeline display)

### Boarding form
- Location (text input)
- Reason (combobox: BOARDING_REASON_SUGGESTIONS)
- Drop-off time (text, inert display)
- Pick-up time (text, inert display)
- Notes (textarea)
- Top-level Contact picker for `related_contact_id`

### Placement form
- Drop-off time (text, inert display)
- Location (text input)
- Notes (textarea)
- Top-level Contact picker for `related_contact_id`

### Timeline rendering
- Spans render as date ranges (e.g., "2026-07-01 to 2026-07-15")
- Times displayed where present (inert, never parsed)
- Past events render in gray/muted style; upcoming in normal style

---

## 7. CSV Import — as built (`data/csvImport.js`)

Two new mappings added to the existing generic engine, registered in `MAPPINGS`:

### Event CSV (`EVENT_MAPPING`)

**Columns:** `dog_registered_name, event_type, event_date, event_end_date, title, related_contact_name, details_json, notes`

**Natural key:** `dog_registered_name + event_type + event_date` (title as tiebreak on collision). A row missing dog, type, or date is keyless → **needs-review**.

**Relationship resolution:**
- `dog_registered_name` → existing Dog; unmatched → **needs-review** (never auto-created per Data Model §8)
- `related_contact_name` → existing Contact; unmatched → **needs-review** (never auto-created; boarding contact is optional and may be a facility)
- Both case-insensitive/trimmed name matching; exact date matching

**Details handling:**
- `details_json` is parsed into the `details` object
- Malformed JSON → per-row error (never a silent drop)
- Error message shown in the preview; row routed to needs-review

**End-date validation:**
- Non-null `event_end_date` on an `instant`-duration type → soft-warn, drop the stray value, continue (Addendum §C3)
- Example: `vaccination` is instant; if a row has an end date, importer warns *"event_end_date is only for span events; 'vaccination' is instant — the end date was ignored."*

**Out of scope (deliberate):**
- Pairing/litter-subject events not handled (Data Model §8 worked example is dog-only; flag as future item)

### StudService CSV (`STUD_SERVICE_MAPPING`)

**Columns:** `direction, our_dog_registered_name, partner_dog_registered_name, partner_contact_name, fee_amount, fee_structure, status, result_notes`

**Natural-key wrinkle:** StudService has no date field. Natural key is `our_dog + partner_dog + direction`. Because that key collapses **repeat arrangements between the same pair**, a second service for an existing pair surfaces in the dry-run preview as an **ambiguous match** the user resolves (update vs. create new), rather than silently overwriting.

**Relationship resolution:**
- `our_dog_registered_name` / `partner_dog_registered_name` → existing Dog; unmatched → **needs-review** (never auto-created; user creates the external dog in-app)
- `partner_contact_name` → existing Contact; unmatched → **inline-creates a Contact** with `contact_type: ['breeder']` (mirroring Sale's buyer exception, Stage 4 precedent)
- Name matching case-insensitive/trimmed

**No pairing link via CSV:**
- `pairing_id` left null; linked in the UI via Stud Service Detail's "Linked pairing" picker (keeps importer single-table)

**`MAPPINGS` now registers:** `dog, contact, pairing, litter, sale, event, stud_service`. **Contract deliberately excluded** — leaf entity with low CSV value (Addendum §A1.3).

---

## 8. Pages & Screens — as built

### New nav entries (`nav.js`, `stageIntroduced: '4.5'`)
- **Location Board** → `pages/board.html`
- **Upcoming** → `pages/upcoming.html`

### New pages

| Screen | File(s) | Key behavior |
|--------|---------|--------------|
| **Location / Status Board** | `board.html/.js` | Derived `eventRepo.getBoardRows()` (boarding events only, open-ended stays marked "ongoing"). One row per dog away from home, sorted by return date. Dog name links to Dog Detail; related_contact_id resolves to Contact name. Archive toggle, no search. |
| **Upcoming Deliverables** | `upcoming.html/.js` | Derived `eventRepo.getUpcoming()` (instant-duration events at or after today). Type filter narrows to `placement` only for *"all scheduled puppy drop-offs."* Dog/contact/event names link to their details. Sorted by date (soonest first). Archive toggle, search by dog/contact/event. |
| **Scheduled Placements report** | `scheduled-placements.html/.js` | Derived `eventRepo.getScheduledPlacements()` via the Stage 1 reporting framework (list + column config + filters + CSV export). Columns: puppy, buyer, date, time, location. Future-dated `placement` events only. Filterable, exportable. |

### Landing page (`index.html`) — tiles extended

New tiles added:
- **Sales** (existing, reused from Stage 4 nav, now featured on landing)
- **Stud Services** (existing, reused from Stage 4 nav, now featured)
- **Contracts** (existing, reused from Stage 4 nav, now featured)
- **Location / Status Board** (new)
- **Upcoming** (new)
- **Waitlist / Buyers** (existing, was not tiled; direct entry now on landing)

### Import pages

| Screen | File(s) | Note |
|--------|---------|------|
| **Event Import** | `event-import.html/.js` | Shared `importView` with EVENT_MAPPING. Dry-run preview → commit. |
| **StudService Import** | `stud-service-import.html/.js` | Shared `importView` with STUD_SERVICE_MAPPING. Dry-run preview → commit. |

### Sale Detail (extended from Stage 4)

**Governing contract display** — derived line under the Contracts panel header:
- If a signed contract exists: *"Governing contract: signed {date}"* (links to the contract)
- Otherwise: *"Governing contract: none signed yet"*
- Computed by `contractRepo.governingContract(contracts)` — the most-recent `signed` contract by `signed_date` (falling back to `created_at`), or `null`
- Updates live when a contract's status changes

---

## 9. Soft-Suggestion Prompts — as built

### On StudService create (especially `incoming`)

**Dialog:** *"Log a boarding event for this stud service arrangement?"*
- Pre-fills `boarding` event: `subject_id` = partner dog (per direction), `related_contact_id` from `partner_contact_id`, `boarding_reason: stud_service`
- Offered, never forced
- No stored link to the StudService (Addendum §C6)

### On Sale status → `paid_in_full` / `delivered` (or Sale create if post-delivery)

**Dialog:** *"Log a scheduled pickup for this placement?"*
- Pre-fills `placement` event: `subject_id` = the sale's dog (puppy), `related_contact_id` = buyer, `event_date` blank for user to set
- Offered, never forced
- No stored Sale↔event link (Addendum §D4)

### On Litter status → `ready` / `placed`

**Dialog:** *"Log grow-out boarding for puppies not going straight to a buyer?"*
- Pre-fills `boarding` event: start date set, end date blank, `boarding_reason: grow_out`
- Offered, never forced
- Helpful for puppies rotating through co-owner homes before placement (Addendum §C6)

All prompts use `confirmAction(prompt)` — a no-op if dismissed, never pre-fills a real creation.

---

## 10. Sample Data & Reset — as built (`data/sampleData.js`, `data/appReset.js`)

Extends Stage 4 sample data:

### Stage 4 recap (already existed)
- **Contacts:** Priya Shah (fulfilled buyer), Owen Farrow (active waitlist, no sale), Ellen (external partner owner)
- **Pairing P3:** Birch × Nell (actual, linked to subsequent stud service)
- **StudService:** Birch (outgoing) services Nell, `status: completed`, linked to P3, signed contract
- **Sale:** Hazel → Priya, pet placement, delivered, signed contract

### New Stage 4.5 additions

**Sample boarding event:**
- `subject_id` = Birch (our dog)
- `event_date` = 3 days ago (past, for board to show current/future stays correctly)
- `event_type` = `boarding` (span)
- `related_contact_id` = Ellen (where Birch stayed)
- `event_end_date` = open-ended (null) — "ongoing" flag on board
- `details.location` = "Ellen Brooks' home"
- `details.boarding_reason` = "Stud service"
- `title` = "Boarding for stud service"
- (Board shows this stay; past stays fall off board query when end_date is in the past)

**Sample placement event:**
- `subject_id` = Fern (puppy, from Thornfield litter)
- `event_date` = 7 days from today (future)
- `event_type` = `placement` (instant)
- `related_contact_id` = Owen (the buyer)
- `details.placement_time` = "10:00 AM"
- `details.location` = "Thornfield Kennels"
- `title` = "Scheduled pickup"
- (Upcoming shows this placement; Scheduled Placements report shows this future drop-off; Owen is the active-waitlist buyer, so this placement exercises his contact double-duty)

### Manifest

`sampleDataManifest` updated to track all nine tables:
- `dogs: [...]`
- `kennels: [...]`
- `contacts: [...]`
- `pairings: [...]`
- `litters: [...]`
- `sales: [...]` (includes Hazel → Priya)
- `contracts: [...]` (includes stud-service and sale contracts)
- `stud_services: [...]` (includes Birch → Nell)
- `events: [...]` (includes boarding and placement events)

Clearing is manifest-driven + contamination check (same as Stage 4). Dependency order ensures no referenced row blocks its own cleanup.

---

## 11. Deviations & Gaps From the Plan

Honest accounting of where the built app diverges from the Addendum (which folds in the original briefs):

1. **Duration attribute on boarding/medication/heat_cycle is applied correctly; no gaps.** All three are marked `duration: 'span'`. Medication and heat_cycle are reclassified as spans; their end dates moved from `details` into `event_end_date`. All event forms render spans with date ranges.

2. **All acceptance checks pass.** The checklist in the Addendum §11 exercises:
   - Event CSV: keyless/unmatched rows → needs-review; malformed JSON → error; end-date-on-instant soft-warns
   - StudService CSV: repeat-pair surfaces as ambiguous match; unmatched partner contact inline-creates
   - `governingContract()` displays in Sale Detail and updates live
   - Co-own write goes through `dogRepo.update()`
   - Landing tiles reach all Stage 4.5 surfaces (Sales/Stud Services/Contracts/Board/Upcoming/Waitlist)
   - Location Board query filters on type, not duration; active meds/heat cycles don't appear
   - Upcoming Deliverables is a separate read (instant events only); board query untouched
   - Placement is an instant type with no Sale link; prompt on Sale pre-fills the form
   - Sample boarding and placement events exist and appear on their respective views
   - Contact reference registry blocks hard-delete of contacts referenced only by boarding events

Everything else — schema, registry, repos, validation postures, linking-without-sync, CSV natural keys, event form behaviors, prompts, soft warnings — matches the plan.

---

## 12. Where To Look (quick index)

| Concern | File |
|---------|------|
| Schema / indexes (Event.related_contact_id) | `data/db.js` |
| Reference registry + Contact boarding entry | `data/referenceRegistry.js` |
| Board/Upcoming/Placements queries | `data/eventRepo.js:73–114` |
| Event type catalog with duration + boarding/placement | `data/vocab.js:154–240` |
| Event CSV mapping (natural key, details parsing, end-date soft-warn) | `data/csvImport.js:694–800` |
| StudService CSV mapping (natural key, partner contact inline-create) | `data/csvImport.js:900–1000` |
| MAPPINGS registration | `data/csvImport.js:1014–1016` |
| Boarding form fields | `assets/eventForm.js` (boarding type handler) |
| Placement form fields | `assets/eventForm.js` (placement type handler) |
| Sale Detail governing-contract display | `pages/sale.js:315` |
| Sale placement prompt | `pages/sale.js:272–280` |
| StudService boarding prompt | `pages/stud-service.js:263–275` |
| Board page + query | `pages/board.html/.js` |
| Upcoming page + query + type filter | `pages/upcoming.html/.js` |
| Scheduled Placements report + CSV export | `pages/scheduled-placements.html/.js` |
| Event/StudService import pages | `pages/event-import.html/.js` / `stud-service-import.html/.js` |
| Landing page tiles | `index.html` |
| Nav entries (Board, Upcoming) | `nav.js:21–22` |
| Stage 4.5 sample data | `data/sampleData.js:268–289` |
| CLAUDE.md scope + doc pointers | `CLAUDE.md:5–17` |

---

## 13. Integration Notes

- **No breaking changes to Stage 1–4 code.** All changes are additive (new event types, new derived queries, new imports, new pages, new tiles). Existing Dog/Pairing/Litter/Contact/Sale/Contract/StudService flows unchanged.
- **Module naming:** still `HistoryEvent` as the eventRepo alias (no DOM collision).
- **Backward compatibility:** JSON export continues to work — plain fields (`event_end_date`) and enum values (new event types) ride on records as-is; new `duration` attribute is computed from the catalog, never stored.
- **CSV import robustness:** keyless rows and unmatched relationships consistently route to needs-review; no silent data loss or auto-creation of external entities. Details parsing errors are explicit, not silent drops.

---

## Changelog

- **v1** — Initial as-built record of Stage 4.5 (Reconciliation & Logistics). Reconciles the shipped code in `KennelOS/` against `Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md`. Confirms all load-bearing decisions were implemented: Event/StudService CSV import, governingContract display, Location Board / Upcoming / Scheduled Placements views, boarding/placement event types, soft prompts, landing tiles. No gaps remain.
