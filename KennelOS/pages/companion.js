// companion.js — the Companion Messaging console: the ONE centralized place to
// pre-configure the share-out messaging and send links.
//
// The page works ONE package type at a time, chosen by the ?type= seg-tabs
// (like the Contacts group tabs). The active type scopes everything: the single
// template card shown, the filter blurb, the recipients that appear, and the
// bundle "Prepare link" builds. Membership per type: prospective = an active
// waiting-list status; family = an open (non-terminal) sale; partner = a current
// stud service / active lease / co-own / other contract. A contact can appear in
// more than one package — that's expected.
//
// Two layers (see settings.js): Layer 1 is the per-type header copy (kennel
// identity + intro + announcement), edited in the "Message template" card.
// Layer 2 is Contact.companion_note, a per-recipient personal line editable
// inline in the Recipients table, shown alongside the broadcast announcement
// (not an override). "Prepare link" builds a fresh point-in-time bundle through the
// allow-list builder, compresses it, and hands off a REAL sms:/mailto: anchor —
// the user's tap on that anchor is the activating gesture (never a post-async
// window.location assignment, which loses the iOS user-activation, brief §5.2).
import { contactRepo } from '../data/contactRepo.js';
import { saleRepo } from '../data/saleRepo.js';
import { studServiceRepo } from '../data/studServiceRepo.js';
import { contractRepo } from '../data/contractRepo.js';
import {
  getCompanionSettings, setCompanionSettings, COMPANION_TYPES, companionTypeLabel
} from '../data/settings.js';
import { buildBundle } from '../data/companionExport.js';
import { compressToEncodedURIComponent } from '../vendor/lz-string.min.mjs';
import { esc, param, todayYMD } from '../assets/ui.js';

// Payload ceilings for the data-in-hash transport (brief §6.1). SMS is the weak
// link — long URLs get truncated/split by some gateways; mail clients tolerate
// far longer. Conservative starting values; tune on real devices.
const MAX_SMS_HASH_LEN = 1800;
const MAX_EMAIL_HASH_LEN = 12000;

// The recipient-facing shell lives at the app root and is maintained by the
// owner (same static host). Absolute so it survives being pasted into SMS/email.
const SHELL_URL = new URL('../companion-view.html', import.meta.url).href;

const els = {
  error: document.getElementById('page-error'),
  blurb: document.getElementById('filter-blurb'),
  tabs: document.getElementById('companion-type-tabs'),
  templates: document.getElementById('templates'),
  recipients: document.getElementById('recipients'),
  showArchived: document.getElementById('show-archived')
};

// The active package type drives everything on the page — which template card
// shows, which contacts appear as recipients, and the bundle type "Prepare
// link" builds. Read from ?type= (like the Contacts group tabs); default to the
// first type when absent/unknown.
const activeType = COMPANION_TYPES.includes(param('type')) ? param('type') : COMPANION_TYPES[0];

// A sale is "open" until it reaches one of these terminal states — a current
// family is one with a sale that is still in flight (reserved / deposit paid /
// paid in full).
const CLOSED_SALE_STATUSES = new Set(['delivered', 'returned', 'cancelled']);

const ctx = {
  contacts: [],
  // Contact-id membership sets, one per package type, recomputed on each load.
  openSaleBuyerIds: new Set(),
  partnerIds: new Set()
};

// Who lands in each package's recipient list. Same contact can satisfy more
// than one — that's expected (a current family can also be a co-own partner).
function inActiveType(contact) {
  switch (activeType) {
    case 'prospective': return contact.waitlist_status === 'active';
    case 'family': return ctx.openSaleBuyerIds.has(contact.id);
    case 'partner': return ctx.partnerIds.has(contact.id);
    default: return false;
  }
}

// The plain-language explanation shown above the template card, so the owner
// knows exactly why a contact is (or isn't) in this package's list.
function filterBlurb() {
  switch (activeType) {
    case 'prospective': return 'Contacts with an active waiting-list status.';
    case 'family': return 'Contacts with an open sale — reserved, deposit paid, or paid in full (not delivered, returned, or cancelled).';
    case 'partner': return 'Contacts on a current stud service (whose return date hasn’t passed), an active lease (whose end date hasn’t passed), or any co-own / other contract.';
    default: return '';
  }
}

function showError(msg) { els.error.innerHTML = `<div class="inline-error">${esc(msg)}</div>`; }
function clearError() { els.error.innerHTML = ''; }

// --- Layer 1: message template cards --------------------------------------
function templateCard(type) {
  const s = getCompanionSettings(type);
  return `
    <div class="card" data-type="${esc(type)}" style="margin-top:12px;">
      <h3 style="margin:0 0 8px;">${esc(companionTypeLabel(type))}</h3>
      <div class="form-grid">
        <div class="field"><label>Kennel name</label><input class="t-kennelName" type="text" value="${esc(s.kennelName)}"></div>
        <div class="field"><label>Tagline</label><input class="t-tagline" type="text" value="${esc(s.tagline)}"></div>
        <div class="field field-wide"><label>Intro text</label><textarea class="t-introText">${esc(s.introText)}</textarea><span class="field-hint">Sets the "not live" expectation on the recipient's page.</span></div>
        <div class="field field-wide"><label>Announcement</label><textarea class="t-announcement">${esc(s.announcement)}</textarea><span class="field-hint">A broadcast line for everyone of this type (e.g. "Spring litter arrives in June!"). Shown alongside a recipient's personal note, not overridden by it.</span></div>
        <div class="field field-wide"><label>Closer</label><textarea class="t-closer">${esc(s.closer)}</textarea><span class="field-hint">A sign-off shown at the very bottom of the page, just above the snapshot date (e.g. "Thanks for being part of our program!").</span></div>
      </div>
      <div style="margin-top:8px;"><button class="btn btn-primary btn-sm t-save">Save ${esc(companionTypeLabel(type))} template</button> <span class="t-saved muted"></span></div>
    </div>`;
}

// Highlight the active package tab (matches the Contacts group-tabs pattern).
function renderTabs() {
  els.tabs.querySelectorAll('.seg-tab').forEach((tab) => {
    const tabType = new URL(tab.href).searchParams.get('type');
    const isActive = tabType === activeType;
    tab.classList.toggle('active', isActive);
    if (isActive) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
}

function renderBlurb() {
  els.blurb.innerHTML =
    `<p class="muted" style="margin:0 0 12px;"><strong>${esc(companionTypeLabel(activeType))}:</strong> ${esc(filterBlurb())}</p>`;
}

// Only the active package type's template card renders — one audience at a time.
function renderTemplates() {
  els.templates.innerHTML = templateCard(activeType);
  els.templates.querySelectorAll('[data-type]').forEach((card) => {
    const type = card.dataset.type;
    card.querySelector('.t-save').addEventListener('click', () => {
      setCompanionSettings(type, {
        kennelName: card.querySelector('.t-kennelName').value.trim(),
        tagline: card.querySelector('.t-tagline').value.trim(),
        introText: card.querySelector('.t-introText').value,
        announcement: card.querySelector('.t-announcement').value,
        closer: card.querySelector('.t-closer').value
      });
      const saved = card.querySelector('.t-saved');
      saved.textContent = 'Saved.';
      setTimeout(() => { saved.textContent = ''; }, 2000);
    });
  });
}

// --- Recipients: type suggestion, note editing, link prep -----------------
async function loadData() {
  const includeArchived = els.showArchived.checked;
  const today = todayYMD();
  const [contacts, sales, studServices, contracts] = await Promise.all([
    contactRepo.getAll({ includeArchived }),
    saleRepo.getAll({ includeArchived: true }),
    studServiceRepo.getAll({ includeArchived: true }),
    contractRepo.getAll({ includeArchived: true })
  ]);
  ctx.contacts = contacts.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));

  // Current families: buyers with a sale that hasn't reached a terminal state.
  ctx.openSaleBuyerIds = new Set();
  for (const s of sales) {
    if (s.is_archived || !s.buyer_contact_id) continue;
    if (s.status && !CLOSED_SALE_STATUSES.has(s.status)) ctx.openSaleBuyerIds.add(s.buyer_contact_id);
  }

  // Partners: a stud service whose return date hasn't passed (empty or future),
  // a lease whose end date hasn't passed, or any co-own / other contract.
  ctx.partnerIds = new Set();
  for (const ss of studServices) {
    if (ss.is_archived || !ss.partner_contact_id) continue;
    if (!ss.returned_date || ss.returned_date >= today) ctx.partnerIds.add(ss.partner_contact_id);
  }
  for (const c of contracts) {
    if (c.is_archived || !c.related_contact_id) continue;
    if (c.contract_type === 'lease') {
      if (!c.lease_end_date || c.lease_end_date >= today) ctx.partnerIds.add(c.related_contact_id);
    } else if (c.contract_type === 'co_own' || c.contract_type === 'other') {
      ctx.partnerIds.add(c.related_contact_id);
    }
  }
}

// Each recipient collapses to just its header (name + contact + a "note" tag when
// one's on file) — the note editor, actions, and link box hide behind the toggle
// so a long filtered list stays scannable. Clicking the header expands one card.
function recipientRow(contact) {
  const archivedTag = contact.is_archived ? ' <span class="badge badge-gray">Archived</span>' : '';
  const noteTag = (contact.companion_note || '').trim() ? ' <span class="badge badge-blue">note</span>' : '';
  return `
    <div class="card" data-id="${esc(contact.id)}" style="margin-top:12px;">
      <div class="r-header" style="display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none;">
        <span class="r-arrow" style="display:inline-block; transition:transform 0.2s; font-size:12px;">▶</span>
        <div class="row-between" style="flex:1; gap:8px;">
          <span><strong>${esc(contact.name)}</strong>${archivedTag}<span class="r-note-tag">${noteTag}</span></span>
          <span class="muted">${esc(contact.email || contact.phone || 'no email/phone on file')}</span>
        </div>
      </div>
      <div class="r-body" style="display:none; margin-top:10px;">
        <div class="form-grid">
          <div class="field field-wide"><label>Personal note (shown alongside the announcement)</label><textarea class="r-note">${esc(contact.companion_note || '')}</textarea></div>
        </div>
        <div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-sm r-save-note">Save note</button>
          <button class="btn btn-primary btn-sm r-prepare">Prepare link</button>
          <span class="r-note-saved muted"></span>
        </div>
        <div class="r-link" style="margin-top:8px;"></div>
      </div>
    </div>`;
}

function renderRecipients() {
  const matches = ctx.contacts.filter(inActiveType);
  if (!matches.length) {
    els.recipients.innerHTML =
      `<div class="empty-state">No ${esc(companionTypeLabel(activeType).toLowerCase())} match this package right now.</div>`;
    return;
  }
  els.recipients.innerHTML = matches.map(recipientRow).join('');
  els.recipients.querySelectorAll('[data-id]').forEach((row) => {
    const id = row.dataset.id;
    const contact = ctx.contacts.find((c) => c.id === id);
    const header = row.querySelector('.r-header');
    const body = row.querySelector('.r-body');
    const arrow = row.querySelector('.r-arrow');
    header.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
    });
    row.querySelector('.r-save-note').addEventListener('click', () => saveNote(row, contact));
    row.querySelector('.r-prepare').addEventListener('click', () => prepareLink(row, contact));
  });
}

async function saveNote(row, contact) {
  clearError();
  try {
    const note = row.querySelector('.r-note').value.trim();
    const saved = await contactRepo.update(contact.id, { companion_note: note });
    contact.companion_note = saved.companion_note;
    // Keep the collapsed header's "note" tag in sync with what was just saved.
    const tag = row.querySelector('.r-note-tag');
    if (tag) tag.innerHTML = (saved.companion_note || '').trim() ? ' <span class="badge badge-blue">note</span>' : '';
    const flag = row.querySelector('.r-note-saved');
    flag.textContent = 'Note saved.';
    setTimeout(() => { flag.textContent = ''; }, 2000);
  } catch (e) {
    showError(e.message || String(e));
  }
}

function channelBody(kennelName, url) {
  const opener = kennelName ? `Here's your update from ${kennelName}:` : `Here's your update:`;
  return `${opener}\n\n${url}`;
}

async function prepareLink(row, contact) {
  clearError();
  const linkBox = row.querySelector('.r-link');
  linkBox.innerHTML = `<span class="muted">Building…</span>`;
  try {
    // Bundle type is the active package tab — no per-row picker anymore.
    const type = activeType;
    // Persist any unsaved note first so the bundle reflects what's on screen.
    const note = row.querySelector('.r-note').value.trim();
    if (note !== (contact.companion_note || '')) {
      const saved = await contactRepo.update(contact.id, { companion_note: note });
      contact.companion_note = saved.companion_note;
      const tag = row.querySelector('.r-note-tag');
      if (tag) tag.innerHTML = (saved.companion_note || '').trim() ? ' <span class="badge badge-blue">note</span>' : '';
    }

    const bundle = await buildBundle(type, contact);
    const hash = compressToEncodedURIComponent(JSON.stringify(bundle));
    const url = `${SHELL_URL}#${hash}`;
    const bodyText = channelBody(bundle.kennelName, url);

    const overSms = hash.length > MAX_SMS_HASH_LEN;
    const overEmail = hash.length > MAX_EMAIL_HASH_LEN;

    const subject = encodeURIComponent(bundle.kennelName ? `Update from ${bundle.kennelName}` : 'Your update');
    const body = encodeURIComponent(bodyText);
    const mailto = `mailto:${encodeURIComponent(contact.email || '')}?subject=${subject}&body=${body}`;
    const sms = `sms:${encodeURIComponent(contact.phone || '')}?body=${body}`;

    // Email is the default channel (larger bundles ride it comfortably); SMS is
    // offered only when the payload is under the SMS ceiling.
    const emailAnchor = overEmail
      ? `<span class="inline-warn">Bundle is too large even for email (${hash.length} chars). Trim it — a family's per-pup event history is the usual culprit.</span>`
      : `<a class="btn btn-primary btn-sm" href="${esc(mailto)}">✉️ Send via email</a>`;
    const smsAnchor = overSms
      ? `<span class="muted">SMS unavailable — payload ${hash.length} chars exceeds the ${MAX_SMS_HASH_LEN}-char SMS limit; use email.</span>`
      : `<a class="btn btn-sm" href="${esc(sms)}">💬 Send via SMS</a>`;

    linkBox.innerHTML = `
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${emailAnchor}
        ${smsAnchor}
      </div>
      <div class="field" style="margin-top:8px;">
        <label>Or copy the link</label>
        <input type="text" readonly value="${esc(url)}" onclick="this.select()">
        <span class="field-hint">Snapshot as of now (${esc(new Date(bundle.updatedAt).toLocaleString())}). Payload ${hash.length} chars. Tap an anchor above to send.</span>
      </div>`;
  } catch (e) {
    linkBox.innerHTML = '';
    showError(e.message || String(e));
  }
}

async function refreshRecipients() {
  await loadData();
  renderRecipients();
}

async function main() {
  renderTabs();
  renderBlurb();
  renderTemplates();
  els.showArchived.addEventListener('change', refreshRecipients);
  await refreshRecipients();
}

main();
