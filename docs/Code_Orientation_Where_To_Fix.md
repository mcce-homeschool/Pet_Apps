# Where To Go Looking — Code Orientation Guide

**Purpose:** a map from *"the symptom I'm seeing"* or *"the thing I want to change"* to *"the file that owns it."* Built from the module boundaries in `Data_Model_Architecture_Proposal_v3.md` §11 and the build briefs. Hand this to Claude Code alongside `Data_Model_Architecture_Proposal_v3.md`, `Stage4_As_Built_v1.md`, and `Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md` so it edits the one place that owns a concern instead of chasing the same logic through five files.

**The one rule everything else follows:** pages never touch Dexie. Pages call repos; repos own all `db.<table>.*` access for their table. If you find a page reaching into `db` directly, that's the bug — not a shortcut to copy.

---

## File Layout

```
/vendor
  dexie.min.js            vendored, not CDN — the offline guarantee depends on this
  papaparse.min.js        vendored CSV parser
/assets
  pedigree.js             hand-rolled family-tree layout + SVG connectors (no charting lib)
/data
  db.js                   Dexie schema — ONE version(1) block, all nine tables
  referenceRegistry.js    the FK registry that drives every delete-guard
  settings.js             localStorage access, all keys namespaced kennelOS.*
  vocab.js                event_type catalog + any controlled/autocomplete value lists
  dogRepo.js              \
  eventRepo.js             \
  pairingRepo.js            \
  litterRepo.js             |  one repo per table. Plain functions:
  saleRepo.js               |  getById / getAll({includeArchived}) /
  contractRepo.js           |  create / update / archive / hardDelete
  studServiceRepo.js       /
  contactRepo.js          /   (Contact now also holds the buyer role)
  kennelRepo.js          /
  importExport.js         CSV + JSON logic; calls repos, never db directly
  sampleData.js           seed + clearSampleData() (manifest-driven)
  appReset.js             resetApp() — the blunt "wipe everything" superset
/pages
  index.html              landing tiles + last-backup indicator
  dogs / contacts / pairings / litters / sales / contracts /
  stud-services / pedigree / roster / import-export        (.html + .js each)
nav.js                    single source of truth for the nav menu
puppyForm.js              "Add Puppy" / "Add N Puppies" from Litter Detail
```

**Gone in the revision — do not look for these, they don't exist:**
`buyerRepo.js`, `buyers.html/js` (Buyer merged into Contact), `attachmentRepo.js` (photos descoped, data model §12), and any "linking module" / two-way-sync helper (linking is now a single canonical FK write — see below).

---

## Symptom → Where To Fix

| What you're seeing / want to change | Go to | Notes |
|---|---|---|
| "Can't delete this dog — something references it" message is wrong, missing a blocker, or lists a blocker that shouldn't exist | `referenceRegistry.js` | The message is *generated* from the registry. Add/remove a `*_REFERENCES` entry; the Detail-screen message updates with no UI change. |
| Deleting a Contract/StudService throws instead of returning blockers | the registry **executor** (in `referenceRegistry.js` or the repo's `hardDelete`) | After the revision every FK is indexed, so this shouldn't happen. If it does, a field is unindexed — add a `.filter()` fallback, don't just index blindly. |
| A new table/index is needed | `db.js` | Until first real release: edit the single `version(1)` block. After first release: add a `.version(2).stores({})` block, never edit v1. |
| "Attach contract," "link pairing," or any linking action | the repo owning the **canonical** side | Contract owns `related_sale_id` / `related_stud_service_id`; StudService owns `pairing_id`. Linking = one `update()` on that table. There is no second side to sync. |
| A reverse relationship isn't showing (e.g. Sale Detail's contract panel, Pairing Detail's linked stud service) | the repo with a **derived query** (`getBySale`, `getByPairing`, etc.) | These are never stored back-pointers. If one is missing, add the query method to the owning repo, not a field to the schema. |
| Validation rule (required fields, warn-don't-block, the one confirmation dialog) | the relevant `*Repo.js` create/update, or the form JS in `/pages` | Business rules live where the data model / briefs put them: repo for data-integrity blocks, form for UX prompts. |
| Sex-mismatch / date-order / duplicate-placement warnings fire wrong | the form JS in `/pages` for that entity | All are **warn, don't block** — they're UI-layer soft warnings, not repo hard-blocks. |
| `event_type` catalog: add a type, change a `details` form | `vocab.js` (the type) + the type-specific form in the entity's page JS | Catalog is extensible by design (data model §5.2). One enum value + one small form, no migration. |
| A backed-out/cancelled contract vanished from a sale, or you want to mark one dead | `Contract.status` (schema in Revision §7) + the contract status badge/form | Use **status** (`cancelled`/`declined`/`void`), never `is_archived`, to mark a fallen-through deal — archiving hides it, status keeps it visible in the sale's contract list. |
| Timeline shows the wrong events for a dog/pairing/litter | `eventRepo.js` query using `[subject_type+subject_id]` | Must use the **compound index**, not `subject_id` alone — otherwise a pairing id colliding with a dog id cross-matches. |
| Pedigree renders wrong / infinite-loops / truncates a branch | `assets/pedigree.js` (render) + the cycle check in `dogRepo` sire/dam validation | Unknown parents must render a placeholder node, not truncate. Cycle prevention lives in the save-path validation, not the renderer. |
| CSV import: keyless rows, bad matching, a new entity mapping | `importExport.js` | Generic engine — add a mapping config, never rebuild the engine. Keyless rows → needs-review, never auto-match/auto-create. |
| JSON backup missing a table, or restore failing | `importExport.js` | Exporter **iterates whatever tables exist in the schema**; if a table is missing from a backup it's because it didn't exist at export time. |
| Sample data won't seed or won't clear | `sampleData.js` | Clearing is manifest-driven (`sampleDataManifest` in localStorage) with a contamination check against the registries. It deliberately bypasses per-record delete-guards. |
| "Reset App" behavior | `appReset.js` | The blunt superset: clears every live table + every `kennelOS.*` settings key, no contamination check. Gated behind typing `RESET`. |
| A settings value (last backup, kennel identity, skip flags) | `settings.js` | All localStorage, all `kennelOS.*` namespaced. Nothing app-level goes in IndexedDB. |
| Nav menu: add/rename a section | `nav.js` | One array of `{label, path, stageIntroduced}`. This is the only file that changes to add a section. |
| Kennel-scoped fields (`is_own_kennel`, `dogs.kennel_id`) behaving oddly | `db.js` (index) + the Dog/Kennel form JS | Own-Kennel addendum: `kennel_id` shown only for owned/co-owned dogs, autofilled when exactly one own-kennel exists. `null` is valid, never an error. |

---

## Load-Bearing Invariants (break one and things rot quietly)

These are the things that, if violated, won't throw immediately but will corrupt data or behavior later. Check them when touching the relevant area.

1. **One canonical direction per relationship; the reverse is always a query.** No stored back-pointers. `StudService.pairing_id`, `Litter.pairing_id`, `Contract.related_sale_id`, `Contract.related_stud_service_id` are canonical. There is no `Pairing.stud_service_id`, no `Sale.contract_id`, no `StudService.contract_id`, no `Litter`-side pairing pointer beyond `pairing_id`. If you're about to store "the other side," stop — derive it.

2. **A puppy is a Dog record, not a new entity.** `status: "puppy"` + `litter_id` set. Promotion is a status edit on the same record. The puppy roster on Litter Detail is `dogRepo.getAll()` filtered by `litter_id` — never a stored list.

3. **A buyer is a Contact.** No Buyer table. `sales.buyer_contact_id` points at Contacts. A co-owning buyer is already a Contact and drops into `Dog.co_owner_contact_ids` with no conversion. "Buyers" is a filtered Contact view.

4. **Nothing is hard-deleted while referenced. Archive ≠ status.** Archive *hides* a record from active lists; it never cascades and never breaks pedigree/history, and archived records must still resolve in pedigree, timelines, and reports. A record's *lifecycle* (a cancelled contract, a returned sale, a failed pairing) is a **`status`**, not archiving — those stay visible. Don't reach for `is_archived` to mean "this fell through." Hard delete is gated by the registry.

5. **Date-only fields are `YYYY-MM-DD` strings**, compared lexicographically. Only `created_at`/`updated_at` carry a time component. A date rule that does `<`/`>=` relies on this — don't turn a date field into a datetime.

6. **`first_contact_source` (Contact) and `lead_source` (Sale) answer different questions and may disagree** — that's intended, not drift. Contact = how the relationship started; Sale = how this specific sale came in. Free text with autocomplete, same as `breed`; they fragment the same way and get cleaned up in the same future enhancement. Don't "fix" them into one field.

7. **Pages call repos; repos own their table.** The moment a linking action or a page writes a table it doesn't own, the ownership model is broken. Linking is a single write on the canonical side's own repo — it never needs to reach across.

8. **"The live contract of a sale" is a derived rule, never a stored flag.** Definition: the most recent `signed` contract (by `signed_date`, else `created_at`), or none if none is `signed`. Any report or rule needing "the governing contract" computes this over the derived contract list. Do not add an `is_active` / `is_primary` field to Contract — that re-creates the 1:1 constraint this revision deleted.
