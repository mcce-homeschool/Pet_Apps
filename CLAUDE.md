# CLAUDE.md — Dog Breeding Management App

Local-first, static, multi-page records app for a dog breeding program. No backend, no build step. Hosted on GitHub Pages; data lives in browser.

## Read first, every session
Canonical model = v3. Stage 4 (Sales, Contracts, Stud Services) built. Stage 4.5 (this doc list's last two entries) reconciles Stage 4's gaps and adds scheduling/logistics. Stage 5 next.

- `docs/Data_Model_Architecture_Proposal_v3.md` — canonical data model, entities, storage, integrity rules. Current-state through Stage 4.5 (folds in Stage 4 + the Stage 4.5 additive fields/types/views); test-planning fields (§5.11) are marked designed-but-not-yet-built. Changelog in §16.
- `docs/Stage1_Stage2_Build_Brief_v2.md` — validation, screens, conventions, build order (Stages 1–2)
- `docs/Stage3_Build_Brief_v1-1.md` — Pairings & Litters schema, validation, screens, build order (Stage 3)
- `docs/Stage4_Revision_v2.md` — Sales, Contracts, Stud Services: the Stage 4 *plan* — schema, reference registry, linking rules
- `docs/Stage4_As_Built_v1.md` — Stage 4 *as-built*: what actually shipped, reconciled against the plan (file-by-file index + the gaps Stage 4.5 then closed). Read alongside the plan for Stage 4.
- `docs/Code_Orientation_Where_To_Fix.md` — symptom → file map across the whole built app; use this before searching blind
- `docs/Sample_Data_and_Reset_Brief_v2.md` — sample data packet + reset/clear behavior across all Stage 1–4.5 tables/fields
- `docs/Test_Planning_and_Vocabulary_Addendum_v1.md` — `planned_tests`/`preferred_tests` fields, independent of stage sequencing
- `docs/Dog_Breeding_App_Requirements_Discovery-1.md` — original requirements discovery (background/vision; scope superseded by the docs above)
- `docs/Stage4.5_Reconciliation_and_Logistics_Addendum_v1.md` — reconciles Stage 4's CSV/`governingContract`/sample-data gaps, folds in Scheduling & Logistics (`event_end_date`, `related_contact_id`, `boarding`/`placement` catalog types, Location/Status Board, Upcoming Deliverables), the current as-built state for all of that

These docs are source of truth. Conflict → stop and flag, don't diverge silently. Undocumented decision → ask, don't invent.

## Scope: Stages 1–4.5 complete; Stage 5 next
Built: Dogs, Contacts, Kennels, Import/Export (1–2); Pairings, Litters (3); Sales, Contracts, Stud Services (4, buyer merged into Contact — no Buyer table); Event CSV/StudService CSV import, `governingContract` UI, Location/Status Board, Upcoming Deliverables, Scheduled Placements report, `boarding`/`placement` event types (4.5).
Stage 5 (dashboard, advanced breeder tools, COI/genetic analysis, reminder engine) is next and NOT started — don't assume any of it exists yet; treat it the way Stage 4 used to be treated here.
Photos/attachments remain descoped (no `attachments` table, `attachmentRepo`, Photos tab, thumbnails) — see data model v3 §12 for the deferred reintroduction path if that ever changes.

## Architecture non-negotiables
- Multi-page static: one `.html` per section, shared JS (`nav.js`/`db.js`/repos). No SPA router.
- ES modules over HTTPS. Serve via `python3 -m http.server` or `npx serve` — never `file://` (CORS-blocks module imports).
- No CDN deps — vendor everything into `/vendor`, load by relative path. Must work offline after first load.
- Strict layering: pages → repos → Dexie. Pages never call `db.*` directly.
- One thin repo per entity: `getById`, `getAll({includeArchived})`, `create`, `update`, `archive`, `hardDelete`. New entity = new repo + page; don't touch existing ones.

## Two decisions — do not re-litigate
- One `Dog` table for breeding stock, puppies, external dogs. Life-stage change = `status` update on same record, never a new record.
- One `Event` table for all dated history (polymorphic `subject_type`/`subject_id`), no per-type tables. JS module named `HistoryEvent`/`LogEntry` — never `Event` (DOM collision).

## Data conventions
- `id`: `crypto.randomUUID()`, client-side. No auto-increment.
- Soft delete only (`is_archived`). Never cascades, never destroys history.
- Date-only fields (`date_of_birth`, `event_date`, …) as `YYYY-MM-DD` strings, compared lexicographically. Only `created_at`/`updated_at` are full ISO.
- Dexie schema additive only **starting at first real release**: new tables → new `db.version(N).stores({...})`, never edit a shipped version block. Pre-release, all nine Stage 1–4 tables live in a single collapsed `version(1)` block (per `Stage4_Revision_v2.md` §2/decision 3) — there's no real data yet to protect, so that block can still be edited directly until the first real release ships.
- Pickers exclude archived by default (toggle to include). Status/type = colored badges.

## Referential integrity
- Driven by `referenceRegistry.js` (declared list of FKs pointing at each entity).
- Hard delete blocked if any reference exists — archive only. The blocking message is generated entirely from the registry, so it always matches whatever tables currently exist in the schema — no stage-specific carve-out to maintain by hand.
- One canonical direction per relationship; the reverse is always a derived query, never a stored back-pointer (see `Stage4_Revision_v2.md` §2 and `Code_Orientation_Where_To_Fix.md` invariant #1).

## CSV import
- Match-or-create by natural key, never UUID. Every import is dry-run preview (create/update/needs-review) before commit.
- Keyless/partial-key rows → always "needs review," never auto-matched or silently created. Name match case-insensitive + trimmed; DOB exact.

## Working style
- Focused, mechanical changes. Design-decision-adjacent change → surface it, invite pushback before implementing.
- Docs are living references with a changelog section, not delta-only.
- Build order per brief: schema → repos → Dog List/Detail → Events, before completeness features.