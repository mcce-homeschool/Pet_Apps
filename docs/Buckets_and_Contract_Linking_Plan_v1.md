# Buckets & Direct Contract Linking — Implementation Plan v1

Scope: four UI changes on top of the navigation cleanup. **No schema, repo, `referenceRegistry.js`, or vocab changes** — every entity, field, and FK these features need already exists. This is a pages + shared-`listView` job only.

Format references (match these, don't invent new patterns):
- **`pages/breeding.js`** — the card-with-nested-block layout (a pairing card carrying its litter block), the `recencyKey()` most-recent-first sort, and the `PAGE_SIZE` + "Show more" toggle. This is the template for the **Sale card carrying its Contract** (Work Area 1).
- **`pages/reminders.js`** `bucketSection()` — labeled section markup (`<h2>Title <span class="muted">(n)</span></h2>`) for grouped lists (Dogs breeding/not-breeding splits).
- **`.seg-tabs` / `.seg-tab`** in `assets/app.css:437` and the existing nav in `pages/sales.html:26` — the toggle strip. This is the template for the Contacts and Dogs bucket toggles.
- **`pages/contacts.js`** existing `?buyer=1` view — the template for a URL-param-driven `baseFilter` bucket that reloads the page (no SPA).

## Invariants to honor (from CLAUDE.md / data model)
- **Contract owns the link.** `Contract.related_sale_id` and `Contract.related_stud_service_id` are the only stored sides. Linking/unlinking = **one write to the contract** via `contractRepo.update(contractId, {...})`. Never add `Sale.contract_id` / `StudService.contract_id`; never two-way sync.
- Reverse lookups already exist: `contractRepo.getBySale(saleId)`, `contractRepo.getByStudService(ssId)`, `contractRepo.governingContract(contracts)`.
- A sale/stud-service may have **more than one** contract (sale + addendum) — by design. Show all linked; the picker links an additional one.
- Pages call repos only (no `db.*`). `esc()` everything interpolated. Badges via `badge(vocab, value)`. Dates via `fmtDate`. Archived excluded by default.

## Open decisions (flagged — easy to change, please confirm if you disagree)
1. **Sale/Stud cards drop the current filter dropdowns.** Moving Sales and Stud Services from the `listView` table to breeding-style cards removes their Placement/Status/Direction dropdown filters (the breeding tab has none). Recommended: proceed without them to match the breeding-tab format. If you want filtering back, we'd add a lightweight seg-tab filter later.
2. **A leading "All" tab** on Contacts and Dogs. Recommended: keep an "All" tab first on both so nothing is ever hidden and the current default (flat list + CSV export) is preserved. The four/four buckets you named still cover every record across the tabs, so "All" is optional — say the word to drop it.
3. **Within-group sort where you didn't specify one** (Not-breeding groups, Puppies, External): defaulting to a sensible order, noted inline below.

---

## Work Area 1 — Placements & Contracts: sale/stud cards + inline contract linking + "Other contracts" + recency

### 1A. Sales tab → card view (`pages/sales.js`, container in `pages/sales.html` unchanged: `#sale-list`)
Rewrite `sales.js` to render breeding-style cards instead of `createListView`.

- **Load** (all in one `Promise.all`): `saleRepo.getAll({includeArchived:false})`, `dogRepo.getAll({includeArchived:true})`, `contactRepo.getAll({includeArchived:true})`, `contractRepo.getAll({includeArchived:false})`. Build `dogsById`, `contactsById`, and a `contractsBySale` map (group the contracts by `related_sale_id`).
- **Sort most-recent-first.** `recencyKey(s) = s.sale_date || (s.created_at||'').slice(0,10)`; sort descending like `breeding.js:100`.
- **Sale card** (pattern `breeding.js` `pairingCard` + `litterHtml`):
  - Header row: `<Dog call_name> → <Buyer name>`, `badge(PLACEMENT_TYPE, placement_type)` `badge(SALE_STATUS, status)`, sale date muted, and an "Open sale" button → `sale.html?id=…`.
  - Nested **Contract block** (the `litterHtml` sub-block equivalent — dashed top border):
    - For **each** linked contract: `badge(CONTRACT_TYPE)` + title + `badge(CONTRACT_STATUS)` + signed date, linking to `contract.html?id=…`, followed by an **✕ Unlink** button (`data-act="unlink"` `data-contract="<id>"`).
    - **"+ Link contract"** control: renders an inline `<select>` of *linkable* contracts (those with no `related_sale_id` **and** no `related_stud_service_id`, plus any already on this sale), value = contract id. On choose → `contractRepo.update(contractId, { related_sale_id: saleId, contract_type: existing.contract_type || 'sale' })`.
    - **"+ Create contract"** link → `contract.html?new=1&sale=<id>` (already supported by `contract.js:255`).
  - **Unlink** → `contractRepo.update(contractId, { related_sale_id: null })`.
  - After any link/unlink write, re-run the load+render (simplest: a `main()` re-call) so the card reflects the new state.
- **Show more** after `PAGE_SIZE` (reuse the `breeding.js` toggle verbatim).
- Wire card button handlers via delegation on `#sale-list` (buttons carry `data-act`), so re-renders don't leak listeners.
- Empty state text unchanged in spirit ("No sales yet…").

### 1B. Stud Services tab → same card treatment (`pages/stud-services.js`)
Identical structure to 1A with stud-service fields:
- Card header: `<our_dog> × <partner_dog>`, `badge(STUD_SERVICE_DIRECTION)` `badge(STUD_SERVICE_STATUS)`, partner contact muted, "Open stud service" → `stud-service.html?id=…`.
- Contract block uses `contractsByStud` (`related_stud_service_id`), link write sets `{ related_stud_service_id: ssId, contract_type: existing.contract_type || 'stud_service' }`, unlink sets `related_stud_service_id: null`. Create link → `contract.html?new=1&stud_service=<id>` (supported by `contract.js:260`).
- **Recency:** StudService has **no user-facing date field** (confirmed — `blankStudService` has none). Sort by `created_at` descending only.

### 1C. Contracts tab → "Other contracts" (`pages/contracts.js` + the three seg-tab navs)
- **Rename the tab label** `Contracts` → `Other contracts` in `pages/sales.html:29`, `pages/stud-services.html:29`, and the active label in `pages/contracts.html:29`.
- **Filter to the fallout:** in `contracts.js`, add `baseFilter: (c) => !c.related_sale_id && !c.related_stud_service_id` — contracts not tied to any sale or stud service (co-own, lease, other, and any unlinked sale/stud contract). Keep the existing `listView` table, Type/Status dropdowns, and columns.
- **Recency sort:** add `sort: (a,b) => (b.signed_date||b.created_at||'').localeCompare(a.signed_date||a.created_at||'')` (uses the new `sort` option — see Work Area 4).
- Update `pages/contracts.html` `<h1>`/subtitle to "Other contracts" / "Co-ownership, lease, and any agreement not tied to a specific sale or stud service. Sale and stud-service contracts live on their Sales and Stud Services cards."

### 1D. Recency on all three tabs
Covered above: Sales by `sale_date||created_at`, Stud Services by `created_at`, Other contracts by `signed_date||created_at` — all descending.

---

## Work Area 2 — Contacts prefiltered toggles (`pages/contacts.js` + `pages/contacts.html`)

Replace the single "Buyers only" pill toggle with a `.seg-tabs` strip patterned on `sales.html`.

- **`contacts.html`:** swap the `#contacts-view-toggle` pill-row (line 29) for:
  ```html
  <nav class="seg-tabs" aria-label="Contact groups">
    <a class="seg-tab" href="contacts.html">All</a>            <!-- active when no ?group -->
    <a class="seg-tab" href="contacts.html?group=clients">Clients</a>
    <a class="seg-tab" href="contacts.html?group=network">Network</a>
    <a class="seg-tab" href="contacts.html?group=care">Care team</a>
    <a class="seg-tab" href="contacts.html?group=other">Other</a>
  </nav>
  ```
  Mark the current tab `active`/`aria-current` in JS from `param('group')` (keep `#contacts-title`/`#contacts-subtitle` for per-group copy).
- **`contacts.js`:** read `const group = param('group')`. Define predicates over a contact `c` (`type = c.contact_type || []`):
  - **clients** — `type.includes('buyer') || (c.waitlist_status && c.waitlist_status !== 'none')` *(this is exactly the existing `isBuyer`)*
  - **network** — `type.includes('breeder') || type.includes('co_owner')`
  - **care** — `type.includes('vet') || type.includes('groomer')`
  - **other** — none of clients/network/care match
  - default (no/blank group) — all
  Set `baseFilter` to the chosen predicate. Keep the existing Type/Waitlist dropdown filters, search, columns, and row nav unchanged. Update title/subtitle per group.
- Overlap is expected and fine (a contact tagged buyer **and** vet appears under Clients and Care team) — same posture as today's buyer view. These are display filters over the one Contacts table (Data Model v3 §5.5); no schema change.

---

## Work Area 3 — Dogs buckets (`pages/dogs.js` + `pages/dogs.html`)

Toggle strip + bucketed rendering. Breeding and Not-breeding need in-tab section headings, so this rides on a small `listView` enhancement (Work Area 4).

- **`dogs.html`:** add a `.seg-tabs` nav above `#dog-list`:
  `All | Puppies | Breeding | Not breeding | External`, links `dogs.html?bucket=puppies` etc., active from `param('bucket')`.
- **Bucket → `DOG_STATUS`:**
  | Bucket | Statuses |
  |---|---|
  | All | (no status filter — current behavior, keeps default CSV/search) |
  | Puppies | `puppy` |
  | Breeding | `active_breeding` |
  | Not breeding | `retired_breeding`, `pet_home`, `deceased` |
  | External | `external_reference` |
- **`dogs.js`:** read `param('bucket')`, set `baseFilter` to the status test, and set `sort`/`groupBy` per bucket:
  - **Breeding** — `baseFilter: d => d.status === 'active_breeding'`; `groupBy` on `d.sex` with ordered groups `[male, female, unknown]` (labels from `SEX`, or the single letters M/F/U to match `dogs.js` `sexBadge`); within-group `sort` = **DOB ascending (oldest→youngest)**, undated rows last.
  - **Not breeding** — `baseFilter: d => ['retired_breeding','pet_home','deceased'].includes(d.status)`; `groupBy` on `d.status` with ordered groups `[retired_breeding, pet_home, deceased]` (labels from `DOG_STATUS`); within-group `sort` = DOB ascending *(order not specified by you — matching Breeding for consistency; easy to change)*.
  - **Puppies** — `baseFilter: d => d.status === 'puppy'`; no `groupBy`; `sort` = DOB **descending (youngest first)** *(unspecified — recommended)*.
  - **External** — `baseFilter: d => d.status === 'external_reference'`; no `groupBy`; `sort` = `call_name` A–Z.
  - **All** — no `baseFilter`; no `groupBy`; current behavior.
- Keep the **Roster CSV export** already on `dogs.js` (it exports visible rows across all groups) and the existing search + Type/Breed/Ownership dropdowns — they sit in the one shared toolbar above the groups.

---

## Work Area 4 — Shared `listView` enhancement (`assets/listView.js`) — do this first

Two **additive, backward-compatible** options (existing Contacts/Other-contracts callers unaffected when omitted):

1. **`sort`** — `(a, b) => number` comparator applied to `visibleRecords()` right before render. Used by Other contracts (1C) and every Dogs bucket (Work Area 3).
2. **`groupBy`** — `{ key: (record) => value, groups: [{ value, label }] }`. When present, `render()` partitions the sorted `visibleRecords()` into the declared groups **in array order**, and renders each non-empty group as a labeled section — `<h2>label <span class="muted">(n)</span></h2>` (match `reminders.js:67`) followed by that group's own `<table class="data">` — all under the single existing toolbar (search / filters / show-archived / CSV stay shared and apply across groups). When absent, behavior is exactly today's single table.

Keep `onRowClick` and the collapse-column toggle wiring working per group (wire after each group's table renders, or delegate on `tableWrap`). CSV "export visible" flattens across groups.

---

## Files touched
- `assets/listView.js` — add `sort` + `groupBy` (foundation).
- `pages/sales.js`, `pages/sales.html` — card view + inline contract link.
- `pages/stud-services.js`, `pages/stud-services.html` — card view + inline contract link.
- `pages/contracts.js`, `pages/contracts.html` — "Other contracts" filter + rename + recency.
- `pages/sales.html`, `pages/stud-services.html` — rename the third seg-tab label.
- `pages/contacts.js`, `pages/contacts.html` — group seg-tabs + predicates.
- `pages/dogs.js`, `pages/dogs.html` — bucket seg-tabs + `groupBy`/`sort`.

**Not touched:** any repo, `db.js`, `referenceRegistry.js`, `vocab.js`, schema/version. Zero migration.

## Suggested build order
1. `listView.js` `sort` + `groupBy` (foundation; verify Contacts still renders unchanged).
2. Contacts toggles (smallest; proves the seg-tab + `baseFilter` + `param` pattern).
3. Dogs buckets (exercises `groupBy`/`sort`).
4. Sales/Stud cards + inline contract linking + "Other contracts" + recency (largest; the breeding-card work).

## Verify (serve over HTTP, never `file://`)
- Sales/Studs: cards newest-first; "+ Link" attaches an existing contract and it appears with an ✕; ✕ unlinks; the same contract then disappears from the "Other contracts" tab and vice-versa (proves the single stored side). Multiple contracts on one sale all show.
- Other contracts: shows only contracts with no sale/stud link, newest-first.
- Contacts: each toggle filters to the right set; overlaps behave; search/dropdowns still work within a group.
- Dogs: Breeding splits M/F/U oldest→youngest; Not breeding splits retired→pet home→deceased; Puppies/External/All flat; CSV export still works.
