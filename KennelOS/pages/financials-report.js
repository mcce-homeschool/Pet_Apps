// financials-report.js — the program-wide Financials report over the Expense
// ledger. A derived read (no stored aggregate): it lists every active expense
// across all subject types, resolves each to its subject's label, and offers the
// standard filter + CSV export via the shared reportView. A small summary card
// above the table totals the loaded rows overall and by category.
import { expenseRepo } from '../data/expenseRepo.js';
import { dogRepo } from '../data/dogRepo.js';
import { litterRepo } from '../data/litterRepo.js';
import { pairingRepo } from '../data/pairingRepo.js';
import { kennelRepo } from '../data/kennelRepo.js';
import { createReportView } from '../assets/reportView.js';
import { esc, badge, fmtDate, fmtMoney } from '../assets/ui.js';
import { EXPENSE_CATEGORIES, EXPENSE_SUBJECT_TYPES, descriptor } from '../data/vocab.js';

// Where a given expense's subject lives, so a row can deep-link to it.
const SUBJECT_PAGE = { dog: 'dog.html', litter: 'litter.html', pairing: 'pairing.html', kennel: 'kennel.html' };

async function init() {
  const [expenses, dogs, litters, pairings, kennels] = await Promise.all([
    expenseRepo.getAll({ includeArchived: false }),
    dogRepo.getAll({ includeArchived: true }),
    litterRepo.getAll({ includeArchived: true }),
    pairingRepo.getAll({ includeArchived: true }),
    kennelRepo.getAll({ includeArchived: true })
  ]);
  const dogsById = new Map(dogs.map((d) => [d.id, d]));
  const littersById = new Map(litters.map((l) => [l.id, l]));
  const pairingsById = new Map(pairings.map((p) => [p.id, p]));
  const kennelsById = new Map(kennels.map((k) => [k.id, k]));
  const dogName = (id) => dogsById.get(id)?.call_name || '—';

  function subjectLabel(x) {
    if (x.subject_type === 'dog') return dogName(x.subject_id);
    if (x.subject_type === 'kennel') return kennelsById.get(x.subject_id)?.kennel_name || '—';
    if (x.subject_type === 'litter') {
      const l = littersById.get(x.subject_id);
      if (!l) return '—';
      return `${dogName(l.dam_id)} × ${dogName(l.sire_id)}`;
    }
    if (x.subject_type === 'pairing') {
      const p = pairingsById.get(x.subject_id);
      if (!p) return '—';
      return `${dogName(p.sire_id)} × ${dogName(p.dam_id)}`;
    }
    return '—';
  }
  const subjectTypeLabel = (v) => descriptor(EXPENSE_SUBJECT_TYPES, v).label;
  const year = (x) => (x.expense_date || '').slice(0, 4);
  const years = [...new Set(expenses.map(year).filter(Boolean))].sort().reverse();

  expenses.sort((a, b) => (b.expense_date || '').localeCompare(a.expense_date || ''));

  // --- Summary card: overall total + per-category breakdown -----------------
  const summary = document.getElementById('summary');
  const grand = expenseRepo.total(expenses);
  const byCat = new Map();
  for (const x of expenses) byCat.set(x.category, (byCat.get(x.category) || 0) + (Number(x.amount) || 0));
  const catRows = EXPENSE_CATEGORIES
    .filter((c) => byCat.get(c.value))
    .map((c) => `<li class="row-between" style="padding:6px 0; border-top:1px solid var(--border);">
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

  createReportView({
    mount: document.getElementById('report-mount'),
    csvFilename: `financials-${new Date().toISOString().slice(0, 10)}.csv`,
    search: { placeholder: 'Search subject, vendor, or notes…', text: (x) => `${subjectLabel(x)} ${x.vendor || ''} ${x.notes || ''}` },
    filters: [
      { id: 'category', label: 'Category', options: EXPENSE_CATEGORIES, match: (x, v) => x.category === v },
      { id: 'subject_type', label: 'Attached to', options: EXPENSE_SUBJECT_TYPES, match: (x, v) => x.subject_type === v },
      { id: 'year', label: 'Year', options: years.map((y) => ({ value: y, label: y })), match: (x, v) => year(x) === v }
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
    load: () => Promise.resolve(expenses),
    emptyText: 'No expenses recorded yet.'
  });
}

init();
