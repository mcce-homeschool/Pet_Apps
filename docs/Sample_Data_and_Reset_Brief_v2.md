# Dog Breeding Management App
## Sample Data & Reset Brief — v2

**How to use this doc:** hand this to Claude Code alongside `Data_Model_Architecture_Proposal_v3.md`, `Stage1_Stage2_Build_Brief_v2.md`, `Stage3_Build_Brief_v1-1.md`, `Stage4_As_Built_v1.md`, and `Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md`. **This version replaces `Sample_Data_and_Reset_Brief_v1.md` entirely** — it is not a diff or an addendum. It defines one unified sample packet across all six tables that exist through Stage 3 (Dog, Event, Contact, Kennel, Pairing, Litter), seeded and cleared together as a single set. §9–§10 below are later, *additive* extensions (Stage 4, then Stage 4.5) to that same packet — read alongside this base.

**Scope:** §1–§8 describe the six tables live at the end of Stage 3. §9 folds in Sale/Contract/StudService (Stage 4, reconciled by `Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md` §A4 after `Stage4_As_Built_v1.md` §10 shipped ahead of this doc). §10 folds in the Stage 4.5 boarding/placement sample events.

---

## 1. Why This Exists

An empty app doesn't demonstrate anything — a first-time user (or a family member testing it out) needs dogs to click on, a pedigree to look at, a pairing and litter to trace, and a timeline with real entries before any of it means something. But that demo data can't become a trap: it has to be trivially and completely removable the moment someone's ready to start entering their own kennel's real records, without corrupting anything real they may have already typed in alongside it.

## 2. Design Principles

- **Seed through the repo layer, not around it.** Sample records are created by calling `dogRepo.create()`, `eventRepo.create()`, `pairingRepo.create()`, `litterRepo.create()`, etc. — the same functions real data goes through. This guarantees sample data can never violate a validation rule that real data can't, and it never drifts from the schema.
- **Track sample records by ID, not by tagging them.** No `is_sample` field on any table — that's a schema change for a temporary concern. Instead, every ID created during seeding is recorded in one manifest object. This is what makes "clear the sample data" possible without a scan or a heuristic.
- **Clearing is a real delete, not an archive.** Sample data should vanish completely — it's not part of anyone's breeding history. But it must refuse to delete anything a real record now depends on (see §5).

## 3. The Sample Manifest

One `localStorage` key, alongside the existing `lastBackupDate` (same small-settings use case):

```js
// key: 'sampleDataManifest'
{
  seededAt: "2026-07-14T00:00:00Z",
  dogs:      ["<uuid>", ...],
  events:    ["<uuid>", ...],
  contacts:  ["<uuid>", ...],
  kennels:   ["<uuid>", ...],
  pairings:  ["<uuid>", ...],
  litters:   ["<uuid>", ...]
}
```

Absence of this key means either sample data was never loaded, or it already was cleared — both cases where the app should behave as "real data only."

## 4. First-Run Flow

On the very first load — no rows in `dogs`, `contacts`, or `kennels`, and no `sampleDataManifest` / `sampleDataCleared` flag in `localStorage` — show a single choice before anything else:

> **"Explore with sample data"** vs. **"Start with a blank kennel"**

- *Explore*: runs the seed routine (§7), writes the manifest, and shows a persistent small banner ("Viewing sample data — [Clear Sample Data]") on every page until it's cleared.
- *Blank*: sets `sampleDataCleared = true` in `localStorage` immediately, so the prompt never reappears and no banner shows.

The same "Clear Sample Data" action is also reachable any time from Import/Export, not just the banner — someone might seed it, poke around for a week, and only then be ready to switch over.

### 4.1 Kennel setup wizard (chained off the "blank" branch)

Choosing "Start with a blank kennel" — or clearing sample data on a later visit — leads into a second, one-time prompt: **"🏡 Set up your kennel"**, asking for a kennel name (required) and the owner's name (optional). This is skippable on first offer; it does not gate anything. Saving it creates real `Kennel` (`is_own_kennel: true`) and, if an owner name was given, `Contact` records through the normal repo layer — same "seed through the repo, not around it" principle as §2 — and stores their ids (not copies of the name strings) in `localStorage` (`myKennelId`, `myContactId`) so the kennel name can be appended to the nav brand and new dogs' Owner field can prefill. Choosing "Explore with sample data" instead skips this prompt entirely on that run, since Thornfield Kennels already fills the "your kennel" role — the wizard only ever fires on the blank-kennel path, or after sample data is later cleared (`myKennelSetupSkipped` in `localStorage` remembers a skip so it doesn't nag on every reload). It's reachable again any time from Import/Export ("Set up your kennel" / "Change kennel / owner"), where reopening it **updates** the existing Kennel/Contact records rather than creating duplicates.

## 5. Clearing Sample Data

`clearSampleData()` (new module, `sampleData.js`, alongside `importExport.js`):

1. Read the manifest. If none exists, there's nothing to do. Treat any missing array key on the manifest as empty (defensive, in case of a future partial-seed failure) rather than erroring.
2. **Contamination check** — before deleting anything, confirm no record *outside* the manifest now points at a record *inside* it. This reuses the reference registries from the data-model and Stage 3 docs, scoped to just the manifest's IDs, checking only for referencers not themselves in the manifest:
   - `DOG_REFERENCES` — e.g. the user added their own real dog and set a sample dog as its sire, or their own real litter/pairing points at a sample dog as sire/dam.
   - `PAIRING_REFERENCES` — a real Litter whose `pairing_id` points at a sample Pairing, or a real Event whose `subject_id` (with `subject_type: pairing`) points at one.
   - `LITTER_REFERENCES` — a real Dog whose `litter_id` points at a sample Litter.
   - If clean → proceed.
   - If blocked → show exactly which real records are affected and offer to archive the conflicting sample record(s) instead of deleting them (archiving is always safe, per the existing hard-delete rules).
3. Delete in dependency order — children before parents — using `bulkDelete` on the manifest's ID lists: **events → litters → pairings → dogs → contacts → kennels**. Litters and pairings must clear before dogs, since a Litter references dogs via `dam_id`/`sire_id` and dogs' own `litter_id` pointers need to go with the same pass.
4. Remove the `sampleDataManifest` key; set `sampleDataCleared = true`.
5. Return a short summary (counts removed, per table) for the confirmation screen.

This is a hard delete of *known, self-contained, unreferenced* records — it deliberately bypasses each entity's normal single-record hard-delete guard rather than reusing it, since that guard is designed to protect one record a user is actively trying to remove, not to bulk-clear a whole known set at once.

## 6. Full App Reset ("Reset App to Start")

Clearing sample data (§5) is scoped and reference-checked because real records might sit alongside it. Reset is the deliberately blunter superset, for "I want to throw everything out and start over" — real data included, no contamination check, because nothing is left standing that could conflict.

`resetApp()` (`appReset.js`, alongside `sampleData.js`):

1. Reads the live table list (`existingTableNames()`, same stage-aware helper the reference registry uses) and, inside one transaction, calls `.clear()` on every one of them — `dogs`, `events`, `contacts`, `kennels`, `pairings`, `litters`, and any table a later stage adds, with no ordering concerns since nothing survives to reference anything else.
2. Clears every `localStorage` key this app owns (`clearAllSettings()`): `lastBackupDate`, `persistRequested`, `sampleDataManifest`, `sampleDataCleared`, `myKennelId`, `myContactId`, `myKennelSetupSkipped`.
3. The app reloads into the exact first-run state a browser that had never visited would see — the "explore vs. blank kennel" prompt (§4) fires again.

Reached from Import/Export's "Danger zone," gated behind typing the literal confirmation phrase `RESET` into a text field (the confirm button stays disabled until it matches exactly) — a stronger bar than the `window.confirm()` dialog used for clearing sample data, appropriate to an action that can also destroy real breeding history. The confirmation screen shows live per-table row counts (`getResetCounts()`) before the user commits.

## 7. Sample Packet Contents

A small fictional kennel — "Thornfield Kennels" — sized to be explorable in a few minutes, not exhaustive. Every entity and index gets exercised at least once, across all six tables.

**Kennels (2)**
| Name | Notes |
|---|---|
| Thornfield Kennels | prefix `THORN` — the user's own kennel; `is_own_kennel: true` |
| Meadow Ridge Kennels | affiliation for an outside contact, below; `is_own_kennel: false` |

**Contacts (5)**
| Name | Type | Demonstrates |
|---|---|---|
| Dr. Patricia Nguyen | vet | plain contact |
| Dana Ruiz | breeder | `kennel_id` → Meadow Ridge; owns an external dog |
| Sam Okafor | co_owner | co-ownership index |
| Tessa Lin | co_owner, buyer_referrer | multi-select `contact_type` |
| Marcus Webb | buyer_referrer | **archived** — exercises the archived-contact toggle |

**Dogs (8)** — every dog's `breed` is **Boston Terrier**

| Call name | Status | Ownership | Demonstrates |
|---|---|---|---|
| Juniper | active_breeding | owned | anchor breeding female; dam in Pairing P1/P2 and the Litter below |
| Gunnar | external_reference | external | `owner_contact_id` → Dana Ruiz; `dob_is_estimated = true`; sire in Pairing P1/P2 and the Litter below |
| Fern | puppy | owned | dam Juniper, sire Gunnar, `litter_id` → the sample Litter — standard puppy record |
| Birch | active_breeding | owned | **same littermate as Fern, but already promoted** — the one-record-not-a-copy rule made visible; `litter_id` → the sample Litter |
| Hazel | pet_home | owned | third littermate, placed out; `litter_id` → the sample Litter |
| Willow | retired_breeding | owned | **archived** — Juniper's dam; still resolves in the pedigree tree despite being archived |
| Ash | deceased | owned | Juniper's sire; `date_of_death` set — status badge + deceased handling |
| Percy | co_owned | co_owned | `co_owner_contact_ids` → Sam Okafor + Tessa Lin; parents left unset to show the pedigree tree's placeholder node for unknown ancestry |

**Pairings (2)**
| # | Sire | Dam | Type | Status | Notes / demonstrates |
|---|---|---|---|---|---|
| P1 | Gunnar | Juniper | actual | whelped | The pairing that produced Fern/Birch/Hazel; has a linked Litter |
| P2 | Gunnar | Juniper | planned | planned | Same pair, a second time; `planned_date` set several months out from seed date; **no** linked litter — exercises the "Create Litter from this Pairing" empty state on Pairing Detail |

**Litters (1)**
| Field | Value |
|---|---|
| `pairing_id` | → P1 |
| `dam_id` | Juniper |
| `sire_id` | Gunnar |
| `whelp_date` | matches Fern/Birch/Hazel's `date_of_birth` |
| `litter_registration_number` | set, to exercise the field |
| `puppies_born_total` | 3 |
| `puppies_born_alive` | 3 |
| `puppies_born_deceased` | 0 |
| `status` | `closed` — all three puppies have moved on (one still a growing puppy, one promoted, one placed), so the litter itself is administratively done even though the individual dogs are at different life stages |

Fern, Birch, and Hazel's `litter_id` all point at this record — the puppy roster shown on Litter Detail is the derived query (`Dog WHERE litter_id = this.id`), never a stored list, per data model §5.4.

**Events (~22)**, spread across all three subject types to cover most of the catalog:

*Dog-subject:*
- Juniper — vaccination, heat_cycle, ofa_pennhip, title_earned
- Gunnar — genetic_test, title_earned
- Fern — milestone, weight_check, vaccination, **evaluation** (`{evaluator, temperament_notes, structure_notes}` — new Stage 3 catalog entry)
- Birch — milestone, weight_check, vaccination, genetic_test (health-tested after promotion to breeding stock)
- Hazel — vaccination, note
- Percy — one **future-dated** vet_visit (tests the "upcoming" visual treatment from the build brief's B1 rules)

*Pairing-subject (all on P1):*
- breeding_tie, progesterone_test, ultrasound, pregnancy_update

*Litter-subject (on the Litter above):*
- whelping_summary (`{total_born: 3, live_born: 3, notes}`)

Pairing P2 (planned, no litter) intentionally has **no** events yet — it demonstrates a pairing at the very start of its lifecycle, with an empty timeline.

## 8. Acceptance Checklist

- [ ] All 8 sample dogs show `breed: Boston Terrier`, and "Boston Terrier" appears as a breed autocomplete suggestion on first use of the Dog form
- [ ] Sample dogs form a real 3-generation pedigree (Ash/Willow → Juniper/Gunnar → Fern/Birch/Hazel) with one archived and one deceased ancestor still resolving correctly
- [ ] Percy renders a placeholder node for both unknown parents
- [ ] Birch (promoted littermate) confirms visually that promotion is a status change, not a new record
- [ ] Fern, Birch, and Hazel all resolve to the same Litter via `litter_id`, and that Litter's derived puppy roster shows exactly those three
- [ ] Pairing P1 shows its linked Litter in the "Linked Litter" panel; Pairing P2 shows the "Create Litter from this Pairing" empty-state action instead
- [ ] Pairing P1's timeline shows all four pairing-subject events in date order; the Litter's timeline shows the whelping_summary event
- [ ] Fern's Health Timeline includes the `evaluation` event, rendered in its own type-specific form
- [ ] Every dog-facing event_type shown in §7 renders in its correct type-specific form
- [ ] Marcus Webb (archived contact) is hidden by default and appears with the archived toggle on
- [ ] Clearing sample data with no real data present removes all of it, across all six tables, and the banner disappears
- [ ] Clearing sample data *after* the user has linked a real dog to a sample dog, a real litter to sample Pairing P1, or a real dog's `litter_id` to the sample Litter is blocked with a clear, specific message, and offers archive-instead
- [ ] After clearing, reloading the app never re-offers the first-run seed prompt
- [ ] Thornfield is flagged `is_own_kennel`; all owned/co-owned sample dogs resolve `kennel_id` → Thornfield; Gunnar (external) has `kennel_id: null`; deleting Thornfield is blocked by `KENNEL_REFERENCES` while any sample dog points at it (Own-Kennel Identity addendum)
- [ ] Choosing "Start with a blank kennel" offers the kennel-setup wizard; choosing "Explore with sample data" does not (that run only)
- [ ] "Reset App to Start" is blocked from completing until the exact phrase `RESET` is typed; on confirm, every table and every settings key is cleared and the app reloads to the first-run prompt

---

## 9. Stage 4 Extension — Sales, Contracts, Stud Services

`Stage4_As_Built_v1.md` §10 shipped these sample records ahead of this doc ever being updated for them; `Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md` §A4 is what closes that gap. This section is the authoritative record — confirmed to match the code in `data/sampleData.js`, no new records invented here.

`sampleDataManifest` gains `sales`, `contracts`, `stud_services` arrays (still **no** `buyers` array — buyer is a Contact, Data Model v3 §5.5).

**Buyers-as-Contacts (added to the 5 in §7's table):**
| Name | Waitlist | Demonstrates |
|---|---|---|
| Priya Shah | fulfilled | `first_contact_source: Instagram`; buyer on the sample Sale below |
| Owen Farrow | active | **no Sale** yet — the empty-waitlist demo |
| Ellen Brooks | (none) | owner of external partner dog Nell, below |

**Dogs (+1, 9 total):** Nell — external, `owner_contact_id` → Ellen, partner dog in the sample Stud Service.

**Pairings (+1, P3):** Birch × Nell, `actual`/`ai_chilled`/`confirmed_pregnant` — the pairing produced by the sample Stud Service, linked via its canonical `pairing_id` (never a stored back-pointer).

**Stud Service (1):** Birch (`outgoing`) services Nell, `status: completed`, `pairing_id` → P3; fee `$1200` flat. Plus a `signed` stud-service Contract (`related_stud_service_id`).

**Sale (1):** Hazel → Priya, `placement_type: pet`, `status: delivered`, `lead_source: Instagram`. Plus a `signed` sale Contract (`related_sale_id`).

**Acceptance checks (append to §8):**
- [ ] Buyers-as-Contacts: Priya, Owen, Ellen exist as Contacts; **no** `buyers` table/array anywhere
- [ ] Owen shows in the Buyers/waitlist view with `waitlist_status: active` and **no** linked Sale
- [ ] Hazel's Sale resolves buyer → Priya (a Contact), and Sale Detail's Contract panel lists the signed sale contract with a status badge
- [ ] Sale Detail shows the derived **governing-contract** line resolving to the signed contract (Stage4.5 Addendum §A2)
- [ ] Birch's StudService links to **P3** via `pairing_id`; Stud Service Detail's Contract panel shows the signed stud-service contract
- [ ] Clearing sample data with a **real** Contract pointed at a sample Sale/StudService is blocked with the specific message and offers archive-instead (exercises `SALE_REFERENCES` / `STUD_SERVICE_REFERENCES`)
- [ ] Contract is confirmed hard-deletable with nothing blocking (leaf; `CONTRACT_REFERENCES` empty)

## 10. Stage 4.5 Extension — Boarding & Placement Events

`Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md` Part C/D adds `event_end_date`, `related_contact_id`, and the `boarding`/`placement` catalog types (no new table). Two sample events exercise them, both dated **relative to seed time** (not fixed calendar dates, unlike the rest of §7's events) so they stay demonstrative no matter when the packet is seeded:

- **Boarding:** Birch's outgoing stud stay with Ellen — `related_contact_id` → Ellen, `boarding_reason: Stud service`, started a few days before seeding, **no** `event_end_date` (ongoing) so it always appears on the Location/Status Board.
- **Placement:** a scheduled pickup for Fern — `related_contact_id` → Owen (the sample's active-waitlist buyer, still with no Sale), dated about a week after seeding. Deliberately **no** Sale record — a placement event never carries a stored link to one.

**Acceptance checks (append to §8):**
- [ ] At least one sample boarding event exists and appears on the Location/Status Board with the right contact link
- [ ] The sample placement event appears on the Upcoming Deliverables view and in the Scheduled Placements report, with no corresponding Sale record
