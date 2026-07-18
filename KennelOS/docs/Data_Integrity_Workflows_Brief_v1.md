# Data Integrity & Workflow-Streamlining Brief v1

**Status:** design agreed, not yet built. Hand-off spec for implementation.
**Branch:** `claude/data-integrity-workflows-y84d4s`
**Goal:** reduce the number of places a user has to *remember* to keep tables aligned. Two mechanisms: (A) capture data at the point of entry the user is already on, and (B) surface derived nudges computed from record state at app launch. Nothing here auto-mutates records — every derived prompt is a user-confirmed action.

---

## 0. Guardrails (do not violate)

These are the project's existing non-negotiables (`CLAUDE.md`); everything below stays inside them.

- **Strict layering:** pages → repos → Dexie. Pages never call `db.*` directly. New behavior goes in a repo method or a small `data/` module.
- **Additive schema only.** Every new field below is a **plain, unindexed** field. Dexie does not declare unindexed fields, so **no `db.js` change and no new `db.version(N)` block is required** for any of them (same posture as the Stage 5 plain-field adds `Dog.recorded_coi` / `Event.reminder_dismissed`). Do **not** add an index unless a query needs one — none here does.
- **No new `referenceRegistry.js` entries.** No new FK relationships are introduced; the one new link (stud→pairing) already exists.
- **Soft delete only, one canonical direction per relationship.** The reverse is always a derived query.
- **Whole-record export.** New plain fields ride along in backup/export automatically — no `importExport.js` field list to update for them. (The dismissal ledger in §2 is deliberately **not** exported — see there.)
- Keep changes focused and mechanical. Reuse existing helpers (`vocabOptions`, `badge`, `descriptor`, `openEventForm`, `field`, `row`).

---

## 1. Decisions ledger (what was agreed)

| # | Feature | Mechanism | Depends on |
|---|---------|-----------|------------|
| 1 | Collect **disposition** at "add puppy from litter" | A — point-of-entry | — |
| 2 | Stud-service **status nudges**: sent→`in_progress`, returned→`completed` | B — derived nudge | nudge engine (§2) |
| 3 | **Promote-lifecycle nudge** for kept puppies, per-kennel configurable | B — derived nudge | nudge engine (§2), Kennel fields (§3) |
| 4a | **"Add heat cycle"** action on the Breeding hub | A — point-of-entry | — |
| 4b | Heat-cycle conclusion → **prompt to create pairing** | B — derived nudge | nudge engine (§2) |
| 5 | Inline **"＋ New contact"** in contact pickers | A — point-of-entry | — |
| 6 | **"Available puppies" feed** on home + "Add sale" deep-link | A — point-of-entry | `sale.js` `?dog_id=` |
| 7 | Stud-service `completed` → **prompt to create pairing** (auto-dismisses via `pairing_id`) | B — derived nudge | nudge engine (§2) |
| — | **Away-board de-dup:** board reads in-person stud services directly | derived query union | `StudService.type` (§3) |

**Two new plain fields:** `StudService.type` and three on `Kennel` (§3).
**One new shared module:** the derived-nudge engine + dismissal ledger (§2).

---

## 2. Shared infrastructure: derived-nudge engine + dismissal ledger

Features 2, 3, 4b, and 7 are all "compute a prompt from record state; show it at launch; let the user act or dismiss." Build the shared piece **once**, then each feature is a small rule.

### 2.1 What exists today (reuse, don't reinvent)
- The Stage 5 reminder engine (`eventRepo.getPendingReminders()`, `today.js` `renderReminders()`) is **manual only** — it surfaces a `reminder_date` a *user typed onto an event*. It is **not** a rule engine. Do not overload it. Derived nudges are a separate, parallel surface.
- Nudges render in their **own section** on `today.js` (the home page), above or beside Reminders. Reuse the card/row markup style already in `today.js`.

### 2.2 Dismissal ledger — decision (b)
A computed nudge has no backing row to store "dismissed" on. So add a small **dismissal ledger** keyed by a synthetic nudge id.

- **Storage:** `localStorage`, new module `data/nudgeState.js` (mirror `data/settings.js` conventions — namespaced keys, a `clearAll` for App Reset). **Rationale:** dismissals are device-local UI state, not portable domain data; keeping them out of the exported dataset means restoring a backup on a new device doesn't carry stale "I dismissed this" flags. Add its key(s) to the `appReset.js` / `settings.clearAllSettings()` sweep so Reset App clears them.
- **Shape:** `{ [nudgeKey: string]: dismissedAtISO }`. A nudge is suppressed if a dismissal exists for its key.
- **API:** `isDismissed(key)`, `dismiss(key)`, `clearAll()`.

### 2.3 Nudge keys (stable, per-condition)
| Nudge | Key | Re-arm behavior |
|-------|-----|-----------------|
| Promote puppy (3) | `promote:<dogId>` | permanent once dismissed (user decided not to promote this dog) |
| Stud → in_progress (2) | `studstatus:<studId>:in_progress` | permanent (or moot once status advances) |
| Stud → completed (2) | `studstatus:<studId>:completed` | permanent (or moot once status advances) |
| Heat → pairing (4b) | `heatpair:<heatEventId>` | permanent per heat event |
| Stud → pairing (7) | `studpair:<studId>` | **auto-clears** when `pairing_id` fills (link is the done-signal); ledger only used on explicit "not now" |

Snooze / date-based re-arm is a **v2** refinement — v1 dismiss is "quiet until the condition materially changes," which the per-condition keys above already approximate.

### 2.4 Engine shape
`data/nudges.js` exports `async function computeNudges()` → array of:
```
{ key, title, detail, subjectHref, actions: [{ label, run: async () => {...} }] }
```
Each rule below produces zero or more of these. `today.js` filters out `isDismissed(key)`, renders the rest, wires each action button, and offers a "Dismiss" that calls `dismiss(key)` + re-renders. Rules read via repos only.

---

## 3. Schema additions (plain fields, no `db.js` change)

### 3.1 `StudService.type` — new vocab + field
Add to `data/vocab.js`:
```js
// Was this a physical stay or a shipment? Sibling to `direction`. The fine-
// grained method (natural / ai_chilled / …) already lives on the linked Pairing
// (pairing_id), so the stud record only needs the coarse in-person/AI split —
// enough to tell the away-board whether a dog physically travelled.
export const STUD_SERVICE_TYPE = [
  { value: 'in_person', label: 'In person', badge: 'badge-green' },
  { value: 'ai',        label: 'AI / shipped', badge: 'badge-neutral' }
];
```
- Add `type` to the `stud-service.js` edit form (a `<select>` via `vocabOptions(STUD_SERVICE_TYPE, s.type, 'Select…')`), to the view render, and to the save payload. **Not required** (`REQUIRED_FIELDS` in `studServiceRepo.js` unchanged) — existing/imported records may have `type` unset, which reads as "unknown" and simply produces no away-board row.
- Optionally accept `type` in the StudService CSV import column list (`csvImport.js`) — nice-to-have, not required for v1.

### 3.2 `Kennel` promote-nudge config — three fields
Plain fields on the Kennel record (per-kennel, resolved via `dog.kennel_id`):
```
Kennel.promote_nudge_enabled       // boolean, default false (opt-in; no nagging out of the box)
Kennel.promote_age_male_months     // number, suggested default 6  (shown, editable)
Kennel.promote_age_female_months   // number, suggested default 12 (shown, editable)
```
- Add a small **"Lifecycle nudges"** section to the Kennel edit form (`pages/kennels.js` / `kennels.html`): an enable checkbox + two month inputs. Persist via `kennelRepo.update`.
- Wire into `kennelRepo` create defaults if it seeds a blank template (leave unset = disabled).

---

## 4. Feature specs

### 4.1 (Idea 1) Disposition at "add puppy from litter"
- **File:** `assets/puppyForm.js`. The field already exists on Dog (`DISPOSITION`: undecided / keeping / available / placed) and on the Dog detail form; it's just not collected at birth.
- `openAddPuppyForm` (single): add a Disposition `<select>` (`vocabOptions(DISPOSITION, base.disposition || 'undecided')`), include `disposition` in the `dogRepo.create` payload.
- `openAddPuppiesForm` (bulk): add **one shared** Disposition select applied to every puppy created in that batch (default `undecided`); editable per-dog later on the record.
- **Why it matters:** feeds the promote nudge (§4.3) and the available feed (§4.6).
- **Acceptance:** a puppy added from a litter persists the chosen disposition; default is `undecided`.

### 4.2 (Idea 2) Stud-service status nudges
- **Rule (`data/nudges.js`):** for each non-archived stud service:
  - `sent_date` set and `<= today` and `status === 'arranged'` → nudge **"Mark in progress?"** (key `studstatus:<id>:in_progress`), action sets `status: 'in_progress'` via `studServiceRepo.update`.
  - `returned_date` set and `< today` and `status ∈ {arranged, in_progress}` → nudge **"Mark completed?"** (key `studstatus:<id>:completed`), action sets `status: 'completed'`.
- Never both at once for the same record if returned has already passed — prefer the `completed` nudge.
- **Acceptance:** advancing the status (via the nudge or manually) makes the nudge disappear on next compute; "Dismiss" suppresses it via the ledger.

### 4.3 (Idea 3) Promote-lifecycle nudge (per-kennel, opt-in)
- **This is a nudge to *decide*, never an auto-promote.**
- **Rule:** for each `status === 'puppy'`, non-archived dog with `disposition === 'keeping'`:
  1. resolve the dog's kennel via `dog.kennel_id`; if none, or that kennel has `promote_nudge_enabled !== true`, **skip silently**.
  2. compute age in months from `date_of_birth` to today (use `dateUtils.js`; add a month-diff helper if absent).
  3. threshold = `promote_age_male_months` (sex male) or `promote_age_female_months` (sex female).
  4. if age ≥ threshold → nudge **"{call_name} is old enough — promote to active breeding?"** (key `promote:<dogId>`).
- **Actions:** primary = set `status: 'active_breeding'` (+ `status_date: today`) via `dogRepo.update`; secondary = "Dismiss" (permanent for that dog).
- **Absence = silence:** no kennel, disabled, blank thresholds, or non-`keeping` disposition all mean no nudge. This keeps it fully opt-in.
- **Acceptance:** with a kennel's nudge enabled and thresholds set, a `keeping` puppy past the age produces exactly one prompt; disabling the kennel setting removes it.

### 4.4 (Idea 4a) "Add heat cycle" on the Breeding hub
- **File:** `pages/breeding.js` (the consolidated Breeding hub). `heat_cycle` is an existing span event type (`EVENT_TYPES`, `subjects: ['dog']`, `duration: 'span'`).
- Add a **"Log heat cycle"** button. Because the hub is organized by pairing, the dam isn't always in context — the button opens a minimal **female-dog picker** (breeding-eligible females: `sex === 'female'`, not archived), then calls:
  ```js
  openEventForm({ subjectType: 'dog', subjectId: damId, prefill: { event_type: 'heat_cycle' }, onSaved });
  ```
  (`assets/eventForm.js` already supports `prefill.event_type`.)
- **Acceptance:** a heat_cycle event is created against the chosen dam without leaving the Breeding page.

### 4.5 (Idea 4b) Heat conclusion → prompt to create pairing
- **Rule:** for each `heat_cycle` event with `event_end_date` set and `< today` (concluded), whose subject dam has **no non-terminal pairing opened since the heat started** → nudge **"{dam} finished a heat — record a pairing?"** (key `heatpair:<eventId>`).
- **Dedup:** suppress if a pairing exists with `dam_id === subjectId`, `status ∉ {cancelled, failed}`, created/planned on/after the heat's `event_date`. Shared with §4.7 so only one pairing prompt shows per breeding.
- **Action:** deep-link to the new-pairing form pre-filled with the dam. Extend `pages/pairing.js` new-mode to also read a `dam` query param (it already reads `stud_service`): `pairing.html?new=1&dam=<dogId>` → `ctx.draft.dam_id = dam`.
- **Acceptance:** a concluded heat with no matching pairing shows the prompt; creating a pairing for that dam clears it.

### 4.6 (Idea 6) "Available puppies" feed on home + "Add sale" deep-link
- **File:** `pages/today.js`. Add a section listing non-archived dogs where `disposition === 'available'` (the documented feed key — see the `DISPOSITION` comment in `vocab.js`). `today.js` already loads `dogRepo.getAll`.
- Each row: call_name → `dog.html?id=<id>`, plus an **"Add sale →"** button → `sale.html?dog_id=<id>`. Include a general "Add sale" affordance too.
- **`sale.js` change:** in init/new-mode, read `?dog_id=` and preselect `draft.dog_id` (the buyer/other fields stay blank). `sale.js` currently starts from a blank draft — add the param read where the draft is initialized.
- **Note:** `DOG_STATUS` also has a `for_sale` value; that's the life-stage badge, distinct from `disposition`. Feed selects on **disposition `available`** per the design. (If desired later, union with `status === 'for_sale'` — not in v1.)
- **Acceptance:** a dog set to disposition `available` appears on home; its "Add sale" button lands on the sale form with that dog preselected.

### 4.7 (Idea 7) Stud `completed` → prompt to create pairing (auto-dismiss)
- **Reuse the existing flow:** `pairing.js` new-mode **already** handles `pairing.html?new=1&stud_service=<id>`, prefilling sire/dam correctly by direction (outgoing → our=sire; incoming → our=dam), setting `pairing_type='actual'`, `status='planned'`, and tracking `sourceStudServiceId` to back-link. **Verify** it writes `pairing_id` back onto the stud service on save; if not, add that back-fill (canonical link already declared).
- **Rule (the only new part):** for each stud service with (`status === 'completed'` **or** `returned_date < today`) **and** empty `pairing_id` → nudge **"Record the pairing for this stud service?"** (key `studpair:<id>`), action = navigate to `pairing.html?new=1&stud_service=<id>`.
- **Auto-dismiss:** once `pairing_id` is set, the rule produces nothing — no ledger entry needed. The ledger only records an explicit "not now."
- **Dedup:** shares the "does a pairing already exist for this dam+window?" check with §4.5.
- **Acceptance:** a completed stud service with no linked pairing shows the prompt; linking a pairing (via the prefilled form) permanently clears it.

### 4.8 (Idea 5) Inline "＋ New contact" in pickers
- **New helper:** `assets/contactPicker.js` exporting a function that decorates a contact `<select>` with a **"＋ New"** button. Clicking opens a minimal modal (name **required**; `contact_type` optional), creates via `contactRepo.create`, appends+selects the new option, and returns it. Reuse the existing modal/overlay pattern from `puppyForm.js`.
- **Wire into** (MVP): `sale.js` (buyer `f-buyer_contact_id`), `stud-service.js` (partner `f-partner_contact_id`), and the boarding `related_contact` picker in `eventForm.js`. Same helper each place — build once.
- **Rationale:** gating contact creation behind the Contacts page forces the user to leave their workflow; this removes that.
- **Acceptance:** from the sale form (and stud-service form), a user can create a contact inline and have it immediately selected, without navigating away.

---

## 5. Away-board de-duplication

**Problem:** a dog physically away at stud is currently entered **twice** — once as the StudService, once as a `boarding` event just so it shows on the Location/Status Board. (Live example in `data/sampleData.js`: `studServiceBirch` at ~:218 **and** the parallel boarding event at ~:291–295, same trip.) Now that stud services carry dates (`sent_date`/`returned_date`) and a `type` (§3.1), the board can read them directly.

**Change:**
- Add `studServiceRepo.getBoardRows()` returning normalized "away" rows for services where `type === 'in_person'` and `today ∈ [sent_date, returned_date]` (open-ended if `returned_date` null). Away dog = `our_dog_id` (whichever way it goes, the dog that travels is ours and is the one away). Location resolves from the partner contact's `address` (`Contact.address` exists); reason = "Stud service"; contact = `partner_contact_id`; out = `sent_date`; return = `returned_date`.
- **Union, don't replace:** the board (`pages/board.js` and `today.js` `renderBoard`) shows `eventRepo.getBoardRows()` (boarding events) **plus** `studServiceRepo.getBoardRows()`. Normalize both to one view-model `{ dogId, location, reason, contactId, outDate, returnDate, sourceType, sourceId, href }` and render together (dog links to `dog.html?id=`; stud rows can link to `stud-service.html?id=`).
- **Boarding events stay** for non-stud reasons (grow-out, foster, owner travel — `BOARDING_REASON_SUGGESTIONS`). Only the *stud-reason* boarding duplicate goes away: **remove it from `sampleData.js`** and stop authoring it.
- **No migration** for existing user data: someone who already has both a boarding event and a stud service for one trip will briefly see it twice. Acceptable; going forward they enter one. Do **not** build auto-dedup in v1.

**Baked-in assumption (documented, confirmed with user):** `type === 'in_person'` ⇒ *our* dog is the one that travelled out. The opposite case (partner's dam visits our premises) correctly yields no "our dog away" row; tracking *visiting* dogs on our property would be a separate board, out of scope.

---

## 6. Build order

Phase A can land independently and immediately; Phase B depends on §2.

**Phase A — point-of-entry wins (no nudge-engine dependency):**
1. §3.1 `StudService.type` field + vocab (unblocks the board).
2. §3.2 Kennel promote-nudge config fields + Kennels-page UI (config only; nudge consumes it in Phase B).
3. §4.1 disposition at add-puppy.
4. §4.8 inline "＋ New contact" helper + wire into sale / stud-service / boarding pickers.
5. §4.6 available feed + `sale.js ?dog_id=`.
6. §4.4 "Add heat cycle" button on Breeding hub.
7. §5 away-board union + remove the duplicate boarding from sample data.

**Phase B — derived-nudge engine and its rules:**
8. §2 `data/nudgeState.js` (ledger) + `data/nudges.js` (engine) + a Nudges section in `today.js`.
9. §4.2 stud status nudges.
10. §4.3 promote nudge.
11. §4.7 stud→pairing nudge (verify/​add `pairing_id` back-fill).
12. §4.5 heat→pairing nudge (+ `pairing.js` `dam` param + shared dedup check with §4.7).

Commit per feature with a clear message; push to `claude/data-integrity-workflows-y84d4s`.

---

## 7. Open questions / assumptions to confirm before/while building
1. **Stud `type` granularity:** v1 uses coarse `in_person` / `ai`. If per-record method detail is wanted on the stud record (mirroring Pairing's 5-value `method`), revisit — but the linked Pairing already carries it.
2. **Nudge re-arm:** v1 dismiss is permanent-per-condition (no snooze). Confirm that's acceptable or schedule snooze for v2.
3. **Dismissal ledger location:** `localStorage` (device-local, not exported). Confirmed appropriate for this local-first app.
4. **Bulk puppy disposition:** one shared value for the batch (v1), not per-puppy at creation.
5. **Heat "conclusion" signal:** keyed on `event_end_date < today`. Heat events without an end date never fire 4b (there's nothing to conclude) — confirm that's the intended behavior.
