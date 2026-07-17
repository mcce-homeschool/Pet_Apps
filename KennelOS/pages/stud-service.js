// stud-service.js — Stud Service Detail. Edit-in-place profile, including the
// canonical `pairing_id` link (mirrors Litter's "Linked pairing" field — this
// entity OWNS the pointer, so it's a plain editable field, not a derived panel)
// plus a convenience to create the pairing when none is linked yet. A derived
// Contracts panel (contracts.related_stud_service_id = this — canonical on
// Contract, Stage4 Revision v2 §5).
import { studServiceRepo, ReferenceBlockedError } from '../data/studServiceRepo.js';
import { contractRepo } from '../data/contractRepo.js';
import { pairingRepo } from '../data/pairingRepo.js';
import { dogRepo } from '../data/dogRepo.js';
import { contactRepo } from '../data/contactRepo.js';
import {
  STUD_SERVICE_DIRECTION, FEE_STRUCTURE, STUD_SERVICE_STATUS,
  CONTRACT_TYPE, CONTRACT_STATUS
} from '../data/vocab.js';
import { esc, badge, fmtDate, param, confirmAction } from '../assets/ui.js';
import { openEventForm } from '../assets/eventForm.js';

const els = {
  title: document.getElementById('ss-title'),
  subtitle: document.getElementById('ss-subtitle'),
  headerActions: document.getElementById('header-actions'),
  profileActions: document.getElementById('profile-actions'),
  body: document.getElementById('profile-body'),
  error: document.getElementById('page-error'),
  contracts: document.getElementById('contracts-section')
};

const blankStudService = () => ({
  direction: '', our_dog_id: '', partner_dog_id: '', partner_contact_id: '',
  fee_amount: '', fee_structure: '', pairing_id: '', status: '', result_notes: '', notes: ''
});

const ctx = {
  mode: 'view', original: null, draft: null, pickerArchived: false,
  allDogs: [], allContacts: [], allPairings: [],
  dogsById: new Map(), contactsById: new Map(), pairingsById: new Map()
};

async function loadRefs() {
  const [dogs, contacts, pairings] = await Promise.all([
    dogRepo.getAll({ includeArchived: true }),
    contactRepo.getAll({ includeArchived: true }),
    pairingRepo.getAll({ includeArchived: true })
  ]);
  ctx.allDogs = dogs;
  ctx.allContacts = contacts;
  ctx.allPairings = pairings;
  ctx.dogsById = new Map(dogs.map((d) => [d.id, d]));
  ctx.contactsById = new Map(contacts.map((c) => [c.id, c]));
  ctx.pairingsById = new Map(pairings.map((p) => [p.id, p]));
}

function dogName(id) {
  const d = ctx.dogsById.get(id);
  return d ? (d.call_name + (d.registered_name ? ` (${d.registered_name})` : '')) : '';
}
function contactName(id) { return ctx.contactsById.get(id)?.name || ''; }
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

function dogOptions(current) {
  const opts = ctx.allDogs
    .filter((d) => ctx.pickerArchived || !d.is_archived || d.id === current)
    .map((d) => `<option value="${esc(d.id)}"${d.id === current ? ' selected' : ''}>${esc(d.call_name)}${d.registered_name ? ' — ' + esc(d.registered_name) : ''}${d.is_archived ? ' (archived)' : ''}</option>`)
    .join('');
  return `<option value="">— select —</option>` + opts;
}

function contactOptions(current) {
  const opts = ctx.allContacts
    .filter((c) => ctx.pickerArchived || !c.is_archived || c.id === current)
    .map((c) => `<option value="${esc(c.id)}"${c.id === current ? ' selected' : ''}>${esc(c.name)}${c.is_archived ? ' (archived)' : ''}</option>`)
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

// --- Read-only view --------------------------------------------------------
function row(label, valueHtml) {
  return `<dt>${esc(label)}</dt><dd>${valueHtml || '<span class="faint">—</span>'}</dd>`;
}

function money(v) { return v != null && v !== '' ? `$${Number(v).toFixed(2)}` : ''; }

function renderView() {
  const s = ctx.original;
  const pairing = ctx.pairingsById.get(s.pairing_id);
  const pairingHtml = pairing
    ? `<a href="pairing.html?id=${encodeURIComponent(pairing.id)}">${esc(pairingLabel(pairing))}</a>`
    : `<a class="btn btn-sm" href="pairing.html?new=1&stud_service=${encodeURIComponent(s.id)}">+ Create Pairing from this Stud Service</a>`;
  els.body.innerHTML = `
    <dl class="dl-meta" style="margin-top:14px;">
      ${row('Direction', badge(STUD_SERVICE_DIRECTION, s.direction))}
      ${row('Our dog', `<a href="dog.html?id=${encodeURIComponent(s.our_dog_id)}">${esc(dogName(s.our_dog_id) || '—')}</a>`)}
      ${row('Partner dog', s.partner_dog_id ? `<a href="dog.html?id=${encodeURIComponent(s.partner_dog_id)}">${esc(dogName(s.partner_dog_id) || '—')}</a>` : '')}
      ${row('Partner contact', s.partner_contact_id ? `<a href="contact.html?id=${encodeURIComponent(s.partner_contact_id)}">${esc(contactName(s.partner_contact_id) || '—')}</a>` : '')}
      ${row('Fee', esc(money(s.fee_amount)) + (s.fee_structure ? ` <span class="faint">(${esc((FEE_STRUCTURE.find(f => f.value === s.fee_structure) || {}).label || s.fee_structure)})</span>` : ''))}
      ${row('Linked pairing', pairingHtml)}
      ${row('Status', badge(STUD_SERVICE_STATUS, s.status))}
      ${row('Result notes', s.result_notes ? esc(s.result_notes).replace(/\n/g, '<br>') : '')}
      ${row('Notes', s.notes ? esc(s.notes).replace(/\n/g, '<br>') : '')}
    </dl>`;
}

// --- Edit form ---------------------------------------------------------
function field(label, inner, { required = false, hint = '', wide = false } = {}) {
  return `<div class="field${wide ? ' field-wide' : ''}">
    <label>${esc(label)}${required ? ' <span class="req">*</span>' : ''}</label>
    ${inner}
    ${hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
  </div>`;
}

function renderEdit() {
  const s = ctx.draft;
  els.body.innerHTML = `
    <div class="form-grid" id="ss-form" style="margin-top:14px;">
      ${field('Direction', `<select id="f-direction">${vocabOptions(STUD_SERVICE_DIRECTION, s.direction, 'Select…')}</select>`, { required: true, hint: 'Outgoing = our dog is the stud. Incoming = our dog is the dam.' })}
      ${field('Our dog', `<select id="f-our_dog_id">${dogOptions(s.our_dog_id)}</select>`, { required: true })}
      ${field('Partner dog', `<select id="f-partner_dog_id">${dogOptions(s.partner_dog_id)}</select>`, { required: true })}
      ${field('Partner contact', `<select id="f-partner_contact_id">${contactOptions(s.partner_contact_id)}</select>`, { required: true, hint: 'Owner of the partner dog.' })}
      ${field('Fee amount', `<input id="f-fee_amount" type="number" min="0" step="0.01" value="${esc(s.fee_amount)}">`)}
      ${field('Fee structure', `<select id="f-fee_structure">${vocabOptions(FEE_STRUCTURE, s.fee_structure, '— none —')}</select>`)}
      ${field('Linked pairing', `<select id="f-pairing_id">${pairingOptions(s.pairing_id)}</select>`, { hint: 'Optional — the actual breeding record and outcome.' })}
      ${field('Status', `<select id="f-status">${vocabOptions(STUD_SERVICE_STATUS, s.status, 'Select…')}</select>`, { required: true })}
      <div class="field field-wide">
        <label class="check-inline"><input id="picker-archived" type="checkbox"${ctx.pickerArchived ? ' checked' : ''}> Include archived dogs/contacts/pairings in the pickers above</label>
      </div>
      ${field('Result notes', `<textarea id="f-result_notes">${esc(s.result_notes)}</textarea>`, { wide: true })}
      ${field('Notes', `<textarea id="f-notes">${esc(s.notes)}</textarea>`, { wide: true })}
    </div>
    <div id="form-warn"></div>`;

  const form = document.getElementById('ss-form');
  form.addEventListener('input', updateWarnings);
  form.addEventListener('change', updateWarnings);
  document.getElementById('picker-archived').addEventListener('change', (e) => {
    ctx.draft = readForm();
    ctx.pickerArchived = e.target.checked;
    renderEdit();
  });
  updateWarnings();
}

function readForm() {
  const val = (id) => document.getElementById(id)?.value ?? '';
  return {
    ...ctx.draft,
    direction: val('f-direction'),
    our_dog_id: val('f-our_dog_id') || '',
    partner_dog_id: val('f-partner_dog_id') || '',
    partner_contact_id: val('f-partner_contact_id') || '',
    fee_amount: val('f-fee_amount'),
    fee_structure: val('f-fee_structure') || '',
    pairing_id: val('f-pairing_id') || null,
    status: val('f-status'),
    result_notes: val('f-result_notes'),
    notes: val('f-notes')
  };
}

function updateWarnings() {
  const s = readForm();
  const warns = [];
  const our = ctx.dogsById.get(s.our_dog_id);
  if (our && s.direction === 'outgoing' && our.sex === 'female') warns.push('Direction is “outgoing” (our dog is the stud) but our dog is recorded as female.');
  if (our && s.direction === 'incoming' && our.sex === 'male') warns.push('Direction is “incoming” (our dog is the dam) but our dog is recorded as male.');
  if (s.our_dog_id && s.partner_dog_id && s.our_dog_id === s.partner_dog_id) warns.push('Our dog and the partner dog are the same dog — this will be blocked on save.');
  const box = document.getElementById('form-warn');
  if (box) box.innerHTML = warns.length ? `<div class="inline-warn">${warns.map(esc).join('<br>')}</div>` : '';
}

// Empty numeric strings become null.
function normalizeMoney(candidate) {
  candidate.fee_amount = candidate.fee_amount === '' || candidate.fee_amount == null ? null : Number(candidate.fee_amount);
  return candidate;
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
  const s = ctx.original;
  const archiveLabel = s.is_archived ? 'Unarchive' : 'Archive';
  const blockers = await studServiceRepo.getDeleteBlockers(s.id);
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
  renderContractsSection();
}

function cancel() {
  clearError();
  if (ctx.mode === 'new') { location.href = 'stud-services.html'; return; }
  ctx.mode = 'view';
  renderView();
  renderProfileActions();
  renderContractsSection();
}

async function save() {
  clearError();
  const candidate = normalizeMoney(readForm());
  try {
    if (ctx.mode === 'new') {
      const saved = await studServiceRepo.create(candidate);
      const goToDetail = () => { location.href = `stud-service.html?id=${encodeURIComponent(saved.id)}`; };
      // Soft-suggestion prompt (Stage4.5 Addendum §C6) — offered, never forced;
      // no stored link back to this stud service. `our_dog_id` is the subject in
      // both directions: it's always our own tracked dog whose whereabouts this
      // board cares about, whether it travels out or the partner comes to us.
      if (confirmAction('Log a boarding event for this stud service arrangement?')) {
        openEventForm({
          subjectType: 'dog', subjectId: saved.our_dog_id,
          prefill: {
            event_type: 'boarding', related_contact_id: saved.partner_contact_id,
            title: 'Stud service boarding', details: { boarding_reason: 'Stud service' }
          },
          onSaved: goToDetail, onCancel: goToDetail
        });
      } else {
        goToDetail();
      }
      return;
    }
    const saved = await studServiceRepo.update(ctx.original.id, candidate);
    ctx.original = saved;
    ctx.mode = 'view';
    await loadRefs();
    ctx.original = await studServiceRepo.getById(saved.id);
    renderAll();
  } catch (e) {
    showError(e.message || String(e));
  }
}

async function toggleArchive() {
  const s = ctx.original;
  const verb = s.is_archived ? 'Unarchive' : 'Archive';
  if (!confirmAction(`${verb} this stud service?`)) return;
  ctx.original = s.is_archived ? await studServiceRepo.unarchive(s.id) : await studServiceRepo.archive(s.id);
  renderAll();
}

async function doDelete() {
  const s = ctx.original;
  if (!confirmAction('Permanently delete this stud service? This cannot be undone.')) return;
  try {
    await studServiceRepo.hardDelete(s.id);
    location.href = 'stud-services.html';
  } catch (e) {
    if (e instanceof ReferenceBlockedError) { showError(e.message); await renderHeaderActions(); }
    else showError(e.message || String(e));
  }
}

// --- Contracts panel (derived) --------------------------------------------
async function renderContractsSection() {
  if (!els.contracts) return;
  if (ctx.mode !== 'view' || !ctx.original) { els.contracts.innerHTML = ''; return; }
  const contracts = await contractRepo.getByStudService(ctx.original.id);
  contracts.sort((a, b) => (b.signed_date || b.created_at || '').localeCompare(a.signed_date || a.created_at || ''));

  const inner = contracts.length
    ? `<ul class="linked-list" style="margin:14px 0 0; padding:0; list-style:none;">` + contracts.map((c) => `
        <li class="row-between" style="padding:8px 0; border-top:1px solid var(--border);">
          <span>${badge(CONTRACT_TYPE, c.contract_type)} <strong>${esc(c.title || 'Contract')}</strong> ${badge(CONTRACT_STATUS, c.status)}${c.signed_date ? ` <span class="faint">signed ${esc(fmtDate(c.signed_date))}</span>` : ''}</span>
          <a class="btn btn-sm" href="contract.html?id=${encodeURIComponent(c.id)}">Open →</a>
        </li>`).join('') + `</ul>`
    : `<p class="muted" style="margin:14px 0 0;">No contracts attached to this stud service yet.</p>`;

  els.contracts.innerHTML = `
    <section class="card" style="margin-top:16px;">
      <div class="row-between">
        <h2 style="margin:0;">Contracts</h2>
        <a class="btn btn-sm" href="contract.html?new=1&stud_service=${encodeURIComponent(ctx.original.id)}">+ Create Contract</a>
      </div>
      ${inner}
    </section>`;
}

// --- Top-level render ------------------------------------------------------
function renderTitle() {
  if (ctx.mode === 'new') {
    els.title.textContent = 'New Stud Service';
    els.subtitle.textContent = 'Choose a direction, our dog, and the partner, then save.';
    return;
  }
  const s = ctx.original;
  const label = `${dogName(s.our_dog_id) || '—'} × ${dogName(s.partner_dog_id) || '—'}`;
  els.title.innerHTML = esc(label) + (s.is_archived ? ' <span class="badge badge-gray">Archived</span>' : '');
  els.subtitle.innerHTML = '';
}

function renderAll() {
  renderTitle();
  renderProfileActions();
  renderHeaderActions();
  if (ctx.mode === 'view') renderView();
  else renderEdit();
  renderContractsSection();
}

async function main() {
  await loadRefs();
  const id = param('id');
  const isNew = param('new');

  if (isNew) {
    ctx.mode = 'new';
    ctx.draft = blankStudService();
    const dogId = param('dog');
    if (dogId && ctx.dogsById.has(dogId)) ctx.draft.our_dog_id = dogId;
    renderTitle();
    renderEdit();
    renderProfileActions();
    renderHeaderActions();
    return;
  }

  if (!id) { showError('No stud service id provided.'); return; }
  const s = await studServiceRepo.getById(id);
  if (!s) { showError('Stud service not found. It may have been deleted.'); return; }
  ctx.original = s;
  ctx.mode = 'view';
  renderAll();
}

main();
