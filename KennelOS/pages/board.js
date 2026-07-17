// board.js — Location / Status Board (Stage4.5 Addendum §C4): one row per
// dog currently away from home. Reads HistoryEvent.getBoardRows(), which
// filters on event_type ∈ {boarding} — never on `duration` — so active
// medications/heat cycles (also spans) never show up here.
import { HistoryEvent } from '../data/eventRepo.js';
import { dogRepo } from '../data/dogRepo.js';
import { contactRepo } from '../data/contactRepo.js';
import { esc, fmtDate, todayYMD } from '../assets/ui.js';

const mount = document.getElementById('board-mount');

async function init() {
  const [rows, dogs, contacts] = await Promise.all([
    HistoryEvent.getBoardRows(),
    dogRepo.getAll({ includeArchived: true }),
    contactRepo.getAll({ includeArchived: true })
  ]);
  const dogsById = new Map(dogs.map((d) => [d.id, d]));
  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  if (!rows.length) {
    mount.innerHTML = `<div class="empty-state">No dogs are currently away from home.</div>`;
    return;
  }

  const today = todayYMD();
  const body = rows.map((ev) => {
    const dog = dogsById.get(ev.subject_id);
    const contact = ev.related_contact_id ? contactsById.get(ev.related_contact_id) : null;
    const d = ev.details || {};
    const returnCell = ev.event_end_date
      ? `${esc(fmtDate(ev.event_end_date))}${ev.event_end_date < today ? ' <span class="badge badge-amber">Overdue?</span>' : ''}`
      : '<span class="badge badge-blue">Ongoing</span>';
    return `<tr class="clickable" data-dog="${esc(ev.subject_id)}">
      <td><strong>${esc(dog ? dog.call_name : '—')}</strong></td>
      <td>${esc(d.location || '')}</td>
      <td>${esc(d.boarding_reason || '')}</td>
      <td>${contact ? esc(contact.name) : '<span class="faint">—</span>'}</td>
      <td>${esc(fmtDate(ev.event_date))}${d.dropoff_time ? ` <span class="faint">${esc(d.dropoff_time)}</span>` : ''}</td>
      <td>${returnCell}${d.pickup_time ? ` <span class="faint">${esc(d.pickup_time)}</span>` : ''}</td>
    </tr>`;
  }).join('');

  mount.innerHTML = `
    <table class="data">
      <thead><tr><th>Dog</th><th>Location</th><th>Reason</th><th>Contact</th><th>Drop-off</th><th>Return</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;

  mount.querySelectorAll('tr[data-dog]').forEach((tr) => {
    tr.addEventListener('click', () => { location.href = `dog.html?id=${encodeURIComponent(tr.dataset.dog)}`; });
  });
}

init();
