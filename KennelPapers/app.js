// app.js — the controller. Wires the DOM to the repos; renders the list and
// every modal. Never calls db.* or localStorage directly (guide §2, §15) —
// those go through a repo / settings.js.
import { dogRepo } from './data/dogRepo.js';
import { documentRepo } from './data/documentRepo.js';
import { fileRepo } from './data/fileRepo.js';
import * as dogImport from './data/dogImport.js';
import { photosToPdf } from './data/pdfBuild.js';
import * as dropbox from './data/dropbox.js';
import * as backupMod from './data/backup.js';
import { createZip } from './data/zip.js';
import { getAutoPush, setAutoPush } from './data/settings.js';
import { DOC_TYPES, fieldsFor, docTypeLabel, docTypeIcon } from './data/vocab.js';
import { esc, fmtDate, todayYMD, fmtBytes, toast, openModal } from './assets/ui.js';

let typeFilter = '';   // '' = all doc types
let dogFilter = '';    // dog id, '' = all dogs
let searchQuery = '';
let pushInFlight = false;

// ---- list ------------------------------------------------------------------

function docCardHtml(doc, fileMeta) {
  const thumbInner = fileMeta?.thumbnail
    ? `<img src="${esc(fileMeta.thumbnail)}" alt="">`
    : docTypeIcon(doc.doc_type);
  return `
    <button class="doc-card" data-doc="${esc(doc.id)}" type="button">
      <div class="doc-thumb">${thumbInner}</div>
      <div class="doc-body">
        <div class="doc-top">
          <span class="doc-title">${esc(doc.title || docTypeLabel(doc.doc_type))}</span>
          <span class="doc-date">${esc(fmtDate(doc.doc_date))}</span>
        </div>
        <div class="doc-sub">
          <span class="chip chip-${esc(doc.doc_type)}">${esc(docTypeLabel(doc.doc_type))}</span>
          ${doc.issuer_or_lab ? `<span class="doc-issuer">${esc(doc.issuer_or_lab)}</span>` : ''}
        </div>
      </div>
    </button>`;
}

async function renderList() {
  const list = document.getElementById('list');
  const dogs = await dogRepo.getAll();
  const docs = await documentRepo.getAll();
  const filesMeta = await fileRepo.getAllMeta();
  const fileById = new Map(filesMeta.map((f) => [f.id, f]));
  const dogsById = new Map(dogs.map((d) => [d.id, d]));

  const q = searchQuery.trim().toLowerCase();
  const filtered = docs.filter((d) => {
    if (typeFilter && d.doc_type !== typeFilter) return false;
    if (dogFilter && d.dog_id !== dogFilter) return false;
    const dog = dogsById.get(d.dog_id);
    if (!dog) return false; // dog archived or missing — keep the main list clean
    if (q) {
      const hay = `${d.title} ${dog.call_name} ${d.notes} ${d.issuer_or_lab}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-emoji">📄</div>
        <p><strong>No documents yet</strong></p>
        <p>Tap “Add document” to file your first pedigree, health test, or contract.</p>
      </div>`;
    return;
  }

  const byDog = new Map();
  for (const d of filtered) {
    if (!byDog.has(d.dog_id)) byDog.set(d.dog_id, []);
    byDog.get(d.dog_id).push(d);
  }

  list.innerHTML = dogs
    .filter((dog) => byDog.has(dog.id))
    .map((dog) => {
      const dogDocs = byDog.get(dog.id); // already newest-first from documentRepo.getAll()
      const cards = dogDocs.map((d) => docCardHtml(d, fileById.get(d.file_id))).join('');
      const sourceTag = dog.source === 'local' ? 'Local' : 'KennelOS';
      return `
        <section class="dog-group" data-dog-id="${esc(dog.id)}">
          <div class="dog-group-head">
            <div class="dog-group-name">
              <h2>${esc(dog.call_name)}</h2>
              <span class="dog-source-tag">${sourceTag}</span>
            </div>
            <div class="dog-group-actions">
              <button class="btn-pack" data-pack="${esc(dog.id)}" type="button">📦 Pack</button>
            </div>
          </div>
          <div class="card-stack">${cards}</div>
        </section>`;
    })
    .join('');

  list.querySelectorAll('[data-doc]').forEach((el) => {
    el.addEventListener('click', () => openViewModal(el.dataset.doc));
  });
  list.querySelectorAll('[data-pack]').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); downloadDogPack(el.dataset.pack); });
  });
}

function renderTypeFilterRow() {
  const row = document.getElementById('type-filter-row');
  const chips = [{ value: '', label: 'All' }, ...DOC_TYPES];
  row.innerHTML = chips
    .map((c) => `<button class="filter ${typeFilter === c.value ? 'active' : ''}" data-type="${esc(c.value)}" type="button">${esc(c.label)}</button>`)
    .join('');
  row.querySelectorAll('[data-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      typeFilter = btn.dataset.type;
      renderTypeFilterRow();
      renderList();
    });
  });
}

async function renderDogFilterSelect() {
  const select = document.getElementById('dog-filter');
  const dogs = await dogRepo.getAll();
  const prev = dogFilter;
  select.innerHTML = '<option value="">All dogs</option>' +
    dogs.map((d) => `<option value="${esc(d.id)}">${esc(d.call_name)}</option>`).join('');
  if (dogs.some((d) => d.id === prev)) select.value = prev;
  else { dogFilter = ''; select.value = ''; }
}

// ---- add / edit document modal ---------------------------------------------

function extraFieldsHtml(docType, existing) {
  const FIELD_DEFS = {
    issuer_or_lab: { label: 'Registry / vet / lab' },
    result: { label: 'Result' },
    registry: { label: 'Registry' },
    registration_number: { label: 'Registration #' }
  };
  return fieldsFor(docType).map((f) => {
    const def = FIELD_DEFS[f];
    const val = esc(existing?.[f] || '');
    return `<label>${esc(def.label)}<input type="text" id="field-${f}" value="${val}"></label>`;
  }).join('');
}

async function openAddEditModal(existingId) {
  const isEdit = !!existingId;
  const existing = isEdit ? await documentRepo.getById(existingId) : null;
  const currentFile = existing ? await fileRepo.get(existing.file_id) : null;
  const dogs = await dogRepo.getAll();
  let pendingFiles = null; // { kind: 'pdf'|'photo', files: File[] }

  const selectedDogId = existing?.dog_id || '';
  const dogOptionsHtml = dogs.map((d) =>
    `<option value="${esc(d.id)}" ${d.id === selectedDogId ? 'selected' : ''}>${esc(d.call_name)}</option>`
  ).join('');
  const initialType = existing?.doc_type || 'pedigree';

  const html = `
    <div class="modal-head">
      <h2>${isEdit ? 'Edit document' : 'Add document'}</h2>
      <button class="icon-btn" data-close type="button">✕</button>
    </div>
    <form class="form" id="doc-form">
      <div class="choice-list">
        <label class="radio-card"><input type="radio" name="source" value="pdf" checked>
          <div><strong>📎 Upload PDF</strong><span class="muted">${isEdit ? 'Replace the current file' : 'An existing PDF file'}</span></div>
        </label>
        <label class="radio-card"><input type="radio" name="source" value="photo">
          <div><strong>📷 Take / choose photo(s)</strong><span class="muted">Converted to a PDF automatically</span></div>
        </label>
      </div>
      ${isEdit ? `<div class="file-chip">📄 Current file: ${esc(currentFile?.filename || 'unknown')} (${fmtBytes(currentFile?.size)}) — pick a new one above to replace it, or leave as-is.</div>` : ''}
      <div class="photo-zone">
        <input type="file" id="file-pdf" accept="application/pdf">
        <input type="file" id="file-photo" accept="image/*" capture="environment" multiple hidden>
        <div class="photo-grid" id="photo-preview"></div>
      </div>

      <label>Dog
        <select id="doc-dog" required>
          <option value="" disabled ${selectedDogId ? '' : 'selected'}>Choose a dog…</option>
          ${dogOptionsHtml}
          <option value="__new__">＋ Add local dog…</option>
        </select>
      </label>
      <div id="new-dog-row" class="grid2" hidden>
        <label>New dog's call name<input type="text" id="new-dog-name"></label>
        <label>&nbsp;<button type="button" class="btn btn-soft" id="btn-new-dog-save">Save dog</button></label>
      </div>

      <label>Type
        <select id="doc-type">
          ${DOC_TYPES.map((t) => `<option value="${t.value}" ${t.value === initialType ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
        </select>
      </label>

      <label>Title<input type="text" id="doc-title" value="${esc(existing?.title || '')}" placeholder="e.g. Willow's OFA hips"></label>
      <label>Date<input type="date" id="doc-date" value="${esc(existing?.doc_date || todayYMD())}"></label>

      <div id="extra-fields">${extraFieldsHtml(initialType, existing)}</div>

      <label>Notes<textarea id="doc-notes" rows="2">${esc(existing?.notes || '')}</textarea></label>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Add document'}</button>
        <button type="button" class="btn btn-soft" data-close>Cancel</button>
        <span class="spacer"></span>
        ${isEdit ? '<button type="button" class="btn btn-danger" id="btn-doc-delete">Delete</button>' : ''}
      </div>
    </form>`;

  const { el, close } = openModal(html);

  // Type -> extra fields.
  el.querySelector('#doc-type').addEventListener('change', (e) => {
    el.querySelector('#extra-fields').innerHTML = extraFieldsHtml(e.target.value, null);
  });

  // Dog select + inline "add local dog".
  const dogSelect = el.querySelector('#doc-dog');
  const newDogRow = el.querySelector('#new-dog-row');
  dogSelect.addEventListener('change', () => { newDogRow.hidden = dogSelect.value !== '__new__'; });
  el.querySelector('#btn-new-dog-save').addEventListener('click', async () => {
    const name = el.querySelector('#new-dog-name').value.trim();
    if (!name) { toast('Enter a call name first.', 'err'); return; }
    try {
      const dog = await dogRepo.create({ call_name: name });
      const opt = document.createElement('option');
      opt.value = dog.id;
      opt.textContent = dog.call_name;
      opt.selected = true;
      dogSelect.insertBefore(opt, dogSelect.querySelector('option[value="__new__"]'));
      newDogRow.hidden = true;
      toast(`Added ${dog.call_name}.`);
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  // Source radio -> which file input shows; both inputs feed the same
  // pendingFiles variable so Save doesn't care which path was used.
  const pdfInput = el.querySelector('#file-pdf');
  const photoInput = el.querySelector('#file-photo');
  const preview = el.querySelector('#photo-preview');

  function syncSourceUI() {
    const source = el.querySelector('input[name="source"]:checked').value;
    pdfInput.hidden = source !== 'pdf';
    photoInput.hidden = source !== 'photo';
  }
  el.querySelectorAll('input[name="source"]').forEach((r) => r.addEventListener('change', syncSourceUI));
  syncSourceUI();

  function renderFilePreview() {
    preview.innerHTML = '';
    if (!pendingFiles) return;
    if (pendingFiles.kind === 'pdf') {
      const f = pendingFiles.files[0];
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.textContent = `📎 ${f.name} (${fmtBytes(f.size)})`;
      preview.appendChild(chip);
    } else {
      for (const f of pendingFiles.files) {
        const url = URL.createObjectURL(f);
        const div = document.createElement('div');
        div.className = 'photo-thumb';
        div.innerHTML = `<img src="${url}" alt="">`;
        preview.appendChild(div);
      }
    }
  }
  pdfInput.addEventListener('change', () => {
    pendingFiles = pdfInput.files[0] ? { kind: 'pdf', files: [pdfInput.files[0]] } : null;
    renderFilePreview();
  });
  photoInput.addEventListener('change', () => {
    pendingFiles = photoInput.files.length ? { kind: 'photo', files: Array.from(photoInput.files) } : null;
    renderFilePreview();
  });

  el.querySelector('#doc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dogId = dogSelect.value;
    if (!dogId || dogId === '__new__') { toast('Choose (or add) a dog first.', 'err'); return; }

    const docType = el.querySelector('#doc-type').value;
    const title = el.querySelector('#doc-title').value.trim();
    const docDate = el.querySelector('#doc-date').value;
    const notes = el.querySelector('#doc-notes').value.trim();
    const extras = {};
    for (const f of fieldsFor(docType)) {
      extras[f] = el.querySelector(`#field-${f}`)?.value.trim() || '';
    }

    const submitBtn = el.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      let fileId = existing?.file_id || null;
      if (pendingFiles) {
        if (pendingFiles.kind === 'pdf') {
          const f = pendingFiles.files[0];
          fileId = await fileRepo.create(f, { filename: f.name, thumbnail: '' });
        } else {
          const built = await photosToPdf(pendingFiles.files, { title: title || docTypeLabel(docType) });
          fileId = await fileRepo.create(built.blob, { filename: built.filename, thumbnail: built.thumbnail });
        }
        if (isEdit && existing.file_id && existing.file_id !== fileId) {
          await fileRepo.remove(existing.file_id);
        }
      }
      if (!fileId) throw new Error('Choose a PDF or photo(s) first.');

      const payload = { dog_id: dogId, doc_type: docType, title, doc_date: docDate, notes, file_id: fileId, ...extras };
      if (isEdit) await documentRepo.update(existing.id, payload);
      else await documentRepo.create(payload);

      close();
      toast(isEdit ? 'Document updated.' : 'Document added.');
      await renderDogFilterSelect();
      await renderList();
      if (!isEdit) maybeAutoPush(); // guide §10: auto-push on add
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      submitBtn.disabled = false;
    }
  });

  if (isEdit) {
    el.querySelector('#btn-doc-delete').addEventListener('click', async () => {
      if (!confirm('Delete this document? This also removes its stored file. This can’t be undone.')) return;
      await documentRepo.remove(existing.id);
      close();
      toast('Document deleted.');
      await renderList();
    });
  }
}

// ---- view modal --------------------------------------------------------

async function openViewModal(docId) {
  const doc = await documentRepo.getById(docId);
  if (!doc) return;
  const dog = await dogRepo.getById(doc.dog_id);
  const fileRow = await fileRepo.get(doc.file_id);
  const objUrl = fileRow ? URL.createObjectURL(fileRow.blob) : '';

  const html = `
    <div class="modal-head">
      <h2>${esc(doc.title || docTypeLabel(doc.doc_type))}</h2>
      <button class="icon-btn" data-close type="button">✕</button>
    </div>
    <div class="doc-sub" style="margin-bottom:10px;">
      <span class="chip chip-${esc(doc.doc_type)}">${esc(docTypeLabel(doc.doc_type))}</span>
      <span class="muted">${esc(dog?.call_name || 'Unknown dog')} · ${esc(fmtDate(doc.doc_date))}</span>
    </div>
    ${objUrl ? `<embed src="${objUrl}" type="application/pdf" class="pdf-embed">` : '<p class="muted">That file is missing.</p>'}
    ${doc.notes ? `<p class="hint" style="margin-top:10px;">${esc(doc.notes)}</p>` : ''}
    <div class="form-actions">
      ${objUrl ? `<a class="btn btn-soft" href="${objUrl}" download="${esc(fileRow?.filename || 'document.pdf')}">⬇ Download</a>` : ''}
      <button class="btn btn-soft" id="btn-doc-edit" type="button">Edit</button>
      <span class="spacer"></span>
      <button class="btn btn-danger" id="btn-doc-delete-view" type="button">Delete</button>
    </div>`;

  const { el, close } = openModal(html, () => { if (objUrl) URL.revokeObjectURL(objUrl); });
  el.querySelector('#btn-doc-edit').addEventListener('click', () => { close(); openAddEditModal(doc.id); });
  el.querySelector('#btn-doc-delete-view').addEventListener('click', async () => {
    if (!confirm('Delete this document? This also removes its stored file.')) return;
    await documentRepo.remove(doc.id);
    close();
    toast('Document deleted.');
    await renderList();
  });
}

// ---- dog document pack ------------------------------------------------------

async function downloadDogPack(dogId) {
  const dog = await dogRepo.getById(dogId);
  if (!dog) return;
  const docs = await documentRepo.getByDog(dogId);
  if (docs.length === 0) { toast('No documents to pack yet.', 'err'); return; }

  const zipFiles = [];
  const usedNames = new Set();
  for (const d of docs) {
    const fileRow = await fileRepo.get(d.file_id);
    if (!fileRow) continue;
    const bytes = new Uint8Array(await fileRow.blob.arrayBuffer());
    const base = (d.title || docTypeLabel(d.doc_type)).replace(/[^\w.-]+/g, '_') || d.id;
    let name = `${base}.pdf`;
    let i = 2;
    while (usedNames.has(name)) { name = `${base}-${i}.pdf`; i++; }
    usedNames.add(name);
    zipFiles.push({ name, data: bytes });
  }

  const blob = createZip(zipFiles);
  const safeDog = dog.call_name.replace(/[^\w.-]+/g, '_') || 'dog';
  backupMod.downloadBlob(`${safeDog}-documents.zip`, blob);
  toast(`Packed ${zipFiles.length} document(s) for ${dog.call_name}.`);
}

// ---- dog sync (KennelOS) ----------------------------------------------------

function dogSyncSummaryLine(d) {
  return `<div>${esc(d.call_name || '(unnamed)')}${d.registered_name ? ' — ' + esc(d.registered_name) : ''}</div>`;
}

function openDogSyncPlanModal(plan) {
  const totalWritable = plan.create.length + plan.update.length;
  const html = `
    <div class="modal-head"><h2>Sync dogs from KennelOS</h2><button class="icon-btn" data-close type="button">✕</button></div>
    <div class="plan-counts">
      <div class="plan-count"><strong>${plan.create.length}</strong><span>New</span></div>
      <div class="plan-count"><strong>${plan.update.length}</strong><span>Updated</span></div>
      <div class="plan-count"><strong>${plan.unchanged.length}</strong><span>Unchanged</span></div>
      <div class="plan-count"><strong>${plan.missingHere.length}</strong><span>Not in file</span></div>
    </div>
    ${plan.create.length ? `<div class="plan-list"><strong>New:</strong>${plan.create.map(dogSyncSummaryLine).join('')}</div>` : ''}
    ${plan.update.length ? `<div class="plan-list"><strong>Updated:</strong>${plan.update.map(dogSyncSummaryLine).join('')}</div>` : ''}
    ${plan.missingHere.length ? `<div class="plan-list"><strong>Here, but not in this file (archived/removed in KennelOS?):</strong>${plan.missingHere.map(dogSyncSummaryLine).join('')}</div>` : ''}
    <div class="form-actions">
      <button class="btn btn-primary" id="btn-plan-commit" type="button" ${totalWritable === 0 ? 'disabled' : ''}>Import ${totalWritable} dog(s)</button>
      <button class="btn btn-soft" data-close type="button">Cancel</button>
    </div>`;
  const { el, close } = openModal(html);
  el.querySelector('#btn-plan-commit').addEventListener('click', async () => {
    const { written } = await dogImport.commit(plan);
    close();
    toast(`Synced ${written} dog(s) from KennelOS.`);
    await renderDogFilterSelect();
    await renderList();
  });
}

// ---- settings modal ----------------------------------------------------

async function openSettingsModal() {
  const connected = dropbox.isConnected();
  const html = `
    <div class="modal-head"><h2>Settings</h2><button class="icon-btn" data-close type="button">✕</button></div>

    <div class="settings-section">
      <h3>☁ Dropbox backup</h3>
      <p class="muted" style="margin:4px 0 10px;">${connected ? 'Connected — pushes automatically while the app is open.' : 'Connect once to push encrypted-in-transit backups automatically (works great from an iPhone).'}</p>
      <div class="settings-row">
        <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;"><input type="checkbox" id="chk-autopush" ${getAutoPush() ? 'checked' : ''} ${connected ? '' : 'disabled'}> Auto-push while open</label>
        <button class="btn ${connected ? 'btn-danger' : 'btn-primary'}" id="btn-dropbox-toggle" type="button">${connected ? 'Disconnect' : 'Connect Dropbox'}</button>
      </div>
      ${connected ? '<button class="btn btn-soft" id="btn-restore-dropbox" type="button">Restore from Dropbox…</button>' : ''}
    </div>

    <div class="settings-section">
      <h3>💾 Local backup</h3>
      <p class="muted" id="last-backup-label" style="margin:4px 0 10px;">${backupMod.lastBackupLabel()}</p>
      <div class="form-actions">
        <button class="btn btn-primary" id="btn-backup-now" type="button">Back up now</button>
        <label class="btn btn-soft">Restore from file…<input type="file" id="file-restore" accept=".zip" hidden></label>
      </div>
    </div>

    <div class="settings-section">
      <h3>🔄 Sync dogs from KennelOS</h3>
      <p class="muted" style="margin:4px 0 10px;">Pick a KennelOS JSON backup to bring its dog list in — a dry-run preview shows what would change before anything is written.</p>
      <label class="btn btn-soft">Choose KennelOS backup…<input type="file" id="file-dog-sync" accept="application/json,.json" hidden></label>
    </div>

    <div class="about">Kennel Papers keeps the actual pedigree, health-test, registration, and contract files for your KennelOS dogs. Files stay on this device except for backups you push to your own Dropbox app folder.</div>
  `;

  const { el, close } = openModal(html);

  el.querySelector('#chk-autopush').addEventListener('change', (e) => setAutoPush(e.target.checked));

  el.querySelector('#btn-dropbox-toggle').addEventListener('click', async () => {
    if (connected) {
      if (!confirm('Disconnect Dropbox? Auto-push will stop until you reconnect.')) return;
      await dropbox.disconnect();
      close();
      toast('Dropbox disconnected.');
      openSettingsModal();
    } else {
      try { await dropbox.connect(); } catch (err) { toast(err.message, 'err'); }
    }
  });

  el.querySelector('#btn-backup-now').addEventListener('click', async () => {
    try {
      const counts = connected ? await backupMod.pushToDropbox() : await backupMod.downloadBackup();
      toast(connected ? `Pushed to Dropbox (${counts.documentCount} documents).` : `Backed up ${counts.documentCount} documents.`);
      el.querySelector('#last-backup-label').textContent = backupMod.lastBackupLabel();
      refreshBackupBadge();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  el.querySelector('#btn-restore-dropbox')?.addEventListener('click', async () => {
    try {
      const backups = await dropbox.listBackups();
      if (backups.length === 0) { toast('No backups found in Dropbox yet.', 'err'); return; }
      const newest = backups[0];
      if (!confirm(`Restore from "${newest.name}" (the newest Dropbox backup)? This won't delete anything, only add/update.`)) return;
      const blob = await dropbox.download(newest.path_lower);
      const inspected = await backupMod.inspectBackup(blob);
      const counts = await backupMod.restoreBackup(inspected);
      toast(`Restored ${counts.documentCount} documents, ${counts.fileCount} files.`);
      close();
      await renderDogFilterSelect();
      await renderList();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  el.querySelector('#file-restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const inspected = await backupMod.inspectBackup(file);
      if (!confirm(`Restore ${inspected.dogs.length} dog(s) / ${inspected.documents.length} document(s) from this file? This won't delete anything, only add/update.`)) return;
      const counts = await backupMod.restoreBackup(inspected);
      toast(`Restored ${counts.documentCount} documents, ${counts.fileCount} files.`);
      close();
      await renderDogFilterSelect();
      await renderList();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  el.querySelector('#file-dog-sync').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const incomingDogs = await dogImport.parse(file);
      const plan = await dogImport.buildPlan(incomingDogs);
      close();
      openDogSyncPlanModal(plan);
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

// ---- backup status + auto-push ----------------------------------------

function refreshBackupBadge() {
  const btn = document.getElementById('btn-backup');
  const badge = document.getElementById('backup-badge');
  const label = backupMod.lastBackupLabel();
  btn.title = label;
  badge.hidden = label !== 'Never backed up';
}

// Auto-push triggers (guide §10): on add (called by the save handler above),
// on app open, and on visibilitychange -> hidden while foregrounded. Silent
// on failure — this is a convenience layer over the manual "Back up now".
async function maybeAutoPush() {
  if (!dropbox.isConnected() || !getAutoPush() || pushInFlight) return;
  pushInFlight = true;
  try {
    await backupMod.pushToDropbox();
    refreshBackupBadge();
  } catch (err) {
    console.warn('Kennel Papers: auto-push failed:', err.message);
  } finally {
    pushInFlight = false;
  }
}

// ---- boot ----------------------------------------------------------------

async function boot() {
  try {
    const justConnected = await dropbox.handleRedirect();
    if (justConnected) toast('Dropbox connected.');
  } catch (err) {
    toast(err.message, 'err');
  }

  renderTypeFilterRow();
  await renderDogFilterSelect();
  await renderList();
  refreshBackupBadge();

  document.getElementById('btn-add').addEventListener('click', () => openAddEditModal());
  document.getElementById('btn-settings').addEventListener('click', () => openSettingsModal());
  document.getElementById('btn-backup').addEventListener('click', async () => {
    try {
      const connected = dropbox.isConnected();
      const counts = connected ? await backupMod.pushToDropbox() : await backupMod.downloadBackup();
      toast(connected ? `Pushed to Dropbox (${counts.documentCount} documents).` : `Backed up ${counts.documentCount} documents.`);
      refreshBackupBadge();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderList();
  });
  document.getElementById('dog-filter').addEventListener('change', (e) => {
    dogFilter = e.target.value;
    renderList();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') maybeAutoPush();
  });

  maybeAutoPush(); // "on open"

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
