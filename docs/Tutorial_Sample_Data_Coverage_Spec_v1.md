# Tutorial Sample-Data Coverage Spec (v1)

**Status:** Draft for review; the §11 open decisions are now **resolved** (see §11).
Planning doc only — no code changes proposed here.
**Goal:** Make the "Thornfield Kennels" sample packet comprehensive enough that a
first-run guided tutorial can walk a brand-new user through **every hub, every
section, every expandable surface, every required field, and every cross-app field
dependency** using nothing but seeded data — one hub at a time.

This spec is the map for a large project. It does two jobs:

1. **Audits the current seed** (`data/sampleData.js`) against what a full-app tour
   needs, and lists the concrete gaps.
2. **Defines the target**: the coverage matrix, the field-dependency catalog, the
   expanded sample-data roster, and the acceptance criteria that say "done."

It deliberately does **not** design the wizard runtime (coach-marks, step pointer,
per-page hook). That is a separate spec. The two meet at one contract: **every step
the tour defines must have a guaranteed, deterministic record to anchor on.** This
doc's job is to guarantee those records exist.

---

## 1. Why the current seed isn't enough (gap summary)

The current packet is well-built for *demoing features*, but a *tutorial* has a
stricter bar: it must be able to **stop on every screen and point at a live example**.
Auditing `sampleData.js` against the page catalog (End-State guide §13) and the vocab
(`data/vocab.js`) surfaces these gaps. Details and fixes are in §7–§8.

| # | Gap | Tour stop that breaks today |
|---|-----|------------------------------|
| G1 | **Nudges section renders empty.** With today = seed's relative dates, none of the eight nudge rules (§19) fire: the stud service is already `completed` and has a `pairing_id`; no kennel has `promote_nudge_enabled`; the heat-cycle event sets `details.cycle_start` but no `event_end_date`, so heat→pairing can't fire; no pairing is overdue; and the sole litter is `closed` with every pup resolved, so none of the three litter-lifecycle rules (sold / reopen / close) fire either. | Today → "Nudges" — the marquee feature has nothing to show. |
| G2 | **No open/in-progress Sale.** The only sale (Hazel→Priya) is `delivered` — a terminal status. So the Companion **"Current families"** tab is **empty** (family membership excludes `delivered`/`returned`/`cancelled`), and the deposit→balance sale lifecycle is never visible. | Placements → Sales lifecycle; Companion → Current families. |
| G3 | **Only one litter, and it's `closed`.** The Breeding hub's `active-breeding`, `live-births`, and litter-status views are sparse/empty; an "expected" and a "ready" litter don't exist. | Breeding → Litters / Active breeding / Live births. |
| G4 | **Litter pricing fields unset** (`expected_price_*` / `expected_deposit_*`). So Sale's price/deposit prefill-from-litter can't be shown, and the **prospective** companion bundle (now carries price — brief policy reversal) shows blank money. | Breeding → Litter detail; Placements → new Sale prefill; Companion → Prospective. |
| G5 | **Ownership types `leased_in` / `leased_out` and dog status `for_sale` never appear.** | Dogs → status/ownership badges; the "mark external if you don't own it" teaching moment has no lease example. |
| G6 | **Dog identity fields all blank across every dog**: `registered_name`, `registry`, `registration_number`, `microchip_id`, `color_markings`, `url` (photos), `planned_tests`. | Dogs → Dog detail form fields; Pedigree; Companion photos. |
| G7 | **Contract types `co_own` / `lease` / `other` and every non-`signed` status unshown.** Lease dates + `related_dog_id`/`related_contact_id` + a lease-based **partner** never demonstrated. | Placements → Contracts; Companion → Partners (lease path). |
| G8 | **Stud service `incoming` direction and `ai` type never shown** (only one outgoing, in-person service exists). | Placements → Stud services. |
| G9 | **Sale `transport_fee` and `deferred_boarding_*` unset**, so the family bundle's computed remaining-balance math is never exercised. | Companion → Current families (balance math). |
| G10 | **"Show more" never triggers.** The only paginated list left is Breeding's pairing chain (`breeding.js`, `PAGE_SIZE=5`); with 3 seeded pairings it never crosses the threshold. Sales and Stud-services are now **grouped** (by litter / by our dog), not paginated, so they carry no "Show more" at all. The user explicitly wants the "expanding window" demonstrated. | Breeding → pairing chain "Show more". |
| G11 | **Several event types have no timeline example**: `boarding` (removed in the away-board de-dup), `medication` (a span), `surgery`, `injury`, `illness`, `abnormalities`, `breed_specific_test`. | Dogs → timeline "here's what a boarding/medication span looks like". |
| G12 | **Own-kennel config unset**: `preferred_tests` / `preferred_breeds` (test-vocab suggestions), `promote_nudge_enabled` + `promote_age_*`. | People → Kennel detail; Dogs → planned-tests combobox suggestions. |
| G13 | **Contact roster thin on teachable fields**: `groomer`/`other` types absent; `companion_note`, `email`, `address` set on only one or two contacts. | People → Contact detail fields. |
| G14 | **No `pairing`-subject Expense**, though `EXPENSE_SUBJECT_TYPES` includes it. | Financials → subject-type filter. |

**The through-line:** the seed was built to prove features *exist*; a tutorial needs
to prove a new user can *find and read* each one. The remediation (§8) closes these
without changing the schema — every addition is data.

---

## 2. Design principles the expanded seed must honor

Non-negotiables carried over from the app's architecture and the Sample Data & Reset
brief; the tutorial adds three more (marked ★).

1. **Seed through the repo layer.** Every record still goes through `*.create` so it
   passes the same validation real data does. No direct `db.*` writes.
2. **Manifest-tracked, cleanly clearable.** Every new record's id lands in the
   manifest; `clearSampleData`'s contamination check and dependency-ordered delete
   must still succeed. New reference kinds ⇒ verify the clear order (§ `sampleData.js`
   delete transaction).
3. **Relative dating, not fixed.** Dates that must read as "now-ish" use
   `daysFromToday` / `monthsFromToday` so the demo never rots. Historical anchors
   (a 2016 birth, a 2021 title) stay absolute. ★ **The tutorial tightens this:** any
   record a nudge/reminder/away-board depends on must be dated so the intended state
   is *live on the day the user runs the tutorial* — see §5.
4. **No schema change if avoidable.** All §8 additions are new *rows* and previously
   unset *plain fields*; none needs a new index, table, or FK. If a genuinely new FK
   appears, it takes a `referenceRegistry.js` line **and** an End-State guide edit.
5. **Believable, not exhaustive-at-any-cost.** Thornfield stays a plausible small
   Boston Terrier program. We add breadth by adding *realistic* dogs/litters/sales, not
   by cramming one of every enum onto nonsensical records. Where an enum value has no
   believable home in Thornfield's story, the tour teaches it from the dropdown, not a
   fake record (see §6 "teach-from-control" fallback).
6. ★ **Determinism.** The tour points at specific records by a stable handle. The seed
   must create the same logical records in the same order every run, so the tour's
   anchors (e.g. "the dog named Juniper", "the expected litter") are reliable. Prefer
   anchoring tour steps on **stable natural handles** (call name, kennel name) over
   array position.
7. ★ **Service-worker discipline.** `sampleData.js` is an existing precached file;
   editing it still requires bumping `CACHE_NAME` in `sw.js` (no new file, so no
   `PRECACHE_URLS` change). Any *new* asset (e.g. a placeholder photo for `Dog.url`)
   is a precache + cache-name change and a data-model note.

---

## 3. Method — the two artifacts this project produces

### 3.1 The Screen × Section coverage matrix

A row per **(hub → screen → section/expandable surface)**; columns:

- **What the tour teaches here** (the one idea per stop).
- **Anchor record** — the seeded record/field the coach-mark points at.
- **Expandable?** — modal / "Show more" / collapsible / toggle the step must open.
- **Depends on** — which seed guarantee must hold (e.g. "≥1 expected litter").
- **Status** — covered / gap (→ §8 fix id).

§4 is the first-pass fill of this matrix. Completing it screen-by-screen by actually
walking each page in the browser is **Phase 1 of the build** (the End-State guide's
page catalog is the checklist; don't trust this doc's section lists to be exhaustive
until each page has been opened).

> **Phase 1 is done.** The completed matrix lives in
> **`Tutorial_Coverage_Matrix_v1.md`** — built by walking every page and verified in a
> browser. It corrects §4 in several structural ways (the hubs land on *consolidated*
> pages: Today→`today.html`, Breeding→`breeding.html`, etc.; "Nudges" is a card, not a
> page; Dog Detail has 12 sections; kennels have no detail editor). Read that matrix as
> the current map; §4 below is kept as the historical first pass.

### 3.2 The field-dependency catalog

Two tables the tour's copy is written from:

- **Required-field catalog** (§5.1) — every repo-enforced required field, per entity,
  with the one-line "why it's required" the tour says out loud.
- **Cross-app dependency catalog** (§5.2) — every field whose value *changes something
  elsewhere* (a nudge, a prefill, a derived list, a companion bundle, an away-board
  row). These are the "value dependencies" that are invisible at the point of entry and
  are the real reason a tutorial exists.

---

## 4. Per-hub tour coverage plan (first-pass matrix)

For each hub: the screens/sections the tour visits, the expandable surface it opens,
and the anchor record. "GAP→Gn" marks a stop that needs a §8 fix before it can run.

### 4.1 Today (hub: `today` → `dashboard`/`reminders`/`upcoming`/`board`/`scheduled-placements`)
- **Status tiles** — count-by-status; anchor: the dog roster. Teaches status vs. archive.
- **Nudges** — the derived-suggestion engine. Anchor: at least one live nudge of each
  rule the story can carry. **GAP→G1** (currently empty).
- **Reminders** — overdue / due-soon / upcoming buckets + **Show dismissed** toggle +
  inline **Snooze**. Anchors already exist (Juniper overdue, Percy due-soon, Birch
  upcoming, Fern dismissed). Teaches: reminders live on events; snooze *is* a date edit.
- **Due outs & upcoming** — anchor: Fern's scheduled placement (+7d). Teaches the
  deep-link into an event.
- **Away board** — anchor: Birch's in-person stud stay at Ellen's. Teaches: whereabouts
  unions boarding events **and** in-person stud services; location resolves from the
  partner contact's `address` (dependency).

### 4.2 Dogs (hub: `dogs` → `dog` detail, `roster`, `pedigree`)
- **Dogs list** — filters, sort, **Show archived** (anchor: Willow, archived). Teaches
  status/ownership/disposition badges.
- **Dog detail — identity fields** — `registered_name`/`registry`/`registration_number`/
  `microchip_id`/`color_markings`/`url`. **GAP→G6** (all blank today).
- **Ownership & the "external" teaching moment** — anchor: Gunnar (external, owner =
  Dana) and a **leased** dog. **GAP→G5**. Teaches: mark external if you never owned it
  or you sold it; owner **required** when external/leased-in; kennel field hides.
- **Disposition** — anchor: Fern (available) / Birch (keeping) / Hazel (placed).
- **Recorded COI** — anchor: Juniper (genomic/Embark) & Gunnar (pedigree/AKC). Teaches:
  user-attested, never computed; combobox method suggestions.
- **Planned tests** — the add/copy toggle (expandable). **GAP→G6/G12** (no planned
  tests seeded; no kennel `preferred_tests` feeding suggestions).
- **Timeline** — the add/edit **event modal** (expandable), span vs. instant rows,
  the 🔗-cost tag. **GAP→G11** (no boarding/medication span example).
- **Pedigree** — ancestor tree + derived Offspring. Anchor: Juniper (has Ash/Willow up,
  Fern/Birch/Hazel down). Teaches: reverse is derived, depth-capped.

### 4.3 Breeding (hub: `breeding` → `pairings`/`pairing`, `litters`/`litter`, `active-breeding`, `live-births`)
- **Pairing chain + Show more** — the only paginated list left (`breeding.js`,
  `PAGE_SIZE=5`). **GAP→G10** (need >5 pairings). Teaches pairing_type/status.
- **Pairing detail** — sire≠dam **hard block**, sex-mismatch **warning**, `planned_date`
  → `expected_due_date` +63d prefill (dependency), timeline of pairing-subject events.
- **Litters list / Active breeding / Live births** — **GAP→G3** (need expected +
  whelped/ready litters, not just one closed).
- **Litter detail** — `nickname` title fallback, `whelp_date` → `estimated_ready_date`
  +56d prefill (dependency), per-sex **pricing defaults** (dependency → Sale prefill &
  prospective bundle). **GAP→G4**. Puppy roster is **derived** (`Dog WHERE litter_id`)
  — teach that it's not a stored list. "Log event for whole litter" cascade + the
  per-puppy `weight_check` exception (expandable modal).

### 4.4 People (hub: `contacts` → `contact` detail, `kennels`/`kennel`)
- **Contacts list — group tabs / waitlist filter** — anchors: Priya (fulfilled), Owen
  (active), others (none). Teaches: buyers are Contacts, no Buyer table.
- **Contact detail fields** — `contact_type[]` multi, `email`/`phone`/`address`,
  `waitlist_status`, `first_contact_source`, `companion_note` (recipient-facing, distinct
  from private `notes` — dependency into companion). **GAP→G13**. Auto-tagged roles
  (`buyer_referrer`/`stud_referrer`) from a Sale/StudService `referred_by` (dependency).
- **Inline "＋ New contact"** from a picker (expandable). Anchor: any picker.
- **Kennels list + Open→ Kennel detail** — `breeder_kennel_id` ("who produced it") vs.
  `kennel_id` ("which of my kennels now") distinction. Own vs. outside kennel (Thornfield
  vs. Meadow Ridge). Kennel detail hosts an **Expense panel**. `preferred_tests`/
  `preferred_breeds` + promote-nudge config. **GAP→G12**.

### 4.5 Placements & Contracts (hub: `sales` → `sale`, `stud-services`/`stud-service`, `contracts`/`contract`)
- **Sales list (grouped by litter)** — cards grouped under each sold pup's litter, with
  a trailing "External acquisitions" bucket for dogs with no litter link; **not**
  paginated. **GAP→G2**. Teaches placement_type & sale_status.
- **Sale detail — fee fields above date fields** — `price`/`deposit`/`transport_fee`/
  deferred boarding, then the date ladder. The deposit→balance lifecycle needs an
  **open** sale. **GAP→G2/G9**. `referred_by` auto-tag (dependency). Prompt to log a
  placement event (dependency, not a stored link).
- **Stud services list (grouped by our dog) + detail** — outgoing **and** incoming;
  in-person **and** ai; `fee_structure` gates `pick_status`/`pick_value_amount`
  visibility (dependency); in-person + `sent_date` feeds away-board (dependency); cards
  grouped by `our_dog_id`, **not** paginated. **GAP→G8**.
- **Contracts list + detail** — all five types; lease hides sale/stud fields and shows
  lease dates; `related_dog_id`/`related_contact_id` only for lease/co_own/other;
  governing-contract = most-recent signed (dependency into companion); `document_url`
  pointer. **GAP→G7**.

### 4.6 Financials (hub: `financials`)
- **Top toggle — Overview / Income / Expenses** (`?view=`). An **"Invoice / Receipt"**
  generator opens as a modal from the header.
- **Overview** — income-vs-expenses at a glance: Earned / Anticipated income tiles,
  total Expenses, and Net (earned − expenses), plus a component/category breakdown.
- **Income** — the **derived** income view (`data/incomeView.js`): one row per Sale /
  outgoing StudService, split earned vs anticipated; clicking a row opens a compact
  **Adjust** modal that writes money/status/paid-date back. Income is never stored —
  it's recomputed from Sale/StudService status + paid fields, and the non-cash
  `pick_value_amount` estimate rides its own line. Thin until **GAP→G8** adds an
  incoming stud service.
- **Expenses** — the Expense ledger: running total, per-category **seg-tabs** plus
  subject-type / year filters + CSV export, and a **"+ Add Expense"** modal against any
  subject. Anchors span kennel/dog/litter + one event-linked (🔗). **GAP→G14** (add a
  pairing-subject expense).
- Teaches: costs live on Expenses, revenue is **derived** from Sale/StudService (no
  income table); no `general` subject — overhead rides your kennel; an event's cost
  writes an Expense here, not on the event (dependency).

### 4.7 More menu — Reports, Companion, Import/Export
- **Reports** — the four analytics report pages; each `reportView` with filters + CSV.
  Anchors: existing litters/stud/placements/health-test data (thin until G3/G8 fixed).
- **Companion** — seg-tabs per recipient type; collapsed recipient rows (expandable);
  Prepare link; size-based channel steering. **Prospective** (Owen; needs G4 for price),
  **Current families** (**GAP→G2** — empty today), **Partners** (Ellen; add a lease
  partner for G7). Teaches the allow-list/one-way/no-revoke model.
- **Import/Export** — JSON backup/restore (replace vs. merge) and the CSV importers'
  dry-run preview. Teaches the trust model + "back up your data" as the tour's closer.

---

## 5. Field catalogs (the copy source)

### 5.1 Required-field catalog (repo-enforced; the tour says the "why")

| Entity | Required | The one-line "why" |
|---|---|---|
| Dog | `call_name`, `sex`, `breed`, `ownership_type`, `status` (+ owner when `external`/`leased_in`) | Identity + life-stage + who owns it; owner is required precisely *because* external/leased dogs are someone else's. |
| Contact | `name` | Everyone — buyer, vet, co-owner — is one Contact tagged by role. |
| Kennel | `kennel_name` | A label; own vs. outside is a flag, not a separate table. |
| Pairing | `sire_id`, `dam_id`, `pairing_type`, `status` (sire≠dam **blocks**) | A planned or actual mating; a dog can't breed itself. |
| Litter | `dam_id`, `sire_id`, `status` | The litter owns its own parents; the puppy roster is derived. |
| Sale | `dog_id`, `buyer_contact_id`, `placement_type`, `status` | A transaction is its own record so reserve/return/re-place stay distinct. |
| Contract | `contract_type` | Generic across sale/stud/co-own/lease; everything else is a link. |
| StudService | `direction`, `our_dog_id`, `partner_dog_id`, `partner_contact_id`, `status` | Both sides of the arrangement, incoming or outgoing. |
| Event | `subject_type`, `subject_id`, `event_type`, `event_date`, `title` | One polymorphic log for every dated thing. |
| Expense | `subject_type`, `subject_id`, `amount`, `category`, `expense_date` | Costs only, attached to what they were spent on. |

### 5.2 Cross-app dependency catalog (the invisible-at-entry effects)

These are the fields the tour **must** explain because their payoff is on a different
screen. Each needs a live seeded example (fixes noted).

| Field (entity) | Effect elsewhere | Seed example |
|---|---|---|
| `disposition` (Dog; **puppy-only** — clears when status moves past `puppy`) | Feeds Today's **Active litters** card (per-litter selling roster) + Prospective companion bundle; `available`/`keeping`/`placed` render only while the dog is a `puppy` | Fern (puppy, `available`) ✓; a `keeping` puppy → **G3/F** |
| `ownership_type ∈ {external,leased_in}` (Dog) | Forces `owner_contact_id`; hides `kennel_id` | Gunnar/Nell ✓; **lease → G5** |
| `breeder_kennel_id` (Dog) | "Who produced it", distinct from `kennel_id`; auto-prefills from owned dam's kennel | Gunnar (outside) ✓; Fern/Birch/Hazel (auto) ✓ |
| `Dog.url` | Companion `photosUrl` | **G6** |
| `planned_tests` (Dog) + `Kennel.preferred_tests` | Test combobox suggestions (union) | **G6/G12** |
| `recorded_coi.method/source` (Dog) | Mixed-provenance display | Juniper/Gunnar ✓ |
| `Kennel.promote_nudge_enabled` + `promote_age_*` | Promote-lifecycle nudge on a `keeping` puppy | **G1/G12** |
| `planned_date` (Pairing) | `expected_due_date` = +63d prefill | P1 ✓ (prefill not shown; **needs a fresh empty one → G3**) |
| `expected_due_date` past + no litter (Pairing) | Overdue-pairing nudge | **G1** |
| `whelp_date` (Litter) | `estimated_ready_date` = +56d prefill | closed litter ✓ (prefill not shown) |
| `expected_price_*`/`expected_deposit_*` (Litter) | Sale price/deposit prefill by pup sex; Prospective bundle price | **G4** |
| `accept_deposits_date` (Litter) | Shown to prospective families in the companion bundle when set (`companionExport` `acceptDepositsDate`) | **G3/G4** (set on the new litter) |
| `nickname` (Litter) | Title fallback across detail/list/report | **G3** (set on a new litter) |
| `referred_by_contact_id` (Sale/StudService) | Auto-tags contact `buyer_referrer`/`stud_referrer` | Tessa/Dana ✓ |
| `transport_fee` + `deferred_boarding_*` (Sale) | Family bundle remaining-balance math | **G9** |
| `balance_due_date` (Sale) | Shown under computed balance in family bundle | **G2** (needs open sale) |
| `fee_structure` (StudService) | Gates `pick_status`/`pick_value_amount`; partner-bundle compensation | flat_plus_pick ✓; **ai/flat_fee → G8** |
| `pick_value_amount` (StudService, pick fee structures) | Non-cash income **estimate** (≠ cash `fee_amount`): its own line in the Financials Income view, the Stud-services report, and the partner companion bundle | flat_plus_pick svc ✓ |
| `type='in_person'` + `sent_date` (StudService) | Away-board row; location from partner `address` | Birch/Ellen ✓ |
| `contract_type='lease'` | Hides sale/stud fields, shows lease dates; drives partner membership | **G7** |
| `related_contact_id` (Contract) | Partner companion membership + bundle scope | **G7** |
| `signed_date` + `status='signed'` (Contract) | Governing-contract → companion contract pointer | Hazel/stud ✓ |
| `document_url` (Contract) | Carried as pointer into companion bundle | ✓ |
| `companion_note` (Contact) | Recipient-facing note on share page (≠ private `notes`) | Priya ✓; broaden **G13** |
| `waitlist_status='active'` (Contact) | Prospective companion membership | Owen ✓ |
| Sale `status ∉ {delivered,returned,cancelled}` (Contact→Sale) | **Current-families** companion membership | **G2** |
| Event cost field | Writes an `Expense` (`event_id` link); 🔗 tag; clearing deletes it | vet_visit ✓ |
| `reminder_date` / `reminder_dismissed` (Event) | Reminder buckets + Show-dismissed | Juniper/Percy/Birch/Fern ✓ |
| `related_contact_id` (Event: boarding/placement) | Away-board / placement contact | Fern placement ✓; **boarding → G11** |

---

## 6. Story-level expansion — how the additions stay believable

Rather than bolt on disconnected records, extend Thornfield's existing narrative so
every new record has a reason to exist. Proposed narrative threads (each closes gaps):

- **Thread A — "the current litter" (closes G3, G4, contributes to G10).** Add Pairing
  **P4** (Juniper × an outside stud) that whelped a **second, open litter** ("Autumn
  litter", `nickname` set, per-sex pricing set, `accept_deposits_date` set, status
  `weaning`→`ready`) with 4–5 puppies — some `available` and one `keeping` (the
  promote-nudge / `keeping`-disposition anchor, Thread F) — giving Breeding real
  content and a priced litter. P4 is also one of the extra pairings that push the
  pairing count past 5 so Breeding's chain "Show more" fires (G10). One pup is on an
  **open sale** (Thread C).
- **Thread B — "the incoming stud client" (closes G8, part of G7).** Add an **incoming**
  stud service (an outside dam visits Percy), `type='ai'`, plus its signed contract —
  balancing the existing outgoing/in-person one.
- **Thread C — "an in-progress placement" (closes G2, G9).** One Autumn-litter pup on an
  **open sale** (`deposit_paid`, `balance_due_date` in the future, a `transport_fee`, a
  `deferred_boarding_*` because the buyer delayed pickup) → makes Priya-style "current
  family" real and exercises the balance math.
- **Thread D — "a co-ownership / lease" (closes G5, G7).** Percy is already co-owned;
  add a **`co_own` contract** (`related_dog_id`=Percy, `related_contact_id`=Sam) and a
  **lease** (a Thornfield dam `leased_out`, or an outside dam `leased_in`) with a `lease`
  contract → lease dog status, lease dates, lease-based partner in Companion.
- **Thread E — "a fuller medical history" (closes G11).** Add to an existing dog a
  `boarding` span (grow-out, with a related contact), a `medication` span, and one each
  of `surgery`/`illness`/`breed_specific_test` so the timeline shows the full vocabulary
  and both span and instant rows.
- **Thread F — "kennel setup done right" (closes G12).** Set Thornfield's
  `preferred_tests`/`preferred_breeds`, `promote_nudge_enabled=true` + `promote_age_*`,
  and make a `keeping` puppy old enough to fire the promote nudge (closes part of G1).
- **Thread G — "nudge liveness" (closes G1).** Tune relative dates and litter/roster
  state so tutorial day carries **one live example per nudge rule** across all **eight**
  (§19): (1) a stud service `arranged` with a passed `sent_date` (status → in-progress /
  completed); (2) the promote nudge from Thread F (a `keeping` puppy past its kennel
  threshold); (3) a completed stud service with no `pairing_id` yet (stud→pairing);
  (4) a `heat_cycle` event with a real `event_end_date` in the recent past and no
  follow-up pairing (heat→pairing); (5) a pairing **overdue** (`expected_due_date` past,
  no litter); plus the three **litter-lifecycle** rules — (6) a `ready` litter whose
  whole roster is `placed`/`keeping` with ≥1 `placed` (litter→sold), (7) a
  `sold`/`closed` litter with a pup back to `available` (litter→reopen), and (8) a
  `sold` litter where every placed pup has a `delivered` sale (litter→close). **Caveat:**
  the three litter rules are mutually exclusive *per litter* (a litter can't be `ready`
  and `sold` at once), so demonstrating all three live at the same moment needs distinct
  litters in distinct states — the closed/sold Boston litter, the Autumn litter (Thread
  A), and a staged sold litter between them carry these; §9.3 allows documenting any one
  that's intentionally not live on a given seed day.
- **Thread H — contacts & expenses polish (closes G13, G14).** Add a `groomer` and an
  `other` contact; set `email`/`address`/`companion_note` on 2–3 more; add one
  `pairing`-subject expense.
- **Thread I — the Boxer program (D2; exercises breed vocabulary/filter).** Thornfield
  keeps a small **Boxer** line beside the Bostons. Add ≥2 Boxer dogs (an
  `active_breeding` female + a `retired_breeding` or `active_breeding` male), one Boxer
  pairing, and enough that the Dogs breed-filter and reports show >1 breed. Set
  `Kennel.preferred_breeds = ['Boston Terrier','Boxer']` on Thornfield (Thread F). Keep
  Boxers on the **same** own kennel (no second fake kennel) so the "one program, two
  breeds" story stays coherent. Reuse Boxers to carry some of the otherwise-thin fields
  (e.g. a lease dog from Thread D, or the incoming stud client's dam from Thread B, can
  be a Boxer) so the breed second-line doesn't just bolt on isolated records. The
  pedigree/pairing sex-and-breed logic has no hard breed-match rule, so a mixed record is
  a *warning* teaching moment, not a block — keep same-breed pairings unless a warning
  stop is intended.

**Teach-from-control fallback:** a few enum values have no believable Thornfield home
(e.g. sale `cancelled`/`returned`, contract `void`/`declined`, pairing `failed`). The
tour teaches these by opening the **dropdown** and naming them, rather than fabricating
a nonsense record. The spec should mark each such value explicitly so we don't chase
100% record coverage where it hurts believability.

---

## 7. Coverage target (enum-by-enum)

The acceptance bar per controlled vocabulary. "Record" = a live seeded example the tour
points at; "Control" = taught from the dropdown (teach-from-control fallback).

| Vocab | Must have a **record** for | Teach-from-**control** |
|---|---|---|
| `OWNERSHIP_TYPE` | owned, co_owned, external, leased_in **or** leased_out | the other lease direction |
| `DOG_STATUS` | puppy, active_breeding, retired_breeding, pet_home, deceased, external_reference, for_sale | — |
| `DISPOSITION` (puppy-only) | undecided, keeping, available, placed — **each on a `status='puppy'` dog** (disposition clears once status moves past `puppy`, so the `keeping` anchor is a kept puppy, not a promoted breeder) | — |
| `PAIRING_STATUS` | planned, confirmed_pregnant, whelped, + one overdue | bred, not_pregnant, failed, cancelled |
| `LITTER_STATUS` | expected, weaning/ready, closed | sold, whelped (transient) |
| `SALE_STATUS` | deposit_paid (open), delivered | deposit_pending, paid_in_full, returned, cancelled |
| `PLACEMENT_TYPE` | pet, + one of show/breeding_rights/co_own | remainder |
| `CONTRACT_TYPE` | sale, stud_service, co_own, lease | other |
| `CONTRACT_STATUS` | signed, + one draft/sent | declined, cancelled, void |
| `STUD_SERVICE_DIRECTION` | outgoing, incoming | — |
| `STUD_SERVICE_TYPE` | in_person, ai | — |
| `FEE_STRUCTURE` | flat_plus_pick, + flat_fee | pick_of_litter, other |
| `CONTACT_TYPE` | vet, breeder, buyer, co_owner, buyer_referrer, stud_referrer, groomer, other | — |
| `WAITLIST_STATUS` | none, active, fulfilled | — |
| `EVENT_TYPES` | ≥1 per subject-type family incl. a span (boarding/medication/heat), a placement, and an **`acquisition`** (first event on a purchased dog; its Cost field defaults to the `dog_purchase` category) | rare types (surgery/injury) optional as records |
| `EXPENSE_CATEGORIES` | food, veterinary, testing, facility, supplies, marketing, registration, **`dog_purchase`** (captured from an `acquisition` event's cost) | remainder (boarding, stud_fee, insurance, other) |
| `EXPENSE_SUBJECT_TYPES` | dog, litter, pairing, kennel | — |
| Breed (free vocab, D2) | Boston Terrier **and** Boxer, both on Thornfield's `preferred_breeds` | further breeds |

---

## 8. Remediation checklist (data-only; maps gaps → threads)

Each item is a new row or a previously-unset plain field — **no schema change**. **All
closed in `data/sampleData.js` (Phase 2)** and verified in a browser: seed loads with zero
repo-validation errors, clear/reset empties every table, and seven of the eight §19 nudges
fire on a fresh seed (see the litter→close note under G-nudges below).

- [x] **G1** ← Threads F+G: dates + kennel config tuned so one nudge per rule is live —
      stud-status (Birch, `arranged`), promote (Poppy), stud→pairing (Juno's incoming AI),
      heat→pairing (Sage), overdue-pairing (Percy × Dahlia), litter→sold (Daisy's litter),
      litter→reopen (founding litter + available Fern). **litter→close is intentionally not
      live** (needs a `sold` litter whose placed pups are all `delivered` — mutually
      exclusive with the reopen/sold anchors per §9.3, and adding it would push sales past
      the packet size).
- [x] **G2** ← Thread C: Cedar's open sale to Jamal (`deposit_paid`, future `balance_due_date`).
- [x] **G3** ← Thread A: the priced, `ready` **Autumn litter** (Ivy × Gunnar) + an
      `expected` **Winter litter**; six pairings (>5) so Breeding's chain "Show more" fires.
- [x] **G4** ← Thread A: `expected_price_*`/`expected_deposit_*`/`nickname`/`accept_deposits_date`
      set on the Autumn litter.
- [x] **G5** ← Thread D: **Sage**, a `leased_in` Boxer dam with owner (Dana) set.
- [x] **G6** ← Threads A/E: `registered_name`/`registry`/`registration_number`/
      `microchip_id`/`color_markings`/`url`(photo)/`planned_tests` across Juniper, Ivy,
      Gunnar, Daisy, Diesel + puppy photos.
- [x] **G7** ← Thread D: a `co_own` contract (Percy, status `sent` — the non-signed example)
      + a signed `lease` contract (Sage, with lease dates).
- [x] **G8** ← Thread B: **Juno's incoming, `ai`, `flat_fee`** stud service + signed contract.
- [x] **G9** ← Thread C: `transport_fee` + `deferred_boarding_*` on Cedar's open sale.
- [x] **G10** ← Threads A/I: pairing count is 6 (>5), so Breeding's chain "Show more" triggers.
- [x] **G11** ← Threads E/A: a `boarding` span (Percy, related contact) + `medication` span
      (Daisy) + instant medical types across Daisy.
- [x] **G12** ← Thread F: Thornfield `preferred_tests`/`preferred_breeds`/promote config set.
- [x] **G13** ← Thread H: **Grace** (groomer) + **Rex** (other) contacts; email/address/
      companion_note broadened across Owen/Ellen/Dana/Jamal.
- [x] **G14** ← Thread H: a `pairing`-subject testing expense on the Autumn pairing.
- [x] **D2** ← Thread I: **Diesel/Juno/Titan/Sage** (Boxers) + a Boxer pairing (Diesel ×
      Juno, `failed`); Thornfield `preferred_breeds` includes Boxer; Dogs breed-filter and
      reports show two breeds. An `acquisition` event on Diesel carries a `dog_purchase`
      expense (§7 enum coverage).

---

## 9. Acceptance criteria (definition of done)

1. **Matrix green.** Every row in the completed §3.1 coverage matrix has an anchor
   record (or an explicit teach-from-control mark). No tour stop points at empty state
   unless the stop's *purpose* is to teach an empty/first-run state.
2. **Enum target met** (§7): every "must have a record" cell is satisfied.
3. **Nudges live:** on a fresh seed run "today", the Today Nudges section shows ≥1 of
   each of the **eight** rules (§19), or a documented reason a rule is intentionally
   omitted — the three litter-lifecycle rules are mutually exclusive per litter, so
   covering all three at once requires distinct litters in the right states.
4. **Companion all three tabs non-empty:** Prospective, Current families, Partners each
   have ≥1 recipient whose bundle builds and renders (price where applicable).
5. **Every §5.2 dependency has a live example** or is explicitly deferred.
6. **Clear/reset still clean:** `clearSampleData` (dry-run and archive-conflicting) and
   `resetApp` fully remove the expanded packet with no orphans; the contamination check
   passes. Verify after each new reference kind.
7. **Validation-clean:** the whole seed loads with zero repo validation errors and zero
   unintended soft-warnings on the seeded records (a *deliberately* mismatched record for
   a "warnings are advisory" teaching stop is allowed and documented).
8. **Docs updated:** if any new field/FK/asset is introduced, the End-State guide's
   data-model/schema sections and `referenceRegistry.js` are updated in the same change;
   `CACHE_NAME` bumped (and `PRECACHE_URLS` if any new asset).
9. **`node --check data/sampleData.js`** passes; the packet loads served over HTTP and
   is walked once end-to-end in a browser.

---

## 10. Phasing (this is a large project)

1. **Phase 0 — Freeze the tour spine.** Agree the hub order and the *list of stops*
   (the wizard's step list at the section grain), because the seed exists to serve it.
2. **Phase 1 — Complete the coverage matrix (§3.1)** by walking every page in the
   browser; confirm each screen's real sections/expandables (don't trust §4 to be
   exhaustive). Output: the green/gap matrix. ✅ **Done → `Tutorial_Coverage_Matrix_v1.md`.**
3. **Phase 2 — Expand the seed by narrative thread (§6)**, closing gaps in this order:
   G3/G4 (litter) → G2/G9 (open sale) → G1/G12/F+G (nudges+kennel) → G5/G7 (lease/co-own)
   → G8 (incoming stud) → G6/G11 (dog fields + medical history) → G13/G14 (polish).
   Re-run clear/reset after each thread. ✅ **Done → `data/sampleData.js`.** All §8 gaps
   closed (see the checklist); final packet ≈ 20 dogs (16 Boston + 4 Boxer), 13 contacts,
   6 pairings, 4 litters, 3 sales, 2 stud services, 6 contracts, ~46 events, 9 expenses.
   Verified in a browser: zero validation errors, clear/reset empties every table, seven of
   eight §19 nudges live (litter→close documented as intentionally omitted, §9.3).
4. **Phase 3 — Reconcile dependencies & dates.** Verify every §5.2 example is live on
   "today"; lock relative dating. ✅ **Done.** Re-derived every §19 nudge condition and
   every §5.2 dependency against `data/sampleData.js`'s relative dates by hand, then
   confirmed in a browser (fresh seed, zero console errors): all seven intended nudges
   fire (stud-status/Birch, promote/Poppy, stud→pairing/Juno, heat→pairing/Sage,
   overdue-pairing/Percy×Dahlia, litter→sold/Daisy, litter→reopen/Fern), litter→close
   stays intentionally silent, and the Financials earned/anticipated/balance math
   (transport + deferred boarding × units) reconciles exactly. clear/reset still empties
   every table with zero contamination. One reconciliation fix: Cedar's open sale had
   `referred_by_contact_id` pointing at Marcus Webb, a contact archived since the
   original seed purely to demo "Show archived" — an archived contact shouldn't read as
   a live referrer on a sale dated weeks ago, so the field is now unset (the
   `buyer_referrer`/`stud_referrer` auto-tag dependency is already covered live via
   Tessa and Dana). All dates are `daysFromToday`/`monthsFromToday`-relative already, so
   nothing needed re-anchoring — "lock relative dating" was a verify, not a rewrite.
5. **Phase 4 — Acceptance pass (§9)** + docs/service-worker/reference-registry updates.
   ✅ **Done.** Ran the §9 checklist against the current seed:
   - **§9.1 Matrix green** — `Tutorial_Coverage_Matrix_v1.md` reconciled row-by-row
     against the expanded seed (it predated Phase 2's seed expansion in git history).
     Every closed-gap row flipped to ✅ with a real anchor; stale anchors fixed (e.g.
     "Fern placement" → Cedar's scheduled pickup); §C's gap table became a resolution
     log; a report page the original walk missed (Litter P&L) was added to the
     inventory.
   - **§9.2 Enum target met** — going through §7's table line by line (not just the
     G1–G14/D2 list) surfaced two values with no live record that the original gap
     catalog never caught: `DOG_STATUS: 'for_sale'` and `DISPOSITION: 'undecided'`.
     Closed both, data-only, no schema change: a new dog **Clover** (`status:
     'for_sale'`, retired-age, no sire/dam — same no-ancestry pattern as
     Percy/Nell/Dahlia/Titan/Sage) and switching **Aster**'s disposition from
     `keeping` to `undecided` (Poppy already anchors `keeping`, so no coverage was
     lost). `LITTER_STATUS: 'closed'` stays deferred — that one's the same accepted
     trade-off as the litter→close nudge (§9.3), not a new finding. Packet is now 21
     dogs (was 20).
   - **§9.3–§9.7** — nudges, Companion tabs, §5.2 dependencies, clear/reset, and
     validation-cleanliness were already confirmed in Phase 3 and re-verified after
     the two Phase 4 additions (same clean results, dog count 20→21, zero
     contamination, zero console errors).
   - **§9.8 Docs updated** — no new field/FK/table, so `referenceRegistry.js` and the
     End-State guide's data-model sections needed no change; the guide's one stale
     fact (`CACHE_NAME` example, still reading v68 from before Phase 3) was corrected.
     `CACHE_NAME` bumped v71→v72 for this phase's `sampleData.js` edit (Clover/Aster).
   - **§9.9** — `node --check data/sampleData.js` passes; the packet was served over
     HTTP and walked end-to-end in a browser after every change in this phase.
6. **Phase 5 — Hand off to the wizard-runtime spec** with a frozen anchor list.
   ✅ **Done → `Wizard_Runtime_Spec_v1.md`.** Resolves the trigger (auto-offer once after
   seeding + a "Take the tour" nav re-entry), the coach-mark mechanic (hand-rolled CSS
   spotlight overlay, no CDN), hub-to-hub advancement (wizard-driven navigation with a
   free-navigation "resume tour" pill), and the Thornfield-seed gate (reuses the
   sample-data-manifest signal `sampleDataUI.js` already reads). Defines the state model,
   the step-catalog schema authored from this project's own §B/§F matrix, and the
   per-page hook contract (`app.js`'s shared boot only — no page file becomes
   wizard-aware). Runtime build itself (transcribing `WIZARD_STEPS`, wiring the modules)
   is a later phase.

---

## 11. Decisions (resolved)

- **D1 — Seed size ceiling → ONE packet.** No separate tutorial packet. The single
  "Thornfield Kennels" sample packet is expanded to serve both the casual demo and the
  tutorial. Accept the roughly-doubled size (≈9→~16 dogs, 1→3 litters, 1→3 sales,
  1→2 stud services, 2→5 contracts). Keep it believable per §2.5.
- **D2 — Second breed → YES, add Boxers.** Thornfield runs a small second program in
  **Boxers** alongside its Boston Terriers. This exercises `Kennel.preferred_breeds`,
  the breed filter/vocabulary, and cross-breed guards. See §6 Thread I for how the Boxer
  records are woven in without a second fake kennel.
- **D3 — Teach-from-control list → CONFIRMED.** The enum values in §6/§7 marked
  "teach-from-control" are **not** fabricated as records; the tour teaches them from the
  dropdown. That list (sale `cancelled`/`returned`, contract `void`/`declined`, pairing
  `bred`/`not_pregnant`/`failed`/`cancelled`, litter `sold`, and the second lease
  direction) is now the agreed scope boundary — don't over-build past it.
- **D4 — Photos → EXTERNAL URLs.** `Dog.url` (and thus companion `photosUrl`) points at
  an **external URL**; no vendored image asset. Consequence: **no** `PRECACHE_URLS` or
  `CACHE_NAME` change is needed for photos, and this stays consistent with `url` already
  being a plain external-pointer field (it won't resolve offline, which is acceptable —
  it's a link, not app shell). Editing `sampleData.js` still bumps `CACHE_NAME` per §2.7.
- **D5 — Nudge determinism → TUNE relative dates.** Do **not** re-seed at tutorial launch.
  Tune each nudge-dependent record's `daysFromToday`/`monthsFromToday` offsets (Threads
  F+G) so all eight nudge rules (§19) are live on seed day — as far as they can co-exist
  (§9.3: the three litter-lifecycle rules can't all fire on one litter) — accepting drift
  if the user seeds now and takes the tutorial much later. §9 criterion 3 is evaluated
  against a fresh seed's
  "today". If drift proves a problem in practice, revisit re-seed-on-launch as a v2 change.

---

*Companion to `Sample_Data_and_Reset_Brief_v2.md` (the seed/clear mechanics) and the
End-State guide §11/§13/§19/§20 (first-run, page catalog, nudges, companion). When the
seed changes, update those and this spec's matrix together.*
