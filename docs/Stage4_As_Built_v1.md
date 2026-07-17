# Stage 4 As-Built — v1
### Sales, Contracts, Stud Services: what actually shipped

**How to use this doc:** this is the *as-built* companion to `Stage4_Revision_v2.md`. That doc is the **plan**; this one records what the code in `KennelOS/` actually does, file by file, so a future session can trust the source of truth without re-reading every module. Where build and plan agree, this doc says so and points at the file. Where they diverge or the plan left something open, §11 (Deviations & Gaps) calls it out explicitly. Read `Stage4_Revision_v2.md` first for the *why*; read this for the *what-and-where*.

**Verdict up front:** Stage 4 is built and matches `Stage4_Revision_v2.md` on every load-bearing decision — Buyer merged into Contact, one `version(1)` schema block, no two-way pointers, Contract lifecycle via `status`. Nine tables, three new repos, six new pages (list + detail for Sales, Contracts, Stud Services), the buyer-as-filtered-Contact view, and one new CSV mapping (Sale). Two intentional-looking gaps remain: **no CSV import for Contracts or Stud Services**, and the **landing-page tiles were never extended** past Stage 2. Both are documented in §11.

---

## 1. Scope That Shipped (recap, not re-litigated)

Everything `Stage4_Revision_v2.md` §1–§7 decided is implemented:

- **Buyer merged into Contact.** No `buyers` table, no `buyerRepo.js`, no Buyer page. `sales.buyer_contact_id` points at `contacts`. "Buyers" is a filtered Contact view (`contacts.html?buyer=1`).
- **Two-way pointers removed.** Every relationship has one canonical stored side; the reverse is a derived query. No `Sale.contract_id`, no `StudService.contract_id`, no `Pairing.stud_service_id`.
- **One `version(1)` schema block** carrying all nine tables (`data/db.js`).
- **Contract lifecycle** via `status` (`draft / sent / signed / declined / cancelled / void`), orthogonal to `is_archived` and to `contract_type`.

Contract is a **leaf** (nothing points at it → always hard-deletable). Sale and StudService are each pointed at only by Contract.

---

## 2. Dexie Schema — as built (`data/db.js`)

Single `db.version(1).stores({...})` block, nine tables. Matches `Stage4_Revision_v2.md` §2 verbatim:

```js
db.version(1).stores({
  dogs:          'id, sire_id, dam_id, litter_id, owner_contact_id, *co_owner_contact_ids, status, ownership_type, sex, breed, kennel_id, is_archived',
  events:        'id, [subject_type+subject_id], event_type, event_date, related_dog_id, is_archived',
  contacts:      'id, kennel_id, waitlist_status, is_archived',
  kennels:       'id, is_archived',
  pairings:      'id, sire_id, dam_id, status, pairing_type, is_archived',
  litters:       'id, pairing_id, sire_id, dam_id, status, whelp_date, is_archived',
  sales:         'id, dog_id, buyer_contact_id, status, placement_type, is_archived',
  contracts:     'id, contract_type, status, related_sale_id, related_stud_service_id, is_archived',
  stud_services: 'id, our_dog_id, partner_dog_id, partner_contact_id, direction, status, pairing_id, is_archived'
});
```

- Database name: `KennelOSBreedingApp`.
- `existingTableNames()` and `requestPersistentStorage()` are exported here; the registry executor and import/export use the former so stage-aware code never probes an absent table.
- **Fields stored but intentionally not indexed** (present on the object, absent from `stores()`): `contacts.first_contact_source`, `sales.lead_source`. `contacts.waitlist_status` and `contracts.status` **are** indexed, matching the plan's reasoning (§2 of the revision).

---

## 3. Reference Registry — as built (`data/referenceRegistry.js`)

The seven registry arrays match `Stage4_Revision_v2.md` §4 exactly. Every FK below is indexed, so every reverse lookup is an index probe, never a scan.

| Guarded entity | Points-at entries |
|---|---|
| `DOG_REFERENCES` | dogs.sire_id, dogs.dam_id, events (compound `[subject_type+subject_id]`, `dog`), events.related_dog_id, pairings.sire_id/dam_id, litters.sire_id/dam_id, **sales.dog_id**, **stud_services.our_dog_id/partner_dog_id** |
| `CONTACT_REFERENCES` | dogs.owner_contact_id, dogs.co_owner_contact_ids (multiEntry), **sales.buyer_contact_id**, **stud_services.partner_contact_id** |
| `KENNEL_REFERENCES` | contacts.kennel_id, dogs.kennel_id |
| `LITTER_REFERENCES` | dogs.litter_id |
| `PAIRING_REFERENCES` | litters.pairing_id, events (compound, `pairing`), **stud_services.pairing_id** |
| `SALE_REFERENCES` | **contracts.related_sale_id** |
| `STUD_SERVICE_REFERENCES` | **contracts.related_stud_service_id** |
| `CONTRACT_REFERENCES` | **`[]`** — leaf, always hard-deletable |

- `findBlockingReferences(registry, id)` is the single generic guard. It skips any entry whose table isn't in the current schema (a harmless no-op now that all nine tables exist), and returns `[{ label, count }]` blockers — empty array means hard-delete is allowed.
- `countReferences` handles two entry shapes: standard `.where(field).equals(id)` (covers multiEntry `*` indexes unchanged) and the polymorphic `compoundIndex` case `.where('[subject_type+subject_id]').equals([discriminatorValue, id])`.
- Detail-screen delete buttons render `getDeleteBlockers()` output as the disabled-button tooltip; Contract's button is never disabled (empty registry). This message is generated entirely from the registry — no per-entity carve-out.

---

## 4. Repos & Validation — as built

Three new thin repos over `repoBase.js` (`makeRepo(table, references)` gives `getById` / `getAll({includeArchived})` / `create` / `update` / `archive` / `unarchive` / `hardDelete` / `getDeleteBlockers`). Each re-exports `ReferenceBlockedError`.

### `saleRepo.js`
- **Required to save:** `dog_id`, `buyer_contact_id`, `placement_type`, `status`. No blocks beyond required fields — a `returned` sale stays visible.
- Derived queries: `getByDog(dogId)`, `getByBuyer(contactId)`, `getLeadSources()` (distinct `lead_source` values → autocomplete).

### `contractRepo.js`
- **Required to save:** `contract_type` only. `create()` defaults `status: 'draft'`. Status is **not** a locked state machine — any type + any status, moves freely, no confirmation dialogs.
- Owns **both** canonical links (`related_sale_id`, `related_stud_service_id`).
- Derived reverse queries: `getBySale(saleId)`, `getByStudService(studServiceId)` — each permits multiple contracts (sale + addendum).
- `governingContract(contracts)`: the derived "live contract" rule — most recent `signed` by `signed_date` (falling back to `created_at`), or `null`. **Never a stored flag** (invariant #8).

### `studServiceRepo.js`
- **Required to save:** `direction`, `our_dog_id`, `partner_dog_id`, `partner_contact_id`, `status`.
- Owns the canonical `pairing_id` (mirrors `Litter.pairing_id`); no `Pairing.stud_service_id`.
- Derived queries: `getByPairing(pairingId)`, `getForDog(dogId)` (union of `our_dog_id` + `partner_dog_id`, deduped).

Repos enforce **data-integrity** blocks (required fields); **soft warnings** (sex-mismatch, same-dog, date-order) live in the form JS — consistent with `Code_Orientation_Where_To_Fix.md`.

---

## 5. Lead-Source / First-Contact-Source — as built

Two free-text fields with `<datalist>` autocomplete, no enforcement, exactly per `Stage4_Revision_v2.md` §3:

- **`Contact.first_contact_source`** — edited on Contact Detail (`pages/contact.js`), autocompletes from prior Contact values.
- **`Sale.lead_source`** — edited on Sale Detail (`pages/sale.js`), autocompletes from `saleRepo.getLeadSources()`.
- **Prefill wiring:** selecting a buyer on the Sale form copies that contact's `first_contact_source` into `lead_source` **only when `lead_source` is still empty**, so it never clobbers a deliberate choice (`sale.js` buyer-change handler). The two fields are allowed to disagree — that's intended, not drift (invariant #6).

---

## 6. Linking Without Sync — as built

Every "link" action is a single write on the repo owning the canonical field (`Stage4_Revision_v2.md` §5). No cross-table transaction except the deliberate two-repo create in the last row.

| Action | Canonical write | Where |
|---|---|---|
| Attach contract to a sale | `contract.related_sale_id` | Contract Detail form (`contract.js`); or `contract.html?new=1&sale=<id>` prefills type `sale` |
| Attach contract to a stud service | `contract.related_stud_service_id` | Contract Detail form; or `contract.html?new=1&stud_service=<id>` prefills type `stud_service` |
| Link a stud service to a pairing | `studService.pairing_id` | Stud Service Detail "Linked pairing" picker (`stud-service.js`) |
| "Create Pairing from this Stud Service" | `pairingRepo.create()` then `studServiceRepo.update()` sets `pairing_id` | `pairing.js` (`?new=1&stud_service=<id>`), each repo touches only its own table |

**Direction mapping** for "Create Pairing from Stud Service" is implemented at `pairing.js:362–373` per Data Model §5.8:
- `outgoing` → `sire = our_dog`, `dam = partner_dog`
- `incoming` → `sire = partner_dog`, `dam = our_dog`

Reverse displays are all derived: Sale Detail's Contracts panel = `contractRepo.getBySale()`; Stud Service Detail's Contracts panel = `contractRepo.getByStudService()`; Pairing Detail's "Linked stud service" line = `studServiceRepo.getByPairing()`.

---

## 7. Contract Lifecycle — as built (`vocab.js` + `contract.js`)

- **Enum** `CONTRACT_STATUS`: `draft / sent / signed / declined / cancelled / void`, each with a badge color. Default `draft` on create.
- The status `<select>` on Contract Detail carries the hint *"Not a locked sequence — moves freely, e.g. sent → declined → sent → signed."* No confirmation dialogs.
- `is_archived` stays orthogonal: a `cancelled`/`declined` contract normally stays **un-archived** so it remains visible in the sale's Contract panel.
- Sale/Stud Service Contract panels list **all** contracts, newest-first by `signed_date`/`created_at`, each with its status badge — visible deal history, no stored "active" flag.

---

## 8. Screens — as built

New nav entries (`nav.js`, `stageIntroduced: 4`): **Sales**, **Stud Services**, **Contracts**. All use the shared `listView` / edit-in-place Detail patterns from Stages 1–3.

| Screen | File(s) | Key behavior |
|---|---|---|
| **Sales List** | `sales.html/.js` | Search by dog/buyer name; filters: Placement, Status; archived toggle. |
| **Sale Detail** | `sale.html/.js` | Edit-in-place; dog & buyer pickers (archived-toggle, exclude archived by default); money fields; `lead_source` datalist; derived **Contracts panel** (`getBySale`) with "+ Create Contract"; archive/delete (blockers from `SALE_REFERENCES`). Co-own placement offers to add buyer to `dog.co_owner_contact_ids` (confirm dialog, never automatic — Data Model §5.6). |
| **Stud Services List** | `stud-services.html/.js` | Search by dog/partner contact; filters: Direction, Status; archived toggle. |
| **Stud Service Detail** | `stud-service.html/.js` | Edit-in-place; direction/dog/contact pickers; fee amount + structure; **canonical "Linked pairing" picker** with "+ Create Pairing from this Stud Service" when none linked; live warn on direction/sex mismatch and same-dog; derived **Contracts panel** (`getByStudService`); archive/delete (blockers from `STUD_SERVICE_REFERENCES`). |
| **Contracts List** | `contracts.html/.js` | Search title/terms; filters: Type, Status; archived toggle. |
| **Contract Detail** | `contract.html/.js` | Edit-in-place; type, free-moving status, signed date, terms; **Related sale** and **Related stud service** pickers (the canonical links this record owns); archive + **always-enabled Delete** (leaf entity). |
| **Buyers view** | `contacts.html?buyer=1` (`contacts.js`) | Not a new page/repo — a filtered Contact view (`buyer` role and/or non-null `waitlist_status`), reached via the "Buyers only →" toggle on Contact List. Adds Waitlist column + filter. |
| **Contact Detail (extended)** | `contact.js` | Gains `waitlist_status`, `first_contact_source`, and a derived **Sales panel** (`saleRepo.getByBuyer`). |
| **Dog Detail (extended)** | `dog.js` | Gains derived **Sales** panel (`getByDog`) and **Stud Services** panel (`getForDog`). |

---

## 9. CSV Import — as built (`data/csvImport.js`)

One new mapping added to the existing generic engine: **Sale**. Wired via `pages/sale-import.html/.js` using the shared `importView`.

- **Sale columns:** `dog_registered_name, buyer_name, sale_date, placement_type, status, price, deposit_amount, lead_source, notes`.
- **Natural key:** `dog + buyer(name) + sale_date`. A dateless or buyer-less row routes to **needs-review** by design (`sale_date` is optional on the entity).
- **The buyer_name exception:** unlike every other relationship column, an unmatched `buyer_name` is **created inline as a Contact** (with `contact_type: ['buyer']`) on commit — never flagged for review. An unmatched `dog_registered_name`, by contrast, is always flagged (never auto-created). Matching is case-insensitive/trimmed on name, exact on date.
- `MAPPINGS` registers `dog, contact, pairing, litter, sale`.

---

## 10. Sample Data & Reset — as built (`data/sampleData.js`, `data/appReset.js`)

`sampleDataManifest` gains `sales`, `contracts`, `stud_services` arrays (no `buyers` array). The Stage 4 seed records:

- **Buyers as Contacts:** Priya Shah (`waitlist_status: fulfilled`, `first_contact_source: Instagram`), Owen Farrow (`waitlist_status: active`, no Sale — exercises the empty-waitlist demo), Ellen (owner of the external partner dog Nell).
- **Stud Service:** Birch (our dog, `outgoing`) services Nell (Ellen's female), `status: completed`, linked to actual Pairing **P3** via canonical `pairing_id`; plus a `signed` stud-service Contract (`related_stud_service_id`).
- **Sale:** Hazel → Priya, `placement_type: pet`, `status: delivered`, `lead_source: Instagram`; plus a `signed` sale Contract (`related_sale_id`).
- **Empty-state coverage:** Pairing **P2** (planned, no litter) exercises "Create Litter from this Pairing"; Owen exercises the active-waitlist-with-no-sale case.

Clearing is manifest-driven with a contamination check against the registries, deleting in dependency order (`events → contracts → litters → stud_services → pairings → sales → dogs → contacts → kennels`) so a referenced row never blocks its own cleanup. `appReset.js` is the blunt superset (wipe every table + every `kennelOS.*` key), gated behind typing `RESET`. JSON backup `schema_version` is `1`.

---

## 11. Deviations & Gaps From the Plan

Honest accounting of where the built app differs from `Stage4_Revision_v2.md` (which folds in the original brief's §4–§7):

1. **No CSV import for Contracts or Stud Services.** Only **Sale** got a new mapping/import page. `csvImport.js` `MAPPINGS` has no `contract` or `stud_service` entry, and there are no `contract-import.*` / `stud-service-import.*` pages. The revision's §6 only spelled out the *Sale* mapping's buyer-name behavior and never explicitly required Contract/StudService importers, so this is arguably in-scope-complete — but it is a real asymmetry (every other transactional entity through Stage 3 has a CSV path) and should be a conscious decision, not an accident, before Stage 5.

2. **Landing-page tiles never extended past Stage 2.** `index.html` still tiles only Dogs, Contacts, Pedigree, Import/Export. Sales, Stud Services, and Contracts are reachable **only** through the top nav, not from the landing grid. Low-effort fix; flagged so it's not mistaken for an intentional information-architecture choice.

3. **Buyers view has no direct nav/tile entry.** The buyer-as-filtered-Contact view is reachable only via the "Buyers only →" toggle on the Contact List (`?buyer=1`). This is consistent with the "Buyer is not a screen" decision, but a user who wants "the waitlist" has to know to go to Contacts first. Working as designed; noted for discoverability.

4. **CLAUDE.md was stale at the time of writing.** It described Stage 4 as *"buyer merged into Contact — no Buyer table"* (correct) but the surrounding "Read first" list and scope notes predate confirming the build. This as-built doc is the reconciliation; CLAUDE.md's Stage 4 scope line is accurate, its doc list should point here for the as-built state.

Everything else — schema, registry, repos, validation postures, linking-without-sync, the direction mapping, Contract lifecycle, sample data — matches the plan.

---

## 12. Where To Look (quick index)

| Concern | File |
|---|---|
| Schema / indexes | `data/db.js` |
| Delete-guard registry + executor | `data/referenceRegistry.js` |
| Sale rules / derived queries | `data/saleRepo.js` |
| Contract rules / links / `governingContract` | `data/contractRepo.js` |
| Stud service rules / `pairing_id` / `getForDog` | `data/studServiceRepo.js` |
| Enums + badge colors | `data/vocab.js` |
| Sale form, co-own convenience, lead-source prefill | `pages/sale.js` |
| Contract form, link pickers | `pages/contract.js` |
| Stud service form, warnings, "Create Pairing" | `pages/stud-service.js` |
| "Create Pairing from Stud Service" direction map | `pages/pairing.js:362` |
| Buyers filtered view | `pages/contacts.js` |
| Sale CSV mapping (+ buyer inline-create) | `data/csvImport.js` |
| Stage 4 sample records | `data/sampleData.js` |
| Nav entries | `nav.js` |

---

## Changelog
- **v1** — Initial as-built record of Stage 4 (Sales, Contracts, Stud Services). Reconciles the shipped code in `KennelOS/` against `Stage4_Revision_v2.md`. Confirms all load-bearing decisions were implemented; documents two gaps (no Contract/StudService CSV import; landing tiles not extended) and two discoverability notes.
</content>
</invoke>
