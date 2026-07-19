// expensePanel.js — renders a subject's Expenses (the Financials ledger for one
// dog / litter / pairing / kennel) with a running total and add/edit/archive/
// delete. Reused on the dog, litter, pairing, and kennel detail pages — the same
// role timeline.js plays for events. A cost entered here lives in the `expenses`
// table (expenseRepo); this is the ledger-first entry point that complements the
// convenience "Cost" field on the event form.
import { expenseRepo } from '../data/expenseRepo.js';
import { EXPENSE_CATEGORIES } from '../data/vocab.js';
import { esc, badge, fmtDate, fmtMoney, todayYMD, confirmModal } from './ui.js';
import { openEventForm } from './eventForm.js';

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join('');

// Subject types that can also carry events, so a ledger row offers "Log event →"
// (kennel expenses have no event subject, so they don't).
const EVENTABLE = new Set(['dog', 'litter', 'pairing']);

// A small modal for creating/editing one expense. Resolves via onSaved. The
// subject is fixed by the panel's context and never editable here.
function openExpenseForm({ subjectType, subjectId, expense = null, onSaved }) {
  const isEdit = !!expense;
  const draft = {
    amount: expense?.amount ?? '',
    category: expense?.category || 'other',
    expense_date: expense?.expense_date || todayYMD(),
    vendor: expense?.vendor || '',
    notes: expense?.notes || ''
  };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="row-between" style="margin-bottom:12px;">
        <h2 style="margin:0;">${isEdit ? 'Edit expense' : 'Add expense'}</h2>
        <button class="btn btn-sm" data-act="cancel">✕</button>
      </div>
      <div class="form-grid">
        <div class="field"><label>Amount <span class="req">*</span></label>
          <input id="xf-amount" type="number" step="0.01" min="0" value="${esc(draft.amount)}"></div>
        <div class="field"><label>Category</label>
          <select id="xf-category">${CATEGORY_OPTIONS}</select></div>
        <div class="field"><label>Date <span class="req">*</span></label>
          <input id="xf-date" type="date" value="${esc(draft.expense_date)}"></div>
        <div class="field"><label>Vendor</label>
          <input id="xf-vendor" type="text" value="${esc(draft.vendor)}" placeholder="Who was paid"></div>
        <div class="field field-wide"><label>Notes</label>
          <textarea id="xf-notes">${esc(draft.notes)}</textarea></div>
      </div>
      <div id="xf-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary" data-act="save">Save expense</button>
        <button class="btn" data-act="cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const modal = overlay.querySelector('.modal');
  modal.querySelector('#xf-category').value = draft.category;

  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }

  async function save() {
    const payload = {
      subject_type: subjectType,
      subject_id: subjectId,
      amount: modal.querySelector('#xf-amount').value,
      category: modal.querySelector('#xf-category').value,
      expense_date: modal.querySelector('#xf-date').value,
      vendor: modal.querySelector('#xf-vendor').value.trim(),
      notes: modal.querySelector('#xf-notes').value
    };
    try {
      const saved = isEdit
        ? await expenseRepo.update(expense.id, payload)
        : await expenseRepo.create(payload);
      close();
      onSaved?.(saved);
    } catch (e) {
      modal.querySelector('#xf-error').innerHTML = `<div class="inline-error">${esc(e.message || String(e))}</div>`;
    }
  }

  modal.querySelector('[data-act="save"]').addEventListener('click', save);
  modal.querySelectorAll('[data-act="cancel"]').forEach((b) => b.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
}

export function renderExpensePanel(opts) {
  const { mount, subjectType, subjectId, title = 'Expenses' } = opts;
  let showArchived = false;

  mount.innerHTML = `
    <section class="card" style="margin-top:16px;">
      <div class="row-between">
        <div class="collapsible-header" style="flex: 1; display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;" data-toggle="xp-toggle">
          <span class="collapsible-arrow" style="transform: rotate(90deg); display: inline-block; transition: transform 0.2s; font-size: 12px;">▶</span>
          <h2 style="margin:0;">${esc(title)}</h2>
        </div>
        <strong id="xp-total" style="font-size:18px;"></strong>
      </div>
      <div class="pill-row" style="justify-content:flex-end; margin-top:8px;">
        <label class="check-inline"><input type="checkbox" id="xp-archived"> Show archived</label>
        <button class="btn btn-primary btn-sm" id="xp-add">+ Add Expense</button>
      </div>
      <div class="collapsible-content" id="xp-content" style="display: block; margin-top:12px;">
        <div id="xp-body"></div>
      </div>
    </section>`;

  const body = mount.querySelector('#xp-body');
  const totalEl = mount.querySelector('#xp-total');

  async function refresh() {
    const all = await expenseRepo.getForSubject(subjectType, subjectId, { includeArchived: true });
    const active = all.filter((x) => !x.is_archived);
    totalEl.textContent = active.length ? `Total ${fmtMoney(expenseRepo.total(active))}` : 'No costs';
    const visible = showArchived ? all : active;
    if (!visible.length) {
      body.innerHTML = `<div class="empty-state">No expenses logged yet.</div>`;
      wireAddOnly();
      return;
    }
    body.innerHTML = `<ul class="linked-list" style="margin:0; padding:0; list-style:none;">` + visible.map((x, i) => {
      const meta = [x.vendor ? esc(x.vendor) : '', x.notes ? esc(x.notes) : ''].filter(Boolean).join(' — ');
      const eventTag = x.event_id ? ' <span class="badge badge-gray" title="Captured from an event">🔗 event</span>' : '';
      const logBtn = (!x.event_id && EVENTABLE.has(subjectType))
        ? `<button class="btn btn-sm" data-act="log-event" data-idx="${i}" title="Create a linked event for this cost">Log event →</button>` : '';
      return `<li class="row-between${x.is_archived ? ' row-archived' : ''}" style="padding:8px 0; border-top:1px solid var(--border); gap:10px;">
        <div style="flex:1;">
          <div>${badge(EXPENSE_CATEGORIES, x.category)} <strong>${esc(fmtMoney(x.amount))}</strong> <span class="faint">${esc(fmtDate(x.expense_date))}</span>${eventTag}</div>
          ${meta ? `<div class="muted" style="font-size:14px;">${meta}</div>` : ''}
        </div>
        <div class="pill-row">
          ${logBtn}
          <button class="btn btn-sm" data-act="edit" data-idx="${i}">Edit</button>
          <button class="btn btn-sm" data-act="archive" data-idx="${i}">${x.is_archived ? 'Unarchive' : 'Archive'}</button>
          <button class="btn btn-danger btn-sm" data-act="delete" data-idx="${i}">Delete</button>
        </div>
      </li>`;
    }).join('') + `</ul>`;

    body.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => onAction(btn.dataset.act, visible[Number(btn.dataset.idx)]));
    });
    wireAddOnly();
  }

  async function onAction(act, x) {
    if (act === 'edit') {
      openExpenseForm({ subjectType, subjectId, expense: x, onSaved: refresh });
    } else if (act === 'archive') {
      x.is_archived ? await expenseRepo.unarchive(x.id) : await expenseRepo.archive(x.id);
      refresh();
    } else if (act === 'delete') {
      if (await confirmModal({ title: 'Delete expense?', message: `Permanently delete this ${fmtMoney(x.amount)} expense? This cannot be undone.`, confirmLabel: 'Delete', danger: true })) {
        await expenseRepo.hardDelete(x.id);
        refresh();
      }
    } else if (act === 'log-event') {
      // Ledger → event: open a fresh event for this subject; on save, adopt it as
      // this expense's canonical link (so the cost and the event become one).
      openEventForm({
        subjectType, subjectId,
        onSaved: async (savedEvent) => {
          if (savedEvent && !Array.isArray(savedEvent) && savedEvent.id) {
            await expenseRepo.update(x.id, { event_id: savedEvent.id });
          }
          refresh();
        }
      });
    }
  }

  // (Re)bind the always-present controls. Called after each body render so the
  // Add button keeps working when the list re-draws.
  function wireAddOnly() {
    const addBtn = mount.querySelector('#xp-add');
    addBtn.onclick = () => openExpenseForm({ subjectType, subjectId, onSaved: refresh });
  }

  mount.querySelector('#xp-archived').addEventListener('change', (e) => { showArchived = e.target.checked; refresh(); });

  // Collapsible header
  const header = mount.querySelector('[data-toggle="xp-toggle"]');
  const content = mount.querySelector('#xp-content');
  const arrow = header?.querySelector('.collapsible-arrow');
  let isExpanded = true;
  if (header) {
    header.addEventListener('click', () => {
      isExpanded = !isExpanded;
      content.style.display = isExpanded ? 'block' : 'none';
      if (arrow) arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
    });
  }

  refresh();
}
