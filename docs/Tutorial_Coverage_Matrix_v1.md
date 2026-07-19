# Tutorial Coverage Matrix (v1) — Phase 1 output, reconciled through Phase 4

**Status:** Complete first pass (Phase 1), reconciled against the expanded seed (Phase
4). This is the **Phase 1** deliverable of the Tutorial project (see
`Tutorial_Sample_Data_Coverage_Spec_v1.md` §10): the §3.1 *Screen × Section coverage
matrix*, filled in by **walking every page** rather than trusting the spec's first-pass
§4. Planning doc only — no code/data changes here.

**Phase 4 reconciliation note.** This matrix was built *before* Phase 2 expanded
`data/sampleData.js` to close gaps G1–G14/D2 (see the spec's §8 checklist — every item
now `[x]`). Phase 4 re-walked the matrix against the expanded seed and updated every
row whose gap is now closed, corrected anchors that changed with the new records (e.g.
the "Due outs & upcoming" placement anchor moved from Fern to Cedar), and replaced §C's
gap-classification table with a resolution log. Section headings, teaching points, and
expandable-surface inventories (§A, most of §B's "Teaches"/"Expandable" columns, §D, §F)
are structural and were already accurate — only **Anchor** and **Status** cells changed
unless noted. The Phase 4 acceptance pass (spec §9.2, enum target) also found two enum
values the original G1–G14/D2 catalog never caught (`DOG_STATUS: 'for_sale'`,
`DISPOSITION: 'undecided'`) and closed both with a new dog (Clover) and a one-field
change (Aster) — see §C's second table. `LITTER_STATUS: 'closed'` stays deferred, same
as before, per the already-documented litter→close trade-off.

**Method.** Every page's `.js`/`.html` in `KennelOS/pages/` (plus the shared
components `timeline.js`, `expensePanel.js`, `eventForm.js`, `pedigree.js`,
`listView.js`, `reportView.js`) was read to enumerate the *real* rendered sections and
expandable surfaces. The result was then verified in a browser: the app was served
locally, the "Thornfield Kennels" sample packet seeded via the first-run prompt, and
the hub pages screenshotted. **Zero page/console errors** across the walked pages; the
rendered section sets matched the source-derived inventory exactly (see §E).

**How to read the matrix.** One row per **(hub → screen → section / expandable
surface)**. Columns:
- **Teaches** — the one idea the tour conveys at this stop.
- **Anchor** — the seeded record/field the coach-mark points at.
- **Expandable** — the modal / toggle / "Show more" / collapsible the step must open
  (— = none).
- **Depends on** — the seed guarantee that must hold.
- **Status** — ✅ covered by today's seed · ⚠️ partial · ❌ gap (→ `Gn`/`D2` fix id
  from the spec §8) · 🎛️ teach-from-control (no record, taught from the dropdown).

Gap ids (`G1`–`G14`, `D2`) are the spec's (§1 / §8). This doc **classifies** each tour
stop against them; it does not renumber them.

---

## A. Corrections to the spec's first-pass §4 (what walking revealed)

The spec's §4 was written from the End-State page catalog and is **not** the shipped
information architecture. Walking the pages surfaced these structural facts the tour
plan must be built on — this was the main point of Phase 1.

1. **The six hubs land on consolidated pages, not the legacy per-table pages.**
   `nav.js` `NAV_ITEMS` + `HUB_CHILDREN`:
   - **Today → `today.html`** (a single consolidated home), **not**
     `dashboard`/`reminders`/`upcoming`/`board`. Those four (plus
     `scheduled-placements`) still exist by URL as `HUB_CHILDREN` but are **not** nav
     entries or tour stops. The Today hub's real stops are the **collapsible cards** of
     `today.html`.
   - **Breeding → `breeding.html`** (a consolidated pairing→litter→puppy *chain* view).
     `pairings`/`litters`/`active-breeding`/`live-births` are legacy `HUB_CHILDREN`.
   - **People → `contacts.html`**; `kennels`/`kennel` are also People (`HUB_CHILDREN`).
   - **Placements & Contracts → `sales.html`**; `stud-services` and `contracts` are the
     other two landing surfaces of the same hub (`HUB_CHILDREN`).
   - **Dogs → `dogs.html`** (the list now carries roster's CSV export, so `roster.html`
     is redundant); **Financials → `financials.html`**.
2. **"Nudges" is a card on `today.html`, not a page.** It renders **nothing** when no
   nudge fires. On the Phase 1 seed it rendered empty (browser, §E) — that was G1;
   Phase 2/3 tuned the seed's dates so 7 of the 8 rules fire on a fresh seed today.
3. **`today.html` card order** (DOM): Nudges · Reminders · Active litters · Due outs
   & upcoming · Away from home · Kennel overview · This year. (Spec §4.1's ordering and
   "status tiles first" was wrong.)
4. **Dog Detail is far richer than §4.2 lists** — 12 sections, most collapsible, several
   **conditionally hidden** (Contracts/Sales/Stud Services/Pairings/Litters appear only
   when relevant or non-empty). Full list in §B-Dogs.
5. **Kennel program config lives on the kennel *detail* page.** `kennels.html` is the
   list — identity CRUD only (name/prefix/location/own-flag/website + archive/delete).
   A kennel's **program configuration** — the **preferred-tests panel** (and its nested
   "Apply to dogs…") and the **lifecycle-nudge thresholds** (`promote_nudge_enabled` +
   `promote_age_*`) — is edited on **`kennel.html`** (own kennels only), which also hosts
   the kennel Expenses ledger and a `logo_data_url` logo. **`preferred_breeds` has no UI
   editor at all** — it's set by seed/import only (matters for D2/G12).
6. **Contracts split across two surfaces.** Sale/stud-service contracts live inline on
   the `sales.html`/`stud-services.html` cards; `contracts.html` lists only the
   **"fallout"** (co_own / lease / other / unlinked). The lease/co-own teaching moment
   is on `contracts.html` + `contract.html`, not the sales card.
7. **The tour has a pre-hub entry**: the first-run "explore vs blank" prompt
   (`sampleDataUI`) and the kennel-setup wizard (`kennelSetupUI`). These bracket the
   whole tour (open) and the Import/Export backup closer.

---

## B. The coverage matrix

Shared components referenced below (each is an **expandable surface** the tour opens):
- **Event History / Timeline** (`timeline.js`): collapsible card; "Show archived";
  **"+ Add Event" → event modal** (`eventForm.js`); span events as date ranges; linked
  expense cost shown; per-row Edit/Archive/Delete.
- **Expenses** (`expensePanel.js`): collapsible; total badge; "Show archived";
  **"+ Add Expense" → expense modal**; "Log event →" (dog/litter/pairing); 🔗 event tag.
- **Pedigree** (`pedigree.js`): ancestor tree (depth-capped) + derived Offspring.

### B.1 Today → `today.html`

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Nudges | Derived suggestions; nothing changes until you act | 7 of 8 rules live: Birch (stud in-progress), Poppy (promote), Juno (stud→pairing), Sage (heat→pairing), Percy×Dahlia (overdue pairing), Daisy's litter (litter→sold), Fern's litter (litter→reopen) | collapsible; per-nudge action + Dismiss | ≥1 live nudge of each rule on seed day | ✅ 7/8 — litter→close intentionally not live (spec §9.3) |
| Reminders | Reminders live on events; snooze *is* a date edit | Juniper (overdue), Percy (due-soon), Birch (upcoming) | collapsible; inline **Snooze** date-swap; "Log new →"; Dismiss | overdue/due-soon/upcoming each ≥1 | ✅ |
| — Show dismissed | Dismissed reminders aren't gone | Fern (dismissed) | (reminder Show-dismissed — legacy `reminders.html`, not surfaced on the consolidated Today card) | ≥1 dismissed reminder | ✅ record exists; toggle lives on the legacy page, not today.html |
| Active litters | Per-litter availability: one block per non-archived litter with ≥1 `available` pup, its selling roster ordered available→undecided→sold with an `<sold>/<total> sold` tally; `disposition='available'` feeds this + the prospective bundle | Autumn litter (Ivy × Gunnar, 1/3 sold: Wren available, Aster undecided — also sellable, Cedar placed); Summer litter (Juniper × Gunnar, 0/1 sold: Fern available again) | collapsible; per-pup **"Add sale →"** on sellable pups; "Open litter →" | ≥1 litter with an `available` pup | ✅ two litters now render, incl. an `undecided` pup in the ordering |
| Due outs & upcoming | Deep-link into an event (edit-in-place) | Cedar placement (+7d), Percy vet visit | collapsible; "Open →" (openEvent) | ≥1 future-dated event | ✅ |
| Away from home | Whereabouts = boarding ∪ in-person stud; location from partner address | Birch @ Ellen (Burlington) | collapsible; **expandable row** (Contact/Drop-off/Return/Open) | in-person stud w/ sent_date, partner address | ✅ |
| Kennel overview | Status vs. archive (deceased is a status, not archived) | dog roster, incl. a live `for_sale` tile (Clover) | collapsible; status tiles | dogs across statuses | ✅ |
| This year | Year-scoped tallies | Litters whelped 2, Pairings 5, Sales 2 (fresh seed, current year) | collapsible | records dated in current year | ✅ all three non-zero |

### B.2 Dogs → `dogs.html` (list) + `dog.html` (detail) + `pedigree.html`

**`dogs.html`**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Bucket seg-tabs | puppies / breeding (by sex) / not_breeding (by status) / external | dogs across statuses, incl. Clover (`for_sale`, groups under "Not breeding") | tab switch + grouping | populated statuses | ✅ |
| Filters | Status/Disposition/Sex/Ownership/Breed | Status filter now has a live `for_sale` match (Clover); Disposition filter has a live `undecided` match (Aster) | filter dropdowns | breed filter needs >1 breed | ✅ Boston Terrier + Boxer both present |
| Sortable columns | click-to-sort; phone-collapse cols | — | column sort; "more details" | — | ✅ |
| Show archived | archive ≠ delete | Willow (archived) | listView Show-archived | ≥1 archived dog | ✅ |
| CSV export / + Add Dog | roster export from the hub | — | — | — | ✅ |

**`dog.html` (detail)** — DOM card order; ⟨cond⟩ = conditionally hidden.

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Profile — identity | full identity field set | Juniper, Ivy, Gunnar, Daisy, Diesel (registered_name/registry/registration_number/microchip_id/color_markings/url) | edit-in-place | identity fields set on ≥2 dogs | ✅ |
| Profile — ownership/external | owner required for external/leased; kennel hides | Gunnar (external, owner Dana), Sage (leased_in, owner Dana) | edit warnings (owner-required) | a `leased_in`/`leased_out` dog | ✅ |
| Profile — disposition | keeping vs offering; **puppy-only** field — shown only while `status='puppy'`, cleared when status moves past puppy | Fern & Wren (available); Poppy (keeping); Daisy & Cedar (placed); Aster (undecided) | — | disposition on ≥1 puppy incl. a `keeping` one | ✅ all four disposition values live |
| Profile — edit warnings | sex-mismatch, DOD/status, DOB-vs-litter (3 fixes) | (edit a linked-litter pup) | inline warn + fix buttons | a litter-linked pup | ✅ |
| Recorded COI | user-attested, never computed; method combobox | Juniper (genomic), Gunnar (pedigree) | collapsible; inline edit | recorded_coi on ≥2 dogs | ✅ |
| Planned Tests | undated intention; add/copy; advisory unlogged | Juniper, Ivy, Diesel (planned_tests set; unions with Thornfield's preferred_tests) | collapsible; **"+ Plan a test"** add/copy toggle | planned_tests + kennel preferred_tests | ✅ |
| Health-Test Summary | read-only test events; no inference | Juniper/Gunnar (genetic/ofa/breed-specific); Daisy (all twelve health-relevant event types on one puppy) | collapsible | health-test events | ✅ |
| Event History | span vs instant; 🔗 cost; add/edit modal | Percy (boarding span, related contact), Daisy (medication span), Sage (heat span) | **timeline** (see shared) | boarding/medication span example | ✅ |
| Expenses | ledger-first entry; event-linked costs | (a dog w/ a vet_visit cost) | **expensePanel** (see shared) | ≥1 expense | ✅ |
| Pairings ⟨cond⟩ | derived; edited on own page | Juniper | collapsible; + Add Pairing | breeding dog w/ pairings | ✅ |
| Sales ⟨cond⟩ | derived placement history | Hazel→Priya | collapsible; + Add Sale | owned dog w/ sales | ✅ |
| Stud Services ⟨cond⟩ | derived; either side | Birch/Percy | collapsible; + Add Stud Service | breeding dog w/ stud svc | ✅ |
| Contracts ⟨cond⟩ | lease/co_own/other via related_dog_id | Sage (lease, signed), Percy (co_own, sent) | collapsible; + Add Contract | related_dog_id contract | ✅ |
| Litters ⟨cond⟩ | derived; sire/dam | Juniper | collapsible; + Add Litter | dog w/ litters | ✅ |
| Pedigree | reverse (offspring) is derived, depth-capped | Juniper (Ash/Willow up; Fern/Birch/Hazel down) | collapsible; Open full view → | ancestry + offspring present | ✅ |
| Header actions | archive vs. delete-blocked-by-refs (registry msg) | any referenced dog | disabled Delete + tooltip | ≥1 referenced dog | ✅ |

**`pedigree.html`** — root picker + generations select + tree + derived Offspring.
Anchor Juniper. Status ✅.

### B.3 Breeding → `breeding.html` + `pairing.html` + `litter.html`

**`breeding.html` (chain view)**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Log heat cycle | dam picker → heat_cycle event | (a female dam) | **dam-picker modal → event modal** | a female on roster | ✅ Sage's already-concluded heat also drives the heat→pairing nudge |
| Pairing cards | pairing→litter→puppies all derived | existing pairings | "Open pairing/litter" | ≥1 pairing | ✅ |
| Show more | expanding window | 6 pairings seeded; first 5 shown, "Show 1 more pairing" toggle appears | **"Show more" toggle** | >5 pairings | ✅ |
| Litters (nested) / orphan litters | derived litter + puppy chips | Autumn litter (Ivy × Gunnar, ready, puppy chips); Daisy's Spring litter listed separately under "Litters without a recorded pairing" (no pairing_id) | — | expected + whelped/ready litters | ✅ |

**`pairing.html`**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Profile | sire≠dam **hard block**; sex-mismatch warn; planned→due +63d prefill | Pairing P2 (Juniper × Gunnar, `planned`, `planned_date` set, `expected_due_date` unset) | edit-in-place + warnings | an unwhelped pairing to show prefill | ✅ |
| Linked Litter | "+ Create Litter from this Pairing" | a pairing w/o litter | — | pairing without a litter | ✅ |
| Linked Stud Service ⟨cond⟩ | StudService owns pairing_id (derived reverse) | outgoing-stud pairing | — | stud svc linked to a pairing | ✅ |
| Timeline | pairing-subject events | — | timeline | pairing events | ✅ |
| Expenses | pairing-subject cost | Autumn pairing (P4) — $90 testing expense, progesterone timing | expensePanel | a pairing-subject expense | ✅ |

**`litter.html`**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Profile | nickname title; whelp→ready +56d; **per-sex pricing** → sale/prospective; **accept-deposits date** → prospective bundle | Autumn litter — nickname "Autumn litter", price $2800/$3000 (M/F), deposit $500/$500, accept-deposits Jun 19 2026, estimated-ready Jul 12 2026 | edit-in-place; sync/count/future-whelp warns; save→"update pairing status?" modal | pricing + nickname on a litter | ✅ |
| Timeline | litter-subject events incl. per-pup weight_check | — | timeline | litter events | ✅ |
| Puppy Roster | roster is derived (Dog WHERE litter_id), not stored | Autumn puppies (Wren, Cedar, Aster) | **+ Add Puppy / + Add N Puppies modals**; **"+ Log event for whole litter"** cascade | a litter w/ puppies + dam breed set | ✅ |
| Expenses | litter-subject cost | — | expensePanel | ≥1 litter expense | ✅ |
| Sales & Income | per-puppy sale **total value** (price + transport + deferred boarding) + status, with a running total; deliberately **no** earned/anticipated split or net (that detail lives only in reporting) | Cedar → Jamal Reed, $3,300.00 total (incl. transport $250 + boarding $250), Deposit paid | collapsible | ≥1 sale on a pup in this litter | ✅ |

Legacy `HUB_CHILDREN` (still reachable, not primary stops): `pairings.html`,
`litters.html` (breed col now meaningful — Boston Terrier and Boxer both appear, D2
resolved), `active-breeding.html`, `live-births.html`.

### B.4 People → `contacts.html` + `contact.html` + `kennels.html` + `kennel.html`

**`contacts.html`**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Group seg-tabs | buyers are Contacts (no Buyer table) | Priya (client), Ellen (network) | tab switch | contacts across role groups | ✅ |
| Filters / sort / Show archived | Type + Waitlist | — | filters; sortable cols | — | ✅ |

**`contact.html`**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Profile | contact_type[] multi; companion_note ≠ private notes; +New kennel inline; auto-tag roles from referred_by | Priya/Owen/Ellen/Jamal (companion_note); Tessa/Dana (referrer, auto-tagged); Grace (groomer); Rex (other) | edit-in-place; **inline "+ New" kennel modal** | groomer/other types; broad email/address/companion_note | ✅ |
| Dogs owned/co-owned ⟨cond⟩ | derived ownership | Dana → Gunnar | collapsible | owner/co-owner links | ✅ |
| Sales (as buyer) ⟨cond⟩ | derived buyer history | Priya | collapsible | buyer w/ sales | ✅ |

**`kennels.html`** (list — identity CRUD only)

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Add / rows | own vs. outside is a flag; name/prefix/location/website + own-flag | Thornfield (mine), Meadow Ridge (outside) | inline edit row | own + outside kennel | ✅ |
| Delete blocked | archive-only when referenced | Thornfield | disabled Delete + tooltip | referenced kennel | ✅ |
| Open → | jumps to the kennel detail page (config + expenses) | Thornfield | — | own kennel | ✅ |

**`kennel.html`** (detail — own-kennel program config + expenses)

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Identity / logo / website | read-only profile; `logo_data_url` + website surface on the print docs | Thornfield | — | own kennel | ✅ |
| Preferred tests panel | own-kennel test vocab; feeds the planned-test combobox | Thornfield preferred_tests — 7 tests (OFA Patella, OFA Cardiac Advanced, BAER Hearing, CAER, JHC DNA, DM DNA, Holter Monitor) | **"Preferred tests" panel + nested "Apply to dogs…"** | preferred_tests set on Thornfield | ✅ |
| Lifecycle nudges | promote-nudge config (`promote_nudge_enabled` + `promote_age_*`) | Thornfield promote_nudge_enabled=true, male 14mo / female 11mo — Poppy (12mo, keeping) is over threshold and fires the promote nudge | own-kennel config block | promote config + a `keeping` pup old enough | ✅ |
| Kennel Expenses | overhead ledger (subject=kennel) | Thornfield overhead expenses | **expensePanel** | ≥1 kennel expense | ✅ |

**Note:** `preferred_breeds` has **no editor** — set via seed/import only. The seed now
populates it (`['Boston Terrier', 'Boxer']`), so the field has a live value; there is
still no in-app control to change it (D2/G12).

### B.5 Placements & Contracts → `sales.html` + `sale.html` + `stud-services.html` + `stud-service.html` + `contracts.html` + `contract.html`

**`sales.html`**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Sale cards, grouped by litter → dog | placement_type & sale_status; Contract owns the link; cards are **grouped under the sold pup's litter** (dogs with no litter link fall into one "External acquisitions" bucket, last), not paginated | Cedar→Jamal (Autumn litter, Show, Deposit paid); Daisy→Nora (Spring litter, Pet, Deposit paid); Hazel→Priya (Summer litter, Pet, Delivered) | link/unlink/create contract | ≥1 open sale | ✅ two open + one delivered |

**`sale.html`**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Profile — fees then dates | price/deposit/transport/deferred; deposit→balance lifecycle | Cedar's sale — Deposit paid, price $2800, deposit $500, transport fee $250, deferred boarding $25/day × 10, balance due Aug 9 2026 | edit-in-place; dog→price prefill; buyer→lead_source | open sale + transport/deferred set | ✅ |
| Profile — post-save prompts | co-own→co-owner, delivered→ownership, disposition, boarding, placement | (a delivered / new sale) | **prompt-chain modals** | sale transitions | ✅ |
| Contracts | governing = most-recent signed (derived) | Hazel sale contract | + Create Contract | a signed sale contract | ✅ |

**`stud-services.html` / `stud-service.html`**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Cards, grouped by our dog | direction; inline contract link; cards are **grouped by `our_dog_id`** (the kennel's own dog on either side), not paginated | Birch (outgoing) and Juno (incoming), each its own card | link/unlink/create | incoming + outgoing | ✅ |
| Profile | direction/type; fee_structure gates pick_status **and** pick_value_amount (non-cash pick estimate, separate from fee); in-person+sent→away board; +Create Pairing | Birch (outgoing, in_person, flat_plus_pick, pick_value $1500, Arranged); Juno (incoming, ai, flat_fee $1200, Completed) | edit-in-place; pick fields toggle on fee_structure | an incoming, ai stud service | ✅ |
| Contracts | derived by related_stud_service_id | Birch × Nell agreement (signed); Titan × Juno AI agreement (signed) | + Create Contract | stud contract | ✅ |

**`contracts.html` / `contract.html`**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Fallout list | co_own/lease/other/unlinked live here | Breeding Lease — Sage (Lease, Signed); Co-Ownership Agreement — Percy (Co-own, Sent) | filters Type/Status; sortable | a lease + co_own contract | ✅ |
| Profile — type-conditional | lease hides sale/stud, shows lease dates; related_dog/counterparty; document_url→companion; status moves freely | Sage's lease (signed, related_contact_id=Dana, lease_start/end dates, document_url); Percy's co_own (status `sent` — the non-signed example) | edit-in-place; fields swap on type | lease + a non-signed status example | ✅ |

### B.6 Financials → `financials.html`

Top **Overview / Income / Expenses** toggle (`?view=`). An **"Invoice / Receipt"**
generator button sits on every view.

**Overview view**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Net tiles | Earned income / Anticipated income / Total expenses / **Net (earned − spent)** | Earned $3,600.00 · Anticipated $5,800.00 (+ $1,500.00 est. non-cash pick value) · Total expenses $4,870.25 · Net −$1,270.25 | — | income + expenses present | ✅ |
| Breakdown | income-by-component beside expense-by-category | Income: deposits/balance/transport/deferred-boarding/stud-fees/pick-value all non-zero; Expenses: 8 of 12 categories seeded as records (food, veterinary, testing, registration, supplies, facility, marketing, dog_purchase) — `boarding`/`stud_fee`/`insurance`/`other` are teach-from-control per spec §7, not seeded | — | costs + income across kinds | ✅ |

**Income view** — money-in is **derived** (no income table); read from Sales + outgoing Stud Services.

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Summary | earned/anticipated totals + per-component breakdown | Earned $3,600.00 across 3 records; Anticipated $5,800.00 across 3 records, plus $1,500.00 est. non-cash pick value | — | income rows present | ✅ |
| Earned / Anticipated boxes | each a reportView (source/year filters + CSV); a component is earned once paid-dated or status-advanced, else anticipated; stud `pick_value` rides its own non-cash line, out of the cash totals | Hazel sale (earned, $2,500 delivered); Cedar & Daisy sales (anticipated, deposit-paid) + Birch stud service (anticipated, arranged) | **row → Adjust modal** (writes money/status/paid-date back via repo) | an open, part-paid sale to split across both boxes | ✅ |

**Expenses view**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Summary | grand total + per-category | existing expenses | — | expenses across categories | ✅ |
| Category seg-tabs | one tab per `EXPENSE_CATEGORIES` value + **All**; pre-filters the loaded ledger | — | tab switch (`?bucket=`) | costs across categories (incl. `dog_purchase`) | ✅ 8 of 12 tabs have records; remainder teach-from-control (spec §7) |
| Ledger | category/subject-type/year filters + CSV; newest-first | kennel/dog/litter/pairing/event costs | filters; row→subject | costs across subject types | ✅ pairing-subject expense added (Autumn pairing, testing) |
| + Add Expense | log against any subject (Expenses view only) | — | **add-expense modal** (subject-type→subject) | — | ✅ |

**Invoice / Receipt generator** — a modal listing every income record (sales + outgoing stud);
picking one opens the print-only `invoice.html` (per-line Full/Partial, due dates, accepted
methods). Teaches: the five cash line types; browser Print → Save as PDF. Status ✅.

### B.7 More → Reports / Companion / Import-Export

**Reports (`reports.html` tiles → reportViews)**

| Report | Teaches | Depends on | Status |
|---|---|---|---|
| litters-report | litters over time (Year/Status) | ≥2 litters | ✅ 4 litters across `expected`/`ready`/`sold` |
| live-births | per-litter live % | litters w/ born counts | ✅ |
| placements-report | sales by type/status/year | ≥1 open + closed sale | ✅ two open (Cedar/Daisy) + one delivered (Hazel) |
| litter-finances-report ("Litter P&L") | sale income vs. cost per litter, earned/anticipated + net | litter + puppy expenses, sale income | ✅ — **not in the Phase 1 inventory**, added to this matrix in Phase 4 after the browser walk found it live under Reports → Analytics |
| stud-services-report | outgoing + incoming | both directions | ✅ Birch (outgoing) + Juno (incoming) |
| health-tests-report | test events across dogs | test events | ✅ Daisy carries all twelve health-relevant event types; Juniper/Gunnar carry genetic/OFA/breed-specific |
| roster / scheduled-placements | operational reportViews | — | ✅ |

**Companion (`companion.html`)**

| Section | Teaches | Anchor | Expandable | Depends on | Status |
|---|---|---|---|---|---|
| Seg-tabs + filter blurb | allow-list / one-way / no-revoke; membership rules; the tab **is** the bundle type | — | tab switch | — | ✅ |
| Message template + "What to include" | per-type Layer-1 copy **plus** the per-type component allow-list (all default on; builder only ever subtracts; masters gate children) | (kennel identity) | editable card; **"What to include" master/child checkboxes** | — | ✅ |
| Recipients — Prospective | active waitlist; per-litter availability incl. **accept-deposits date** + per-sex price | Owen — sees Autumn litter's live price ($2800/$3000 M/F) and accept-deposits date | collapsible row; note editor; **Preview** (iframe render) / **Prepare link** | Owen + litter price/accept-deposits | ✅ |
| Recipients — Current families | open sale membership (terminal sales excluded); balance math | Nora (Daisy, deposit paid) and Jamal (Cedar, deposit paid + transport + deferred boarding) | collapsible row; Preview / Prepare link | ≥1 open sale | ✅ |
| Recipients — Partners | stud/lease/co_own membership; live-only, per-type contracts | Ellen (outgoing stud); Hugo (incoming stud); Dana (lease); Sam (co_own) | collapsible row; Preview / Prepare link | Ellen + a lease partner | ✅ |

**Import/Export (`import-export.html`)**

| Section | Teaches | Expandable | Status |
|---|---|---|---|
| JSON backup / restore | trust model; "back up your data" (tour closer) | restore **preview table** → Merge/Replace confirm | ✅ |
| CSV import (7 importers + kennel-tests) | match-or-create by natural key; dry-run preview | each = importView dry-run (create/update/needs-review) → commit | ✅ |
| Sample data / Kennel setup / Reset | clear demo; kennel-setup; reset (type RESET) | reset modal | ✅ |

---

## C. Gap resolution log (Phase 2/3, browser-confirmed)

Phase 1 found these gaps; Phase 2 (`data/sampleData.js`) closed all of them via the
spec's §6 narrative threads, and Phase 3 confirmed every one live on a fresh seed in a
browser (zero console errors). This table is now a closure record, not an open list —
kept so the anchor that closed each gap stays traceable. See §B above for the anchor
detail per tour stop; the spec's §8 checklist has the thread-by-thread mapping.

| Gap | Where it bit (tour stop) | Closed by | Confirmed live? |
|---|---|---|---|
| G1 nudges | Today → Nudges card rendered nothing | Threads F+G — tuned relative dates + kennel config | ✅ 7 of 8 rules fire; litter→close intentionally not live (spec §9.3) |
| G2 open sale | Sales lifecycle; Companion "Current families"; This-year Sales=0 | Thread C — Cedar's open sale to Jamal | ✅ This-year Sales tile = 2; Current families has Nora + Jamal |
| G3 litters | Breeding chain sparse; This-year Litters=0; pairing/litter prefills | Thread A — Autumn (ready) + Winter (expected) litters | ✅ This-year Litters tile = 2; 4 litters total |
| G4 litter pricing | Litter detail; Sale prefill; Prospective bundle price | Thread A — Autumn litter priced per sex + accept-deposits date | ✅ litter.html shows $2800/$3000, Owen's prospective bundle shows the price |
| G5 lease | Dog ownership "external/lease" teaching moment | Thread D — Sage, `leased_in` from Dana | ✅ dog.html shows Ownership: Leased in, Owner: Dana Ruiz |
| G6 dog identity | Dog Profile identity fields; Planned Tests empty | Threads A/E — full identity + planned_tests on Juniper/Ivy/Gunnar/Daisy/Diesel | ✅ confirmed on all five dog pages |
| G7 contracts | contracts.html fallout; Companion Partners lease path | Thread D — Percy `co_own` (sent) + Sage `lease` (signed) | ✅ both listed on contracts.html; Dana appears as a Partner |
| G8 incoming/ai stud | Stud service direction/type; stud-services-report | Thread B — Juno × Titan, incoming, ai, flat_fee | ✅ stud-services.html shows both directions grouped by our dog |
| G9 sale fees | family bundle balance math | Thread C — Cedar's transport_fee + deferred_boarding_* | ✅ litter.html Sales & Income totals $3,300 (price + transport + boarding), matches Financials Anticipated breakdown exactly |
| G10 Show more | Breeding pairings pagination only (Sales & Stud are grouped, not paginated) | Threads A/I — 6th pairing (Diesel × Juno) pushes the count past `PAGE_SIZE=5` | ✅ 5 pairing cards + "Show 1 more pairing" toggle |
| G11 medical spans | Dog timeline boarding/medication span | Threads E/A — Percy boarding span, Daisy medication span, Sage heat span | ✅ all three render as span rows on their dog timelines |
| G12 kennel config | Preferred-tests panel; promote nudge | Thread F — Thornfield preferred_tests/preferred_breeds/promote_* | ✅ kennel.html shows all 7 tests + promote thresholds; Poppy's promote nudge fires |
| G13 contacts polish | groomer/other; email/address/companion_note breadth | Thread H — Grace (groomer), Rex (other); broadened fields on Owen/Ellen/Dana/Jamal | ✅ contacts.html lists both new types; companion_note confirmed on 4 recipients |
| G14 pairing expense | Financials subject-type filter; pairing Expenses | Thread H — testing expense on the Autumn pairing | ✅ Financials Expenses ledger includes a `pairing`-subject row |
| D2 Boxers | Dogs breed filter; litters breed col; reports >1 breed | Thread I — Diesel/Juno/Titan/Sage (Boxer) + a Boxer pairing | ✅ Dogs breed filter offers Boston Terrier + Boxer; Diesel×Juno pairing status `failed` |

**Two additional closures found during the Phase 4 acceptance pass (not part of the
original G1–G14/D2 set — the spec's §7 enum-coverage table required them but the Phase
2 checklist never listed them as gaps):**

| Finding | Where it bit | Closed by | Confirmed live? |
|---|---|---|---|
| `DOG_STATUS: 'for_sale'` had no live record | Dogs status filter; Today's Kennel overview status tiles | New dog **Clover** — a retired Boston female past breeding age, `status: 'for_sale'`, no sire/dam recorded (same pattern as Percy/Nell/Dahlia/Titan/Sage) | ✅ Kennel overview shows a "For Sale" tile = 1; dogs.html status filter matches |
| `DISPOSITION: 'undecided'` had no live record | Dog Profile disposition field; Today's Active litters roster ordering (available→undecided→sold) | **Aster**'s disposition changed from `keeping` to `undecided` (Poppy already anchors `keeping`, so no coverage was lost) | ✅ Aster shows "Undecided" on dog.html and in Autumn litter's Active-litters roster (now 1/3 sold, Aster listed as sellable between Wren and Cedar) |

`LITTER_STATUS: 'closed'` remains without a live record — that one is an already-documented, deliberate trade-off (same reasoning as the litter→close nudge not firing; see the spec's §8 G1 note and §9.3), not a new finding, and stays deferred.

**Teach-from-control (🎛️, no record — spec §6/D3, unchanged by Phase 2/3):** sale
`cancelled`/`returned`, contract `void`/`declined`, pairing
`bred`/`not_pregnant`/`failed`/`cancelled`, litter `sold`, and the second lease
direction. The tour opens the dropdown and names these; they are **not** matrix gaps.
(Diesel × Juno's pairing *is* seeded as `failed`, but that's incidental to giving the
Boxer line a pairing record, not an attempt to also turn `failed` into a live record —
`bred`/`not_pregnant`/`cancelled` still have no seeded example and stay
teach-from-control.)

---

## D. Expandable-surface inventory (every toggle/modal the tour must open)

The tour must drive these, not just point at them. Complete list found by walking:

- **Collapsible cards** (chevron): every `today.html` card; every `dog.html` card
  (except Profile); `contact.html` Dogs/Sales; Event History & Expenses everywhere.
- **Expandable table rows**: Today "Away from home" (tap row → Contact/Drop-off/Return).
- **"Show more" pagination**: `breeding.html` only (PAGE_SIZE=5) — live with the seed's
  6 pairings. `sales.html` and `stud-services.html` group their cards (by litter/dog)
  instead and do not paginate.
- **Modals**:
  - Event add/edit (`eventForm.js`) — from every timeline, litter cascade, sale
    post-save prompts, breeding "Log heat cycle" (via dam-picker modal first).
  - Expense add/edit — from every expensePanel + Financials "+ Add Expense".
  - Puppy add — "+ Add Puppy" / "+ Add N Puppies" on litter.
  - Prompt-chain modals on sale save (co-owner / ownership / disposition / boarding /
    placement) and litter save ("update pairing status?").
  - Income **Adjust** modal (Financials Income view → row) writing money/status/paid-date back.
  - **Invoice / Receipt generator** modal (Financials, every view) → print-only `invoice.html`.
  - **Print Puppy Record** modal (`sales.html`, non-delivered sales) → print-only `puppy-record.html`.
  - Companion **Preview** modal (channel body + real shell in an iframe).
  - Inline "+ New contact" (contactPicker) on sale/stud-service pickers; inline "+ New
    kennel" on contact.
  - Confirm/alert/select/prompt modals (`ui.js`) for archive/delete/etc.
  - Reset-app "type RESET" modal; restore Merge/Replace confirm.
- **View toggles / seg-tabs**: Financials **Overview / Income / Expenses** top toggle +
  Expenses **category** seg-tabs; Companion bundle-type seg-tabs; Dogs/Contacts group tabs.
- **Inline edit toggles**: Dog Profile edit; Recorded COI edit; Planned Tests
  "+ Plan a test"; kennels list inline edit (identity); kennel-detail config — Preferred-tests
  panel + "Apply to dogs…" + lifecycle-nudge thresholds; companion recipient expand + note
  editor + "What to include" checkboxes + Preview + Prepare link.
- **Datalists / comboboxes**: breed, COI method, planned-test token, lead source,
  first-contact source, pick status.

---

## E. Browser verification evidence

**Phase 1 evidence (pre-Phase-2 seed, superseded — kept for history):** served
`KennelOS/` over HTTP, seeded Thornfield via the first-run prompt, walked the hub pages
headless. No page/console errors. Today showed Reminders(3) · Active litters(1, the
closed litter still holding available Fern) · Due outs(2) · Away from home(1)=Birch ·
This year (Litters 0 / Pairings 2 / Sales 0), **no Nudges card**. Dog Detail's Planned
Tests and Breeding's "Show more" were both empty/absent. Screenshots from that walk
were scratch and not retained.

**Phase 3 evidence (current — the expanded seed, Playwright, headless Chromium,
fresh IndexedDB profile).** Seeded via the first-run prompt; walked ~25 pages across
every hub plus all six report pages. **Zero console/page errors throughout.**

- **Today**: Nudges(7) — all seven intended rules present (stud-status/Birch,
  promote/Poppy, stud→pairing/Juno, heat→pairing/Sage, overdue-pairing/Percy×Dahlia,
  litter→sold/Daisy's litter, litter→reopen/Summer litter). Reminders(3): Overdue(1,
  Juniper) · Due soon(1, Percy) · Upcoming(1, Birch). Active litters(2): Autumn
  (1/3 sold: Wren available, Aster undecided, Cedar placed) and Summer (0/1 sold: Fern
  available). Due outs & upcoming(2): Cedar's scheduled pickup + Percy's vet visit.
  Away from home(1): Birch @ Burlington, VT. Kennel overview: 6 puppy / 7 active
  breeding / 0 retired breeding / 1 pet home / 1 for sale (Clover) / 1 deceased / 4
  external reference / 1 archived. This year: Litters whelped 2 / Pairings 5 / Sales 2.
- **Dog Detail**, spot-checked on Juniper, Ivy, Gunnar, Daisy, Diesel, Poppy, Sage,
  Aster, Percy: identity fields, Recorded COI, Planned Tests, Health-Test Summary,
  Event History (span + instant rows), Expenses, conditional Pairings/Sales/Stud
  Services/Contracts/Litters cards, and Pedigree all render as the matrix in §B
  describes. Percy's boarding span shows a related contact (Sam); Sage's Contracts card
  (conditional) shows the signed lease; Daisy's Health-Test Summary and timeline show
  the full twelve-type spread.
- **Breeding**: 5 pairing cards + "Show 1 more pairing" toggle (6 pairings seeded);
  "Litters without a recorded pairing (1)" correctly isolates Daisy's Spring litter.
- **Contacts**: 12 rows visible (Marcus Webb archived, correctly hidden by default);
  Dana shows auto-tagged roles "Breeder, Stud referrer".
- **Sales**: three cards grouped by litter (Autumn/Spring/Summer), correct
  placement_type and status badges.
- **Stud Services**: two cards grouped by our dog (Birch outgoing, Juno incoming).
- **Contracts** (fallout list): Percy's co_own (Sent) and Sage's lease (Signed).
- **Financials** (Overview + Income views): Earned $3,600.00, Anticipated $5,800.00 (+
  $1,500.00 est. non-cash pick value), Total expenses $4,870.25, Net −$1,270.25. Balance
  math verified by hand: Cedar's anticipated total ($2,800 = $2,300 balance + $250
  transport + $250 deferred boarding) and Daisy's ($2,200 balance) both reconcile
  exactly against the litter detail's Sales & Income total and the breakdown table.
- **Companion**: all three tabs (Prospective/Current families/Partners) render ≥1
  recipient — Owen; Nora + Jamal; Dana + Ellen + Hugo + Sam.
- **Reports**: all six analytics pages (Litters Over Time, Live-Birth Summary,
  Placements, **Litter P&L**, Stud Services, Health-Test Events) plus both operational
  pages load with content and no errors.
- **Reset check**: `clearSampleData()` reported `cleared: true` with counts matching
  the packet exactly (21 dogs, 13 contacts, 2 kennels, 6 pairings, 4 litters, 3 sales,
  2 stud services, 6 contracts, 46 events, 9 expenses, 0 contamination conflicts), and
  every table read back empty afterward. Re-verified after adding Clover (`for_sale`)
  and switching Aster to `undecided` — same clean result, dog count 20→21.

---

## F. The tour spine (ordered stop list — Phase 0 backbone this matrix implies)

The natural one-idea-per-stop sequence the seed must serve, hub by hub, in the shipped
IA. (Feeds Phase 0's "freeze the spine"; the wizard-runtime spec, Phase 5, consumes it.)

0. **Open** — first-run prompt → seed Thornfield; kennel-setup wizard.
1. **Today** — Reminders (+snooze/dismiss) → Active litters (per-litter availability) →
   Due outs → Away board (expand row) → Kennel overview (status vs archive) → *Nudges*
   (7 of 8 rules live).
2. **Dogs** — list (buckets/filters/Show archived) → Dog detail top-to-bottom (identity
   → ownership/external → disposition → COI → Planned Tests → Health tests → timeline
   span → expenses → derived panels → pedigree).
3. **Breeding** — chain view (Show more, Log heat) → Pairing (sire≠dam block, prefill)
   → Litter (pricing, roster derived, cascade event).
4. **People** — Contacts (groups, companion_note) → Kennels list (identity) → Kennel
   detail (preferred tests, promote config, kennel expenses).
5. **Placements** — Sales (open lifecycle, grouped by litter/dog, inline contracts;
   Puppy Record PDF) → Sale detail (fees→dates) → Stud services (incoming+ai, pick_value,
   away-board link) → Contracts (lease/co_own).
6. **Financials** — Overview (Net tiles) → Income (earned vs anticipated, Adjust) →
   Expenses (category tabs, ledger, add expense) → Invoice/Receipt PDF.
7. **More** — Reports (six analytics, incl. Litter P&L) → Companion (all three tabs
   non-empty, "What to include") → Import/Export (**backup = the closer**).

---

*Companion to `Tutorial_Sample_Data_Coverage_Spec_v1.md` (the gap catalog this matrix
classifies against), `Wizard_Runtime_Spec_v1.md` (Phase 5 — the runtime that consumes
§B/§F as its step catalog), and the End-State guide §13 (page catalog) / §19 (nudges) /
§20 (companion). When the seed or IA changes, update this matrix and the spec together.*
