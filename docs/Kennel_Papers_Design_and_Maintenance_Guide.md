# Kennel Papers — Design & Maintenance Guide

The single build-ready reference for **Kennel Papers**, a local-first companion app that
stores the actual document files (pedigrees, health tests, registrations, contracts) for
KennelOS dogs. This guide is the map: architecture, data model, exact schema, per-module
surface, the two non-trivial algorithms (dog sync and photo→PDF), the Dropbox flow, the
invariants, and the maintenance recipes.

Companion to `Kennel_Papers_Design_Brief_v1.md` (the summary). Where this guide and the
brief differ, this guide is the finer authority; where code will eventually differ from
both, the **code wins** and the docs get fixed — same rule KennelOS uses.

Status: **built.** `KennelPapers/` exists and matches this guide as of the initial build
(dogs/documents/files tables, all repos, dog sync, photo→PDF, Dropbox PKCE integration,
full backup/restore, the single-page UI, and the service worker). Dropbox push/restore
needs a one-time app registration — see `KennelPapers/README.md` — but everything else
works offline out of the box.

---

## 1. What the app is

A **standalone, local-first, single-page PWA** for keeping the real document files that
KennelOS deliberately does not store (End-State guide §15 — no attachments table, no
photos tab; the only image it keeps is a kennel logo). Third sibling next to `KennelOS/`
and `Receipts/`, sharing their posture:

- No backend, no build step. Plain ES modules served over HTTP. Hosted on GitHub Pages.
- All data in the browser (IndexedDB via Dexie). Installable, works offline.
- **Single user, single device** is the design centre. Data moves between devices through
  the `.zip` backup — pushed to Dropbox (§9) or saved by hand.

**One deliberate departure from the KennelOS/Receipts posture:** the Dropbox push needs the
network at push time. Everything else — capture, view, file, per-dog pack, local backup and
restore — works fully offline.

- **Product name:** Kennel Papers
- **Folder / PWA scope:** `KennelPapers/`

Unlike the multi-page KennelOS, Kennel Papers is a **single-page app** (like Receipts): one
`index.html`, one `app.js` controller, everything else a modal. There is no page router and
no per-screen `.html`.

---

## 2. Architecture non-negotiables

Inherited from KennelOS/Receipts; changing any is a design decision, not a routine edit.

1. **Static, no build step, ES modules over HTTP** — never `file://`.
2. **Layering: controller → repos → Dexie.** `app.js` and any UI code never call `db.*`
   directly and never touch `localStorage` directly — those go through a repo or
   `settings.js`.
3. **No CDN / no network deps.** Everything third-party is vendored under
   `KennelPapers/vendor/` and loaded by relative path. The **only** vendored library is
   Dexie. The Dropbox integration uses plain `fetch` against Dropbox's REST API (which
   sends CORS headers) — **no Dropbox SDK, no CDN script.**
4. **Offline-first**, with the single Dropbox-push network exception noted in §1.
5. **Escape every user value** in any hand-built HTML (`esc()` from `assets/ui.js`).
6. **Service-worker discipline** (§11): any app file added/renamed/removed/edited ⇒ update
   `PRECACHE_URLS` **and** bump `CACHE_NAME` in `sw.js`.

---

## 3. Directory layout

```
KennelPapers/
  index.html          The whole app: a document list + add/edit/view/settings modals.
  app.js              Controller. Wires the DOM to the repos; renders the list and
                      modals. Never calls db.* directly.
  sw.js               Service worker — app-shell precache, cache-first, offline.
  manifest.json       PWA manifest ("Kennel Papers").
  data/               THE DATA LAYER (repos + shared data logic)
    db.js             Dexie schema — the only schema definition (dogs, documents, files).
    dogRepo.js        CRUD + queries for dog rows.
    documentRepo.js   CRUD for document rows; getByDog reverse query.
    fileRepo.js       Blob storage — the file archive (analog of Receipts' photoRepo).
    dogImport.js      Read a KennelOS JSON backup → dry-run plan → non-destructive upsert.
    pdfBuild.js       Image(s) → single/multi-page PDF (vanilla, DCTDecode). §8.
    dropbox.js        PKCE OAuth + fetch-based upload/list/download. §9.
    backup.js         Full .zip backup / inspect / restore. §10.
    zip.js            Zip reader/writer (copied verbatim from Receipts/data/zip.js).
    settings.js       localStorage-backed prefs — the only localStorage owner. §12.
    vocab.js          Controlled vocabularies (document types, and their optional fields).
  assets/
    app.css           All styles.
    ui.js             esc(), fmtDate(), modal helpers, toast — mirrors Receipts' ui.js.
    icons/            favicon-32, apple-touch-icon, icon-192, icon-512, maskable-512.
  vendor/
    dexie.min.mjs     The only vendored library.
```

No OCR, no Tesseract, no page router.

---

## 4. Data model

Three tables. The **dogs**/**documents**/**files** split mirrors Receipts'
entries/photos split, with dogs added because Kennel Papers must align to KennelOS by id.

Every row carries `id`, and `created_at`/`updated_at` where noted. Dates are `YYYY-MM-DD`
strings; `created_at`/`updated_at` are full ISO. Soft delete via `is_archived`. ids are
`crypto.randomUUID()` **except** a `dogs.id`, which is copied from KennelOS (§7).

### 4.1 dogs

The join to KennelOS. A `dogs.id` **is** the KennelOS `Dog.id`, so both apps name the same
identity. Fields other than `id` are a denormalized snapshot; KennelOS stays the source of
truth for them.

| Field | Notes |
|---|---|
| `id` | = KennelOS `Dog.id`. PK and the whole point of the table. For a manual local dog, a fresh UUID with `source:'local'`. |
| `call_name` | Display name. |
| `registered_name` | Optional. |
| `sex`, `breed`, `status` | Snapshot from KennelOS. |
| `registration_number`, `microchip_id`, `date_of_birth` | Snapshot; handy on document forms and the dog pack. |
| `source` | `'kennelos'` (came from a sync) or `'local'` (added by hand, §7). |
| `synced_at` | ISO — when last pulled from a KennelOS backup. Null for local. |
| `is_archived` | Soft delete. |

### 4.2 documents

| Field | Notes |
|---|---|
| `id` | Own UUID. |
| `dog_id` | → `dogs.id`. **Indexed FK.** Reverse = `documentRepo.getByDog(dogId)`. |
| `doc_type` | `pedigree` \| `health_test` \| `registration` \| `contract` \| `other`. From `vocab.js`. |
| `title` | Free text. |
| `doc_date` | `YYYY-MM-DD` — issue/test date. |
| `issuer_or_lab` | Registry, vet, or lab. |
| `result` | Optional — health-test result. |
| `registry`, `registration_number` | Optional — pedigree/registration. |
| `tags` | Optional array. |
| `notes` | Free text. |
| `file_id` | → `files.id` (the stored bytes). |
| `created_at`, `updated_at`, `is_archived` | Standard. |

`result` shows on the form only for `health_test`; `registry`/`registration_number` only
for `pedigree`/`registration`. Which optional fields belong to which type lives in
`vocab.js` (one place, like KennelOS).

### 4.3 files

The archive. One row per stored PDF; the document points at it by `file_id`.

| Field | Notes |
|---|---|
| `id` | Own UUID. |
| `blob` | The PDF bytes. `mime` is `application/pdf` for every stored file (photos are converted, §8). |
| `mime` | Always `application/pdf` in normal use. |
| `filename` | Original or generated (`<title>.pdf`). |
| `size` | Bytes, for the list and backup manifest. |
| `thumbnail` | data-URL — present for photo-sourced docs (from the first page image), blank for uploaded PDFs (list shows a doc-type icon). |
| `created_at` | ISO. |

### 4.4 Conventions

- Only indexed fields go in the Dexie schema string; every other field still persists and
  rides the backup.
- Pickers exclude archived by default.
- One canonical direction per relationship (a document points at a dog; a dog's documents
  are a **query**, never a stored back-pointer).

---

## 5. Dexie schema (`data/db.js`)

DB name: `KennelPapersApp`. One `version(1)` block.

```js
import Dexie from '../vendor/dexie.min.mjs';

export const db = new Dexie('KennelPapersApp');

db.version(1).stores({
  dogs:      'id, call_name, breed, status, source, is_archived',
  documents: 'id, dog_id, doc_type, doc_date, is_archived',
  files:     'id, created_at'
});

export default db;
```

- `documents.dog_id` is indexed so `getByDog` is an index probe.
- `documents.doc_type` / `doc_date` back the list filters.
- `files` indexes only `id`/`created_at`; the blob and thumbnail persist unindexed.
- `is_archived` is filtered in JS (IndexedDB can't key on booleans) — trivial at this scale.

**Versioning rule** (same as KennelOS): once real data ships, schema changes are
**additive only** — new tables/indexes go in a new `db.version(N).stores({...})` block, and
shipped blocks are never edited again. Pre-first-release, editing `version(1)` is fine if
reconciled with a data reset.

---

## 6. The repo layer

Thin repos over Dexie, mirroring the KennelOS/Receipts posture: validate, then write;
soft-delete via `is_archived`; reverse lookups are queries on the repo.

### dogRepo
- `getAll({ includeArchived })` — sorted by `call_name`.
- `getById(id)`
- `create(data)` — used by the manual "add local dog" path; assigns a UUID,
  `source:'local'`, timestamps.
- `update(id, changes)`
- `upsertFromKennelOS(row)` — **used only by `dogImport`**: writes a dog whose `id` is the
  KennelOS id, sets `source:'kennelos'` and `synced_at`, preserving any existing local
  edits that KennelOS doesn't own (this app's own `is_archived`/`created_at`).
- `archive(id)` / `unarchive(id)`
- `hardDelete(id)` — **blocked if any document references the dog** (throws); archive
  instead. The one referential guard in the app.
- `putRaw(row)` — restore only.

### documentRepo
- `getAll({ includeArchived })`, `getById(id)`
- `getByDog(dogId, { includeArchived })` — the reverse query powering the grouped list and
  the dog pack.
- `create(data)` — validates required (`dog_id`, `doc_type`, `file_id`), assigns UUID +
  timestamps.
- `update(id, changes)`, `archive(id)` / `unarchive(id)`
- `remove(id)` — hard delete; also removes the linked file via `fileRepo.remove(file_id)`
  (a file is owned by exactly one document).
- `putRaw(row)` — restore only.

### fileRepo (analog of Receipts' photoRepo)
- `create(blob, { filename, thumbnail })` → returns new file id. Stores blob + mime +
  filename + size + thumbnail + `created_at`.
- `get(id)`, `getObjectUrl(id)` (caller revokes), `getThumbnail(id)`
- `getAllMeta()` — every file row minus the blob, for list rendering across many rows.
- `remove(id)`
- `getAll()` — backup export (streams blobs).
- `putRaw(row)` — restore only.

---

## 7. Dog sync (`data/dogImport.js`)

Manual, on demand, non-destructive. Mirrors KennelOS's own dry-run import discipline.

**Source:** a KennelOS **JSON backup** file. `KennelOS/data/importExport.js`'s
`exportAll()` writes `{ schema_version, format_version, exported_at, collections }`, where
`collections.dogs` is the full stored dog rows **including `id`**. That id is the only
reliable source of KennelOS's UUID (its CSV path matches by natural key and never exposes
the id).

**Flow:**
1. `parse(file)` → JSON → pull `collections.dogs` (validate the file shape; a friendly
   error if it isn't a KennelOS backup).
2. `buildPlan(incomingDogs)` → compares against current `dogRepo.getAll({includeArchived})`
   by `id`, returns:
   ```
   { create: [...],      // id not present here
     update: [...],      // id present, snapshot fields differ
     unchanged: [...],
     missingHere: [...] } // in Kennel Papers, absent from the file (archived in KennelOS?)
   ```
   Only the snapshot fields KennelOS owns are compared; `missingHere` is **reported, never
   auto-removed**.
3. User reviews the counts and confirms.
4. `commit(plan)` → `dogRepo.upsertFromKennelOS` for each create/update. Never deletes.

**Edge case (documented, accepted):** a **local** dog (`source:'local'`, own UUID for a dog
not yet in KennelOS) can't be auto-merged by a later sync — there is no natural key, the
join is by id. Linking it means pasting its KennelOS id. This is the inherent cost of an
id-based join and is the correct trade for keeping the two apps from drifting.

---

## 8. Photo → PDF (`data/pdfBuild.js`) — vanilla, no library

A PDF can embed a JPEG directly via the **DCTDecode** filter, so no PDF library is needed.

**Pipeline:**
1. For each chosen photo, `createImageBitmap(file)` → draw to a `<canvas>`, **downscaled**
   so the long edge ≤ ~2000px, re-encoded as JPEG (~0.8 quality) via `canvas.toBlob`. This
   step also **normalizes iPhone HEIC → JPEG** (Safari decodes HEIC into the bitmap; the
   canvas export is JPEG), which matters because raw HEIC doesn't embed cleanly and isn't
   universally viewable, and the re-encode keeps size sane.
2. Build the PDF as byte-accurate `Uint8Array` chunks (JPEG is binary, so track byte offsets
   for the xref table). One **page per image**; a multi-photo capture becomes one
   multi-page PDF.
3. The **first image's bitmap** is also separately downscaled to a small (~320px) JPEG data-
   URL and kept as the document's list **thumbnail** — deliberately smaller than the
   ~2000px page image, since the list only ever needs a preview (same THUMB_MAX pattern as
   Receipts' `photoRepo`).

**Minimal single-page structure** (multi-page repeats the page + image objects):

```
%PDF-1.4
1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj
2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj
3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 W H]
         /Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>> endobj
4 0 obj <</Type/XObject/Subtype/Image/Width w/Height h
         /ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length L>>
stream
…JPEG bytes…
endstream endobj
5 0 obj <</Length n>>
stream
q W 0 0 H 0 0 cm /Im0 Do Q
endstream endobj
xref … trailer <</Size N/Root 1 0 R>> startxref … %%EOF
```

`MediaBox` W×H = the image pixel size; the content-stream matrix `W 0 0 H 0 0 cm` maps the
unit image to the page. The result is stored via `fileRepo.create` exactly like an uploaded
PDF, so view / dog-pack / backup treat every document identically.

**Uploaded PDFs** skip this module entirely — stored as-is.

---

## 9. Dropbox integration (`data/dropbox.js`)

Chosen because it works from an iPhone. PKCE OAuth + REST via `fetch`, **no SDK, no CDN**.

### One-time app registration (developer console)
- Create a Dropbox app, **App folder** access type → the app is confined to
  `/Apps/Kennel Papers`.
- Permissions (scopes): `files.content.write`, `files.content.read`.
- Note the **App key** (public client id) — pasted into the `APP_KEY` constant at the top
  of `dropbox.js` (placeholder until you register your own app). No client secret (PKCE).

### Connect (PKCE authorization-code flow)
1. Generate a random `code_verifier` (43–128 chars) and
   `code_challenge = base64url(SHA-256(verifier))`.
2. Redirect to
   `https://www.dropbox.com/oauth2/authorize?client_id=…&response_type=code`
   `&code_challenge=…&code_challenge_method=S256&token_access_type=offline`
   `&redirect_uri=…&scope=files.content.write files.content.read`.
   `token_access_type=offline` is what yields a **refresh token**.
3. On redirect back with `?code=…`, `handleRedirect()` (called once on app boot) POSTs to
   `https://api.dropboxapi.com/oauth2/token` (`grant_type=authorization_code`, `code`,
   `code_verifier`, `client_id`, `redirect_uri`) → `{ access_token, refresh_token,
   expires_in }`. Stores `refresh_token` (and the current access token + expiry) via
   `settings.js`, and scrubs `?code=`/`&state=` from the URL.

### Staying connected
- `getAccessToken()` — returns a cached access token if unexpired, else refreshes:
  POST `oauth2/token` with `grant_type=refresh_token`, `refresh_token`, `client_id`. Silent;
  no user interaction.

### Operations (all `fetch`, CORS-enabled)
- **Upload:** POST `https://content.dropboxapi.com/2/files/upload`, body = zip bytes,
  headers `Authorization: Bearer …`, `Content-Type: application/octet-stream`,
  `Dropbox-API-Arg: {"path":"/kennel-papers-backup-<stamp>.zip","mode":"overwrite"}`.
- **List newest:** POST `https://api.dropboxapi.com/2/files/list_folder` with `{"path":""}`
  (app-folder root), pick the most recent by `server_modified`.
- **Download:** POST `https://content.dropboxapi.com/2/files/download` with
  `Dropbox-API-Arg: {"path":"…"}` → zip bytes for restore.

### Module surface
`isConnected()`, `connect()`, `handleRedirect()`, `disconnect()`, `getAccessToken()`,
`upload(name, blob)`, `listBackups()`, `download(path)`.

### iPhone realities (stated in the Settings modal)
- **Auto-push is while-open only.** iOS Safari has no reliable background sync, so Kennel
  Papers pushes on add, on open, and on `visibilitychange`→hidden while foregrounded —
  **never while closed.**
- The one-time **Connect** redirect is smoothest in a Safari tab; installed-PWA redirect
  handling is fiddlier but rare (the refresh token keeps you connected).

### No fiscal cost
Free API, free app registration, backups count against your existing Dropbox quota.

---

## 10. Backup + restore (`data/backup.js`)

### Backup archive (one `.zip`, via `zip.js`)

```
manifest.json    { app:'kennel-papers-backup', version, created_at,
                   dog_count, document_count, file_count }
dogs.json        every dogs row (incl. archived)
documents.json   every documents row (incl. archived)
files.json       file metadata (id, mime, filename, size, thumbnail, created_at)
settings.json    small localStorage prefs (Dropbox link state, auto-push flag)
files/<id>.pdf   the actual bytes, one per file
```

This is the **only real data-loss protection** — the files are the whole value of the app.

⚠️ `settings.json` carries the Dropbox **refresh token** so a "restore from file" onto the
same Dropbox-linked device round-trips cleanly. That token is scoped to this app's own
Dropbox app-folder (limited blast radius), but it's still a live credential — a full backup
`.zip` isn't something to hand to a buyer or partner the way a per-dog document pack is (the
pack, built separately in `app.js`, never includes `settings.json`).

Surface: `buildBackup()` → `{ blob, counts }`; `downloadBackup()` (saves + stamps
`lastBackupDate`); `pushToDropbox()` (build + `dropbox.upload` + stamp); `inspectBackup(file)`
(parse + validate, no writes) → `{ manifest, dogs, documents, fileMeta, settings, parts }`;
`restoreBackup(inspected)` (upsert by id, never clobbers an existing on-device Dropbox link
with a stale one from the archive).

### Auto-push triggers
- **On add** of a document (the important one for device-loss).
- On app open and on `visibilitychange` → hidden while foregrounded.
- A manual **Back up now** button.
- A visible **"Last backup: N ago"** indicator (like Receipts) so you're never guessing.

### Restore — device-loss recovery
On a new device: **Connect Dropbox → Restore from Dropbox** → `dropbox.listBackups()` picks
the **newest**, downloads it, runs `inspectBackup` → confirm → `restoreBackup`. Repopulates
documents, **file bytes**, the dog table (KennelOS-id links survive), and settings, in one
operation. **Restore from file** (pick any saved `.zip`) is the fallback when Dropbox isn't
connected.

Restore is **upsert-by-id and non-destructive** — safe on a fresh device and safe to re-run
without duplicating.

**The honest limit:** recovery is complete only up to the **last successful push**, which —
because iOS can't push in the background — is the last time the app was open. Auto-push
*on add* keeps that window to seconds in normal use.

---

## 11. Service worker / PWA (`sw.js`)

App-shell cache so the app installs and works offline — same cache-first posture as
KennelOS/Receipts.

- `CACHE_NAME` (`kennelpapers-shell-v1`) + a `PRECACHE_URLS` list of **every** app file
  (html/js/css/icons/dexie). No large runtime-cached assets (there's no OCR blob), so the
  whole shell precaches on install.
- **The discipline:** any app file added/renamed/removed/edited ⇒ (1) update `PRECACHE_URLS`
  and (2) **bump `CACHE_NAME`**. `cache.addAll` is atomic — one wrong path fails the whole
  install and silently breaks offline.
- Dropbox requests are cross-origin and non-GET → they fall through the fetch handler
  untouched.

---

## 12. Settings (`data/settings.js`) — the only localStorage owner

Keys under `kennelPapers.*`:

- `dropbox.refreshToken`, `dropbox.accessToken`, `dropbox.accessExpiry`,
  `dropbox.pkceVerifier` (transient during connect) — the Dropbox link state.
- `lastBackupDate` — ISO, for the "Last backup: N ago" label.
- `autoPush` — bool, whether auto-push is enabled (default on once connected).

Getters/setters only; no other module touches `localStorage`.

**Not built:** a custom-document-types hook. The open item in §17 of the original brief
("whether to allow custom document types") was resolved as **no** — the five built-in
`doc_type` values in `vocab.js` are fixed. Revisit if a real need for a sixth type shows up.

---

## 13. UI (`index.html` + `app.js` + `assets/ui.js`)

Single page, Receipts-style:

- **App bar** — brand, a backup status control (⬆, title = "Last backup: N ago", a small
  badge when never backed up), and a settings ⚙ button.
- **Filter row** — chips by document type (`All` + the five types); a second row holds a
  text search (title/dog/notes/issuer) and a dog `<select>`.
- **List** — grouped **by dog** (alphabetical by call name), each group showing its
  documents (thumbnail or type icon, title, type badge, date, issuer). Newest first within
  a dog. A dog group only appears if it has at least one document matching the current
  filters; archived/unknown dogs are excluded from the main list.
- **FAB** — **＋ Add document** → the add modal.
- **Add / edit modal** — choose source (**Upload PDF** or **Take/Choose photo(s)**; the same
  radio choice re-used on edit to *replace* the current file), pick the **dog** (from the
  synced dog table, with an inline **"＋ Add local dog"** option), the **type** (drives which
  extra fields show, from `vocab.js`), title, date, notes. Photos run through `pdfBuild`; the
  result stores via `fileRepo`. Deleting swaps in a confirm() and removes the linked file.
- **View modal** — inline browser PDF (`<embed>` on an object URL), with Download, Edit, and
  Delete.
- **Dog pack** — from a dog's group header, "📦 Pack" → a `.zip` of that dog's files (via
  `zip.js`), named collision-safely from each document's title.
- **Settings modal** — Connect/Disconnect Dropbox + auto-push toggle, Back up now (pushes to
  Dropbox if connected, else downloads), Restore (from Dropbox / from file), Sync dogs from
  KennelOS (dry-run plan modal with create/update/unchanged/missingHere counts before
  committing).

Escaping: every user value in hand-built HTML goes through `esc()`.

---

## 14. Deliberately NOT built

- No OCR / text extraction / auto-fill.
- No **merge** of already-PDF documents into one file (photos→one multi-page PDF **is**
  supported; merging existing PDFs needs a heavier lib). Deferrable.
- No PDF editing, e-signing, or annotation.
- No write-back into KennelOS (there is no document import target there, by design).
- No true background upload (iOS limitation, §9).
- No multi-user / sharing beyond handing someone a dog-pack `.zip`.
- No custom document types (resolved in §12 — the five built-ins are fixed).
- No periodic backup timer beyond the on-add / on-open / on-hidden triggers (the hidden
  trigger covers the "about to leave the app" moment a timer would otherwise approximate).

---

## 15. Invariants checklist (before you commit)

1. **Layering:** no UI code calls `db.*` or touches `localStorage` (go through a repo /
   `settings.js`).
2. **One canonical direction:** a dog's documents are `documentRepo.getByDog`, never a
   stored back-pointer.
3. **Referential guard:** `dogRepo.hardDelete` stays blocked while documents reference the
   dog.
4. **Escaping:** every user value in hand-built HTML is `esc()`'d.
5. **Service worker:** new/renamed/removed/edited app file ⇒ update `PRECACHE_URLS` **and**
   bump `CACHE_NAME`.
6. **Schema:** additive `version(N)` blocks only after first real data; never edit a shipped
   block.
7. **Encoding:** clean UTF-8, no BOM.
8. `node --check <file>.js` parses everything touched (no bundler to catch it).
9. **Files stay PDF:** every `files` row is `application/pdf` (photos converted on capture).
10. **Dropbox stays SDK-free:** only `fetch` against Dropbox REST; nothing added to
    `vendor/` but Dexie.

---

## 16. Local development

```bash
cd KennelPapers
python3 -m http.server 8000      # or: npx serve
# open http://localhost:8000/  — never file://
```

No build, test runner, or linter. Verification = `node --check` on touched JS, serving
locally and exercising the flow in a browser, and the precache check. The Dropbox connect
flow needs a registered redirect URI that matches the served origin (localhost for dev, the
GitHub Pages URL for prod) — see `KennelPapers/README.md` for the one-time setup.

---

## 17. Open items resolved at build time

- **Redirect URI(s):** handled by `dropbox.js`'s `redirectUri()` (current origin + pathname)
  and `handleRedirect()` (a `?code=` check run once on boot, in `app.js`'s `boot()`). Still
  requires registering the real origin(s) in the Dropbox app console — a one-time manual
  step (README).
- **Exact per-type field sets:** `vocab.js`'s `fieldsFor(docType)` — `issuer_or_lab` on all
  but `pedigree`/`registration` which also add `registry`/`registration_number`;
  `health_test` adds `result` instead.
- **Custom document types:** resolved as **no** — five fixed built-ins (§12, §14).
- **Inline "＋ add local dog":** built into the add/edit modal's dog picker.
- **Icon set / brand mark:** a generated navy/parchment "document with folded corner" glyph
  (📄 as the in-app brand mark emoji), distinct from Receipts' green and KennelOS's plain
  navy.
