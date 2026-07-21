# Kennel Papers — the document vault for KennelOS

A local-first, offline PWA that stores the actual document files (pedigrees, health
tests, registration certificates, contracts) for your KennelOS dogs — the files
KennelOS deliberately never stores itself. Third sibling next to `KennelOS/` and
`Receipts/`, sharing their philosophy: no backend, no build step, all data in the
browser, works offline, installable.

## What it does

- **📎 Add a document** — from an **existing PDF** or from **one or more photos**
  (camera / library). Photos are converted to a single- or multi-page PDF on save
  (a ~150-line vanilla module, no library — a PDF can embed a JPEG directly via the
  DCTDecode filter).
- **File it under a dog + a type** — every document is attached to a real dog record
  and tagged `pedigree` · `health test` · `registration` · `contract` · `other`, plus
  a few type-specific fields (registry, result, registration #, …).
- **Browse by dog, then by type** — the list groups by dog; filter chips narrow by
  type, a dropdown narrows by dog, and search covers title/dog/notes/issuer.
- **View / download** — open a document inline (browser-native PDF view) or download
  the original bytes.
- **📦 Dog document pack** — bundle every file for one dog into a `.zip` to hand a
  buyer or vet.
- **☁ Backup + auto-push to Dropbox** — one `.zip` with every record and every file's
  original bytes, pushed to your own Dropbox app folder automatically while the app
  is open (PKCE OAuth, no SDK, no CDN — plain `fetch` against Dropbox's REST API),
  plus a manual "Back up now."
- **🔄 Sync dogs from KennelOS** — pick a KennelOS JSON backup; a dry-run preview
  shows new/updated/unchanged/no-longer-in-KennelOS dogs before anything is written.
  The join is KennelOS's own `Dog.id`, so the two apps refer to the exact same dog.

**No write-back into KennelOS** — alignment is one-directional, and there is no
document-import target there by design (KennelOS keeps no attachments).

## How the pieces fit

```
KennelPapers/
  index.html        the whole app: a dog-grouped list + add/edit/view/settings modals
  app.js             controller (DOM -> repos, never db.* directly)
  sw.js              offline app-shell precache (cache-first; bump CACHE_NAME on change)
  manifest.json      PWA manifest ("Kennel Papers")
  data/
    db.js            Dexie schema — dogs + documents + files
    dogRepo.js        CRUD for dog rows (synced from KennelOS, or local)
    documentRepo.js   CRUD for document rows (getByDog reverse query)
    fileRepo.js       blob storage — the file archive
    dogImport.js      KennelOS JSON backup -> dry-run plan -> non-destructive upsert
    pdfBuild.js       photo(s) -> PDF, vanilla (DCTDecode), no library
    dropbox.js        PKCE OAuth + fetch-based upload/list/download
    backup.js         full .zip backup / inspect / restore
    zip.js            dependency-free ZIP reader/writer (copied from Receipts)
    settings.js       localStorage prefs — the only localStorage owner
    vocab.js          document types + their per-type optional fields
  assets/  app.css, ui.js (esc/format/modal/toast), icons/
  vendor/  dexie.min.mjs — the only vendored library
```

## Before this works: register a Dropbox app

Dropbox push/restore needs a one-time, free app registration:

1. Create an app at <https://www.dropbox.com/developers/apps> — **Scoped access**,
   **App folder** access type (confines it to `/Apps/Kennel Papers`).
2. Grant the `files.content.write` and `files.content.read` scopes.
3. Register this app's origin(s) as OAuth redirect URIs (e.g. `http://localhost:8000/`
   for dev, your GitHub Pages URL for prod).
4. Paste the app's **App key** into `APP_KEY` at the top of `data/dropbox.js`.

Everything else — capture, view, file, per-dog pack, local backup/restore — works
fully offline with no setup.

## Run it

```bash
cd KennelPapers
python3 -m http.server 8000     # or: npx serve
# open http://localhost:8000/  — never file://
```

## Notes

- **No build, test runner, or linter** (same as KennelOS/Receipts). Verify with
  `node --check <file>.js`, serving locally, and exercising the flow in a browser.
- **Service worker:** if you add/rename/remove a precached file, update
  `PRECACHE_URLS` and bump `CACHE_NAME` in `sw.js`.
- The full design reference lives in `docs/Kennel_Papers_Design_and_Maintenance_Guide.md`
  (companion: `docs/Kennel_Papers_Design_Brief_v1.md`).
