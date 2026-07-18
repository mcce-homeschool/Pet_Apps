// sale.js — Sale Detail. Edit-in-place profile and a derived Contracts panel
// (contracts.related_sale_id = this sale — canonical on Contract, never a
// Sale.contract_id, Stage4 Revision v2 §5). Buyer is a Contact (no Buyer table).
import { saleRepo, ReferenceBlockedError } from '../data/saleRepo.js';
import { contractRepo } from '../data/contractRepo.js';
import { dogRepo } from '../data/dogRepo.js';
import { contactRepo } from '../data/contactRepo.js';
import { litterRepo } from '../data/litterRepo.js';
import { PLACEMENT_TYPE, SALE_STATUS, CONTRACT_TYPE, CONTRACT_STATUS } from '../data/vocab.js';
import { esc, badge, fmtDate, todayYMD, param, confirmAction } from '../assets/ui.js';
import { openEventForm } from '../assets/eventForm.js';
import { attachNewContactButton } from '../assets/contactPicker.js';

// Statuses that warrant the "log a scheduled pickup" prompt (Stage4.5 Addendum §D4).
const PLACEMENT_PROMPT_STATUSES = ['paid_in_full', 'delivered'];

const els = {
  title: document.getElementById('sale-title'),
  subtitle: document.getElementById('sale-subtitle'),
  headerActions: document.getElementById('header-actions'),
  profileActions: document.getElementById('profile-actions'),
  body: document.getElementById('profile-body'),
  error: document.getElementById('page-error'),
  contracts: document.getElementById('contracts-section')
};

const blankSale = () => ({
  dog_id: '', buyer_contact_id: '', sale_date: '', price: '', deposit_amount: '',
  deposit_date: '', balance_paid_date: '', placement_type: '', lead_source: '',
  referred_by_contact_id: '', status: '', notes: ''
});

const ctx = {
  mode: 'view', original: null, draft: null, pickerArchived: false,
  allDogs: [], allContacts: [], leadSources: [],
  dogsById: new Map(), contactsById: new Map(), littersById: new Map()
};

async function loadRefs() {
  const [dogs, contacts, leadSources, litters] = await Promise.all([
    dogRepo.getAll({ includeArchived: true }),
    contactRepo.getAll({ includeArchived: true }),
    saleRepo.getLeadSources(),
    litterRepo.getAll({ includeArchived: true })
  ]);
  ctx.allDogs = dogs;
  ctx.allContacts = contacts;
  ctx.leadSources = leadSources;
  ctx.dogsById = new Map(dogs.map((d) => [d.id, d]));
  ctx.contactsById = new Map(contacts.map((c) => [c.id, c]));
  ctx.littersById = new Map(litters.map((l) => [l.id, l]));
}

// Prefills price/deposit_amount from the dog's litter (Litter.expected_price_male/
// _female and expected_deposit_male/_female, both by the dog's sex) — only into
// fields still empty, so it never clobbers a value already entered (same pattern as
// the buyer's first_contact_source -> lead_source prefill below).
function applyExpectedPricing() {
  const dog = ctx.dogsById.get(ctx.draft.dog_id);
  const litter = dog && dog.litter_id ? ctx.littersById.get(dog.litter_id) : null;
  if (!litter) return;
  if (!ctx.draft.price) {
    const expected = dog.sex === 'male' ? litter.expected_price_male
      : dog.sex === 'female' ? litter.expected_price_female : null;
    if (expected != null) ctx.draft.price = expected;
  }
  if (!ctx.draft.deposit_amount) {
    const expected = dog.sex === 'male' ? litter.expected_deposit_male
      : dog.sex === 'female' ? litter.expected_deposit_female : null;
    if (expected != null) ctx.draft.deposit_amount = expected;
  }
}

function dogName(id) {
  const d = ctx.dogsById.get(id);
  return d ? (d.call_name + (d.registered_name ? ` (${d.registered_name})` : '')) : '';
}
function contactName(id) {
  return ctx.contactsById.get(id)?.name || '';
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

// --- Read-only view --------------------------------------------------------
function row(label, valueHtml) {
  return `<dt>${esc(label)}</dt><dd>${valueHtml || '<span class="faint">—</span>'}</dd>`;
}

function money(v) {
  return v != null && v !== '' ? `$${Number(v).toFixed(2)}` : '';
}

function renderView() {
  const s = ctx.original;
  els.body.innerHTML = `
    <dl class="dl-meta" style="margin-top:14px;">
      ${row('Dog', `<a href="dog.html?id=${encodeURIComponent(s.dog_id)}">${esc(dogName(s.dog_id) || '—')}</a>`)}
      ${row('Buyer', `<a href="contact.html?id=${encodeURIComponent(s.buyer_contact_id)}">${esc(contactName(s.buyer_contact_id) || '—')}</a>`)}
      ${row('Placement type', badge(PLACEMENT_TYPE, s.placement_type))}
      ${row('Status', badge(SALE_STATUS, s.status))}
      ${row('Sale date', s.sale_date ? esc(fmtDate(s.sale_date)) : '')}
      ${row('Price', esc(money(s.price)))}
      ${row('Deposit', esc(money(s.deposit_amount)) + (s.deposit_date ? ` <span class="faint">(${esc(fmtDate(s.deposit_date))})</span>` : ''))}
      ${row('Balance paid', s.balance_paid_date ? esc(fmtDate(s.balance_paid_date)) : '')}
      ${row('Lead source', esc(s.lead_source))}
      ${row('Referred by', s.referred_by_contact_id ? `<a href="contact.html?id=${encodeURIComponent(s.referred_by_contact_id)}">${esc(contactName(s.referred_by_contact_id) || '—')}</a>` : '')}
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
  const sourceList = ctx.leadSources.map((v) => `<option value="${esc(v)}"></option>`).join('');
  els.body.innerHTML = `
    <div class="form-grid" id="sale-form" style="margin-top:14px;">
      ${field('Dog', `<select id="f-dog_id">${dogOptions(s.dog_id)}</select>`, { required: true })}
      ${field('Buyer', `<select id="f-buyer_contact_id">${contactOptions(s.buyer_contact_id)}</select>`, { required: true })}
      ${field('Placement type', `<select id="f-placement_type">${vocabOptions(PLACEMENT_TYPE, s.placement_type, 'Select…')}</select>`, { required: true })}
      ${field('Status', `<select id="f-status">${vocabOptions(SALE_STATUS, s.status, 'Select…')}</select>`, { required: true })}
      ${field('Sale date', `<input id="f-sale_date" type="date" value="${esc(s.sale_date)}">`)}
      ${field('Price', `<input id="f-price" type="number" min="0" step="0.01" value="${esc(s.price)}">`)}
      ${field('Deposit amount', `<input id="f-deposit_amount" type="number" min="0" step="0.01" value="${esc(s.deposit_amount)}">`)}
      ${field('Deposit date', `<input id="f-deposit_date" type="date" value="${esc(s.deposit_date)}">`)}
      ${field('Balance paid date', `<input id="f-balance_paid_date" type="date" value="${esc(s.balance_paid_date)}">`)}
      ${field('Lead source', `<input id="f-lead_source" type="text" list="lead-source-list" value="${esc(s.lead_source)}"><datalist id="lead-source-list">${sourceList}</datalist>`, { hint: 'How this specific sale came in. Prefills from the buyer, but may differ.' })}
      ${field('Referred by', `<select id="f-referred_by_contact_id">${contactOptions(s.referred_by_contact_id)}</select>`, { hint: 'The contact who referred this buyer. Tags them as a Buyer referrer automatically.' })}
      <div class="field field-wide">
        <label class="check-inline"><input id="picker-archived" type="checkbox"${ctx.pickerArchived ? ' checked' : ''}> Include archived dogs/contacts in the pickers above</label>
      </div>
      ${field('Notes', `<textarea id="f-notes">${esc(s.notes)}</textarea>`, { wide: true })}
    </div>`;

  document.getElementById('picker-archived').addEventListener('change', (e) => {
    ctx.draft = readForm();
    ctx.pickerArchived = e.target.checked;
    renderEdit();
  });
  // Prefilling price/deposit_amount from the selected dog's litter (only when
  // those fields are still empty, so it never clobbers a deliberate entry).
  document.getElementById('f-dog_id').addEventListener('change', () => {
    ctx.draft = readForm();
    applyExpectedPricing();
    renderEdit();
  });
  // Prefilling lead_source from the buyer's first_contact_source (only when
  // lead_source is still empty, so it never clobbers a deliberate choice) —
  // Stage4 Revision v2 §3.
  document.getElementById('f-buyer_contact_id').addEventListener('change', (e) => {
    ctx.draft = readForm();
    const c = ctx.contactsById.get(e.target.value);
    if (c && c.first_contact_source && !ctx.draft.lead_source) {
      ctx.draft.lead_source = c.first_contact_source;
    }
    renderEdit();
  });
  const onNewContact = (contact) => {
    ctx.allContacts.push(contact);
    ctx.contactsById.set(contact.id, contact);
  };
  attachNewContactButton(document.getElementById('f-buyer_contact_id'), { onCreated: onNewContact });
  attachNewContactButton(document.getElementById('f-referred_by_contact_id'), { onCreated: onNewContact });
}

function readForm() {
  const val = (id) => document.getElementById(id)?.value ?? '';
  return {
    ...ctx.draft,
    dog_id: val('f-dog_id') || '',
    buyer_contact_id: val('f-buyer_contact_id') || '',
    placement_type: val('f-placement_type'),
    status: val('f-status'),
    sale_date: val('f-sale_date'),
    price: val('f-price'),
    deposit_amount: val('f-deposit_amount'),
    deposit_date: val('f-deposit_date'),
    balance_paid_date: val('f-balance_paid_date'),
    lead_source: val('f-lead_source').trim(),
    referred_by_contact_id: val('f-referred_by_contact_id') || null,
    notes: val('f-notes')
  };
}

// Empty numeric strings become null.
function normalizeMoney(candidate) {
  for (const k of ['price', 'deposit_amount']) {
    candidate[k] = candidate[k] === '' || candidate[k] == null ? null : Number(candidate[k]);
  }
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
  const blockers = await saleRepo.getDeleteBlockers(s.id);
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
  if (ctx.mode === 'new') { location.href = 'sales.html'; return; }
  ctx.mode = 'view';
  renderView();
  renderProfileActions();
  renderContractsSection();
}

// Soft prompt on the Delivered transition (Enhancements Batch #7): offer to
// update the sold dog's ownership to reflect it has left the program.
// "External"/"Co-owned" are OWNERSHIP_TYPE values, not DOG_STATUS values — this
// edits dog.ownership_type (and, for External, may also set status to
// external_reference). Optional/warn-don't-block: the sale is already saved by
// the time this shows, and a skipped/failed update never blocks anything.
// Resolves once the modal is dismissed, so callers can sequence it.
function promptOwnershipUpdate(sale) {
  return new Promise((resolve) => {
    const dogLabel = dogName(sale.dog_id) || 'this dog';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2 style="margin-top:0;">Sale delivered — update ${esc(dogLabel)}'s ownership?</h2>
      <div class="field">
        <label>Ownership</label>
        <select id="own-choice">
          <option value="">— leave unchanged —</option>
          <option value="external">External</option>
          <option value="co_owned">Co-owned</option>
        </select>
      </div>
      <div class="field" id="own-owner-field" hidden>
        <label>Owner</label>
        <select id="own-owner">${contactOptions(sale.buyer_contact_id)}</select>
      </div>
      <div id="own-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="own-confirm">Confirm</button>
        <button class="btn" id="own-skip">Skip</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); resolve(); };
    overlay.querySelector('#own-skip').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const choiceSelect = overlay.querySelector('#own-choice');
    const ownerField = overlay.querySelector('#own-owner-field');
    // Owner is the single owner_contact_id field, which only applies to
    // External — Co-owned adds the buyer to co_owner_contact_ids instead
    // (handled below without needing a picker; owner_contact_id there stays
    // whoever it already was, typically the breeder).
    choiceSelect.addEventListener('change', () => {
      ownerField.hidden = choiceSelect.value !== 'external';
    });
    overlay.querySelector('#own-confirm').addEventListener('click', async () => {
      const choice = choiceSelect.value;
      if (!choice) { close(); return; }
      try {
        // Re-fetch: the co-own convenience above may have just updated this dog.
        const dog = await dogRepo.getById(sale.dog_id);
        if (choice === 'external') {
          const ownerId = overlay.querySelector('#own-owner').value || null;
          const updates = { ownership_type: 'external', status: 'external_reference', status_date: todayYMD() };
          if (ownerId) updates.owner_contact_id = ownerId;
          await dogRepo.update(sale.dog_id, updates);
        } else if (choice === 'co_owned') {
          const coOwners = dog?.co_owner_contact_ids || [];
          const updates = { ownership_type: 'co_owned' };
          if (!coOwners.includes(sale.buyer_contact_id)) updates.co_owner_contact_ids = [...coOwners, sale.buyer_contact_id];
          await dogRepo.update(sale.dog_id, updates);
        }
        close();
      } catch (e) {
        overlay.querySelector('#own-error').innerHTML = `<div class="inline-error">${esc(e.message || String(e))}</div>`;
      }
    });
  });
}

async function save() {
  clearError();
  const candidate = normalizeMoney(readForm());
  const prevStatus = ctx.mode === 'new' ? null : ctx.original.status;
  try {
    let saved;
    if (ctx.mode === 'new') {
      saved = await saleRepo.create(candidate);
    } else {
      saved = await saleRepo.update(ctx.original.id, candidate);
    }
    // Co-own placement convenience (Data Model v3 §5.6): pairs naturally with
    // adding the buyer to the dog's co_owner_contact_ids — never automatic.
    if (saved.placement_type === 'co_own') {
      const dog = await dogRepo.getById(saved.dog_id);
      if (dog && !(dog.co_owner_contact_ids || []).includes(saved.buyer_contact_id)) {
        if (confirmAction('This is a co-own placement. Also add the buyer as a co-owner of this dog?')) {
          await dogRepo.update(dog.id, { co_owner_contact_ids: [...(dog.co_owner_contact_ids || []), saved.buyer_contact_id] });
        }
      }
    }

    const finish = async () => {
      if (ctx.mode === 'new') { location.href = `sale.html?id=${encodeURIComponent(saved.id)}`; return; }
      ctx.original = saved;
      ctx.mode = 'view';
      await loadRefs();
      ctx.original = await saleRepo.getById(saved.id);
      renderAll();
    };

    // Ownership-update prompt (#7) fires only on the transition INTO delivered,
    // before the existing placement-event prompt below.
    if (saved.status === 'delivered' && prevStatus !== 'delivered') {
      await promptOwnershipUpdate(saved);
    }

    // Soft-suggestion prompt (Stage4.5 Addendum §D4) — offered, never forced;
    // no stored Sale↔event link. Only on the transition INTO a prompt-worthy
    // status, so re-saving an already-delivered sale doesn't re-nag.
    const enteringPlacementPrompt = PLACEMENT_PROMPT_STATUSES.includes(saved.status) && prevStatus !== saved.status;
    if (enteringPlacementPrompt && confirmAction('Log a scheduled pickup for this placement?')) {
      openEventForm({
        subjectType: 'dog', subjectId: saved.dog_id,
        prefill: { event_type: 'placement', related_contact_id: saved.buyer_contact_id, title: 'Puppy pickup' },
        onSaved: finish, onCancel: finish
      });
    } else {
      await finish();
    }
  } catch (e) {
    showError(e.message || String(e));
  }
}

async function toggleArchive() {
  const s = ctx.original;
  const verb = s.is_archived ? 'Unarchive' : 'Archive';
  if (!confirmAction(`${verb} this sale?`)) return;
  ctx.original = s.is_archived ? await saleRepo.unarchive(s.id) : await saleRepo.archive(s.id);
  renderAll();
}

async function doDelete() {
  const s = ctx.original;
  if (!confirmAction('Permanently delete this sale? This cannot be undone.')) return;
  try {
    await saleRepo.hardDelete(s.id);
    location.href = 'sales.html';
  } catch (e) {
    if (e instanceof ReferenceBlockedError) { showError(e.message); await renderHeaderActions(); }
    else showError(e.message || String(e));
  }
}

// --- Contracts panel (derived) --------------------------------------------
async function renderContractsSection() {
  if (!els.contracts) return;
  if (ctx.mode !== 'view' || !ctx.original) { els.contracts.innerHTML = ''; return; }
  const contracts = await contractRepo.getBySale(ctx.original.id);
  contracts.sort((a, b) => (b.signed_date || b.created_at || '').localeCompare(a.signed_date || a.created_at || ''));

  // Derived governing-contract line (Stage4.5 Addendum §A2) — proves invariant
  // #8 (the "live contract" is derived, never a stored flag) by exercising
  // contractRepo.governingContract() somewhere real, not just leaving it unused.
  const governing = contractRepo.governingContract(contracts);
  const governingHtml = governing
    ? `Governing contract: <a href="contract.html?id=${encodeURIComponent(governing.id)}">signed ${esc(fmtDate(governing.signed_date || governing.created_at))}</a>`
    : 'Governing contract: none signed yet';

  const inner = contracts.length
    ? `<ul class="linked-list" style="margin:14px 0 0; padding:0; list-style:none;">` + contracts.map((c) => `
        <li class="row-between" style="padding:8px 0; border-top:1px solid var(--border);">
          <span>${badge(CONTRACT_TYPE, c.contract_type)} <strong>${esc(c.title || 'Contract')}</strong> ${badge(CONTRACT_STATUS, c.status)}${c.signed_date ? ` <span class="faint">signed ${esc(fmtDate(c.signed_date))}</span>` : ''}</span>
          <a class="btn btn-sm" href="contract.html?id=${encodeURIComponent(c.id)}">Open →</a>
        </li>`).join('') + `</ul>`
    : `<p class="muted" style="margin:14px 0 0;">No contracts attached to this sale yet.</p>`;

  els.contracts.innerHTML = `
    <section class="card" style="margin-top:16px;">
      <div class="row-between">
        <div>
          <h2 style="margin:0;">Contracts</h2>
          <p class="muted" style="margin:4px 0 0; font-size:13px;">${governingHtml}</p>
        </div>
        <a class="btn btn-sm" href="contract.html?new=1&sale=${encodeURIComponent(ctx.original.id)}">+ Create Contract</a>
      </div>
      ${inner}
    </section>`;
}

// --- Top-level render ------------------------------------------------------
function renderTitle() {
  if (ctx.mode === 'new') {
    els.title.textContent = 'New Sale';
    els.subtitle.textContent = 'Choose a dog and buyer, then save.';
    return;
  }
  const s = ctx.original;
  els.title.innerHTML = `${esc(dogName(s.dog_id) || '—')} → ${esc(contactName(s.buyer_contact_id) || '—')}` + (s.is_archived ? ' <span class="badge badge-gray">Archived</span>' : '');
  els.subtitle.innerHTML = s.sale_date ? `Sale date ${esc(fmtDate(s.sale_date))}` : '';
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
    ctx.draft = blankSale();
    const dogId = param('dog');
    if (dogId && ctx.dogsById.has(dogId)) {
      ctx.draft.dog_id = dogId;
      applyExpectedPricing();
    }
    renderTitle();
    renderEdit();
    renderProfileActions();
    renderHeaderActions();
    return;
  }

  if (!id) { showError('No sale id provided.'); return; }
  const s = await saleRepo.getById(id);
  if (!s) { showError('Sale not found. It may have been deleted.'); return; }
  ctx.original = s;
  ctx.mode = 'view';
  renderAll();
}

main();
