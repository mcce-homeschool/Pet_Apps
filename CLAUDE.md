# CLAUDE.md — Dog Breeding Management App (KennelOS)

Local-first, static, multi-page records app for a dog breeding program. No backend,
no build step. Hosted on GitHub Pages; all data lives in the browser (IndexedDB via
Dexie). The app is **built and in maintenance** — Dogs, Contacts, Kennels, Pairings,
Litters, Sales, Contracts, Stud Services, a polymorphic event log, reminders,
dashboard, analytics reports, CSV/JSON import-export, a read-only Companion
share-out (no-account buyer/partner links; see the End-State guide §20), and the
online-only Dropbox sync + KennelAssistant helper mini-app (guide §26) all ship.
Work now is incremental enhancement and fixes, not stage builds.

## Read first, every session

**`docs/End_State_Design_and_Maintenance_Guide.md` is the map** — the single
current-state reference. Read it first. It consolidates the architecture, data model,
Dexie schema, module map, invariants, and "how do I change X" recipes, and it always
reflects what the app **is today**. Start there.

Supporting references, in order of usefulness:
- `docs/Data_Model_Architecture_Proposal_v3.md` — field-level / rule-level authority
  for the data model when a detail matters. (The code is the ultimate authority; where
  a doc and the code disagree, the **code wins** and the doc is what gets fixed.)
- `docs/Code_Orientation_Where_To_Fix.md` — symptom → file map; use it before
  searching blind.

Everything else in `docs/` (the `StageN_*` briefs and addenda) is **historical
record** — the finest-grained source of original intent, kept for archaeology. Do not
treat them as current-state, and do not re-derive today's scope from them; the
End-State guide supersedes them.

Undocumented decision → ask, don't invent. Design-decision-adjacent change → surface
it and invite pushback before implementing.

## ⚠️ Update the End-State guide when you change the app

The End-State guide is only useful if it stays true. **After any structural change,
update the relevant section(s) of `docs/End_State_Design_and_Maintenance_Guide.md` in
the same change** so the next session starts from the truth. Update it when you:

- add/remove/rename a table, index, or field in `data/db.js`;
- add or change a foreign key or a `referenceRegistry.js` entry (this is the one that
  gets forgotten — a new FK must land in **both** the registry and the guide's data-model
  + schema sections);
- add or change an entity, repo, page, event type, or controlled vocabulary;
- change a documented invariant, relationship direction, or a component's behavior.

Doc-only edits and pure-internal refactors that leave every stated fact true don't
need a guide edit — but **if in doubt, update it.** Keep the guide's field tables,
schema block, and section prose all consistent with each other and with the code.

## ⚠️ Service-worker cache — never skip this

This is the single most-forgotten step. The app is an offline PWA with a **cache-first**
service worker, so an installed client only picks up changed files when the cache name
changes. **Whenever you add, rename, or remove any app file** (`.html`/`.js`/`.css`,
an icon, a `vendor/` or `resources/` asset):

1. Update the `PRECACHE_URLS` list in `KennelOS/sw.js` to match (add/rename/remove the
   entry). `cache.addAll` is atomic — one missing or misnamed path fails the whole
   install and silently breaks offline.
2. **Bump `CACHE_NAME`** in `KennelOS/sw.js` (e.g. `kennelos-shell-vN` → `vN+1`).
   Without this, clients keep serving the old cache and never see your change.
   **Only bump after the user confirms there are no more changes** — do it as the
   final step of a batch of related edits, not once per individual file edit, so a
   multi-edit session ships as a single cache rollover rather than a churn of bumps.
   (`PRECACHE_URLS` edits in step 1 are not optional and still land with the edit
   that changes the file set — this deferral is about `CACHE_NAME` only.)

There is a sanity check (a short Python snippet) in the End-State guide's invariants
section that lists any app file missing from the precache and any precache entry with
no file on disk — run it if you touched the file set. Editing an *existing* file's
contents still needs the `CACHE_NAME` bump so clients re-fetch it — again, as the
final confirmed step.

## Architecture non-negotiables
- Multi-page static: one `.html` per section, shared JS (`nav.js`/`db.js`/repos). No SPA router.
- ES modules over HTTP(S). Serve via `python3 -m http.server` or `npx serve` — never `file://` (CORS-blocks module imports).
- No CDN deps — vendor everything into `KennelOS/vendor/`, load by relative path. Must work offline after first load.
- Strict layering: pages → repos → Dexie. Pages never call `db.*` directly, and never touch `localStorage` (go through a repo / `settings.js`).
- One thin repo per entity: `getById`, `getAll({includeArchived})`, `create`, `update`, `archive`, `hardDelete`. New entity = new repo + page; don't reshape existing ones.

## Two decisions — do not re-litigate
- One `Dog` table for breeding stock, puppies, external dogs. Life-stage change = `status` update on the same record, never a new record.
- One `Event` table for all dated history (polymorphic `subject_type`/`subject_id`), no per-type tables. Its JS module is named `HistoryEvent`/`eventRepo` — **never a bare `Event`** (DOM collision).

## Data conventions
- `id`: `crypto.randomUUID()`, client-side. No auto-increment.
- Soft delete only (`is_archived`). Never cascades, never destroys history.
- Date-only fields (`date_of_birth`, `event_date`, …) are `YYYY-MM-DD` strings, compared lexicographically. Only `created_at`/`updated_at` are full ISO.
- **Schema versioning:** all tables currently live in one collapsed `db.version(1)` block. It is still editable **only because nothing has shipped that needs migration** — reconcile any change with Reset App + re-seed. At the first real release this changes permanently: from then on schema changes are **additive only** — new tables/indexes go in a new `db.version(N).stores({...})` block and shipped blocks are never edited again.
- Only fields you query/filter/sort on are indexed; every other field still persists and rides the JSON backup. Pickers exclude archived by default (toggle to include). Status/type = colored badges sourced from `data/vocab.js` (dropdowns and badges both read from it, so they never drift).
- Escaping: `reportView` `value` functions return plain text (framework escapes); `listView` `cell` functions and any hand-built innerHTML must `esc()` every user value.

## Referential integrity
- Driven by `referenceRegistry.js` (a declared list of every FK pointing **at** each entity). **When you add an FK anywhere, add its line to the registry** or hard-delete will silently allow orphaning.
- Hard delete is blocked if any reference exists — archive only. The blocking message is generated entirely from the registry, so it always matches whatever tables currently exist; no hand-maintained carve-out.
- One canonical direction per relationship; the reverse is **always a derived query, never a stored back-pointer**. Need the reverse of X? Write a query — don't add a mirror field.

## CSV import
- Match-or-create by natural key, never UUID. Every import is a dry-run preview (create/update/needs-review) before commit.
- Keyless/partial-key rows → always "needs review," never auto-matched or silently created. Name match is case-insensitive + trimmed; dates exact. Relationship columns resolve against existing records only — an unresolved name is flagged, never invented.

## Local dev & verification
- `cd KennelOS && python3 -m http.server 8000` (or `npx serve`), open `http://localhost:8000/` — never `file://`.
- No build, test runner, or linter. Verification = `node --check <file>.js` on anything you touched, serving locally and exercising the flow in a browser, and the precache sanity check above. State resets via **Reset App to Start**; sample data via the first-run prompt or Import/Export.
