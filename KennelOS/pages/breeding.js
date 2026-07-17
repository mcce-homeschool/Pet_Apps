// breeding.js — the consolidated Breeding hub (Navigation Consolidation Plan v1 §5).
// One screen for the whole chain: each PAIRING shows its LITTER (derived,
// Litter WHERE pairing_id = pairing.id) and that litter's PUPPIES (derived,
// Dog WHERE litter_id = litter.id). No stored back-pointers — every downstream
// link is a derived query, exactly as the data model requires.
//
// Ordered most-recent-first; only the first PAGE_SIZE pairings show, the rest are
// behind a "Show more" toggle. Litters with no recorded pairing are listed on
// their own at the end so nothing is hidden. Editing a single pairing or litter
// happens on its detail page — reached by clicking into the card.
import { pairingRepo } from '../data/pairingRepo.js';
import { litterRepo } from '../data/litterRepo.js';
import { dogRepo } from '../data/dogRepo.js';
import { PAIRING_STATUS, PAIRING_TYPE, LITTER_STATUS } from '../data/vocab.js';
import { esc, badge, fmtDate } from '../assets/ui.js';

const PAGE_SIZE = 5; // recent pairings shown before "Show more"

const body = document.getElementById('breeding-body');
const errorBox = document.getElementById('page-error');

function showError(msg) { errorBox.innerHTML = `<div class="inline-error">${esc(msg)}</div>`; }

// Best available date for "recent", newest first. Pairings carry planned/expected
// dates; fall back to created_at so undated rows still sort deterministically.
function recencyKey(p) {
  return p.planned_date || p.expected_due_date || (p.created_at || '').slice(0, 10) || '';
}

function dateLine(label, ymd) {
  return ymd ? `<span class="muted">${esc(label)} ${esc(fmtDate(ymd))}</span>` : '';
}

// The puppy strip: one chip per resulting Dog, linking to its record.
function puppiesHtml(puppies) {
  if (!puppies.length) return `<div class="muted" style="font-size:13px;">No puppy records linked yet.</div>`;
  const chips = puppies
    .slice()
    .sort((a, b) => (a.call_name || '').localeCompare(b.call_name || ''))
    .map((d) => `<a class="pill" href="dog.html?id=${encodeURIComponent(d.id)}">${esc(d.call_name || '—')}${d.sex ? ` <span class="faint">${esc(d.sex[0].toUpperCase())}</span>` : ''}</a>`)
    .join('');
  return `<div class="pill-row" style="margin-top:6px;">${chips}</div>`;
}

// The litter block nested under a pairing (or standalone at the end).
function litterHtml(litter, puppies) {
  if (!litter) {
    return `<div class="muted" style="margin-top:8px; font-size:13px;">No litter recorded for this pairing yet.</div>`;
  }
  const counts = [];
  if (litter.born_total != null) counts.push(`${esc(litter.born_total)} born`);
  if (litter.born_alive != null) counts.push(`${esc(litter.born_alive)} alive`);
  if (litter.born_deceased != null) counts.push(`${esc(litter.born_deceased)} deceased`);
  return `<div class="sub-block" style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border);">
      <div class="row-between">
        <div>
          <a href="litter.html?id=${encodeURIComponent(litter.id)}"><strong>Litter</strong></a>
          ${badge(LITTER_STATUS, litter.status)}
          ${dateLine('· whelped', litter.whelp_date)}
          ${counts.length ? `<span class="muted">· ${counts.join(', ')}</span>` : ''}
        </div>
        <a class="btn btn-sm" href="litter.html?id=${encodeURIComponent(litter.id)}">Open litter</a>
      </div>
      ${puppiesHtml(puppies)}
    </div>`;
}

function pairingCard(p, dogsById, litter, puppies) {
  const sire = dogsById.get(p.sire_id)?.call_name || '—';
  const dam = dogsById.get(p.dam_id)?.call_name || '—';
  return `<section class="card breeding-card" style="margin-top:14px;">
      <div class="row-between">
        <div>
          <a href="pairing.html?id=${encodeURIComponent(p.id)}"><strong>${esc(sire)} × ${esc(dam)}</strong></a>
          ${badge(PAIRING_TYPE, p.pairing_type)} ${badge(PAIRING_STATUS, p.status)}
          <div class="muted" style="font-size:13px; margin-top:2px;">
            ${dateLine('Planned', p.planned_date) || '<span class="faint">No planned date</span>'}
            ${p.expected_due_date ? ` · ${dateLine('due', p.expected_due_date)}` : ''}
          </div>
        </div>
        <a class="btn btn-sm" href="pairing.html?id=${encodeURIComponent(p.id)}">Open pairing</a>
      </div>
      ${litterHtml(litter, puppies)}
    </section>`;
}

async function main() {
  const [pairings, dogs] = await Promise.all([
    pairingRepo.getAll({ includeArchived: false }),
    dogRepo.getAll({ includeArchived: true })
  ]);
  const dogsById = new Map(dogs.map((d) => [d.id, d]));

  // Attach each pairing's derived litter, then that litter's derived puppies.
  const withLitters = await Promise.all(pairings.map(async (p) => {
    const litter = await litterRepo.getForPairing(p.id);
    const puppies = litter ? await dogRepo.getByLitter(litter.id) : [];
    return { p, litter, puppies };
  }));
  withLitters.sort((a, b) => recencyKey(b.p).localeCompare(recencyKey(a.p)));

  // Litters that exist without any recorded pairing — surfaced on their own so
  // the chain view never hides a litter.
  const linkedLitterIds = new Set(withLitters.map((w) => w.litter?.id).filter(Boolean));
  const allLitters = await litterRepo.getAll({ includeArchived: false });
  const orphanLitters = allLitters.filter((l) => !linkedLitterIds.has(l.id));

  if (!withLitters.length && !orphanLitters.length) {
    body.innerHTML = `<div class="card empty-state">No pairings yet. Click “+ Add Pairing” to record the first breeding.</div>`;
    return;
  }

  const shown = withLitters.slice(0, PAGE_SIZE);
  const rest = withLitters.slice(PAGE_SIZE);

  const shownHtml = shown.map((w) => pairingCard(w.p, dogsById, w.litter, w.puppies)).join('');
  const restHtml = rest.length
    ? `<div id="breeding-more" hidden>${rest.map((w) => pairingCard(w.p, dogsById, w.litter, w.puppies)).join('')}</div>
       <div style="margin-top:14px;"><button class="btn" id="show-more-btn">Show ${rest.length} more pairing${rest.length === 1 ? '' : 's'} ▾</button></div>`
    : '';

  let orphanHtml = '';
  if (orphanLitters.length) {
    orphanLitters.sort((a, b) => (b.whelp_date || '').localeCompare(a.whelp_date || ''));
    const cards = await Promise.all(orphanLitters.map(async (l) => {
      const puppies = await dogRepo.getByLitter(l.id);
      return `<section class="card" style="margin-top:14px;">${litterHtml(l, puppies)}</section>`;
    }));
    orphanHtml = `<h2 style="margin-top:26px;">Litters without a recorded pairing <span class="muted" style="font-size:14px;">(${orphanLitters.length})</span></h2>${cards.join('')}`;
  }

  body.innerHTML = shownHtml + restHtml + orphanHtml;

  const btn = document.getElementById('show-more-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      document.getElementById('breeding-more').hidden = false;
      btn.remove();
    });
  }
}

main().catch((e) => showError(e.message || String(e)));
