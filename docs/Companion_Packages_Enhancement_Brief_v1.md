# Companion Packages Enhancement — Build Brief v1

**Status:** planned, not yet built. This brief is an execution spec for a follow-up
session. It does **not** describe current behavior — the End-State guide (§20) still
reflects what ships today and must be updated *when this work lands*, not before.

**Scope:** enrich all three Companion share-out bundles (prospective / partner /
current family) with substantially more of the recipient's own data. Pure
composition + projection over existing repos — the one exception is a documented
policy reversal (prospective pricing) and a scoped relaxation of the family
event-sanitization rule, both decided below.

Read alongside: End-State guide §20 (the security spine), `data/companionExport.js`
(the allow-list builders), `companion-view.html` (the recipient shell),
`pages/companion.js` (the console).

---

## 0. Locked decisions (resolved with the owner)

1. **Prospective bundles now carry price.** This **reverses** the current
   documented invariant ("prospective = shared availability, NO price"). Per-sex
   list price + deposit render on each prospective pup. Update the guide §20 prose
   and the `companionExport.js` header comment that asserts "NO price" in the same
   change.
2. **No contract "returned date."** `Contract` has no `returned_date` field and one
   is **not** being added. The partner Contracts section shows type, status, signed
   date (or "Not Signed"), terms, and the document link only. (The stud-agreement
   block keeps its real `sent_date`/`returned_date` — those live on `StudService`.)
3. **"Breed-specific health tests" = three event types**, each surfaced only when it
   carries a non-empty result/rating:
   - `breed_specific_test` → `details.test_name` : `details.result`
   - `ofa_pennhip` → `details.joint` : `details.rating`
   - `genetic_test` → `details.panel_name` : `details.result`
4. **Family event history surfaces title + one curated safe field per type** — never
   the freeform top-level `notes`, never illness/injury/evaluation. This is a
   **scoped relaxation** of the "fixed type label only" sanitization rule; document
   it in guide §20 when it lands.

---

## 1. Shared helper: completed tests for a dog

Add one helper in `companionExport.js`, used by prospective (sire + dam) and partner
(stud + dam). Reads through `eventRepo.getForSubject('dog', dogId)` (never `db.*`),
projects to an array of `{ name, result }`, and **returns `[]` when nothing
qualifies** so callers omit the block entirely (no placeholder, no "no tests found").

```
breed_specific_test → { name: details.test_name, result: details.result }   (result non-empty)
ofa_pennhip         → { name: details.joint,     result: details.rating }    (rating non-empty)
genetic_test        → { name: details.panel_name,result: details.result }    (result non-empty)
```

No date is included. Every field is copied by name — no record spread.

## 2. Shared dog projection

A richer projection than today's `dogMini`. Add (do not mutate `dogMini`, which
prospective/partner pair labels still use):

```
dogCard(dog) → {
  registeredName: dog.registered_name || '',
  callName:       dog.call_name || '',
  photosUrl:      dog.url || '',          // "See photos here" / "View pictures here"
  tests:          completedTests(dog.id)  // may be []
}
```

---

## 3. Prospective package (`buildProspectiveBundle` + renderer)

**Shape change:** collapse the two flat cards (availablePups + litters) into **one
card per litter, pups nested inside**. Keep `availablePups` OFF the new shape; the
shell falls back to the old flat rendering only for legacy links (see §6).

Per litter (`Litter` where it has ≥1 available pup — `Dog.status='puppy'` +
`disposition='available'`):
- `nickname` — rendered `"<nickname>" Litter`
- `breed` — from the dam `Dog.breed`, falling back to sire `Dog.breed`
- `whelpDate` — `Litter.whelp_date`
- `readyDate` — `Litter.estimated_ready_date` (+ hardcoded estimate disclaimer in shell)
- `sire` — `dogCard(sireDog)`  (resolve `Litter.sire_id`)
- `dam`  — `dogCard(damDog)`   (resolve `Litter.dam_id`)
- `pups[]` — each available pup, in litter order:
  - `sex`, `callName` (`call_name`), `markings` (`color_markings`)
  - `price`   — sex-keyed: `expected_price_male` / `expected_price_female`
  - `deposit` — sex-keyed: `expected_deposit_male` / `expected_deposit_female`

**Disclaimers (hardcoded in the shell, not the bundle):**
- Under ready date: *"*This is an estimate and may be subject to change depending on
  veterinary status."*
- Below the pups: *"Deposits must be received and cleared through the seller's
  financial institution before puppies will be updated to a reserved status. All
  puppies are considered available until then. Deposits are first come, first
  serve."*

`PROSPECTIVE_KEYS`: add `litters` stays but is now the rich array; drop reliance on
`availablePups` for new bundles (leave the key allowed for back-compat or remove —
your call, but keep the allow-list exact to whatever the builder emits).

## 4. Partner package (`buildPartnerBundle` + renderer)

Per stud service, replace the flat `studDog`/`damDog` minis with **labeled Stud and
Dam blocks** using `dogCard` (AKC name, call name, completed tests). Direction still
decides which side is stud vs. dam (outgoing = our dog is stud; incoming = our dog is
dam) — unchanged.

**Stud-agreement block** (per service) — extend `compensation`:
- `fee_structure` (always)
- `fee_amount` — only when a fee option is in play (keep current non-empty guard)
- `pick_status` — only when `fee_structure ∈ {pick_of_litter, flat_plus_pick}` (keep
  current `hasPick` guard)
- add `sentDate` (`StudService.sent_date`) and `returnedDate` (`StudService.returned_date`)

**Contracts section** — extend the per-contract projection:
- `type` (`contract_type`), `status`
- `signedDate` (`signed_date`) → shell shows "Not Signed" when null
- `terms` (`terms_summary`)
- `document_url` → "View contract here" alias
- **No returned date** (decision 2).

`PARTNER_KEYS` unchanged at top level (enrichment is nested inside `studServices` /
`contracts`).

## 5. Current family package (`buildFamilyBundle` + renderer) — largest build

Per placed pup (`saleRepo.getByBuyer` → `Sale` → `Dog`):
- `callName`, `sex` (name + sex icon, prominent)
- `litterNickname` — only when the linked litter has one ("From the [nickname]
  litter"); omit otherwise
- `sire` / `dam` — `{ registeredName, callName }` from the litter's sire/dam dogs
  (parentage line `Sire "call" × Dam "call"`)
- `photosUrl` — `Dog.url` ("View pictures here")
- **Age:** compute at build time as-of `updatedAt` from `Dog.date_of_birth` →
  `{ ageWeeks, ageDays }` (do not ship raw DOB). Shell renders
  *"As of [gen date], your puppy is X weeks, Y days."*
- **Ready / placement:** if the pup has a `placement` event → `{ date: event_date,
  time: details.placement_time, method: details.dropoff_method }`; else
  `estimatedReadyDate` = linked `Litter.estimated_ready_date`. Either way the shell
  shows the estimate disclaimer.
- **Sale facts:** `placementType`, `saleStatus`, `price`, `deposit`, and
  `remainingBalance` = `price − deposit_amount` (compute in builder; both nullable →
  guard).
- **Event history sections** — one section per type, newest-first, each item
  `{ date, title, detail }` where `detail` is the curated safe field only:
  - `vaccination` → `details.vaccine`
  - `preventative` → `details.product`
  - `weight_check` → weight from `details.weight_lbs` (+ `weight_oz` if present)
  - `milestone` → `details.description`
  - `note` → none (title only)
  Never surface top-level `notes`. `getForSubject` already excludes archived and
  returns newest-first.

The existing sanitized `vetVisits` / `pickupDates` / `contractUrls` may be kept or
folded into the new sections — reconcile so nothing is shown twice. Keep
`FAMILY_KEYS` exact to whatever the builder emits.

---

## 6. Shell (`companion-view.html`) — backward-compatible rewrite

Rewrite the three per-type renderers to the new shapes **without bumping
`COMPANION_BUNDLE_VERSION`**. The infrastructure contract requires already-sent
links to keep rendering: each renderer must detect the new nested fields and render
them, but **fall back to today's flat layout when they're absent** (e.g. prospective:
if a litter has no `pups`, render the old `availablePups` + flat litter list). Money,
sex icon, date, and `esc()` helpers already exist in the shell.

Hardcoded disclaimer strings live in the shell (not the bundle).

## 7. Security spine — non-negotiable

- Every new field is **named explicitly** in the builder and present in the matching
  `*_KEYS` allow-list. No record spread, no `Object.assign` from a record, no
  delete-the-private-keys. `assertOnlyKeys` guards top-level keys; nested additions
  are safe as long as top-level allow-lists stay exact.
- All reads go through repos, never `db.*`.
- New reads introduced: `eventRepo.getForSubject('dog', …)` for parent tests in
  prospective/partner (family already reads it).

## 8. Size & transport

Family bundles grow the most (per-pup parents + tests + event sections). `pages/
companion.js` already steers over-`MAX_SMS_HASH_LEN` (1800) payloads to email and
warns over `MAX_EMAIL_HASH_LEN` (12000). Load a rich sample and confirm a realistic
family still fits email; no code change expected, just verification.

## 9. Files to touch & closeout

- `data/companionExport.js` — helpers + three builders + allow-lists + header comment.
- `companion-view.html` — three renderers (backward-tolerant) + disclaimers.
- `pages/companion.js` — no logic change expected (verify size behavior).
- `KennelOS/sw.js` — **bump `CACHE_NAME`** (existing files edited; no new files, so
  `PRECACHE_URLS` is unchanged). Run the precache sanity check anyway.
- `docs/End_State_Design_and_Maintenance_Guide.md` §20 — update to the new reality
  **when the code lands**: prospective now carries price; family surfaces curated
  per-type event detail; partner blocks are labeled with parent tests. Note the two
  policy changes (decisions 1 and 4) explicitly.
- `node --check` every `.js` touched.

No schema, index, or `referenceRegistry.js` change: every field consumed already
exists on its table (`Dog.url`, `Dog.registered_name`, `Dog.color_markings`,
`Litter.nickname`/`estimated_ready_date`/`expected_price_*`/`expected_deposit_*`,
`Sale.price`/`deposit_amount`/`placement_type`/`status`, `StudService.sent_date`/
`returned_date`/`fee_*`/`pick_status`, `Contract.signed_date`/`terms_summary`/
`document_url`, and the `breed_specific_test`/`ofa_pennhip`/`genetic_test`/`placement`
event `details`).
