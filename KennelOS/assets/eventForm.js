// eventForm.js — modal form for creating/editing a HistoryEvent. Picks the
// type-specific short form from the EVENT_TYPES catalog (Build Brief B1) so
// `details` stays structured, not a free-text dumping ground.
//
// Stage4.5 Addendum §C3/D1: a `span`-duration type (boarding, heat_cycle,
// medication) also shows the plain `event_end_date` field, and a
// `relatedContact: true` type (boarding, placement) shows a top-level Contact
// picker — the canonical events.related_contact_id FK, never a `details` field.
import { HistoryEvent } from '../data/eventRepo.js';
import { contactRepo } from '../data/contactRepo.js';
import { eventTypesFor, descriptor, EVENT_TYPES } from '../data/vocab.js';
import { esc, todayYMD } from './ui.js';

// Open the modal. opts: { subjectType, subjectId, event?, prefill?, onSaved, onCancel? }
// If `event` is provided we're editing; otherwise creating. `prefill` seeds a
// NEW event's draft (event_type/related_contact_id/title/details) — used by the
// soft-suggestion prompts (Stage4.5 Addendum §C6/§D4: StudService→boarding,
// Litter→grow-out, Sale→placement). It's a one-time seed, never a stored link
// back to whatever triggered it.
export async function openEventForm(opts) {
  const { subjectType, subjectId, event = null, prefill = null, onSaved, onCancel } = opts;
  const types = eventTypesFor(subjectType);
  const isEdit = !!event;

  // Contacts are only ever needed for relatedContact types (boarding, placement,
  // both dog-subject) — loaded once up front so the picker is ready on first render.
  const contacts = await contactRepo.getAll({ includeArchived: true });

  // Working state
  const draft = {
    event_type: event?.event_type || prefill?.event_type || types[0].value,
    event_date: event?.event_date || todayYMD(),
    event_end_date: event?.event_end_date || '',
    related_contact_id: event?.related_contact_id || prefill?.related_contact_id || '',
    title: event?.title || prefill?.title || '',
    details: { ...(event?.details || prefill?.details || {}) },
    reminder_date: event?.reminder_date || '',
    cost: event?.cost ?? '',
    notes: event?.notes || ''
  };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true"></div>`;
  const modal = overlay.querySelector('.modal');
  document.body.appendChild(overlay);

  function detailFieldsHtml(typeDef) {
    if (!typeDef.fields.length) return '<p class="faint" style="margin:0;">No extra fields for this type — use the title and notes.</p>';
    return `<div class="form-grid">` + typeDef.fields.map((f) => {
      const v = draft.details[f.key] ?? '';
      if (f.type === 'textarea') {
        return `<div class="field field-wide"><label>${esc(f.label)}</label><textarea data-detail="${esc(f.key)}">${esc(v)}</textarea></div>`;
      }
      if (f.type === 'combobox') {
        const dlId = `ef-dl-${f.key}`;
        const opts = (f.options || []).map((o) => `<option value="${esc(o)}"></option>`).join('');
        return `<div class="field"><label>${esc(f.label)}</label><input data-detail="${esc(f.key)}" type="text" list="${dlId}" value="${esc(v)}"><datalist id="${dlId}">${opts}</datalist></div>`;
      }
      const inputType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
      return `<div class="field"><label>${esc(f.label)}</label><input data-detail="${esc(f.key)}" type="${inputType}" value="${esc(v)}"></div>`;
    }).join('') + `</div>`;
  }

  function contactOptions(current) {
    const opts = contacts
      .map((c) => `<option value="${esc(c.id)}"${c.id === current ? ' selected' : ''}>${esc(c.name)}${c.is_archived ? ' (archived)' : ''}</option>`)
      .join('');
    return `<option value="">— none —</option>` + opts;
  }

  function render() {
    const typeDef = descriptor(EVENT_TYPES, draft.event_type);
    const typeOptions = types.map((t) =>
      `<option value="${esc(t.value)}"${t.value === draft.event_type ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
    const isSpan = typeDef.duration === 'span';
    modal.innerHTML = `
      <div class="row-between" style="margin-bottom:12px;">
        <h2 style="margin:0;">${isEdit ? 'Edit event' : 'Add event'}</h2>
        <button class="btn btn-sm" data-act="cancel">✕</button>
      </div>
      <div class="form-grid">
        <div class="field"><label>Type <span class="req">*</span></label>
          <select id="ef-type">${typeOptions}</select></div>
        <div class="field"><label>${isSpan ? 'Start date' : 'Date'} <span class="req">*</span></label>
          <input id="ef-date" type="date" value="${esc(draft.event_date)}">
          <span class="field-hint">Future dates are allowed (e.g. a scheduled surgery).</span></div>
        ${isSpan ? `<div class="field"><label>End date</label>
          <input id="ef-end-date" type="date" value="${esc(draft.event_end_date)}">
          <span class="field-hint">Leave blank for an open-ended/ongoing stay.</span></div>` : ''}
        <div class="field field-wide"><label>Title <span class="req">*</span></label>
          <input id="ef-title" type="text" value="${esc(draft.title)}" placeholder="Short summary shown in the timeline"></div>
        ${typeDef.relatedContact ? `<div class="field"><label>Related contact</label>
          <select id="ef-related-contact">${contactOptions(draft.related_contact_id)}</select>
          <span class="field-hint">The person or kennel on the other side of this event.</span></div>` : ''}
      </div>
      <h2 style="font-size:15px;">${esc(typeDef.label)} details</h2>
      <div id="ef-details">${detailFieldsHtml(typeDef)}</div>
      <div class="form-grid" style="margin-top:14px;">
        <div class="field"><label>Reminder date</label><input id="ef-reminder" type="date" value="${esc(draft.reminder_date)}"></div>
        <div class="field"><label>Cost</label><input id="ef-cost" type="number" step="0.01" value="${esc(draft.cost)}"></div>
        <div class="field field-wide"><label>Notes</label><textarea id="ef-notes">${esc(draft.notes)}</textarea></div>
      </div>
      <div id="ef-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary" data-act="save">Save event</button>
        <button class="btn" data-act="cancel">Cancel</button>
      </div>`;

    modal.querySelector('#ef-type').addEventListener('change', (e) => {
      captureInputs();
      draft.event_type = e.target.value;
      // Auto-fill an empty title with the type label as a convenience.
      if (!draft.title) draft.title = descriptor(EVENT_TYPES, draft.event_type).label;
      render();
    });
    modal.querySelector('[data-act="save"]').addEventListener('click', save);
    modal.querySelectorAll('[data-act="cancel"]').forEach((b) => b.addEventListener('click', close));
  }

  function captureInputs() {
    draft.event_date = modal.querySelector('#ef-date').value;
    const endEl = modal.querySelector('#ef-end-date');
    draft.event_end_date = endEl ? endEl.value : '';
    const contactEl = modal.querySelector('#ef-related-contact');
    draft.related_contact_id = contactEl ? contactEl.value : '';
    draft.title = modal.querySelector('#ef-title').value.trim();
    draft.reminder_date = modal.querySelector('#ef-reminder').value;
    draft.cost = modal.querySelector('#ef-cost').value;
    draft.notes = modal.querySelector('#ef-notes').value;
    draft.details = {};
    modal.querySelectorAll('[data-detail]').forEach((el) => {
      const val = el.value.trim();
      if (val !== '') draft.details[el.dataset.detail] = el.type === 'number' ? Number(val) : val;
    });
  }

  function showError(msg) {
    modal.querySelector('#ef-error').innerHTML = `<div class="inline-error">${esc(msg)}</div>`;
  }

  async function save() {
    captureInputs();
    // Soft warning: reminder should not precede the event.
    if (draft.reminder_date && draft.event_date && draft.reminder_date < draft.event_date) {
      if (!window.confirm('Reminder date is before the event date. Save anyway?')) return;
    }
    const payload = {
      subject_type: subjectType,
      subject_id: subjectId,
      event_type: draft.event_type,
      event_date: draft.event_date,
      event_end_date: draft.event_end_date || null,
      related_contact_id: draft.related_contact_id || null,
      title: draft.title,
      details: draft.details,
      reminder_date: draft.reminder_date || null,
      cost: draft.cost === '' ? null : Number(draft.cost),
      notes: draft.notes
    };
    try {
      const saved = isEdit
        ? await HistoryEvent.update(event.id, payload)
        : await HistoryEvent.create(payload);
      close();
      onSaved?.(saved);
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') { close(); onCancel?.(); } }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); onCancel?.(); } });
  document.addEventListener('keydown', onKey);
  render();
}
