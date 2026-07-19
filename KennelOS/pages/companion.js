// companion.js — the Companion Messaging console: the ONE centralized place to
// pre-configure the share-out messaging and send links.
//
// Two layers (see settings.js): Layer 1 is the per-type header copy (kennel
// identity + intro + announcement), edited in the "Message templates" cards.
// Layer 2 is Contact.companion_note, a per-recipient personal line editable
// inline in the Recipients table that overrides the announcement for that one
// recipient. "Prepare link" builds a fresh point-in-time bundle through the
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
import { esc } from '../assets/ui.js';

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
  templates: document.getElementById('templates'),
  recipients: document.getElementById('recipients'),
  showArchived: document.getElementById('show-archived')
};

const ctx = {
  contacts: [],
  salesByBuyer: new Map(),
  partnerServiceCount: new Map(),
  contractCountByContact: new Map()
};

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
        <div class="field field-wide"><label>Announcement</label><textarea class="t-announcement">${esc(s.announcement)}</textarea><span class="field-hint">A broadcast line for everyone of this type (e.g. "Spring litter arrives in June!"). A recipient's personal note overrides this.</span></div>
      </div>
      <div style="margin-top:8px;"><button class="btn btn-primary btn-sm t-save">Save ${esc(companionTypeLabel(type))} template</button> <span class="t-saved muted"></span></div>
    </div>`;
}

function renderTemplates() {
  els.templates.innerHTML = COMPANION_TYPES.map(templateCard).join('');
  els.templates.querySelectorAll('[data-type]').forEach((card) => {
    const type = card.dataset.type;
    card.querySelector('.t-save').addEventListener('click', () => {
      setCompanionSettings(type, {
        kennelName: card.querySelector('.t-kennelName').value.trim(),
        tagline: card.querySelector('.t-tagline').value.trim(),
        introText: card.querySelector('.t-introText').value,
        announcement: card.querySelector('.t-announcement').value
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
  const [contacts, sales] = await Promise.all([
    contactRepo.getAll({ includeArchived }),
    saleRepo.getAll({ includeArchived: true })
  ]);
  ctx.contacts = contacts.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));

  ctx.salesByBuyer = new Map();
  for (const s of sales) {
    if (s.is_archived) continue;
    if (!ctx.salesByBuyer.has(s.buyer_contact_id)) ctx.salesByBuyer.set(s.buyer_contact_id, 0);
    ctx.salesByBuyer.set(s.buyer_contact_id, ctx.salesByBuyer.get(s.buyer_contact_id) + 1);
  }
  // Partner signals: a stud service where they're the partner, or a
  // lease/co_own/other contract naming them as counterparty.
  const [studServices, contracts] = await Promise.all([
    studServiceRepo.getAll({ includeArchived: true }),
    contractRepo.getAll({ includeArchived: true })
  ]);
  ctx.partnerServiceCount = new Map();
  for (const ss of studServices) {
    if (ss.is_archived || !ss.partner_contact_id) continue;
    ctx.partnerServiceCount.set(ss.partner_contact_id, (ctx.partnerServiceCount.get(ss.partner_contact_id) || 0) + 1);
  }
  ctx.contractCountByContact = new Map();
  for (const c of contracts) {
    if (c.is_archived || !c.related_contact_id) continue;
    ctx.contractCountByContact.set(c.related_contact_id, (ctx.contractCountByContact.get(c.related_contact_id) || 0) + 1);
  }
}

function suggestType(contact) {
  if (ctx.salesByBuyer.get(contact.id)) return 'family';
  if (ctx.partnerServiceCount.get(contact.id) || ctx.contractCountByContact.get(contact.id)) return 'partner';
  const roles = contact.contact_type || [];
  if (roles.includes('buyer') || (contact.waitlist_status && contact.waitlist_status !== 'none')) return 'prospective';
  if (roles.includes('breeder')) return 'partner';
  return 'prospective';
}

function typeOptions(selected) {
  return COMPANION_TYPES
    .map((t) => `<option value="${esc(t)}"${t === selected ? ' selected' : ''}>${esc(companionTypeLabel(t))}</option>`)
    .join('');
}

function recipientRow(contact) {
  const suggested = suggestType(contact);
  const archivedTag = contact.is_archived ? ' <span class="badge badge-gray">Archived</span>' : '';
  return `
    <div class="card" data-id="${esc(contact.id)}" style="margin-top:12px;">
      <div class="row-between">
        <strong>${esc(contact.name)}</strong>${archivedTag}
        <span class="muted">${esc(contact.email || contact.phone || 'no email/phone on file')}</span>
      </div>
      <div class="form-grid" style="margin-top:8px;">
        <div class="field"><label>Bundle type</label><select class="r-type">${typeOptions(suggested)}</select></div>
        <div class="field field-wide"><label>Personal note (overrides the announcement)</label><textarea class="r-note">${esc(contact.companion_note || '')}</textarea></div>
      </div>
      <div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <button class="btn btn-sm r-save-note">Save note</button>
        <button class="btn btn-primary btn-sm r-prepare">Prepare link</button>
        <span class="r-note-saved muted"></span>
      </div>
      <div class="r-link" style="margin-top:8px;"></div>
    </div>`;
}

function renderRecipients() {
  if (!ctx.contacts.length) {
    els.recipients.innerHTML = `<div class="empty-state">No contacts yet.</div>`;
    return;
  }
  els.recipients.innerHTML = ctx.contacts.map(recipientRow).join('');
  els.recipients.querySelectorAll('[data-id]').forEach((row) => {
    const id = row.dataset.id;
    const contact = ctx.contacts.find((c) => c.id === id);
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
    const type = row.querySelector('.r-type').value;
    // Persist any unsaved note first so the bundle reflects what's on screen.
    const note = row.querySelector('.r-note').value.trim();
    if (note !== (contact.companion_note || '')) {
      const saved = await contactRepo.update(contact.id, { companion_note: note });
      contact.companion_note = saved.companion_note;
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
  renderTemplates();
  els.showArchived.addEventListener('change', refreshRecipients);
  await refreshRecipients();
}

main();
