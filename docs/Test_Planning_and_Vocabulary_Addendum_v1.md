# Test Planning & Shared Vocabulary Addendum — v1
### Per-dog health-test plans, a kennel-authored preferred panel, and an advisory completeness view

**How to use this doc:** hand this to Claude Code alongside `Data_Model_Architecture_Proposal_v3.md` (the canonical model now; supersedes the v2 this addendum originally shipped against), `Stage1_Stage2_Build_Brief_v2.md`, `Stage3_Build_Brief_v1-1.md`, `Stage4_As_Built_v1.md`, `Sample_Data_and_Reset_Brief_v2.md`, and `Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md`. Those define the entities and conventions this builds on — this doc only adds what's new: two unindexed array fields, a suggestion-vocabulary read, a kennel-level authoring screen, and an advisory completeness panel. It is **Stage-5-adjacent** (it serves the discovery doc's "data quality auditing" candidate feature and leans on the existing future-reminder groundwork), but it depends on nothing in Stage 5 and can land independently. Nothing here changes the schema version, the reference registry, or the JSON backup format.

---

## 1. What This Is (and Deliberately Isn't)

A breeder wants two connected things:

1. To record, per dog, **which health/genetic tests they intend to run** — the denominator of "have I done my due diligence on this animal."
2. To not retype the same breed panel on every dog, and to have logging a test later feel connected to that intent rather than disconnected free text.

This delivers both as the thinnest possible layer on the existing model:

- **`Dog.planned_tests`** — an intent checklist per dog (the denominator).
- **`Kennel.preferred_tests`** — a kennel-authored panel that seeds new dogs' plans *and* doubles as the shared suggestion vocabulary (the join anchor).
- **An advisory completeness view** — "planned, no matching event found — verify," never a hard fraction.

**What it is not:** it is **not** a new entity, not an FK relationship, not a test-definition table dogs point at. Tests are captured as plain strings on both the plan side and the event side. Nothing references a canonical "test" record, so nothing enters the reference registry, nothing blocks a delete, and an off-panel test name typed during a messy CSV import is *saved*, not *rejected* — consistent with the warn-don't-block / import-resilience posture in every prior brief (data model §8, Stage 2 B1, Stage 3 §3). The tests list is a *suggestion source*, and the string it produces is inert data the list can never orphan.

> **Why not an FK to a test catalog?** The moment `genetic_test` stores a `test_definition_id` instead of a `panel_name` string, the test list joins the reference registry: you can't rename or remove a test while any event references it, and import of an off-list test gets blocked instead of saved. That directly contradicts the app's historical-data resilience. Keep tests as strings; keep the list advisory.

---

## 2. Schema Additions (zero-migration)

Both new fields are **unindexed string arrays**. Dexie only requires a `db.version(N)` bump to add or change *indexes*, not plain fields — so neither field needs a new version block, and both ride the JSON backup for free, since §9 of the data model doc serializes whole records.

```
Dog.planned_tests      : string[]   // this dog's intended tests; per-dog owned after seeding
Kennel.preferred_tests : string[]   // the kennel's authored panel AND the suggestion vocabulary
```

- Neither field is indexed. Completeness is computed per-dog on the detail screen (one dog's plan vs. that dog's events) — there is no "all dogs missing test X" query in this addendum, so no index is needed. (If a kennel-wide audit report is wanted later, that's a Stage 5 reporting concern, not a schema one.)
- No `db.version()` change. No `referenceRegistry.js` change. No backup-format (`format_version`) change.
- `Kennel.preferred_tests` lives on the Kennel record specifically so it survives a JSON restore. It must **not** live in a `kennelOS.`-prefixed `localStorage` key — that store isn't serialized by the backup (§9 dumps Dexie tables only), and this is breeding-program data, not a UI preference.

---

## 3. The Shared Vocabulary (the join anchor)

The single idea that makes planned-vs-logged matching work: **both sides draw suggestions from the same token set.** A breeder who seeds "OFA Hips" into a plan sees "OFA Hips" waiting in the combobox when they log the event months later, so the two strings converge instead of drifting to "OFA Hips" vs. "OFA Hip Dysplasia."

**Event-form test-name suggestions = union of:**
- `Kennel.preferred_tests` (the authored panel), plus
- distinct test tokens **already seen** in existing events' `details` (e.g. `genetic_test.panel_name`, `breed_specific_test.test_name`), append-only.

Rules:
- The union **suggests, never forces.** Free-text entry is always allowed; an off-vocabulary test name is saved as typed (warn-don't-block intact).
- The seen-in-events contribution is **append-only** — logging a test name folds it into future suggestions; nothing purges it. This is what keeps an old event's test name resolving as a known suggestion even after the kennel panel changes.
- Applies to the test-bearing event forms only: `genetic_test`, `breed_specific_test`, and `ofa_pennhip`. Other event types are untouched.

> **Granularity note.** These three event types carry tests at different grains — `genetic_test.panel_name` is a multi-test run ("Embark Breed + Health"), `breed_specific_test.test_name` is a single locus ("Patellar Luxation"), and `ofa_pennhip` is really an enum (joint/method/rating). The vocabulary is a flat suggestion list across all three; if a token is obviously mis-grained for a given form the breeder just ignores the suggestion and types the right thing. Don't over-engineer per-form vocabularies unless real use shows the flat list is noisy.

> **Typo release valve (don't build now).** Because seen-in-events is append-only, a typo logged once ("Ofa Hpis") becomes a permanent low-value suggestion. Low stakes — minor autocomplete clutter. If it ever matters, the fix is to fold **only** `preferred_tests` into *suggestions* and treat seen-in-events tokens as **match-only, not suggest**. Flagged, not built.

---

## 4. Seeding Behavior (forward-only, warned)

`Dog.planned_tests` is seeded from `Kennel.preferred_tests` **once, at dog creation**, for owned/co-owned dogs. After that the array is the dog's own — editing the kennel panel never reaches back into an existing dog's plan.

Precise rules:

- **Trigger is create only** — creating an owned or co-owned Dog. It is explicitly **not** triggered by an ownership change (an external dog flipping to owned, or a null `kennel_id` being assigned later). Tying seeding to ownership transitions would reintroduce the "does it fire again?" ambiguity through the back door. Dogs that become owned later simply start with an empty plan and are populated via the manual copy-forward action (§5).
- **Which kennel's panel?** `Dog.kennel_id` is nullable and unenforced ("unassigned, not an error," per the Own-Kennel addendum), and 2+ kennels can be flagged `is_own_kennel`. So the seed source resolves as: dog's `kennel_id` set → that kennel's panel; `kennel_id` null and exactly one own-kennel exists → that kennel's panel; null with multiple own-kennels → seed nothing (don't guess, don't throw).
- **Owned/co-owned only.** External and leased-in dogs are someone else's animals to health-plan — seed nothing, same line the addendum already draws for `kennel_id`.
- **Forward-only is the contract, and it's stated in the UI.** Editing the kennel panel shows, at edit time: *"Changes apply to newly added dogs only. Existing dogs keep their current plans — use 'Apply to dogs' to update them."* Forward-only silently would produce the "I added it, why isn't it on my dogs?" confusion; forward-only announced turns a limitation into an honest contract.

> **Why this stays a plain array (no removed-set bookkeeping).** Forward-only seeding means the plan is never re-computed against the panel, so there's no need to remember "had this test, removed it on purpose" vs. "never had it." A plain `string[]` suffices. The moment re-apply/back-fill enters, you'd need a per-dog suppressed set — a real complexity jump this design deliberately avoids by making panel edits forward-only.

---

## 5. Copy-Forward (additive, user-driven)

Because seeding is forward-only, existing dogs need a manual path — but an **additive, user-targeted** one, never a silent re-sync:

- **"Apply to dogs"** from the kennel panel editor: breeder picks target dogs (owned/co-owned only, archived excluded by default per the standing picker rule), and the selected panel tokens are **added** to each target's `planned_tests`. Add-only: it never removes a test the breeder pruned, and adding an already-present token is a no-op (dedupe on write).
- **"Copy plan from…"** on Dog Detail: seed this dog's plan from another dog's plan, or from a kennel panel, as a one-shot additive copy.

Both are explicit gestures with the breeder choosing targets each time, which is exactly what makes them forward-only-safe: no silent rewrites, no resurrecting pruned entries, no suppressed-set needed. This is the same additive-copy mechanism whether it's labeled "apply," "copy forward," or "seed from" — one behavior, friendly verbs.

---

## 6. UI

### 6.1 Kennel preferred-tests editor (authoring — deliberate)
On the Kennel screen (own-kennels only), a **checkbox list** of the panel plus a **"type a test + Enter to add"** control. Enter does two things in one write: appends the token to `Kennel.preferred_tests` (so it's in the panel and the suggestion vocabulary immediately and globally) and makes it available to seed newly created dogs going forward. Un-checking a test removes it from the panel **going forward only** — it does **not** purge the token from the vocabulary (already-logged events still want it to resolve; vocabulary is cheap and append-only). The forward-only warning (§4) sits here. The "Apply to dogs" action (§5) sits here.

### 6.2 Dog Detail — plan + completeness
A **Planned Tests** panel on Dog Detail: the dog's `planned_tests` as an editable checklist (add via the same shared-vocabulary combobox, free-text fallback intact), plus "Copy plan from…" (§5). Directly below, the **advisory completeness view**: for each planned token, show whether a matching test event exists on this dog, and surface unmatched planned tests as *"planned — no matching event found, verify."* 

- **Never a hard fraction.** No "3/5" badge asserting completeness. Matching is string-based across two free-text-capable sides; even with the shared vocabulary it will occasionally miss (drift, typos, grain mismatch). The view states what it can verify and flags the rest for human judgment — "people are people," so the tool nudges rather than scores.
- Matching is case-insensitive and trimmed, same posture as CSV natural-key matching everywhere else.

### 6.3 The wall: no test checkboxes on the event screen
Test **authoring/planning** happens at the kennel level (deliberate act) and the dog level (curation). The **event screen stays a lean combobox** that *suggests* from the shared vocabulary but never presents the panel as a checklist to reconcile. Recording an event is a fast, single-dog, mid-task fact-capture — turning it into a planning session is the failure mode this wall exists to prevent. Suggest, don't checklist, at event time.

---

## 7. Distinctions the Build Must Keep Straight

These read as subtle but each is load-bearing:

- **Vocabulary ≠ plan.** Adding a test at the kennel level puts it in the *vocabulary* immediately and globally (suggestable on every dog's event form at once) but in the *plan* of existing dogs **never** (forward-only). A test being suggestable on a dog's event form does not mean it's planned for that dog. Two separate reads; keep them separate.
- **Panel membership ≠ vocabulary membership.** Un-checking a kennel test removes panel membership going forward but leaves the vocabulary token intact for matching/suggesting old events. Checkbox-off means "not in my preferred panel," not "purge the token."
- **Plan ≠ event.** A planned test is an *undated intention* (nothing happened yet) — legitimately not an Event, and deliberately not a second future-dated-event mechanism alongside the reminder one the app already has. A logged test is a dated Event. Completeness is the advisory join between the two.

---

## 8. Sample Data — Follow-Up Needed (not built here)

Consistent with how Stage 3 and Stage 4 flagged their own sample-data follow-ups rather than folding them in: a short extension to `Sample_Data_and_Reset_Brief_v2.md` would give Thornfield a `preferred_tests` panel (a small Boston Terrier set) and seed two or three sample dogs' `planned_tests` from it, with at least one planned test that **has** a matching event (shows a satisfied checklist row) and one that **doesn't** (shows the advisory "verify" flag). Fern already carries an `evaluation` and health events, so she's the natural dog to demonstrate a partially-satisfied plan. Neither field needs manifest tracking — they're attributes on already-manifested Dog/Kennel records, cleared with them.

---

## 9. Build Order

1. Add `Dog.planned_tests` / `Kennel.preferred_tests` handling to `dogRepo` / `kennelRepo` (plain array read/write/dedupe — no schema version bump).
2. Shared-vocabulary read: union of `Kennel.preferred_tests` + distinct seen-in-events test tokens; wire it as the suggestion source on the `genetic_test` / `breed_specific_test` / `ofa_pennhip` event forms (free-text fallback preserved).
3. Kennel preferred-tests editor: checkbox list + type-and-Enter add + forward-only warning.
4. Seeding-on-create (owned/co-owned, kennel-resolution rules, null/multi-kennel fallback).
5. Dog Detail Planned Tests panel + advisory completeness view.
6. Copy-forward actions ("Apply to dogs" on the kennel editor; "Copy plan from…" on Dog Detail).

Steps 1–3 make the vocabulary and panel usable; 4–6 connect them to dogs and deliver the advisory completeness nudge. Zero-migration throughout — the only genuinely new code is the authoring UI and the union-read; the rest is fields and a copy action.
