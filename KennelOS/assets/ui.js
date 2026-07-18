// ui.js — small shared rendering helpers used across pages. No framework;
// just functions that return safe HTML strings or build DOM.
import { descriptor } from '../data/vocab.js';
import { todayYMD } from '../data/dateUtils.js';

// Re-exported so pages keep importing todayYMD from here alongside the rest
// of the shared rendering helpers — the one implementation lives in
// data/dateUtils.js so repos and assets never drift apart on "what is today."
export { todayYMD };

// Escape untrusted text for safe interpolation into innerHTML.
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A colored badge for a single vocab value.
export function badge(vocab, value) {
  const d = descriptor(vocab, value);
  return `<span class="badge ${d.badge}">${esc(d.label)}</span>`;
}

// Multiple badges (e.g. a contact's several types).
export function badges(vocab, values) {
  if (!values || !values.length) return '<span class="faint">—</span>';
  return values.map((v) => badge(vocab, v)).join(' ');
}

// Date-only display: 'YYYY-MM-DD' -> localized medium date, untouched if empty.
export function fmtDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// Read ?id= (or any param) from the current URL.
export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

// Populate a <select> from a vocab list. `current` preselects; `placeholder`
// adds a leading empty option when provided.
export function fillSelect(selectEl, vocab, current, placeholder) {
  selectEl.innerHTML = '';
  if (placeholder != null) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = placeholder;
    selectEl.appendChild(o);
  }
  for (const v of vocab) {
    const o = document.createElement('option');
    o.value = v.value;
    o.textContent = v.label;
    if (v.value === current) o.selected = true;
    selectEl.appendChild(o);
  }
}

// Minimal confirm wrapper (kept as a seam so we can swap in a nicer modal later).
export function confirmAction(message) {
  return window.confirm(message);
}

// Collapsible card chrome (Today home cards). `title` is the header HTML
// (may already include a trailing count span); `bodyHtml` is everything
// below the header. `isEmpty` starts the card collapsed — the caller
// decides what "empty" means for that card. `headerExtra` renders inline
// actions (e.g. a link/button) next to the toggle, before it.
export function cardShell(title, bodyHtml, { key = '', isEmpty = false, headerExtra = '', marginTop = false } = {}) {
  return `<section class="card card-collapsible"${marginTop ? ' style="margin-top:16px;"' : ''} data-card="${esc(key)}">
      <div class="card-head">
        <h2 style="margin:0;">${title}</h2>
        <div class="card-head-actions">
          ${headerExtra}
          <button type="button" class="card-toggle-btn" aria-expanded="${isEmpty ? 'false' : 'true'}" aria-label="${isEmpty ? 'Expand' : 'Collapse'} card">▾</button>
        </div>
      </div>
      <div class="card-body"${isEmpty ? ' hidden' : ''}>${bodyHtml}</div>
    </section>`;
}

// Delegated once for every page that renders a cardShell — toggles the
// nearest card body and flips the button's expanded state/label.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.card-toggle-btn');
  if (!btn) return;
  const body = btn.closest('.card-collapsible')?.querySelector('.card-body');
  if (!body) return;
  const wasOpen = !body.hidden;
  body.hidden = wasOpen;
  btn.setAttribute('aria-expanded', String(!wasOpen));
  btn.setAttribute('aria-label', wasOpen ? 'Expand card' : 'Collapse card');
});
