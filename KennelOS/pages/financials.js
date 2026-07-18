// financials.js — the Financials hub (its own nav tab, not a Report). "Where the
// money lives": a program-wide view over the Expense ledger with a running total,
// a per-category breakdown, the full filterable/exportable ledger, and a hub-level
// "+ Add Expense" that logs a cost against ANY subject (dog / litter / pairing /
// kennel) from one place. Per-subject entry still lives on each detail page; this
// is the operational home. (Analytics queries stay under Reports.)
import { expenseRepo } from '../data/expenseRepo.js';
import { dogRepo } from '../data/dogRepo.js';
import { litterRepo } from '../data/litterRepo.js';
import { pairingRepo } from '../data/pairingRepo.js';
import { kennelRepo } from '../data/kennelRepo.js';
import { createReportView } from '../assets/reportView.js';
import { esc, badge, fmtDate, fmtMoney, todayYMD } from '../assets/ui.js';
import { EXPENSE_CATEGORIES, EXPENSE_SUBJECT_TYPES, descriptor } from '../data/vocab.js';

const SUBJECT_PAGE = { dog: 'dog.html', litter: 'litter.html', pairing: 'pairing.html', kennel: 'kennel.html' };
const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join('');

const ref = { dogs: [], litters: [], pairings: [], kennels: [] };
const maps = { dogsById: new Map(), littersById: new Map(), pairingsById: new Map(), kennelsById: new Map() };
const dogName = (id) => maps.dogsById.get(id)?.call_name || '—';

function subjectLabel(x) {
  if (x.subject_type === 'dog') return dogName(x.subject_id);
  if (x.subject_type === 'kennel') return maps.kennelsById.get(x.subject_id)?.kennel_name || '—';
  if (x.subject_type === 'litter') {
    const l = maps.littersById.get(x.subject_id);
    return l ? `${dogName(l.dam_id)} × ${dogName(l.sire_id)}` : '—';
  }
  if (x.subject_type === 'pairing') {
    const p = maps.pairingsById.get(x.subject_id);
    return p ? `${dogName(p.sire_id)} × ${dogName(p.dam_id)}` : '—';
  }
  return '—';
}

// Options for the add-modal's Subject picker, given a chosen subject type.
function subjectOptionsFor(type) {
  const head = '<option value="">— select —</option>';
  if (type === 'dog') {
    return head + ref.dogs.filter((d) => !d.is_archived)
      .map((d) => `<option value="${esc(d.id)}">${esc(d.call_name)}${d.registered_name ? ' — ' + esc(d.registered_name) : ''}</option>`).join('');
  }
  if (type === 'kennel') {
    return head + ref.kennels.filter((k) => !k.is_archived)
      .map((k) => `<option value="${esc(k.id)}">${esc(k.kennel_name)}${k.is_own_kennel ? ' (mine)' : ''}</option>`).join('');
  }
  if (type === 'litter') {
    return head + ref.litters.filter((l) => !l.is_archived)
      .map((l) => `<option value="${esc(l.id)}">${esc(dogName(l.dam_id))} × ${esc(dogName(l.sire_id))}${l.whelp_date ? ' (' + esc(fmtDate(l.whelp_date)) + ')' : ''}</option>`).join('');
  }
  if (type === 'pairing') {
    return head + ref.pairings.filter((p) => !p.is_archived)
      .map((p) => `<option value="${esc(p.id)}">${esc(dogName(p.sire_id))} × ${esc(dogName(p.dam_id))}${p.planned_date ? ' (' + esc(fmtDate(p.planned_date)) + ')' : ''}</option>`).join('');
  }
  return head;
}

function openAddExpense(onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="row-between" style="margin-bottom:12px;">
        <h2 style="margin:0;">Add expense</h2>
        <button class="btn btn-sm" data-act="cancel">✕</button>
      </div>
      <div class="form-grid">
        <div class="field"><label>Attached to <span class="req">*</span></label>
          <select id="af-subject-type">${EXPENSE_SUBJECT_TYPES.map((s) => `<option value="${esc(s.value)}">${esc(s.label)}</option>`).join('')}</select></div>
        <div class="field"><label>Subject <span class="req">*</span></label>
          <select id="af-subject-id">${subjectOptionsFor('dog')}</select></div>
        <div class="field"><label>Amount <span class="req">*</span></label>
          <input id="af-amount" type="number" step="0.01" min="0"></div>
        <div class="field"><label>Category</label>
          <select id="af-category">${CATEGORY_OPTIONS}</select></div>
        <div class="field"><label>Date <span class="req">*</span></label>
          <input id="af-date" type="date" value="${esc(todayYMD())}"></div>
        <div class="field"><label>Vendor</label>
          <input id="af-vendor" type="text" placeholder="Who was paid"></div>
        <div class="field field-wide"><label>Notes</label><textarea id="af-notes"></textarea></div>
      </div>
      <div id="af-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary" data-act="save">Save expense</button>
        <button class="btn" data-act="cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const modal = overlay.querySelector('.modal');
  const typeSel = modal.querySelector('#af-subject-type');
  const subjSel = modal.querySelector('#af-subject-id');
  typeSel.addEventListener('change', () => { subjSel.innerHTML = subjectOptionsFor(typeSel.value); });

  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  async function save() {
    try {
      const saved = await expenseRepo.create({
        subject_type: typeSel.value,
        subject_id: subjSel.value,
        amount: modal.querySelector('#af-amount').value,
        category: modal.querySelector('#af-category').value,
        expense_date: modal.querySelector('#af-date').value,
        vendor: modal.querySelector('#af-vendor').value.trim(),
        notes: modal.querySelector('#af-notes').value
      });
      close();
      onSaved?.(saved);
    } catch (e) {
      modal.querySelector('#af-error').innerHTML = `<div class="inline-error">${esc(e.message || String(e))}</div>`;
    }
  }
  modal.querySelector('[data-act="save"]').addEventListener('click', save);
  modal.querySelectorAll('[data-act="cancel"]').forEach((b) => b.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
}

function renderSummary(expenses) {
  const summary = document.getElementById('summary');
  const grand = expenseRepo.total(expenses);
  const byCat = new Map();
  for (const x of expenses) byCat.set(x.category, (byCat.get(x.category) || 0) + (Number(x.amount) || 0));
  const catRows = EXPENSE_CATEGORIES.filter((c) => byCat.get(c.value)).map((c) =>
    `<li class="row-between" style="padding:6px 0; border-top:1px solid var(--border);">
      <span>${badge(EXPENSE_CATEGORIES, c.value)}</span>
      <strong>${esc(fmtMoney(byCat.get(c.value)))}</strong>
    </li>`).join('');
  summary.innerHTML = `
    <div class="row-between" style="align-items:baseline;">
      <h2 style="margin:0;">Total spent</h2>
      <strong style="font-size:22px;">${esc(fmtMoney(grand))}</strong>
    </div>
    <p class="muted" style="margin:4px 0 0; font-size:13px;">Across ${expenses.length} expense${expenses.length === 1 ? '' : 's'} (active only).</p>
    ${catRows ? `<ul class="linked-list" style="margin:12px 0 0; padding:0; list-style:none;">${catRows}</ul>` : ''}`;
}

async function loadExpenses() {
  const expenses = await expenseRepo.getAll({ includeArchived: false });
  expenses.sort((a, b) => (b.expense_date || '').localeCompare(a.expense_date || ''));
  return expenses;
}

async function init() {
  const [dogs, litters, pairings, kennels] = await Promise.all([
    dogRepo.getAll({ includeArchived: true }),
    litterRepo.getAll({ includeArchived: true }),
    pairingRepo.getAll({ includeArchived: true }),
    kennelRepo.getAll({ includeArchived: true })
  ]);
  ref.dogs = dogs; ref.litters = litters; ref.pairings = pairings; ref.kennels = kennels;
  maps.dogsById = new Map(dogs.map((d) => [d.id, d]));
  maps.littersById = new Map(litters.map((l) => [l.id, l]));
  maps.pairingsById = new Map(pairings.map((p) => [p.id, p]));
  maps.kennelsById = new Map(kennels.map((k) => [k.id, k]));

  const subjectTypeLabel = (v) => descriptor(EXPENSE_SUBJECT_TYPES, v).label;
  const year = (x) => (x.expense_date || '').slice(0, 4);

  const view = createReportView({
    mount: document.getElementById('report-mount'),
    csvFilename: `financials-${new Date().toISOString().slice(0, 10)}.csv`,
    search: { placeholder: 'Search subject, vendor, or notes…', text: (x) => `${subjectLabel(x)} ${x.vendor || ''} ${x.notes || ''}` },
    filters: [
      { id: 'category', label: 'Category', options: EXPENSE_CATEGORIES, match: (x, v) => x.category === v },
      { id: 'subject_type', label: 'Attached to', options: EXPENSE_SUBJECT_TYPES, match: (x, v) => x.subject_type === v },
      // Year options are rebuilt on each load from the data actually present.
      { id: 'year', label: 'Year', options: [], match: (x, v) => year(x) === v }
    ],
    columns: [
      { header: 'Date', value: (x) => (x.expense_date ? fmtDate(x.expense_date) : ''), csv: (x) => x.expense_date || '' },
      { header: 'Category', value: (x) => x.category || '', badge: EXPENSE_CATEGORIES, csv: (x) => descriptor(EXPENSE_CATEGORIES, x.category).label },
      { header: 'Amount', value: (x) => fmtMoney(x.amount), csv: (x) => String(x.amount ?? '') },
      { header: 'Attached to', value: (x) => subjectTypeLabel(x.subject_type) },
      { header: 'Subject', value: (x) => subjectLabel(x) },
      { header: 'Vendor', value: (x) => x.vendor || '' },
      { header: 'Notes', value: (x) => x.notes || '' }
    ],
    onRowClick: (x) => {
      const page = SUBJECT_PAGE[x.subject_type];
      if (page && x.subject_id) location.href = `${page}?id=${encodeURIComponent(x.subject_id)}`;
    },
    // load recomputes the summary each refresh and rebuilds the Year filter's
    // options from whatever years are present now.
    load: async () => {
      const expenses = await loadExpenses();
      renderSummary(expenses);
      const years = [...new Set(expenses.map(year).filter(Boolean))].sort().reverse();
      const yearSel = document.querySelector('#report-mount select[aria-label="Year"]');
      if (yearSel) {
        const cur = yearSel.value;
        yearSel.innerHTML = `<option value="">Year: All</option>` + years.map((y) => `<option value="${esc(y)}">${esc(y)}</option>`).join('');
        yearSel.value = cur;
      }
      return expenses;
    },
    emptyText: 'No expenses recorded yet. Use “+ Add Expense” to log one.'
  });

  document.getElementById('add-expense').addEventListener('click', () => openAddExpense(() => view.refresh()));
}

init();
