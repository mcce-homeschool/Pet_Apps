# Photo Upload — Feasibility & Design (v1)

Status: **design only — not yet built.** This is a plan/spec in the tradition of
`Buckets_and_Contract_Linking_Plan_v1.md` and `Navigation_Consolidation_Plan_v1.md`,
not current-state. The End-State guide still lists photos as a non-goal (§15) and
will not change until the feature ships. The code is the authority; if this doc and
the code ever disagree after build, the code wins and this doc is what gets fixed.

## 1. Goal

Let the user attach a modest number of photos (~30 across the program is the stated
scale, not a hard cap) to records, view them in the app offline, and — for a chosen
subset — surface them in the read-only Companion share-out to buyers and partners.

## 2. Feasibility summary

Two very different problems hide behind "upload pictures."

### 2a. Storing & viewing photos locally — **easy-to-moderate**

The data layer is IndexedDB via Dexie; 30 (or many more) images is trivial for the
engine. The work is routine and fits existing patterns: a new table + repo, an
upload/thumbnail UI, and the standard service-worker/cache chores.

One storage decision is load-bearing: **store each image as a base64 data-URL
string, not a raw `Blob`.** The JSON backup (`data/importExport.js`) does
`JSON.stringify(table.toArray())`; a `Blob` serializes to `{}` and would be silently
lost on backup/restore. Data-URL strings ride the existing backup for free. Cost: a
larger backup file (~5–6 MB for 30 photos resized to ~150 KB each), which is fine.

Client-side resize before storing is mandatory, or a phone photo lands as several MB.
Target ~1280 px longest edge, JPEG quality ~0.72, via an off-screen `<canvas>`.

### 2b. Sending photos to Companion — the real constraint

Companion is **not a server.** The bundle is stuffed into a **URL fragment**:
`JSON.stringify` → lz-string compression → `companion-view.html#<hash>`, delivered as
an `sms:`/`mailto:` link the recipient taps (`pages/companion.js`). The size caps are
hard:

- `MAX_SMS_HASH_LEN = 1800` chars
- `MAX_EMAIL_HASH_LEN = 12000` chars

A single phone photo resized to ~100 KB is **~135,000 base64 chars**, and lz-string
cannot compress already-compressed JPEG. **One photo overruns the email cap by ~10×**;
30 is hopeless. Photos fundamentally cannot ride the base64 payload.

The only viable path is the same indirection the app already uses for contracts:
`Contract.document_url` is a **pointer**, not the document — the file lives in the
owner's Drive and only the URL travels in the bundle. Photos do the same: the app
stores the image locally for the owner's own viewing, and (for photos the owner wants
to share) carries a **hosted image URL** into the bundle. The recipient shell already
trusts external links.

Trade-off the user accepted: sharing a photo requires hosting it publicly (Drive, or a
`photos/` folder on GitHub Pages) and those URLs are reachable by anyone with the link
— exactly like the contract URLs today. This bends the "all-local, no external hosting"
model for the shared subset only; the local copy stays local.

## 3. Decisions locked

| Question | Decision |
|---|---|
| Storage model | **Local base64 + optional hosted URL.** Local copy is offline/local-first and rides the backup; a photo gains Companion visibility only when the owner supplies a hosted URL for it. |
| Attach targets | **Dogs and Litters.** (Litter photos matter because the prospective-family bundle is built around litters + available pups.) |
| Companion coverage | **All three bundle types** — prospective, family, **and partner** — project shareable photos. |
| Hard-delete blocking | Photos register as references (like events): a dog/litter with photos blocks *hard* delete until photos are removed. Archive is unaffected. |
| Bundle version | Stays **1** — `photos` is an additive field and the shell tolerates additive fields; version bumps only on a breaking shape change. |

## 4. Implementation plan

### 4.1 Data model — new `photos` table (`data/db.js`)

Editable pre-release (nothing has shipped), reconciled via **Reset App + re-seed**.

```
photos: 'id, [subject_type+subject_id], is_archived'
```

Record fields:

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | `crypto.randomUUID()`, client-side |
| `subject_type` | `'dog' \| 'litter'` | polymorphic subject, same pattern as `events` |
| `subject_id` | UUID | the dog/litter this photo belongs to |
| `data_url` | string | base64 data-URL — **local viewing only, never leaves the device** |
| `external_url` | string \| null | hosted public URL; presence is what makes a photo shareable |
| `caption` | string | optional, plain text |
| `is_primary` | boolean | at most one primary per subject (the record's "cover") |
| `sort_order` | number | manual ordering within a subject |
| `created_at` / `updated_at` | ISO | standard |
| `is_archived` | boolean | soft delete; never cascades |

Only `[subject_type+subject_id]` and `is_archived` are indexed (the only things we
query on); `data_url`, `external_url`, `caption`, `is_primary`, `sort_order` persist
unindexed and ride the backup.

### 4.2 `data/photoRepo.js`

`makeRepo('photos', /* leaf — nothing points AT a photo */ null)` plus entity helpers:
`getForSubject(type, id)` (active, ordered by `sort_order`), `setPrimary(id)` (clears
the sibling flags), and a reorder helper. Standard thin surface otherwise.

### 4.3 `data/referenceRegistry.js`

Add a photo line to **`DOG_REFERENCES`** and **`LITTER_REFERENCES`**, using the
polymorphic compound-index form (mirrors the existing event entries):

```js
{
  table: 'photos', field: 'subject_id', label: 'has a photo',
  compoundIndex: '[subject_type+subject_id]', discriminatorValue: 'dog'   // 'litter' for the litter list
}
```

⚠️ This is the load-bearing FK step — without it, hard-delete would silently orphan
photos. Consequence: a dog/litter with photos can't be hard-deleted until its photos
are removed (consistent with how events already block). Archive is unaffected.

### 4.4 UI — `assets/photoManager.js` (one reusable component)

A self-contained panel embedded in a detail page: thumbnail grid, an
`<input type="file" accept="image/*">`, **canvas resize/re-compress before storing**,
per-photo caption edit, ★ set-primary, delete (archive), drag/reorder, and a per-photo
**"sharing URL"** text field (writes `external_url`). All user values `esc()`'d in any
hand-built innerHTML. Wired into `pages/dog.js` and `pages/litter.js` (their detail
views).

### 4.5 Companion — `data/companionExport.js` (the security spine)

The invariant here is absolute: builders name every field explicitly, copy only listed
fields, and `assertOnlyKeys()` aborts the send on any unexpected key. Photo work:

- Add a projector, e.g. `shareablePhotos(subjectType, subjectId)` → for each active
  photo **with a non-empty `external_url`**, emit `{ url, caption }`. **Never emit
  `data_url`.** A photo with no `external_url` simply doesn't appear.
- Add `'photos'` to **`PROSPECTIVE_KEYS`**, **`FAMILY_KEYS`**, and **`PARTNER_KEYS`**.
  - prospective: litter photos (+ available-pup photos) for the litters already in the
    bundle.
  - family: the family's placed pup(s) + their litter photos.
  - partner: photos of the partner's external/leased dogs already surfaced in the
    bundle.
- `COMPANION_BUNDLE_VERSION` stays `1` (additive).

### 4.6 Recipient shell — `companion-view.html`

Render a small gallery wherever `photos` is present, **guarded on presence** so links
sent before this change still render. The shell must stay backward-compatible with
every `bundleVersion` ever sent — additive rendering only.

### 4.7 Plumbing

- **`sw.js`:** add `assets/photoManager.js` to `PRECACHE_URLS` and **bump
  `CACHE_NAME`** (`kennelos-shell-vN` → `vN+1`). Run the precache sanity check.
- **Backup:** rides for free — `importExport.js` iterates all tables and data-URLs are
  strings.
- **End-State guide:** on ship, remove photos from §15 non-goals; add the table/repo to
  the module map and data-model + schema sections; add the two registry lines to the
  data-model + schema sections; extend §20 with the photo projections. (Per CLAUDE.md,
  this happens in the same change that builds the feature — not in this design doc.)

## 5. Effort

Roughly **one day.** No open unknowns — every file that changes is identified above.

## 6. The one manual step the app can't do

Companion needs a **public** image URL per shared photo. The owner must host the image
themselves — Google Drive (same as contract docs today) or a `photos/` folder in the
GitHub Pages repo — and paste that URL into the photo's sharing-URL field. The choice of
host doesn't change any code; it's simply the step the offline, no-backend app cannot
perform on the user's behalf.
