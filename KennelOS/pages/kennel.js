// kennel.js — Kennel Detail. A lean read-only profile (editing kennels stays on
// the Kennels list, kennels.js) whose real job is hosting the kennel-wide
// Expenses ledger: costs that belong to the whole kennel rather than any one
// dog or litter (facility, bulk food, registration dues, marketing…). All such
// rows carry subject_type='kennel' + subject_id=this kennel.
import { kennelRepo } from '../data/kennelRepo.js';
import { esc, param } from '../assets/ui.js';
import { renderExpensePanel } from '../assets/expensePanel.js';

const els = {
  title: document.getElementById('kennel-title'),
  subtitle: document.getElementById('kennel-subtitle'),
  body: document.getElementById('profile-body'),
  error: document.getElementById('page-error'),
  expenses: document.getElementById('expenses-section')
};

function row(label, valueHtml) {
  return valueHtml ? `<dt>${esc(label)}</dt><dd>${valueHtml}</dd>` : '';
}

function renderView(k) {
  els.title.innerHTML = esc(k.kennel_name) +
    (k.is_own_kennel ? ' <span class="badge badge-green">My kennel</span>' : '') +
    (k.is_archived ? ' <span class="badge badge-gray">Archived</span>' : '');
  els.subtitle.textContent = 'Kennel-wide financials and details.';
  els.body.innerHTML = `
    <dl class="dl-meta" style="margin-top:14px;">
      ${row('Name', esc(k.kennel_name))}
      ${row('Prefix', esc(k.prefix))}
      ${row('Location', esc(k.location))}
    </dl>
    <p class="field-hint" style="margin-top:10px;">Edit a kennel's details from the
      <a href="kennels.html">Kennels list</a>. Log kennel-wide overhead below.</p>`;
}

async function main() {
  const id = param('id');
  if (!id) { els.error.innerHTML = '<div class="inline-error">No kennel id provided.</div>'; return; }
  const k = await kennelRepo.getById(id);
  if (!k) { els.error.innerHTML = '<div class="inline-error">Kennel not found. It may have been deleted.</div>'; return; }
  renderView(k);
  renderExpensePanel({ mount: els.expenses, subjectType: 'kennel', subjectId: k.id, title: 'Kennel Expenses' });
}

main();
