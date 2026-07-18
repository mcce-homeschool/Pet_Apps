// litter.js — Litter Detail. Edit-in-place profile (whelping counts, dates,
// optional linked-Pairing picker with sync-and-warn), a derived Puppy Roster
// panel (Dog records with this litter_id; Add Puppy / Add N Puppies), and a
// Timeline of litter-subject events. Hard blocks come from litterRepo (required
// fields); the sync/count/date checks are warn-only here per Stage 3 Brief §3.
import { litterRepo, ReferenceBlockedError } from '../data/litterRepo.js';
import { pairingRepo } from '../data/pairingRepo.js';
import { dogRepo } from '../data/dogRepo.js';
import { LITTER_STATUS, PAIRING_STATUS, DOG_STATUS, SEX, descriptor } from '../data/vocab.js';
import { esc, badge, fmtDate, todayYMD, param, confirmAction } from '../assets/ui.js';
import { renderTimeline } from '../assets/timeline.js';
import { openAddPuppyForm, openAddPuppiesForm } from '../assets/puppyForm.js';
import { openEventForm, openEventFromQuery } from '../assets/eventForm.js';

// Statuses that warrant the grow-out boarding prompt (Stage4.5 Addendum §C6).
const GROW_OUT_STATUSES = ['ready', 'placed'];

// Statuses at/after whelping — used to decide whether a future whelp_date warns.
const WHELPED_OR_LATER = ['whelped', 'weaning', 'ready', 'placed', 'closed'];

const els = {
  title: document.getElementById('litter-title'),
  subtitle: document.getElementById('litter-subtitle'),
  headerActions: document.getElementById('header-actions'),
  profileActions: document.getElementById('profile-actions'),
  body: document.getElementById('profile-body'),
  error: document.getElementById('page-error'),
  roster: document.getElementById('roster-section'),
  timeline: document.getElementById('timeline-section')
};

const blankLitter = () => ({
  pairing_id: '', dam_id: '', sire_id: '', nickname: '', whelp_date: '', litter_registration_number: '',
  puppies_born_total: '', puppies_born_alive: '', puppies_born_deceased: '', puppies_born_abnormalities: '', status: '', notes: '',
  expected_price_male: '', expected_price_female: '', expected_deposit_male: '', expected_deposit_female: ''
});

const ctx = {
  mode: 'view',
  original: null,
  draft: null,
  pickerArchived: false,
  allDogs: [],
  allPairings: [],
  dogsById: new Map(),
  pairingsById: new Map()
};

async function loadRefs() {
  const [dogs, pairings] = await Promise.all([
    dogRepo.getAll({ includeArchived: true }),
    pairingRepo.getAll({ includeArchived: true })
  ]);
  ctx.allDogs = dogs;
  ctx.allPairings = pairings;
  ctx.dogsById = new Map(dogs.map((d) => [d.id, d]));
  ctx.pairingsById = new Map(pairings.map((p) => [p.id, p]));
}

function dogName(id) {
  const d = ctx.dogsById.get(id);
  return d ? (d.call_name + (d.registered_name ? ` (${d.registered_name})` : '')) : '';
}
// Read-only dog reference → a link to that dog's detail page. Returns '' when the
// id doesn't resolve, so row() falls back to its faint dash. Escapes the name.
function dogLink(id) {
  const name = dogName(id);
  if (!name) return '';
  return `<a href="dog.html?id=${encodeURIComponent(id)}">${esc(name)}</a>`;
}
function pairingLabel(p) {
  if (!p) return '';
  return `${dogName(p.sire_id) || '—'} × ${dogName(p.dam_id) || '—'}${p.planned_date ? ` (${fmtDate(p.planned_date)})` : ''}`;
}

// --- Option builders -----------------------------------------------------
function vocabOptions(vocab, current, placeholder) {
  const head = placeholder != null ? `<option value="">${esc(placeholder)}</option>` : '';
  return head + vocab.map((v) =>
    `<option value="${esc(v.value)}"${v.value === current ? ' selected' : ''}>${esc(v.label)}</option>`
  ).join('');
}

function dogOptions(current, sex) {
  const opts = ctx.allDogs
    .filter((d) => ctx.pickerArchived || !d.is_archived || d.id === current)
    .filter((d) => !sex || d.id === current || d.sex === sex || d.sex === 'unknown')
    .map((d) => `<option value="${esc(d.id)}"${d.id === current ? ' selected' : ''}>${esc(d.call_name)}${d.registered_name ? ' — ' + esc(d.registered_name) : ''}${d.is_archived ? ' (archived)' : ''}</option>`)
    .join('');
  return `<option value="">— select —</option>` + opts;
}

function pairingOptions(current) {
  const opts = ctx.allPairings
    .filter((p) => ctx.pickerArchived || !p.is_archived || p.id === current)
    .map((p) => `<option value="${esc(p.id)}"${p.id === current ? ' selected' : ''}>${esc(pairingLabel(p))}${p.is_archived ? ' (archived)' : ''}</option>`)
    .join('');
  return `<option value="">— none —</option>` + opts;
}

// --- Read-only view ------------------------------------------------------
function row(label, valueHtml) {
  return `<dt>${esc(label)}</dt><dd>${valueHtml || '<span class="faint">—</span>'}</dd>`;
}

function money(v) {
  return v != null && v !== '' ? `$${Number(v).toFixed(2)}` : '';
}

function countsDisplay(l) {
  const has = (v) => v != null && v !== '';
  if (!has(l.puppies_born_total) && !has(l.puppies_born_alive) && !has(l.puppies_born_deceased) && !has(l.puppies_born_abnormalities)) return '';
  const parts = [];
  if (has(l.puppies_born_total)) parts.push(`${esc(String(l.puppies_born_total))} total`);
  if (has(l.puppies_born_alive)) parts.push(`${esc(String(l.puppies_born_alive))} alive`);
  if (has(l.puppies_born_deceased)) parts.push(`${esc(String(l.puppies_born_deceased))} deceased`);
  if (has(l.puppies_born_abnormalities)) parts.push(`${esc(String(l.puppies_born_abnormalities))} with abnormalities`);
  return parts.join(' · ');
}

function renderView() {
  const l = ctx.original;
  const pairing = ctx.pairingsById.get(l.pairing_id);
  const pairingHtml = pairing
    ? `<a href="pairing.html?id=${encodeURIComponent(pairing.id)}">${esc(pairingLabel(pairing))}</a>`
    : '';
  els.body.innerHTML = `
    ${syncWarningHtml(l)}
    <dl class="dl-meta" style="margin-top:14px;">
      ${row('Nickname', esc(l.nickname))}
      ${row('Dam', dogLink(l.dam_id))}
      ${row('Sire', dogLink(l.sire_id))}
      ${row('Linked pairing', pairingHtml)}
      ${row('Whelp date', l.whelp_date ? esc(fmtDate(l.whelp_date)) : '')}
      ${row('Litter registration #', esc(l.litter_registration_number))}
      ${row('Puppies born', countsDisplay(l))}
      ${row('Status', badge(LITTER_STATUS, l.status))}
      ${row('Expected price (male)', esc(money(l.expected_price_male)))}
      ${row('Expected deposit (male)', esc(money(l.expected_deposit_male)))}
      ${row('Expected price (female)', esc(money(l.expected_price_female)))}
      ${row('Expected deposit (female)', esc(money(l.expected_deposit_female)))}
      ${row('Notes', l.notes ? esc(l.notes).replace(/\n/g, '<br>') : '')}
    </dl>`;
}

// Sync-and-warn (Data Model §5.4 / Stage 3 Brief §3): when a pairing is linked,
// the litter's own dam/sire are authoritative but should match the pairing's.
// Mismatch warns, never blocks. Returns a banner (or '') for both view and edit.
function syncMismatches(l) {
  const pairing = ctx.pairingsById.get(l.pairing_id);
  if (!pairing) return [];
  const out = [];
  if (l.dam_id && pairing.dam_id && l.dam_id !== pairing.dam_id) {
    out.push(`This litter's dam (${dogName(l.dam_id) || '—'}) doesn't match the linked pairing's dam (${dogName(pairing.dam_id) || '—'}).`);
  }
  if (l.sire_id && pairing.sire_id && l.sire_id !== pairing.sire_id) {
    out.push(`This litter's sire (${dogName(l.sire_id) || '—'}) doesn't match the linked pairing's sire (${dogName(pairing.sire_id) || '—'}).`);
  }
  return out;
}
function syncWarningHtml(l) {
  const m = syncMismatches(l);
  return m.length ? `<div class="inline-warn">${m.map(esc).join('<br>')}</div>` : '';
}

// --- Edit form -----------------------------------------------------------
function field(label, inner, { required = false, hint = '', wide = false } = {}) {
  return `<div class="field${wide ? ' field-wide' : ''}">
    <label>${esc(label)}${required ? ' <span class="req">*</span>' : ''}</label>
    ${inner}
    ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
  </div>`;
}

function renderEdit() {
  const l = ctx.draft;
  els.body.innerHTML = `
    <div class="form-grid" id="litter-form" style="margin-top:14px;">
      ${field('Nickname', `<input id="f-nickname" type="text" value="${esc(l.nickname)}" maxlength="80">`, { hint: 'Optional friendly name for this litter, e.g. “Party of Five”.', wide: true })}
      ${field('Linked pairing', `<select id="f-pairing_id">${pairingOptions(l.pairing_id)}</select>`, { hint: 'Optional. Choosing one fills in dam/sire below (still editable).', wide: true })}
      ${field('Dam', `<select id="f-dam_id">${dogOptions(l.dam_id, 'female')}</select>`, { required: true })}
      ${field('Sire', `<select id="f-sire_id">${dogOptions(l.sire_id, 'male')}</select>`, { required: true })}
      ${field('Status', `<select id="f-status">${vocabOptions(LITTER_STATUS, l.status, 'Select…')}</select>`, { required: true })}
      ${field('Whelp date', `<input id="f-whelp_date" type="date" value="${esc(l.whelp_date)}">`, { hint: 'May be a projected date while status is Expected.' })}
      ${field('Litter registration #', `<input id="f-litter_registration_number" type="text" value="${esc(l.litter_registration_number)}">`)}
      ${field('Puppies born (total)', `<input id="f-puppies_born_total" type="number" min="0" value="${esc(l.puppies_born_total)}">`)}
      ${field('Born alive', `<input id="f-puppies_born_alive" type="number" min="0" value="${esc(l.puppies_born_alive)}">`)}
      ${field('Born deceased', `<input id="f-puppies_born_deceased" type="number" min="0" value="${esc(l.puppies_born_deceased)}">`)}
      ${field('Born with abnormalities', `<input id="f-puppies_born_abnormalities" type="number" min="0" value="${esc(l.puppies_born_abnormalities)}">`)}
      <div class="field field-wide"><h3 style="margin:8px 0 0;">Males — expected price &amp; deposit</h3></div>
      ${field('Expected price (male)', `<input id="f-expected_price_male" type="number" min="0" step="0.01" value="${esc(l.expected_price_male)}">`, { hint: 'Prefills a new sale\'s price when the puppy sold is male. Still editable per sale.' })}
      ${field('Expected deposit (male)', `<input id="f-expected_deposit_male" type="number" min="0" step="0.01" value="${esc(l.expected_deposit_male)}">`, { hint: 'Prefills a new sale\'s deposit amount when the puppy sold is male. Still editable per sale.' })}
      <div class="field field-wide"><h3 style="margin:8px 0 0;">Females — expected price &amp; deposit</h3></div>
      ${field('Expected price (female)', `<input id="f-expected_price_female" type="number" min="0" step="0.01" value="${esc(l.expected_price_female)}">`, { hint: 'Prefills a new sale\'s price when the puppy sold is female. Still editable per sale.' })}
      ${field('Expected deposit (female)', `<input id="f-expected_deposit_female" type="number" min="0" step="0.01" value="${esc(l.expected_deposit_female)}">`, { hint: 'Prefills a new sale\'s deposit amount when the puppy sold is female. Still editable per sale.' })}
      <div class="field field-wide">
        <label class="check-inline"><input id="picker-archived" type="checkbox"${ctx.pickerArchived ? ' checked' : ''}> Include archived dogs/pairings in the pickers above</label>
      </div>
      ${field('Notes', `<textarea id="f-notes">${esc(l.notes)}</textarea>`, { wide: true })}
    </div>
    <div id="form-warn"></div>`;

  const form = document.getElementById('litter-form');
  form.addEventListener('input', updateWarnings);
  form.addEventListener('change', updateWarnings);
  document.getElementById('picker-archived').addEventListener('change', (e) => {
    ctx.draft = readForm();
    ctx.pickerArchived = e.target.checked;
    renderEdit();
  });
  // Choosing a pairing fills dam/sire from it (only when those are still empty,
  // so it never clobbers a deliberate choice) — matches Stage 3 Brief §4.
  document.getElementById('f-pairing_id').addEventListener('change', (e) => {
    ctx.draft = readForm();
    const p = ctx.pairingsById.get(e.target.value);
    if (p) {
      if (!ctx.draft.dam_id) ctx.draft.dam_id = p.dam_id || '';
      if (!ctx.draft.sire_id) ctx.draft.sire_id = p.sire_id || '';
    }
    renderEdit();
  });
  updateWarnings();
}

function readForm() {
  const val = (id) => document.getElementById(id)?.value ?? '';
  return {
    ...ctx.draft,
    nickname: val('f-nickname').trim(),
    pairing_id: val('f-pairing_id') || '',
    dam_id: val('f-dam_id') || '',
    sire_id: val('f-sire_id') || '',
    status: val('f-status'),
    whelp_date: val('f-whelp_date'),
    litter_registration_number: val('f-litter_registration_number').trim(),
    puppies_born_total: val('f-puppies_born_total'),
    puppies_born_alive: val('f-puppies_born_alive'),
    puppies_born_deceased: val('f-puppies_born_deceased'),
    puppies_born_abnormalities: val('f-puppies_born_abnormalities'),
    expected_price_male: val('f-expected_price_male'),
    expected_price_female: val('f-expected_price_female'),
    expected_deposit_male: val('f-expected_deposit_male'),
    expected_deposit_female: val('f-expected_deposit_female'),
    notes: val('f-notes')
  };
}

function updateWarnings() {
  const l = readForm();
  const warns = [...syncMismatches(l)];
  const dam = ctx.dogsById.get(l.dam_id);
  const sire = ctx.dogsById.get(l.sire_id);
  if (dam && dam.sex === 'male') warns.push('Selected dam is recorded as male.');
  if (sire && sire.sex === 'female') warns.push('Selected sire is recorded as female.');

  const num = (v) => (v === '' || v == null ? null : Number(v));
  const total = num(l.puppies_born_total);
  const alive = num(l.puppies_born_alive);
  const deceased = num(l.puppies_born_deceased);
  if (total != null && alive != null && deceased != null && alive + deceased > total) {
    warns.push('Born alive + born deceased exceeds total born.');
  }
  if (l.whelp_date && WHELPED_OR_LATER.includes(l.status) && l.whelp_date > todayYMD()) {
    warns.push('Whelp date is in the future but the status is at or past “Whelped”.');
  }
  const box = document.getElementById('form-warn');
  if (box) box.innerHTML = warns.length ? `<div class="inline-warn">${warns.map(esc).join('<br>')}</div>` : '';
}

// --- Actions -------------------------------------------------------------
function renderProfileActions() {
  if (ctx.mode === 'view') {
    els.profileActions.innerHTML = `<button class="btn btn-sm" id="btn-edit">Edit</button>`;
    document.getElementById('btn-edit').onclick = enterEdit;
  } else {
    els.profileActions.innerHTML = `
      <button class="btn btn-primary btn-sm" id="btn-save">Save</button>
      <button class="btn btn-sm" id="btn-cancel">Cancel</button>`;
    document.getElementById('btn-save').onclick = save;
    document.getElementById('btn-cancel').onclick = cancel;
  }
}

async function renderHeaderActions() {
  els.headerActions.innerHTML = '';
  if (ctx.mode === 'new' || !ctx.original) return;
  const l = ctx.original;
  const archiveLabel = l.is_archived ? 'Unarchive' : 'Archive';
  const blockers = await litterRepo.getDeleteBlockers(l.id);
  const delTitle = blockers.length
    ? 'Referenced as ' + blockers.map((b) => `${b.label} (${b.count})`).join(', ') + ' — archive instead.'
    : 'Permanently delete this record.';
  els.headerActions.innerHTML = `
    <button class="btn btn-sm" id="btn-archive">${archiveLabel}</button>
    <button class="btn btn-danger btn-sm" id="btn-delete"${blockers.length ? ' disabled' : ''} title="${esc(delTitle)}">Delete</button>`;
  document.getElementById('btn-archive').onclick = toggleArchive;
  const del = document.getElementById('btn-delete');
  if (!blockers.length) del.onclick = doDelete;
}

function showError(msg) {
  els.error.innerHTML = `<div class="inline-error">${esc(msg)}</div>`;
  els.error.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function clearError() { els.error.innerHTML = ''; }

function enterEdit() {
  clearError();
  ctx.mode = 'edit';
  ctx.draft = { ...ctx.original };
  renderEdit();
  renderProfileActions();
  renderRosterSection();
  renderTimelineSection();
}

function cancel() {
  clearError();
  if (ctx.mode === 'new') { location.href = 'litters.html'; return; }
  ctx.mode = 'view';
  renderView();
  renderProfileActions();
  renderRosterSection();
  renderTimelineSection();
}

// Empty numeric strings become null so we don't persist '' where a number belongs.
function normalizeCounts(candidate) {
  for (const k of [
    'puppies_born_total', 'puppies_born_alive', 'puppies_born_deceased', 'puppies_born_abnormalities',
    'expected_price_male', 'expected_price_female', 'expected_deposit_male', 'expected_deposit_female'
  ]) {
    candidate[k] = candidate[k] === '' || candidate[k] == null ? null : Number(candidate[k]);
  }
  candidate.pairing_id = candidate.pairing_id || null;
  return candidate;
}

// Soft-suggestion prompt (Stage4.5 Addendum §C6): offered, never forced; no
// stored link back to this litter. If exactly one roster puppy is still at
// life-stage `puppy` (i.e. not yet placed with a buyer), prefill its boarding
// event directly; otherwise point the user at the roster below to pick one.
async function maybePromptGrowOut(litter) {
  const label = descriptor(LITTER_STATUS, litter.status).label;
  if (!confirmAction(`This litter is now "${label}". Log grow-out boarding for a puppy that isn't going straight to a buyer?`)) return;
  const puppies = await dogRepo.getByLitter(litter.id);
  const candidates = puppies.filter((p) => !p.is_archived && p.status === 'puppy');
  if (candidates.length === 1) {
    openEventForm({
      subjectType: 'dog', subjectId: candidates[0].id,
      prefill: { event_type: 'boarding', title: 'Grow-out boarding', details: { boarding_reason: 'Grow-out' } }
    });
  } else {
    window.alert('Pick the puppy from the roster below, then use its own "+ Add Event" to log the boarding stay.');
  }
}

// Soft-suggestion prompt: the first time a litter crosses into a whelped-or-
// later status, offer to sync its linked pairing's status to match (prefilled
// "Whelped", but editable — the pairing's real state might be something else
// entirely by then). Skipped silently when there's no linked pairing, or the
// pairing is already "Whelped".
function maybePromptPairingWhelped(litter) {
  if (!litter.pairing_id) return Promise.resolve();
  const pairing = ctx.pairingsById.get(litter.pairing_id);
  if (!pairing || pairing.status === 'whelped') return Promise.resolve();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2 style="margin-top:0;">Update the linked pairing's status?</h2>
      <p class="muted">This litter is now "${esc(descriptor(LITTER_STATUS, litter.status).label)}" — the linked pairing is still "${esc(descriptor(PAIRING_STATUS, pairing.status).label)}".</p>
      <div class="field">
        <label>Pairing status</label>
        <select id="pw-status">${vocabOptions(PAIRING_STATUS, 'whelped')}</select>
      </div>
      <div id="pw-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="pw-confirm">Confirm</button>
        <button class="btn" id="pw-skip">Skip</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); resolve(); };
    overlay.querySelector('#pw-skip').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#pw-confirm').addEventListener('click', async () => {
      const status = overlay.querySelector('#pw-status').value;
      if (!status) { close(); return; }
      try {
        await pairingRepo.update(pairing.id, { status });
        close();
      } catch (e) {
        overlay.querySelector('#pw-error').innerHTML = `<div class="inline-error">${esc(e.message || String(e))}</div>`;
      }
    });
  });
}

async function save() {
  clearError();
  const candidate = normalizeCounts(readForm());
  try {
    if (ctx.mode === 'new') {
      const saved = await litterRepo.create(candidate);
      location.href = `litter.html?id=${encodeURIComponent(saved.id)}`;
      return;
    }
    const prevStatus = ctx.original.status;
    const saved = await litterRepo.update(ctx.original.id, candidate);
    ctx.original = saved;
    ctx.mode = 'view';
    await loadRefs();
    ctx.original = await litterRepo.getById(saved.id);
    renderAll();
    const enteringWhelpBand = WHELPED_OR_LATER.includes(saved.status) && !WHELPED_OR_LATER.includes(prevStatus);
    if (enteringWhelpBand) {
      await maybePromptPairingWhelped(saved);
    }
    if (GROW_OUT_STATUSES.includes(saved.status) && prevStatus !== saved.status) {
      await maybePromptGrowOut(saved);
    }
  } catch (e) {
    showError(e.message || String(e));
  }
}

async function toggleArchive() {
  const l = ctx.original;
  const verb = l.is_archived ? 'Unarchive' : 'Archive';
  if (!confirmAction(`${verb} this litter?`)) return;
  ctx.original = l.is_archived ? await litterRepo.unarchive(l.id) : await litterRepo.archive(l.id);
  renderAll();
}

async function doDelete() {
  const l = ctx.original;
  if (!confirmAction('Permanently delete this litter? This cannot be undone.')) return;
  try {
    await litterRepo.hardDelete(l.id);
    location.href = 'litters.html';
  } catch (e) {
    if (e instanceof ReferenceBlockedError) { showError(e.message); await renderHeaderActions(); }
    else showError(e.message || String(e));
  }
}

// --- Puppy Roster panel --------------------------------------------------
async function renderRosterSection() {
  if (!els.roster) return;
  if (ctx.mode !== 'view' || !ctx.original) { els.roster.innerHTML = ''; return; }

  const puppies = await dogRepo.getByLitter(ctx.original.id);
  puppies.sort((a, b) => (a.call_name || '').localeCompare(b.call_name || '', undefined, { numeric: true }));
  const activePuppies = puppies.filter((d) => !d.is_archived);

  const rowsHtml = puppies.length
    ? `<ul class="linked-list" style="margin:14px 0 0; padding:0; list-style:none;">` + puppies.map((d) => `
        <li class="row-between" style="padding:8px 0; border-top:1px solid var(--border);">
          <span>${badge(SEX, d.sex)} <strong>${esc(d.call_name)}</strong>${d.registered_name ? ` <span class="faint">${esc(d.registered_name)}</span>` : ''} ${badge(DOG_STATUS, d.status)}${d.is_archived ? ' <span class="badge badge-gray">Archived</span>' : ''}</span>
          <a class="btn btn-sm" href="dog.html?id=${encodeURIComponent(d.id)}">Open →</a>
        </li>`).join('') + `</ul>`
    : `<p class="muted" style="margin:14px 0 0;">No puppies recorded yet. Each puppy is an ordinary Dog record with this litter set.</p>`;

  const dam = ctx.dogsById.get(ctx.original.dam_id);
  const damHasBreed = !!(dam && dam.breed);

  els.roster.innerHTML = `
    <section class="card" style="margin-top:16px;">
      <div class="row-between">
        <h2 style="margin:0;">Puppy Roster${puppies.length ? ` <span class="faint">(${puppies.length})</span>` : ''}</h2>
        <div class="pill-row">
          <button class="btn btn-primary btn-sm" id="btn-add-puppy"${damHasBreed ? '' : ' disabled title="Set the dam\'s breed first."'}>+ Add Puppy</button>
          <button class="btn btn-sm" id="btn-add-puppies"${damHasBreed ? '' : ' disabled'}>+ Add N Puppies</button>
          <button class="btn btn-sm" id="btn-cascade-event"${activePuppies.length ? '' : ' disabled title="No puppies to log against."'}>+ Log event for whole litter</button>
        </div>
      </div>
      ${rowsHtml}
    </section>`;

  const add = document.getElementById('btn-add-puppy');
  const addN = document.getElementById('btn-add-puppies');
  if (add && damHasBreed) add.onclick = () => openAddPuppyForm({ litter: ctx.original, dam, onSaved: refreshRosterAndCounts });
  if (addN && damHasBreed) addN.onclick = () => openAddPuppiesForm({ litter: ctx.original, dam, existingCount: puppies.length, onSaved: refreshRosterAndCounts });
  const cascadeBtn = document.getElementById('btn-cascade-event');
  if (cascadeBtn && activePuppies.length) {
    cascadeBtn.onclick = () => openEventForm({
      subjectType: 'dog',
      cascadeTargets: activePuppies.map((p) => ({ id: p.id, label: `${p.call_name}${p.sex ? ` (${descriptor(SEX, p.sex).label[0]})` : ''}` })),
      onSaved: () => { renderRosterSection(); renderTimelineSection(); }
    });
  }
}

// After adding puppies the roster (and dog names cached in ctx) may have changed.
async function refreshRosterAndCounts() {
  await loadRefs();
  renderRosterSection();
}

// --- Timeline ------------------------------------------------------------
function renderTimelineSection() {
  if (!els.timeline) return;
  if (ctx.mode === 'view' && ctx.original) {
    renderTimeline({ mount: els.timeline, subjectType: 'litter', subjectId: ctx.original.id, title: 'Timeline' });
  } else {
    els.timeline.innerHTML = '';
  }
}

// --- Top-level render ----------------------------------------------------
function renderTitle() {
  if (ctx.mode === 'new') {
    els.title.textContent = 'New Litter';
    els.subtitle.textContent = 'Choose a dam and sire, then save.';
    return;
  }
  const l = ctx.original;
  const cross = `${dogName(l.dam_id) || '—'} × ${dogName(l.sire_id) || '—'}`;
  const archived = l.is_archived ? ' <span class="badge badge-gray">Archived</span>' : '';
  const whelped = l.whelp_date ? `Whelped ${esc(fmtDate(l.whelp_date))}` : '';
  // The nickname is the friendly label; when present it leads, with dam × sire
  // and whelp date demoted to the subtitle. Otherwise dam × sire is the title.
  if (l.nickname) {
    els.title.innerHTML = esc(l.nickname) + archived;
    els.subtitle.innerHTML = esc(cross) + (whelped ? ` · ${whelped}` : '');
  } else {
    els.title.innerHTML = esc(cross) + archived;
    els.subtitle.innerHTML = whelped;
  }
}

function renderAll() {
  renderTitle();
  renderProfileActions();
  renderHeaderActions();
  if (ctx.mode === 'view') renderView();
  else renderEdit();
  renderRosterSection();
  renderTimelineSection();
}

async function main() {
  await loadRefs();
  const id = param('id');
  const isNew = param('new');

  if (isNew) {
    ctx.mode = 'new';
    ctx.draft = blankLitter();
    // Pre-fill from a pairing when arriving via "Create Litter from this Pairing".
    const pairingId = param('pairing');
    if (pairingId && ctx.pairingsById.has(pairingId)) {
      const p = ctx.pairingsById.get(pairingId);
      ctx.draft.pairing_id = p.id;
      ctx.draft.dam_id = p.dam_id || '';
      ctx.draft.sire_id = p.sire_id || '';
      // Sensible default status: a just-created pairing→litter is usually expected.
      ctx.draft.status = 'expected';
    }
    renderTitle();
    renderEdit();
    renderProfileActions();
    renderHeaderActions();
    return;
  }

  if (!id) { showError('No litter id provided.'); return; }
  const l = await litterRepo.getById(id);
  if (!l) { showError('Litter not found. It may have been deleted.'); return; }
  ctx.original = l;
  ctx.mode = 'view';
  renderAll();
  openEventFromQuery('litter', l.id, renderTimelineSection);
}

main();
