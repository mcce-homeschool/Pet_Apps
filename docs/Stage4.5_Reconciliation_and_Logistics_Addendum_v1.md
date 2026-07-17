# Stage 4.5 — Reconciliation & Logistics Addendum — v1
### Level-set the Stage 4 code, fill the named gaps, fold in Scheduling & Logistics — before Stage 5 starts

**How to use this doc:** hand this to Claude Code alongside `Data_Model_Architecture_Proposal_v3.md`, `Stage4_Revision_v2.md`, `Stage4_As_Built_v1.md`, `Scheduling_and_Logistics_Addendum_v2.md`, and the earlier build briefs. This is a **mid-build reconciliation pass, not a new feature stage.** Its job is to close the gaps `Stage4_As_Built_v1.md` §11 flagged, honor two data-model promises Stage 4 quietly skipped, land the Scheduling & Logistics work, and leave the tree clean enough that Stage 5 (genetic analysis, COI, analytics, dashboards, reminder engine) starts from a consistent base.

**Premise (unchanged, and load-bearing):** nothing has shipped and there is exactly one user (the owner), whose only records are disposable sample/test data. So **no additive `.version(2)` block and no migration are needed for anything in this doc.** Every schema touch below is an edit to the single `db.version(1).stores({...})` block, reconciled on the local machine by a **Reset App + re-seed**, not by a version bump. The JSON backup `schema_version` stays **`1`**.

> **The one Dexie mechanic to state plainly:** Dexie keys a live IndexedDB by its version *number*, so editing the `version(1)` `stores()` string on a database that already exists locally won't re-index on its own. Because the only local data is disposable, the correct move is: edit the `version(1)` string in place, then **Reset App** (`appReset.js`, type `RESET`) to drop and recreate the store, then re-seed. No `.version(2)`, no migration code, no `format_version` change. Only **one** index actually changes here (`events` gains `related_contact_id`); `event_end_date` is a plain unindexed field and touches nothing.

---

## 0. Scope

- **Part A — Stage 4 normalization:** the CSV promises Stage 4 skipped, the two code paths to verify, sample-data reconciliation, and the two small UI-discoverability gaps.
- **Part B — Documentation reconciliation:** stale `v2` pointers → `v3`, and CLAUDE.md.
- **Part C — Scheduling & Logistics fold-in:** `event_end_date`, `related_contact_id`, the `duration` catalog attribute, the `boarding` type, the Location/Status Board.
- **Part D — Upcoming Deliverables & puppy drop-offs:** resolves the open item the Scheduling addendum left in §13, and is the owner's stated top need.

**Explicitly not in scope (leave for Stage 5):** the reminder engine, COI/genetic tooling, analytics/dashboards, and any new entity. Nothing here adds a table.

---

# Part A — Stage 4 Normalization

## A1. CSV import gaps (build Event + StudService; make Contract a decision)

`Stage4_As_Built_v1.md` §11 gap #1 framed the missing importers as "arguably in-scope-complete." That undersells it: **Data Model §8 explicitly names three importers as owed** — "Event, Sale, and StudService mappings follow the same match-or-create pattern and land with their stages." Only Sale shipped. So **Event and StudService are genuine omissions, not ambiguous ones.** Contract was never named in §8, so it stays a conscious choice (A1.3).

All three use the **existing generic engine** (`data/csvImport.js`): match-or-create by natural key, dry-run preview (create / update / needs-review), keyless rows → needs-review, case-insensitive/trimmed name matching, exact-match dates. **No engine changes** — add mapping configs to `MAPPINGS` and an import page each, exactly as Sale did.

### A1.1 Event CSV mapping (dog-subject only)

Register `event` in `MAPPINGS`; add `pages/event-import.html/.js` via the shared `importView`.

- **Columns:** `dog_registered_name, event_type, event_date, event_end_date, title, related_contact_name, details_json, notes`
  - `event_end_date` and `related_contact_name` are included **now** so boarding/span events (Part C) import through the same path — no second pass later.
- **Natural key:** `dog_registered_name + event_type + event_date` (title as a tiebreak on collision). A row missing dog, type, or date is keyless → **needs-review**.
- **Relationship columns resolve, never auto-create:**
  - `dog_registered_name` → existing Dog; unmatched → **needs-review** (never auto-create a dog, per Data Model §8).
  - `related_contact_name` → existing Contact; unmatched → **needs-review**. **Deliberately not inline-created** — unlike a Sale's buyer (definitely a person you're transacting with), a boarding contact is optional and may be a facility; auto-creating would spawn junk contacts.
- **`details_json`** is parsed into the `details` object; malformed JSON → needs-review with a clear per-row error, never a silent drop.
- **Out of scope for this importer:** `subject_type` of `pairing`/`litter`. Subject resolution for those differs (no registered-name key), and the Data Model §8 worked example is dog-only. Flag pairing/litter-subject event import as a future item; do not half-build it.

### A1.2 StudService CSV mapping

Register `stud_service` in `MAPPINGS`; add `pages/stud-service-import.html/.js`.

- **Columns:** `direction, our_dog_registered_name, partner_dog_registered_name, partner_contact_name, fee_amount, fee_structure, status, result_notes`
- **Natural-key wrinkle — state it, don't paper over it:** StudService has **no date field**, so it has no clean natural key. Use `our_dog + partner_dog + direction`. Because that key collapses **repeat arrangements between the same pair**, a second service for an existing pair will look like an "update." Handle it honestly: surface such rows in the **dry-run preview as an ambiguous match** the user resolves (update the existing vs. create a new), rather than silently overwriting. When in doubt, route to needs-review.
- **Relationship columns:**
  - `our_dog_registered_name` / `partner_dog_registered_name` → existing Dog; unmatched → **needs-review** (the external partner dog is created inline by the user there, never auto-created by the importer).
  - `partner_contact_name` → existing Contact; unmatched → **inline-create a Contact** (`contact_type: ['breeder']`), mirroring the documented Sale `buyer_name` exception. This is the one auto-create, matching Stage 4's precedent.
- `pairing_id` is **not** set via CSV — leave null; link in the UI. (Keeps the importer single-table and avoids resolving a pairing by fuzzy key.)

### A1.3 Contract CSV — decide, then write the decision down

Contract was **never promised** a CSV path (absent from Data Model §8's list). A contract is a leaf of mostly free text (`terms_summary`) plus two canonical links — low CSV value, and its links resolve poorly by name. **Recommendation: do not build a Contract importer.** The point is to make this a *stated decision*, not the accident §11 called out. Record it in the as-built (A-note below) so the asymmetry is intentional.

**After A1, `MAPPINGS` registers: `dog, contact, pairing, litter, sale, event, stud_service` — Contract deliberately excluded.**

## A2. `governingContract()` — wire it to a real consumer

`contractRepo.governingContract()` exists (`Stage4_As_Built_v1.md` §4) but nothing shown actually *consumes* it — the Sale/StudService Contract panels just list everything newest-first. Untested infrastructure rots. **Surface it in exactly one place** so the rule is exercised:

- On **Sale Detail's Contract panel header**, render a single derived line: *"Governing contract: signed {date}"* pointing at `governingContract(getBySale(id))`, or *"Governing contract: none signed yet"* when it returns `null`.
- Keep it **derived, never stored** — this is the display that proves invariant #8, not a new field.

(If a "Placements" report later wants a governing-contract column, it reuses the same call. Not required now.)

## A3. Co-own placement write path — confirm it goes through `dogRepo`

Stage 4's Sale Detail offers to add the buyer to `dog.co_owner_contact_ids` on a `co_own` placement (`Stage4_As_Built_v1.md` §8). **Verify that write is `dogRepo.update()`, not a direct `db.dogs.*` write** from the sale form. A page writing another entity's table directly breaks Invariant #7 (pages call repos; repos own their table). If it's currently a direct write, route it through `dogRepo.update()`. The confirm-dialog-not-automatic behavior stays as-is.

## A4. Sample-data reconciliation (the Stage 4 packet grew ahead of its brief)

`Stage4_As_Built_v1.md` §10 shipped sample records that **do not appear in `Sample_Data_and_Reset_Brief_v2.md`**: Pairing **P3**, dogs **Nell** (external), contacts **Ellen / Priya / Owen**, a Birch×Nell stud service, and two Stage 4 contracts. That's a reasonable build call, but it left the Sample brief and its §8 acceptance checklist un-extended. **This section is the missing extension** — treat it as the authoritative Stage 4 addition to the sample packet (fold into the Sample brief lineage; no code change if the as-built already matches, just confirm each item exists and add the checks).

**Confirm these sample records exist and are manifest-tracked** (`sampleDataManifest` gains `sales`, `contracts`, `stud_services`; no `buyers` array):

- **Buyers-as-Contacts:** Priya Shah (`waitlist_status: fulfilled`, `first_contact_source: Instagram`), Owen Farrow (`waitlist_status: active`, **no Sale** — empty-waitlist demo), Ellen (owner of external partner dog Nell).
- **StudService:** Birch (`outgoing`) services Nell, `status: completed`, canonical `pairing_id` → **P3**; plus a `signed` stud-service Contract (`related_stud_service_id`).
- **Sale:** Hazel → Priya, `placement_type: pet`, `status: delivered`, `lead_source: Instagram`; plus a `signed` sale Contract (`related_sale_id`).

**New Stage 4 acceptance checks (append to Sample brief §8):**

- [ ] Buyers-as-Contacts: Priya, Owen, Ellen exist as Contacts; **no `buyers` table/array** anywhere.
- [ ] Owen shows in the Buyers/waitlist view with `waitlist_status: active` and **no** linked Sale.
- [ ] Hazel's Sale resolves buyer → Priya (a Contact), and Sale Detail's Contract panel lists the signed sale contract with a status badge.
- [ ] Sale Detail shows the **governing-contract** line (A2) resolving to the signed contract.
- [ ] Birch's StudService links to **P3** via `pairing_id`; Stud Service Detail's Contract panel shows the signed stud-service contract.
- [ ] Clearing sample data with a **real** Contract pointed at a sample Sale/StudService is **blocked** with the specific message and offers archive-instead (exercises `SALE_REFERENCES` / `STUD_SERVICE_REFERENCES` in the contamination check).
- [ ] Contract is confirmed hard-deletable with nothing blocking (leaf; `CONTRACT_REFERENCES` empty).
- [ ] After Part C: at least one sample **boarding** event exists (see C6) and appears on the Location/Status Board.

## A5. Two small UI-discoverability gaps (`Stage4_As_Built_v1.md` §11 #2/#3)

Low-effort, closes the flagged items so they're not mistaken for intent:

- **Landing tiles:** `index.html` still tiles only Dogs/Contacts/Pedigree/Import-Export. Add tiles for **Sales, Stud Services, Contracts**, and (after Part C) the **Location/Status Board** and (after Part D) **Upcoming**. Same tile pattern; no new machinery.
- **Buyers/waitlist reachability:** the buyer-as-filtered-Contact view is reachable only via the `?buyer=1` toggle. Add a direct entry point (a landing tile or a nav item labeled "Waitlist / Buyers") so a user after "the waitlist" doesn't have to know to go to Contacts first. Still the same filtered Contact view — **not** a new page or repo.

---

# Part B — Documentation Reconciliation

## B1. Promote `v2` pointers to `v3`

The canonical model is now **v3**, but several docs still say "hand alongside `…_v2.md`" in their headers: `Code_Orientation_Where_To_Fix.md` (states it was "built from … v2 §11"), the three Stage build briefs, `Test_Planning_and_Vocabulary_Addendum_v1.md`, and `Sample_Data_and_Reset_Brief_v2.md`. Update each "hand this to Claude Code alongside…" pointer to reference `Data_Model_Architecture_Proposal_v3.md` and, where relevant, `Stage4_As_Built_v1.md` and this doc. Content doesn't need rewriting — just the pointers, so a future session opens the right canonical set.

## B2. CLAUDE.md

Its Stage 4 scope line ("buyer merged into Contact — no Buyer table") is accurate; its "Read first" doc list predates the build. Point that list at `Stage4_As_Built_v1.md` for as-built state and at **this doc** for the reconciliation + logistics + Stage-5 on-ramp. Add a one-liner: canonical model = v3; Stage 4 built; Stage 4.5 (this doc) reconciles + adds logistics; Stage 5 next.

---

# Part C — Scheduling & Logistics Fold-In

This lands `Scheduling_and_Logistics_Addendum_v2.md` in full. Under the nothing-shipped premise, **its schema additions fold into `version(1)` with no bump** (the addendum's own §11 already assumed this; the owner's single-user status makes it correct). Build it exactly as that addendum specifies; the notes below only pin down the reconciliation mechanics.

## C1. `Event.event_end_date` (plain field, unindexed)
Nullable `YYYY-MM-DD`. **No schema-string change** — Dexie only lists indexed fields. Null for instants; the end for spans. Rides the JSON backup for free. (Addendum §2.)

## C2. `Event.related_contact_id` (indexed FK) + registry entry
The **only** index change in this whole doc. Edit the `version(1)` `events` line to:

```js
events: 'id, [subject_type+subject_id], event_type, event_date, related_dog_id, related_contact_id, is_archived',
```

Append to `CONTACT_REFERENCES` in `referenceRegistry.js`:

```js
{ table: 'events', field: 'related_contact_id', label: 'contact on a boarding event' },
```

This makes a Contact referenced only by a boarding event non-hard-deletable (archive still allowed); the Contact Detail blocking message picks it up with no UI change. Guard is an index probe, consistent with the v3 "every canonical FK is indexed" rule. (Addendum §5–§6.) **Reconcile locally via Reset App + re-seed** — no `.version(2)`.

## C3. `duration` catalog attribute + `boarding` type (`vocab.js`, no schema impact)
- Add `duration: 'instant' | 'span'` to every catalog entry. All existing types are `instant` except `heat_cycle` and `medication` (`span` — see C5) and the new `boarding`.
- Add `boarding`: `subject_type: dog`, `duration: span`, `details: { location, boarding_reason, dropoff_time, pickup_time, notes }`. `boarding_reason` is suggest-not-enforce (starter set: `stud_service / co_owner_rotation / foster / grow_out / owner_travel / whelp_assist / other`). Times are **inert display strings in `details`**, never parsed or compared (Addendum §8). `location` stays a plain string in `details`; the person/kennel is the top-level `related_contact_id`, never an FK in `details`.
- Validation: reject (soft-warn) a non-null `event_end_date` on an `instant` type.

## C4. Location/Status Board (whereabouts view)
New nav entry + tile. **Query filters on the whereabouts type set, never on `duration`** (Addendum §4/§12.1 — this is the load-bearing distinction):

```js
const today = todayYMD();
db.events
  .where('event_type').equals('boarding')          // index probe; .anyOf([...]) if the set grows
  .and(e => !e.is_archived)
  .and(e => e.event_end_date == null || e.event_end_date >= today);
```

One row per dog-away-from-home, sorted by end date (soonest return first), open-ended stays flagged "ongoing." Past stays fall off automatically and remain on the dog's own timeline. **Do not** add `medication`/`heat_cycle` to this board — they're spans but not whereabouts.

## C5. Optional: reclassify `heat_cycle` / `medication` as spans
Recommended while `event_end_date` exists and there's no data to migrate. Reclassify both `duration: span`, move their ends onto `event_end_date` (`heat_cycle.cycle_start` retires into `event_date`; `medication.end_date` moves out of `details`). They render as ranges on their own timelines and **must not** appear on the board. Skip only if you'd rather leave `boarding` the lone proper span.

## C6. Soft-suggestion prompts (`§9`) + one sample boarding event
- Prompt to log a `boarding` event on **StudService create** (esp. `direction: incoming`), pre-filling `boarding_reason: stud_service`, `related_contact_id` from `partner_contact_id`, dog per direction. Offered, never forced; **no stored link** to the StudService.
- Prompt on **Litter status → `ready`/`placed`** to log grow-out boarding for puppies not going straight to a buyer.
- Add **one sample boarding event** to the packet (Birch's `outgoing` stud stay with Ellen is the natural fit — `related_contact_id` → Ellen, `boarding_reason: stud_service`) so the board is non-empty on first run and the A4 boarding check passes.

---

# Part D — Upcoming Deliverables & Puppy Drop-offs

Resolves the open item `Scheduling_and_Logistics_Addendum_v2.md` §13 left ("no kennel-wide view of pure single-moment deliverables"), and delivers the owner's stated top need: **see all scheduled puppy drop-offs at a glance.** The whole trick is to add a **second, independent read** — never to touch the board's whereabouts filter. That keeps the "duration ≠ whereabouts, two separate reads" invariant intact by construction.

## D1. Model a drop-off as an instant event type — `placement`
**Decision for this build (default):** a drop-off is an instant, so add a catalog type, not a span and not a Sale field.

- `placement`: `subject_type: dog`, `duration: instant`, `details: { placement_time, location, notes }`.
- `subject_id` = the puppy (a Dog record). `related_contact_id` = the **buyer** (already a Contact, already registry-guarded via C2). `event_date` = the scheduled drop-off day. `placement_time` is an inert display string (same §8 posture as boarding times).
- **No stored link to the Sale** — consistent with boarding-not-linked-to-StudService (Addendum §5/§9). It's prompted at the Sale, not tied to it (D4).
- It rides the puppy's own timeline as an "upcoming" event (future-dated events already render distinctly, Stage 2 B1), and drops off the Upcoming view once its date passes — "history falls out for free," same as the board.

> **Alternative, if you'd rather (flag, don't default):** a `Sale.scheduled_pickup_date` field instead. Cleaner semantically (pickup is a Sale fact) and keeps drop-offs entirely off the Event side, but it doesn't generalize to other deliverables and it's a Sale schema field. **This doc assumes the `placement` event type; do not build both** (that would be dual-storage). If the owner prefers the Sale field, that's a one-line switch to this section — ask before diverging.

## D2. Upcoming Deliverables view (separate read; board untouched)
New nav entry + tile, **distinct from the Location/Status Board**. Its query is a sibling read on the indexed `event_date`:

```js
const today = todayYMD();
db.events
  .where('event_date').aboveOrEqual(today)   // index range probe, not a scan
  .and(e => !e.is_archived)
  .and(e => catalog[e.event_type].duration === 'instant');  // exclude spans/whereabouts
```

Sorted ascending (soonest first). This is the general "what do I need to do this week across the kennel" surface §13 said was lost — it catches drop-offs, scheduled vet visits, scheduled surgeries, etc. **Leave the board's query in C4 exactly as written** — the two never fuse; that's the whole point.

- A **type filter** on this view lets the user narrow to `placement` only → the glanceable "all scheduled puppy drop-offs" the owner asked for.

## D3. Lowest-lift glance: a "Scheduled Placements" report
Reuse the Stage 1 reporting framework (A4-era: list + column config + filters + CSV export) for a **Scheduled Placements** report — future-dated `placement` events, columns (puppy, buyer, date, time, location), filterable and exportable, exactly like Active Roster / Active Breeding. This is near-zero new code and gives an exportable drop-off list immediately; the D2 view is the prettier at-a-glance surface. Build the report first if time is tight.

## D4. Bring back the Sale-triggered prompt
Re-add the v1 soft prompt that §9 dropped with the calendar: on **Sale create / status → `paid_in_full`/`delivered`-adjacent**, offer *"log a scheduled pickup for this placement?"* — pre-fills a `placement` event (puppy = the sale's dog, `related_contact_id` = buyer, date blank for the user to set). Offered, never forced; no stored Sale↔event link. Sibling to the C6 Litter grow-out prompt.

## D5. Sample coverage
Add **one future-dated `placement` event** to the packet (e.g. a second puppy from Thornfield scheduled to go home next week) so the Upcoming view and the Scheduled Placements report are non-empty on first run.

---

## Build Order

Console-testable data/repo work first, UI after — same shape as every prior stage.

1. **Schema + registry (one edit, one reconcile):** add `related_contact_id` to the `version(1)` `events` line; add its `CONTACT_REFERENCES` entry; add the `event_end_date` plain field handling in `eventRepo`. Reset App + re-seed to pick up the index. (C1–C2)
2. **Catalog:** add `duration` to all types; add `boarding` and `placement` entries; add end-date-on-instant soft-validation. (C3, D1)
3. **Optional span cleanup:** reclassify `heat_cycle`/`medication`. (C5)
4. **Event forms + timeline:** boarding form (location, reason combobox, times, top-level Contact picker) and placement form; render spans as start–end ranges, show times where present. (C3, D1)
5. **CSV importers:** Event mapping, then StudService mapping; register both in `MAPPINGS`; add the two import pages. (A1.1–A1.2)
6. **`governingContract()` consumer** on Sale Detail; **verify co-own write** goes through `dogRepo`. (A2–A3)
7. **Views:** Location/Status Board (C4); Upcoming Deliverables view + type filter (D2); Scheduled Placements report (D3).
8. **Prompts:** StudService→boarding and Litter→grow-out (C6); Sale→placement (D4).
9. **Sample data:** confirm/complete the Stage 4 packet (A4); add the sample boarding (C6) and placement (D5) events; extend the Sample brief §8 checklist (A4).
10. **UI discoverability + docs:** landing tiles for Sales/StudServices/Contracts/Board/Upcoming and a Waitlist/Buyers entry (A5); promote `v2`→`v3` pointers and fix CLAUDE.md (B1–B2).

Steps 1–4 make logistics usable; 5–6 close the Stage 4 debts; 7–8 deliver the boards and prompts; 9–10 leave the tree consistent for Stage 5.

---

## Acceptance Checklist

**Stage 4 normalization**
- [ ] `MAPPINGS` registers `dog, contact, pairing, litter, sale, event, stud_service`; **no** `contract` mapping (deliberate, A1.3).
- [ ] Event CSV: keyless rows → needs-review; unmatched dog/contact → needs-review (neither auto-created); malformed `details_json` → per-row error, never a silent drop; `event_end_date`/`related_contact_name` columns import boarding rows correctly.
- [ ] StudService CSV: a repeat service for an existing `our_dog+partner_dog+direction` surfaces as an **ambiguous match** in preview (not a silent overwrite); unmatched `partner_contact_name` inline-creates a Contact; unmatched dogs → needs-review.
- [ ] Sale Detail shows a derived **governing-contract** line that reads the signed contract, or "none signed yet" — and updates when a contract's status changes.
- [ ] The co-own placement write to `co_owner_contact_ids` goes through `dogRepo.update()` (no direct `db.dogs` write from the sale form).
- [ ] All A4 sample-data checks pass.
- [ ] Landing tiles reach Sales/Stud Services/Contracts/Board/Upcoming; a Waitlist/Buyers entry exists.

**Logistics (Part C)**
- [ ] `events` `version(1)` line includes `related_contact_id`; deleting a Contact referenced only by a boarding event is **blocked** (archive allowed); reconciled via Reset App with no `.version(2)`.
- [ ] `event_end_date` is present on records, absent from the schema string, and rides the JSON backup (`schema_version` still `1`).
- [ ] Every catalog type has a `duration`; a non-null end on an `instant` type soft-warns.
- [ ] The Location/Status Board query filters on `event_type ∈ {boarding}` — **not** on `duration`; active medications/heat cycles never appear on it.
- [ ] A sample boarding event shows on the board with the right contact link; past boardings fall off but remain on the dog's timeline.

**Upcoming / drop-offs (Part D)**
- [ ] `placement` is an `instant` type; a placement event carries buyer via `related_contact_id` and has **no** stored link to any Sale.
- [ ] The Upcoming Deliverables view is a **separate** read (`event_date >= today`, `duration: instant`); the board query is byte-for-byte unchanged.
- [ ] Filtering Upcoming to `placement` (or running the Scheduled Placements report) shows all future drop-offs at a glance and exports to CSV.
- [ ] The Sale→placement prompt pre-fills a form and creates no schema link.
- [ ] Exactly one drop-off model exists (`placement` events **or** a Sale field — not both).

**Docs**
- [ ] Every "hand alongside" pointer references `v3` (+ as-built / this doc where relevant); CLAUDE.md points here for reconciliation state.

---

## What This Doc Does *Not* Change
No new table. No `.version(2)`, no migration, no `format_version` change. No new two-way pointers (every reverse stays a derived query). No change to Sale/Contract/StudService relationships. The one-canonical-direction rule, archive-≠-status, date-only-strings, and pages-call-repos invariants all hold unchanged. Stage 5 (COI, analytics, dashboards, reminder engine) begins from here.
