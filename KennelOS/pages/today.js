// today.js — the consolidated "Today" home (Navigation Consolidation Plan v1 §4).
// Action-first ordering, top → bottom: (1) reminders, (2) due-outs / upcoming,
// (3) who's away, (4) the slow-changing kennel overview. This page is the single
// home for what used to be four separate nav destinations (dashboard, reminders,
// upcoming, board), so it shows their real content — not teaser counts.
//
// Every read here is DERIVED over the existing repos, exactly as the dashboard/
// reminders/upcoming/board pages each do — no stored aggregates, no new schema.
import { eventRepo } from '../data/eventRepo.js';
import { dogRepo } from '../data/dogRepo.js';
import { litterRepo } from '../data/litterRepo.js';
import { pairingRepo } from '../data/pairingRepo.js';
import { saleRepo } from '../data/saleRepo.js';
import { contactRepo } from '../data/contactRepo.js';
import { EVENT_TYPES, DOG_STATUS } from '../data/vocab.js';
import { esc, badge, fmtDate } from '../assets/ui.js';
import { todayYMD, daysFromToday } from '../data/dateUtils.js';

const DUE_SOON_DAYS = 30; // shared window with the reminder buckets (§3.3)

const errorBox = document.getElementById('page-error');
const remindersEl = document.getElementById('today-reminders');
const upcomingEl = document.getElementById('today-upcoming');
const boardEl = document.getElementById('today-board');
const overviewEl = document.getElementById('today-overview');

// Subject-resolution context, loaded once. Shared by every section.
const ctx = { dogsById: new Map(), pairingsById: new Map(), littersById: new Map(), contactsById: new Map() };

function showError(msg) { errorBox.innerHTML = `<div class="inline-error">${esc(msg)}</div>`; }

function subjectLabel(ev) {
  if (ev.subject_type === 'dog') return ctx.dogsById.get(ev.subject_id)?.call_name || '—';
  if (ev.subject_type === 'pairing') {
    const p = ctx.pairingsById.get(ev.subject_id);
    if (!p) return '—';
    return `${ctx.dogsById.get(p.sire_id)?.call_name || '—'} × ${ctx.dogsById.get(p.dam_id)?.call_name || '—'}`;
  }
  const l = ctx.littersById.get(ev.subject_id);
  if (!l) return '—';
  return `Litter (${ctx.dogsById.get(l.dam_id)?.call_name || '—'} × ${ctx.dogsById.get(l.sire_id)?.call_name || '—'})`;
}

function subjectHref(ev) {
  if (ev.subject_type === 'dog') return `dog.html?id=${encodeURIComponent(ev.subject_id)}`;
  if (ev.subject_type === 'pairing') return `pairing.html?id=${encodeURIComponent(ev.subject_id)}`;
  return `litter.html?id=${encodeURIComponent(ev.subject_id)}`;
}

// --- 1. Reminders (interactive; re-renders in place on dismiss/snooze) ------

function reminderRow(ev, bucketBadge) {
  const contact = ev.related_contact_id ? ctx.contactsById.get(ev.related_contact_id)?.name : '';
  return `<li class="row-between" style="padding:10px 0; border-top:1px solid var(--border); align-items:flex-start;">
      <div>
        <div>${bucketBadge}<a href="${subjectHref(ev)}"><strong>${esc(subjectLabel(ev))}</strong></a> — ${badge(EVENT_TYPES, ev.event_type)} ${esc(ev.title)}</div>
        <div class="muted" style="font-size:13px;">⏰ ${esc(fmtDate(ev.reminder_date))}${contact ? ` · ${esc(contact)}` : ''}</div>
      </div>
      <div class="pill-row" data-row="${esc(ev.id)}">
        <button class="btn btn-sm" data-act="snooze" data-id="${esc(ev.id)}">Snooze</button>
        <button class="btn btn-sm" data-act="dismiss" data-id="${esc(ev.id)}">Dismiss</button>
      </div>
    </li>`;
}

function reminderBucket(title, rows, bucketBadge) {
  if (!rows.length) return '';
  return `<h3 style="margin:14px 0 0;">${esc(title)} <span class="muted" style="font-size:13px;">(${rows.length})</span></h3>
    <ul class="linked-list" style="margin:2px 0 0; padding:0; list-style:none;">
      ${rows.map((ev) => reminderRow(ev, bucketBadge)).join('')}
    </ul>`;
}

async function renderReminders() {
  const reminders = await eventRepo.getReminders();
  if (!reminders.length) {
    remindersEl.innerHTML = `<section class="card"><h2 style="margin:0;">Reminders</h2>
      <div class="empty-state">Nothing pending. Add a reminder date to any event to see it here.</div></section>`;
    return;
  }
  const today = todayYMD();
  const horizon = daysFromToday(DUE_SOON_DAYS);
  const overdue = reminders.filter((e) => e.reminder_date < today);
  const dueSoon = reminders.filter((e) => e.reminder_date >= today && e.reminder_date <= horizon);
  const upcoming = reminders.filter((e) => e.reminder_date > horizon);

  remindersEl.innerHTML = `<section class="card">
      <div class="row-between"><h2 style="margin:0;">Reminders <span class="muted" style="font-size:14px;">(${reminders.length})</span></h2></div>
      ${reminderBucket('Overdue', overdue, '<span class="badge badge-red">Overdue</span> ')}
      ${reminderBucket('Due soon', dueSoon, '<span class="badge badge-amber">Due soon</span> ')}
      ${reminderBucket('Upcoming', upcoming, '<span class="badge badge-blue">Upcoming</span> ')}
    </section>`;
  wireReminderActions();
}

function wireReminderActions() {
  remindersEl.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => onReminderAction(btn.dataset.act, btn.dataset.id));
  });
}

async function onReminderAction(act, id) {
  try {
    if (act === 'dismiss') { await eventRepo.dismissReminder(id); renderReminders(); }
    else if (act === 'snooze') openSnooze(id);
  } catch (e) { showError(e.message || String(e)); }
}

// Inline snooze: swap the row's actions for a date picker (a week out, never before
// today). Snoozing IS a reminder_date edit — there is no separate snooze field.
function openSnooze(id) {
  const holder = remindersEl.querySelector(`[data-row="${CSS.escape(id)}"]`);
  if (!holder) return;
  holder.innerHTML = `
    <input type="date" class="snooze-date" min="${todayYMD()}" value="${daysFromToday(7)}" style="max-width:160px;">
    <button class="btn btn-primary btn-sm" data-set>Set</button>
    <button class="btn btn-sm" data-cancel>Cancel</button>`;
  holder.querySelector('[data-cancel]').addEventListener('click', renderReminders);
  holder.querySelector('[data-set]').addEventListener('click', async () => {
    const val = holder.querySelector('.snooze-date').value;
    if (!val) return;
    try { await eventRepo.snoozeReminder(id, val); renderReminders(); }
    catch (e) { showError(e.message || String(e)); }
  });
}

// --- 2. Due outs / Upcoming -------------------------------------------------

function renderUpcoming(rows) {
  const inner = rows.length
    ? `<ul class="linked-list" style="margin:6px 0 0; padding:0; list-style:none;">
        ${rows.map((ev) => {
          const contact = ev.related_contact_id ? ctx.contactsById.get(ev.related_contact_id)?.name : '';
          return `<li class="row-between" style="padding:9px 0; border-top:1px solid var(--border);">
            <div><a href="${subjectHref(ev)}"><strong>${esc(subjectLabel(ev))}</strong></a> — ${badge(EVENT_TYPES, ev.event_type)} ${esc(ev.title || '')}${contact ? ` <span class="muted">· ${esc(contact)}</span>` : ''}</div>
            <div class="muted" style="font-size:13px; white-space:nowrap;">${esc(fmtDate(ev.event_date))}</div>
          </li>`;
        }).join('')}
      </ul>`
    : `<div class="empty-state">Nothing scheduled from today onward.</div>`;
  upcomingEl.innerHTML = `<section class="card" style="margin-top:16px;">
      <h2 style="margin:0;">Due outs &amp; upcoming ${rows.length ? `<span class="muted" style="font-size:14px;">(${rows.length})</span>` : ''}</h2>
      <p class="field-hint">Everything scheduled from today onward — drop-offs, vet visits, surgeries.</p>
      ${inner}</section>`;
}

// --- 3. Who's away (Location / Status Board) --------------------------------

// Expandable-row table (phone-first): Dog · Reason · Location stay in the row;
// Contact / Drop-off / Return collapse into a panel a tap opens. Each away-dog is
// a summary <tr> plus a hidden panel <tr>; clicking the summary toggles both.
function renderBoard(rows) {
  if (!rows.length) {
    boardEl.innerHTML = `<section class="card" style="margin-top:16px;">
      <h2 style="margin:0;">Away from home</h2>
      <div class="empty-state">No dogs are currently away.</div></section>`;
    return;
  }
  const today = todayYMD();
  const body = rows.map((ev, i) => {
    const dog = ctx.dogsById.get(ev.subject_id);
    const contact = ev.related_contact_id ? ctx.contactsById.get(ev.related_contact_id) : null;
    const d = ev.details || {};
    const ret = ev.event_end_date
      ? `${esc(fmtDate(ev.event_end_date))}${ev.event_end_date < today ? ' <span class="badge badge-amber">Overdue?</span>' : ''}`
      : '<span class="badge badge-blue">Ongoing</span>';
    const drop = `${esc(fmtDate(ev.event_date))}${d.dropoff_time ? ` <span class="faint">${esc(d.dropoff_time)}</span>` : ''}`;
    return `<tbody class="expand-group">
      <tr class="expand-summary" data-panel="board-${i}">
        <td><strong>${esc(dog ? dog.call_name : '—')}</strong></td>
        <td>${esc(d.boarding_reason || '—')}</td>
        <td>${esc(d.location || '—')}</td>
        <td style="text-align:right; width:1em;"><span class="expand-chevron">▸</span></td>
      </tr>
      <tr class="expand-panel" id="board-${i}" hidden>
        <td colspan="4">
          <div class="expand-detail">
            <div class="k">Contact</div><div class="v">${contact ? esc(contact.name) : '—'}</div>
            <div class="k">Drop-off</div><div class="v">${drop}</div>
            <div class="k">Return</div><div class="v">${ret}</div>
            <div class="expand-actions"><a class="btn btn-sm" href="dog.html?id=${encodeURIComponent(ev.subject_id)}">Open dog →</a></div>
          </div>
        </td>
      </tr>
    </tbody>`;
  }).join('');
  boardEl.innerHTML = `<section class="card" style="margin-top:16px;">
      <h2 style="margin:0;">Away from home <span class="muted" style="font-size:14px;">(${rows.length})</span></h2>
      <p class="field-hint">Boarding stays only — medications and heat cycles don't appear here. Tap a row for contact, drop-off, and return.</p>
      <table class="data expand-table">
        <thead><tr><th>Dog</th><th>Reason</th><th>Location</th><th></th></tr></thead>
        ${body}
      </table></section>`;
  boardEl.querySelectorAll('.expand-summary').forEach((tr) => {
    tr.addEventListener('click', () => {
      const panel = document.getElementById(tr.dataset.panel);
      if (!panel) return;
      const open = panel.hidden;
      panel.hidden = !open;
      tr.classList.toggle('open', open); // CSS rotates the ▸ chevron to point down
    });
  });
}

// --- 4. Kennel overview (slow-changing; sits last) --------------------------

function stat(num, label, href) {
  const cls = ['stat', num === 0 ? 'stat-zero' : ''].filter(Boolean).join(' ');
  const inner = `<div class="stat-num">${esc(num)}</div><div class="stat-label">${esc(label)}</div>`;
  return href ? `<a class="${cls}" href="${href}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
}

function renderOverview({ allDogs, litters, pairings, sales }) {
  const activeDogs = allDogs.filter((d) => !d.is_archived);
  const archivedCount = allDogs.length - activeDogs.length;
  const byStatus = new Map();
  for (const d of activeDogs) byStatus.set(d.status, (byStatus.get(d.status) || 0) + 1);
  const statusTiles = DOG_STATUS
    .filter((s) => (byStatus.get(s.value) || 0) > 0 || ['active_breeding', 'retired_breeding', 'puppy', 'pet_home', 'deceased'].includes(s.value))
    .map((s) => stat(byStatus.get(s.value) || 0, s.label, 'dogs.html'))
    .join('') + stat(archivedCount, 'Archived (any status)', 'dogs.html');

  const year = String(new Date().getFullYear());
  const inYear = (ymd) => (ymd || '').startsWith(year);

  overviewEl.innerHTML = `<section class="card" style="margin-top:16px;">
      <h2 style="margin:0;">Kennel overview</h2>
      <p class="field-hint">Active dogs by status. Rarely changes, so it sits at the bottom.</p>
      <div class="stat-grid">${statusTiles}</div>
    </section>
    <section class="card" style="margin-top:16px;">
      <h2 style="margin:0;">This year (${year})</h2>
      <div class="stat-grid">
        ${stat(litters.filter((l) => inYear(l.whelp_date)).length, 'Litters whelped', 'breeding.html')}
        ${stat(pairings.filter((p) => inYear(p.planned_date)).length, 'Pairings', 'breeding.html')}
        ${stat(sales.filter((s) => inYear(s.sale_date)).length, 'Sales', 'sales.html')}
      </div>
    </section>`;
}

async function main() {
  const [allDogs, litters, pairings, sales, contacts, upcoming, boardRows] = await Promise.all([
    dogRepo.getAll({ includeArchived: true }),
    litterRepo.getAll({ includeArchived: false }),
    pairingRepo.getAll({ includeArchived: false }),
    saleRepo.getAll({ includeArchived: false }),
    contactRepo.getAll({ includeArchived: true }),
    eventRepo.getUpcoming(),
    eventRepo.getBoardRows()
  ]);
  ctx.dogsById = new Map(allDogs.map((d) => [d.id, d]));
  ctx.pairingsById = new Map(pairings.map((p) => [p.id, p]));
  ctx.littersById = new Map(litters.map((l) => [l.id, l]));
  ctx.contactsById = new Map(contacts.map((c) => [c.id, c]));

  await renderReminders();
  renderUpcoming(upcoming);
  renderBoard(boardRows);
  renderOverview({ allDogs, litters, pairings, sales });
}

main().catch((e) => showError(e.message || String(e)));
