# Wizard Runtime Spec — v1
### The guided first-run tour: coach-marks, step pointer, per-page hook

**How to use this doc:** this is **Phase 5** of the first-run guided-tutorial project —
the "hand off to the wizard-runtime spec" step named by
`Tutorial_Sample_Data_Coverage_Spec_v1.md` §10 and consumed from
`Tutorial_Coverage_Matrix_v1.md` §F ("the tour spine"). That project deliberately did
**not** design the runtime; this doc does. Read alongside `Tutorial_Coverage_Matrix_v1.md`
(the frozen step spine + per-section anchor/expandable data this doc's step catalog is
authored from) and `docs/End_State_Design_and_Maintenance_Guide.md` (module conventions,
page catalog, first-run flow). This is a **new feature**, not a reconciliation pass — it
adds two small modules and no schema.

**Premise:** the tour is a pure UI/state feature. It reads existing records through
existing repos (never writes to app data) and persists its own progress the same way
`kennelSetup.js`/`sampleDataUI.js` do — `localStorage` via `settings.js`. No Dexie table,
no schema version touch, no `referenceRegistry.js` entry.

---

## 0. Scope

**In:**
- A **spotlight coach-mark overlay**: dim the page, highlight the real target element,
  anchor a tooltip with the step's copy and Back / Next / Skip controls.
- A **step pointer** that survives full-page navigation (this is a multi-page app, no
  SPA router) — persisted in `localStorage`, resumed by every page's own bootstrap.
- A **step catalog**: the flat, ordered list of stops transcribed from
  `Tutorial_Coverage_Matrix_v1.md` §B/§F, each with a target selector and copy.
- **Wizard-driven navigation** between hub-level stops (the tour clicks "Next" for the
  user across a hub boundary; within a page, the user drives expand/collapse and the
  wizard reacts to what's already open).
- **Trigger + re-entry:** auto-offered once right after the Thornfield sample seed loads;
  a persistent "Take the tour" entry for replay.
- **Thornfield-seed gating:** the tour is only offered/runnable while the active dataset
  is the seeded sample packet (checked via the existing sample-data manifest).

**Explicitly deferred (doors cut in §12, not built):**
- Driving modals open automatically (event/expense/puppy forms, prompt chains). The tour
  points at the *button* that opens them and names what's inside, it does not open them.
- Running against real (non-sample) data with generic "teach from control" fallbacks.
- A second, different tour (e.g. a "what's new" post-launch tour) — this is one tour, one
  spine.
- Per-user analytics on tour completion/drop-off.

---

## 1. Resolved architecture decisions (recap, so the "why" isn't re-litigated)

Four load-bearing calls, made before drafting so the rest of this doc has a spine:

1. **Trigger: auto-offer once + persistent re-entry.** The tour is offered immediately
   after the first-run sample-data seed loads (folds into `app.js`'s existing
   `firstRunFlow()`, skippable), plus a "Take the tour" row in the nav's **More** menu so
   it can be replayed any time the Thornfield seed is active.
2. **Coach-mark mechanic: spotlight overlay**, hand-rolled (no CDN, per the architecture
   non-negotiables) using the CSS box-shadow spotlight technique (§4) — dims everything
   except the real target element, tooltip anchored beside it.
3. **Step advancement: wizard-driven navigation.** Crossing a hub boundary navigates the
   browser (`location.href`) for the user; inside a page the user acts and the wizard
   reacts (§5).
4. **Data dependency: requires the Thornfield seed.** The tour's anchors are specific
   sample records (Juniper, the Autumn litter, Cedar's open sale, …) with no equivalent
   guarantee on real data, so it is hidden/disabled whenever the sample packet isn't the
   active dataset (§6.3).

---

## 2. State model

### 2.1 New `settings.js` keys (localStorage, no IndexedDB — app-level UI state per
`CLAUDE.md`'s data conventions and the existing `settings.js` header comment)

```
wizardStatus:     'kennelOS.wizardStatus'      // 'unseen' | 'active' | 'dismissed' | 'completed'
wizardStepIndex:  'kennelOS.wizardStepIndex'   // integer index into WIZARD_STEPS, always current
```

- `wizardStepIndex` is written on every advance/retreat regardless of status, so pausing
  mid-tour (Skip, or just navigating away) never loses the spot.
- Fresh install / before first offer: status is absent → treated as `'unseen'`.
- **No per-step "seen" ledger.** Unlike `nudgeState.js`'s per-dismissal ledger, the tour
  is strictly linear — one pointer, not a set. Simpler is correct here: there is exactly
  one tour and it either has a place-in-progress or it doesn't.

### 2.2 `data/wizardState.js` (new — the state/logic half, mirrors `kennelSetup.js`)

Pure functions, no DOM:

```js
export function isTourAvailable()       // Thornfield seed present AND not cleared (§6.3)
export function getWizardStatus()       // reads settings.js, defaults 'unseen'
export function getWizardStepIndex()    // reads settings.js, defaults 0
export function currentStep()           // WIZARD_STEPS[index], or null if out of range
export function stepsForPage(pageKey)   // WIZARD_STEPS filtered to one page, in order
export function startWizard()           // status='active', index=0
export function advanceWizard()         // index++, clamped; index at end -> completeWizard()
export function retreatWizard()         // index--, clamped at 0
export function dismissWizard()         // status='dismissed' (index untouched — §2.1)
export function completeWizard()        // status='completed', index=0 (finishing implies "from the top" on replay)
export function restartWizard()         // status='active', index=0 (explicit re-entry action)
```

`WIZARD_STEPS` itself lives in a sibling data file, `data/wizardSteps.js` (§3) — kept
separate from the logic module so the (long, mechanical) step array doesn't bury the
handful of state functions above it, same split as `vocab.js` (data) vs. the repos that
read it (logic).

### 2.3 `assets/wizardUI.js` (new — the DOM/UI half, mirrors `kennelSetupUI.js`)

```js
export function maybeOfferWizardStart()   // called once from app.js after seeding choice
export function renderWizardMenuEntry()   // injects "Take the tour" into nav's More menu
export function runWizardStep()           // called from app.js boot on every page load
```

`runWizardStep()` is the per-page hook (§7) — it is the only function that touches the
spotlight overlay.

---

## 3. Step catalog

### 3.1 Schema

`data/wizardSteps.js` exports one flat array, ordered exactly as
`Tutorial_Coverage_Matrix_v1.md` §F (hub order) and §B (in-hub order within each hub).
Each element:

```js
{
  id:          'today-reminders',      // stable string id (hub-slug), never array position
  hub:         'Today',                // matches nav.js NAV_ITEMS label, for the progress chrome
  page:        'today.html',           // file name only (bare, no path/prefix — resolved like nav.js's HUB_CHILDREN)
  selector:    '[data-card="reminders"]', // CSS selector for the coach-mark target on that page
  beforeShow:  { openCard: 'reminders' }, // optional — see §4.3; omit if the target is already visible
  title:       'Reminders',
  body:        'Every event with a reminder date shows up here, bucketed overdue / due soon / upcoming. Snooze just edits the date — there is no separate snooze field.',
  isHubEntry:  true                    // true for a hub's first step — drives the "Next: Dogs →" button copy (§5)
}
```

- `selector` targets a real, already-rendered element — usually a `data-card`, a
  `data-*` hook already in markup (list rows, badges), or a stable class the page ships
  (`.card-toggle-btn`, `.nav-link`). No new `data-testid`-style attributes are added
  purely for the tour; if a step's target has no stable hook yet, add one real
  `data-wizard="…"` attribute at that element in the page's own file (see §7's "one hook
  per stop" rule) rather than a brittle text/position selector.
- `body` is written from the coverage matrix's "what the tour teaches here" column
  (§3.1 of the coverage spec) — one idea per stop, same discipline the spec already
  enforced.
- No `anchorRecord` field: the copy names the anchor inline (as in the example above,
  "Juniper", "the Autumn litter") because it reads better in a tooltip than a separate
  structured field would render. The record itself doesn't need to be looked up at
  runtime — the seed is deterministic (coverage spec §2.6), so the copy can hard-name it.

### 3.2 Where the ~80 rows come from

This spec does not re-transcribe every row of `Tutorial_Coverage_Matrix_v1.md` §B — that
table's **Anchor record** and **Expandable?** columns already carry the content each step
needs; authoring `WIZARD_STEPS` is a mechanical pass over that table in §F's order, one
element per matrix row (rows marked "teach-from-control" in the coverage spec §7/D3 get a
step whose `body` says so explicitly and whose `beforeShow` may open the relevant
dropdown, rather than being skipped — the tour spine visits every planned stop). Two more
worked examples, spanning the three `beforeShow` cases (§4.3):

```js
// A step needing no reveal — the target is already on-screen.
{ id: 'dogs-recorded-coi', hub: 'Dogs', page: 'dog.html?id=<juniper>',
  selector: '[data-section="recorded-coi"]',
  title: 'Recorded COI',
  body: 'This is a user-attested value, never computed by the app — see the method and source recorded beside it.' }

// A step whose target is behind a collapsed card.
{ id: 'breeding-show-more', hub: 'Breeding', page: 'breeding.html',
  selector: '.pagination-more', beforeShow: { openCard: 'pairings' },
  title: 'Show more', body: 'Six pairings are seeded — one more than fits on the first page.' }

// A step that only points at an entry point (a modal it will not force open — §0/§12).
{ id: 'dogs-timeline-add', hub: 'Dogs', page: 'dog.html?id=<percy>',
  selector: '[data-add-event]',
  title: 'Logging history', body: 'Every dated fact — a vet visit, a boarding stay, a note — goes through this one button. Try it: a span event (like Percy’s boarding stay above) has both a start and an end.' }
```

The `page` field for detail pages carries a placeholder id comment (`<juniper>`) in this
spec; the real `WIZARD_STEPS` file resolves it to the seeded id at *build* time by reading
it from `sampleData.js`'s manifest constants (the same named exports the seed itself
uses), never by re-querying the database at runtime — keeps the catalog a static import,
consistent with `vocab.js`.

---

## 4. Coach-mark rendering (`assets/wizardUI.js`)

### 4.1 The overlay

One `.wizard-overlay` div, position `fixed`, full-viewport, mounted/removed the same way
`ui.js`'s `mountModal` mounts/removes `.modal-overlay` (append to `<body>`, remove on
advance/dismiss — no persistent DOM between steps, rebuilt fresh each time so a page
navigation or a DOM change between steps never leaves a stale reference).

### 4.2 The spotlight

No cutout mask, no SVG, no 4-div letterbox — the standard **CSS box-shadow spotlight**:
the target element itself gets `position: relative; z-index: 10001;` plus
`box-shadow: 0 0 0 9999px rgba(0,0,0,.6);` (a shadow spread far larger than any viewport,
which browsers clip to the viewport automatically) and a thin accent outline. The overlay
div sits at `z-index: 10000` as a transparent click-blocker (so the user can't act ahead
of the step — the target itself remains clickable through its own stacking context, which
is what lets an in-page step like "click here to add an event" work if a future step ever
needs it, though §0 keeps that out of v1). This avoids maintaining any cutout-geometry
math — the technique already used nowhere else in the app, but it is ~6 lines of CSS, no
new file needed (added to `assets/app.css`, §9).

### 4.3 Revealing the target — `beforeShow`

Three cases, in order of how much `wizardUI.js` does:

1. **Nothing** (`beforeShow` omitted) — the target is already visible; scroll it into view
   (`scrollIntoView({ block: 'center', behavior: 'smooth' })`) and spotlight it.
2. **`{ openCard: '<key>' }`** — find `[data-card="<key>"] .card-toggle-btn`; if its card
   body is currently `hidden`, dispatch a `click` on it. This reuses `ui.js`'s existing
   delegated card-toggle listener verbatim — no new API on the card component, the wizard
   just drives the same control a user would click.
3. **A missing target** (selector matches nothing — e.g. the user manually collapsed
   something the wizard didn't expect, or navigated to a stale step after data changed) —
   `wizardUI.js` degrades to a **centered, non-spotlit tooltip** with the same copy and
   controls, no highlight ring. Never throws, never silently skips a step: the copy still
   teaches the idea even if the visual pointer can't land. This is the one runtime
   fallback the spec requires (§13 acceptance).

### 4.4 The tooltip

A `<div class="wizard-tooltip">` positioned via `getBoundingClientRect()` of the (now
spotlit) target: prefer below the target, flip above if it would overflow the viewport
bottom, clamp horizontally so it never runs off either edge. Contents:
- Step counter — `"Step {n} of {total}"` (from `WIZARD_STEPS.length`, computed, never
  stored).
- `title` + `body` (from the catalog).
- Controls: **Back** (hidden on step 0), **Next** (label becomes `"Next: {hub} →"` when
  the *next* step's `isHubEntry` is true, else just `"Next"`), **Skip tour** (calls
  `dismissWizard()`), and on the final step **Next** becomes **"Finish"** (calls
  `completeWizard()` and shows a short closing message via `ui.js`'s `alertModal`, in the
  same voice as the rest of the app's dialogs — not a special wizard-only modal style).

No separate close/X button distinct from "Skip tour" — one exit action, not two that could
disagree about what they persist.

---

## 5. Advancement & navigation

- **Next / Back within a page** (the next/previous step's `page` equals the current
  page): `advanceWizard()`/`retreatWizard()` update the persisted index, then
  `runWizardStep()` re-renders the overlay in place — no navigation.
- **Next / Back crossing a page** (different `page` value): update the persisted index
  first, *then* `location.href = <resolved page path>` (prefixed the same way `nav.js`'s
  `rootPrefix()` does, since the wizard, like nav, can be invoked from either `/` or
  `/pages/`). The destination page's own `app.js` boot calls `runWizardStep()` on load,
  reads the now-current index, and shows that step's coach-mark — the pointer, not an
  in-memory handoff, is what carries state across the reload.
- **The user free-navigates instead of clicking Next/Back** (clicks a different nav item,
  types a URL, uses browser back): the persisted index does not change. Landing on a page
  that isn't the current step's page means `runWizardStep()` finds no steps for `stepsForPage(pageKey)` matching the *current* index and mounts nothing — the overlay simply
  doesn't appear. A small floating **"Resume tour →"** pill (bottom-right, `position:
  fixed`, not part of the overlay) renders instead whenever `status === 'active'` but the
  current page isn't the pointer's page, so the tour is never silently lost, only quiet
  until the user asks for it back. Clicking the pill navigates to the pointer's page.
- This means the wizard never fights a manual click — it either matches where the user
  already is, or steps back into a corner and waits.

---

## 6. Trigger & re-entry

### 6.1 First offer

`app.js`'s existing `firstRunFlow()`:

```js
async function firstRunFlow() {
  const choice = await maybeShowFirstRunPrompt();
  if (choice !== 'seeded') { maybeShowKennelSetupPrompt(); return; }
  maybeOfferWizardStart(); // new — only reached on the 'seeded' branch
}
```

`maybeOfferWizardStart()` only prompts when `getWizardStatus() === 'unseen'` (so it never
re-nags after a Skip or Finish) — a small `confirmModal` ("Take a 2-minute guided tour of
Thornfield Kennels?" / "Start tour" / "Not now"). "Not now" calls `dismissWizard()` (status
`'dismissed'`, so it reads as "offered and declined," distinct from `'unseen'`, which is
what makes the re-entry menu item's label choice in §6.2 meaningful).

### 6.2 Re-entry

`renderWizardMenuEntry()` runs after `renderNav()` (same append-after-render pattern as
`renderKennelBanner()`) and, only when `isTourAvailable()`, appends one row to
`.nav-more-menu`: **"🧭 Take the tour"** (status `unseen`/`dismissed`) or **"🧭 Resume
tour"** (status `active`, index > 0) or **"🧭 Retake the tour"** (status `completed`).
Clicking it calls `startWizard()` (unseen/dismissed/completed) or leaves the pointer alone
and just navigates to it (active), then routes to the first/current step's page.

When `isTourAvailable()` is false (no Thornfield seed active), the row is omitted
entirely — not shown-disabled — consistent with the rest of the nav never showing dead
entries.

### 6.3 The Thornfield-seed gate (`isTourAvailable()`)

```js
import { getSampleDataManifest, wasSampleDataCleared } from './settings.js';
export function isTourAvailable() {
  return !!getSampleDataManifest() && !wasSampleDataCleared();
}
```

Same two calls `sampleDataUI.js` already uses to decide whether the "Clear Sample Data"
banner shows — the tour piggybacks on the exact same signal, so it can never disagree with
the app about whether Thornfield data is currently loaded. If the user clears sample data
mid-tour, the next `runWizardStep()` call (next page load) finds `isTourAvailable()` false
and tears down any active overlay/pill without changing `wizardStatus` — so reseeding
later resumes rather than restarts. `isTourAvailable() === false` is checked at the very
top of `runWizardStep()`, before anything else.

---

## 7. Per-page hook contract

One rule, applied uniformly: **`app.js`'s shared `boot()` calls `runWizardStep()`
unconditionally on every page**, the same as it already calls `renderSampleBanner()` /
`renderKennelBanner()`. No page-specific JS file (`dog.js`, `breeding.js`, …) imports or
calls anything wizard-related — the wizard is entirely a shell-level concern, exactly like
nav and the two existing first-run banners, and pages stay unaware it exists.

The one place an ordinary page file *can* be touched is markup: if a step's `selector`
needs a hook that doesn't already exist (§3.1), add a single `data-wizard="<id>"`
attribute to that element in its own page file — a plain attribute add, not new logic, and
not different in kind from the `data-card`/`data-add-event` hooks those pages already
carry for their own purposes.

`runWizardStep()` itself, in order:
1. `isTourAvailable()` false → tear down any wizard DOM, return.
2. `getWizardStatus() !== 'active'` → return (nothing to show).
3. `currentStep()` — if its `page` doesn't match the current page, render the "Resume
   tour" pill (§5) and return.
4. Otherwise: resolve `beforeShow` (§4.3), mount the overlay + spotlight + tooltip (§4).

---

## 8. Module map (new files)

| File | Role |
|---|---|
| `data/wizardState.js` | Status/index state machine over `settings.js`; `isTourAvailable()`. No DOM. |
| `data/wizardSteps.js` | The static, ordered `WIZARD_STEPS` array (§3) — data only, like `vocab.js`. |
| `assets/wizardUI.js` | Overlay/spotlight/tooltip rendering, the nav menu entry, the resume pill. |

`settings.js` gains the two keys in §2.1 (edit to an existing file, not a new one).
`app.js` gains two calls (`maybeOfferWizardStart()` in the seeded branch of
`firstRunFlow()`, `runWizardStep()` unconditionally in `boot()`) plus one import line each
for the new UI module. `assets/app.css` gains the overlay/spotlight/tooltip/pill rules
(§9) — no new CSS file.

---

## 9. CSS (added to `assets/app.css`, no new file)

Rule classes needed: `.wizard-overlay` (fixed, full-viewport, transparent, `z-index:
10000`), the spotlight state applied to the *target* element itself (`z-index: 10001;
position: relative; box-shadow: 0 0 0 9999px rgba(0,0,0,.6), 0 0 0 3px var(--accent) inset;`
— reuses the app's existing `--accent` custom property rather than a new color),
`.wizard-tooltip` (a `.modal`-adjacent look, reusing existing card/modal spacing tokens
rather than inventing a new visual language), `.wizard-resume-pill` (fixed, bottom-right,
rounded, small). No dark-mode-specific overrides needed beyond what `--accent`/`--border`
custom properties already resolve to, per the app's existing single-theme CSS variables.

---

## 10. Service-worker / precache — do not skip (per `CLAUDE.md`)

Three new files are added to the app's file set: `data/wizardState.js`,
`data/wizardSteps.js`, `assets/wizardUI.js`. Both are required at build time:

1. Add all three paths to `PRECACHE_URLS` in `KennelOS/sw.js`.
2. **Bump `CACHE_NAME`** (next `vN` after whatever `Stage4` last left it at).
3. `app.js` and `app.css` are *edited*, not renamed — no `PRECACHE_URLS` change for them,
   but the same `CACHE_NAME` bump already covers picking up their new content (one bump
   covers the whole change, not one per file).

Run the End-State guide's precache sanity check after this lands.

---

## 11. Build order

Console/state-testable work first, visuals after — same discipline as every stage brief.

1. **`settings.js`**: add the two keys + getter/setter pairs (§2.1).
2. **`data/wizardState.js`**: the state machine + `isTourAvailable()`. Verify by hand in
   the console (start/advance/retreat/dismiss/complete/restart, and the availability gate
   against a cleared vs. seeded dataset).
3. **`data/wizardSteps.js`**: transcribe `Tutorial_Coverage_Matrix_v1.md` §B/§F into
   `WIZARD_STEPS` (§3.2) — the largest single piece of work in this project, but
   mechanical, not designed.
4. **`assets/wizardUI.js`**: overlay + spotlight + tooltip against one hub first (Today),
   confirm `beforeShow.openCard` reveal works, confirm the missing-target fallback (§4.3)
   degrades cleanly.
5. **`app.js` wiring**: `maybeOfferWizardStart()` + `runWizardStep()` calls.
6. **Nav menu entry + resume pill** (§6.2, §5).
7. **Walk the full spine end to end** in a browser, hub by hub, confirming every step's
   selector resolves (or degrades per §4.3) and that crossing every hub boundary navigates
   correctly.
8. **Precache + `CACHE_NAME`** (§10). **Docs**: point `Tutorial_Sample_Data_Coverage_Spec_v1.md` §10's Phase 5 line at this doc as its output; add a short "First-run
   tour" mention to the End-State guide's first-run-flow section (§11-area, per its own
   header list).

---

## 12. Doors left open (future, not built)

- **Wizard-driven modals.** A step that needs a modal open (event form, litter cascade)
  currently only points at the button. A future pass could teach `wizardUI.js` a second
  `beforeShow` shape (`{ openModal: … }`) once there's a concrete need — deferred because
  every modal in the app is a different shape and forcing them open generically risks
  leaving one half-filled mid-tour.
- **Resume-across-devices / export.** The pointer lives in `localStorage`, so it's
  per-browser like every other setting here (`lastBackupDate`, `myKennelId`, …) — not
  carried by JSON backup/restore. Consistent with the rest of `settings.js`, not a gap
  specific to the wizard.
- **A second tour / tour picker.** The catalog format (§3.1) would support more than one
  named tour trivially (an extra `tourId` field, a second array), but nothing today needs
  it — one spine, one array.
- **Teach-from-control on real data.** §0 defers running the tour against non-sample data;
  if that's ever wanted, the natural extension is per-step `fallbackBody` copy used when
  `isTourAvailable()` is false rather than hiding the tour outright.

---

## 13. Acceptance checklist

- [ ] `settings.js` carries `wizardStatus`/`wizardStepIndex`; `data/wizardState.js`'s
      status machine matches §2.2 exactly (five states, one persisted index).
- [ ] `isTourAvailable()` reads the same two `settings.js` signals as `sampleDataUI.js`'s
      banner — never disagrees with it about whether Thornfield data is active.
- [ ] `WIZARD_STEPS` covers every row of `Tutorial_Coverage_Matrix_v1.md` §B in §F's
      order, including "teach-from-control" rows (with `body` copy saying so).
- [ ] The spotlight overlay dims everything but the live target; the box-shadow technique
      needs no cutout math and no new dependency.
- [ ] `beforeShow.openCard` reuses `ui.js`'s existing card-toggle delegated listener —
      no new API added to `cardShell()`.
- [ ] A missing-target step degrades to a centered non-spotlit tooltip, never throws,
      never silently disappears (§4.3).
- [ ] Crossing a hub boundary persists the new index *before* navigating; the destination
      page's own `runWizardStep()` call (via `app.js` boot, not a page-specific import)
      picks the step back up.
- [ ] Free navigation away from the tour's current page never changes the pointer; the
      "Resume tour" pill appears instead of a lost tour.
- [ ] First offer fires exactly once (`status: 'unseen'` → prompt), never again after a
      Skip or Finish; the nav's More-menu entry always reflects current status
      (Take/Resume/Retake) and disappears entirely when `isTourAvailable()` is false.
- [ ] No page file (`dog.js`, `breeding.js`, …) imports anything wizard-related — the
      hook lives only in `app.js`'s shared boot.
- [ ] `PRECACHE_URLS` lists all three new files; `CACHE_NAME` is bumped once for the
      whole change (§10).
- [ ] No IndexedDB table, no schema version touch, no `referenceRegistry.js` change —
      confirmed by diff review before merge.

---

## 14. What this doc does *not* change

No new Dexie table, no `.version(2)`, no `referenceRegistry.js` entry — the wizard reads
existing records for its copy (hard-named at catalog-authoring time, §3.1) and never
writes app data. No change to any repo. No change to `nav.js`'s declarative
`NAV_ITEMS`/`MORE_ITEMS` (the tour's menu row is appended by `wizardUI.js` after render,
the same way the kennel-name banner is). No change to any existing page's own JS beyond
the occasional single `data-wizard` attribute add for a target with no existing hook.
`Tutorial_Coverage_Matrix_v1.md` and `Tutorial_Sample_Data_Coverage_Spec_v1.md` stay the
source of truth for *what* the tour says and points at; this doc is only the *how*.

---

## Changelog
- **v1** — Initial wizard-runtime spec (Phase 5 of the first-run guided-tutorial
  project). Resolves the four open architecture questions the coverage spec deliberately
  left unanswered: auto-offer-once + persistent re-entry trigger, hand-rolled CSS
  box-shadow spotlight overlay (no CDN), wizard-driven hub navigation with a
  free-navigation "resume pill" escape hatch, and a hard Thornfield-seed gate reusing the
  sample-data manifest signal already in `settings.js`. Defines the state model
  (`data/wizardState.js` + two new `settings.js` keys), the step-catalog schema
  (`data/wizardSteps.js`, authored from `Tutorial_Coverage_Matrix_v1.md` §B/§F), and the
  rendering/hook contract (`assets/wizardUI.js`, called only from `app.js`'s shared boot —
  no page file becomes wizard-aware). No schema change.
