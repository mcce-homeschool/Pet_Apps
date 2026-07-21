// assistant.js — the whole KennelAssistant app (see assistant.html). Three
// verbs: sync dogs in from the Dropbox feed, log events locally, send them
// back as the outbox. All storage goes through data/assistantStore.js (its own
// tiny database); Dropbox goes through the same data/dropbox.js client and
// connection the main app uses, so on the owner's own phone the two share one
// sign-in.
import { esc } from './assets/ui.js';
import { EVENT_TYPES, DOG_STATUS, SEX, descriptor, eventTypesFor } from './data/vocab.js';
import { todayYMD } from './data/dateUtils.js';
import {
  completeDropboxAuth, beginDropboxAuth, isDropboxConnected,
  dropboxRedirectUri, getDropboxAppKey, dropboxUploadJson, dropboxDownloadJson,
  DROPBOX_PATHS
} from './data/dropbox.js';
import {
  syncFromFeed, getDogs, getTimeline, createPendingEvent,
  getPendingEvents, deletePendingEvent, buildOutbox
} from './data/assistantStore.js';
import { getAssistantLastSync } from './data/settings.js';

// Same service worker + scope as the main app (registered from app root), so
// the assistant loads fast on its own too.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { scope: new URL('./', import.meta.url) });
}

const msg = document.getElementById('page-msg');
function flash(text, kind = 'ok') {
  msg.innerHTML = `<div class="${kind === 'ok' ? 'inline-warn' : 'inline-error'}" style="${kind === 'ok' ? 'color:var(--accent-dark);background:var(--accent-soft);border-color:#bfe0cd;' : ''}">${esc(text)}</div>`;
  msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function show(id, visible) {
  document.getElementById(id).style.display = visible ? '' : 'none';
}

async function renderAll() {
  const connected = isDropboxConnected();
  show('connect-card', !connected);
  show('sync-card', connected);
  show('dogs-card', connected);
  if (!connected) {
    show('pending-card', false);
    document.getElementById('redirect-uri').textContent = dropboxRedirectUri();
    document.getElementById('dbx-app-key').value = getDropboxAppKey();
    return;
  }
  await Promise.all([renderSyncStatus(), renderPending(), renderDogs()]);
}

async function renderSyncStatus() {
  const last = getAssistantLastSync();
  const pending = await getPendingEvents();
  document.getElementById('sync-status').textContent = last
    ? `Dogs last synced ${new Date(last).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`
    : 'No dogs yet — tap "Get latest dogs" to pull them in.';
  const sendBtn = document.getElementById('btn-send');
  sendBtn.style.display = pending.length ? '' : 'none';
  sendBtn.textContent = `⬆ Send my updates (${pending.length})`;
}

async function renderDogs() {
  const dogs = await getDogs();
  const list = document.getElementById('dog-list');
  if (!dogs.length) {
    list.innerHTML = '<p class="faint">No dogs synced yet.</p>';
    return;
  }
  list.innerHTML = dogs.map((d) => {
    const status = descriptor(DOG_STATUS, d.status);
    const sex = descriptor(SEX, d.sex);
    return `
      <div class="dog-row" data-id="${esc(d.id)}" role="button" tabindex="0"
           style="display:flex;align-items:center;gap:10px;padding:10px 2px;border-top:1px solid var(--border,#e2e6ec);cursor:pointer;">
        <div style="flex:1;min-width:0;">
          <strong>${esc(d.call_name || '(unnamed)')}</strong>
          ${d.registered_name ? `<span class="faint"> — ${esc(d.registered_name)}</span>` : ''}
          <div class="muted" style="font-size:13px;">${esc([d.breed, sex.label].filter(Boolean).join(' • '))}</div>
        </div>
        <span class="badge ${esc(status.badge)}">${esc(status.label)}</span>
      </div>`;
  }).join('');
  for (const row of list.querySelectorAll('.dog-row')) {
    const open = async () => {
      const dogs2 = await getDogs();
      const dog = dogs2.find((d) => d.id === row.dataset.id);
      if (dog) openLogModal(dog);
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  }
}

async function renderPending() {
  const pending = await getPendingEvents();
  show('pending-card', pending.length > 0);
  if (!pending.length) return;
  const list = document.getElementById('pending-list');
  list.innerHTML = pending.map(({ event, dogName, typeLabel }) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 2px;border-top:1px solid var(--border,#e2e6ec);">
      <div style="flex:1;min-width:0;">
        <strong>${esc(dogName)}</strong> — ${esc(typeLabel)}
        <span class="muted">${esc(event.event_date)}</span>
      </div>
      <button class="btn" data-del="${esc(event.id)}" title="Remove before sending">✕</button>
    </div>`).join('');
  for (const btn of list.querySelectorAll('[data-del]')) {
    btn.addEventListener('click', async () => {
      try {
        await deletePendingEvent(btn.dataset.del);
        await Promise.all([renderPending(), renderSyncStatus()]);
      } catch (e) {
        flash(e.message || String(e), 'err');
      }
    });
  }
}

// --- Log-event modal --------------------------------------------------------

// Renders one details input per vocab field. `combobox` renders as plain text
// (suggest lists live in the main app); `select` options may be plain strings.
function detailFieldsHtml(typeDef) {
  if (!typeDef.fields.length) return '<p class="faint" style="margin:0;">Nothing extra for this type — the title says it all.</p>';
  return typeDef.fields.map((f) => {
    let input;
    if (f.type === 'textarea') {
      input = `<textarea data-detail="${esc(f.key)}" rows="2"></textarea>`;
    } else if (f.type === 'select') {
      const opts = (f.options || []).map((o) => {
        const value = o.value ?? o;
        const label = o.label ?? o;
        return `<option value="${esc(value)}">${esc(label)}</option>`;
      }).join('');
      input = `<select data-detail="${esc(f.key)}"><option value=""></option>${opts}</select>`;
    } else if (f.type === 'number') {
      input = `<input data-detail="${esc(f.key)}" type="number" ${f.step ? `step="${esc(f.step)}"` : ''}>`;
    } else if (f.type === 'date') {
      input = `<input data-detail="${esc(f.key)}" type="date">`;
    } else {
      input = `<input data-detail="${esc(f.key)}" type="text">`;
    }
    return `<div class="field"><label>${esc(f.label)}</label>${input}</div>`;
  }).join('');
}

async function openLogModal(dog) {
  const types = eventTypesFor('dog');
  const defaultType = 'weight_check';
  const recent = (await getTimeline(dog.id)).slice(0, 5);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:440px;">
      <h2 style="margin-top:0;">Log for ${esc(dog.call_name || '(unnamed)')}</h2>
      <div class="field field-wide">
        <label>What happened?</label>
        <select id="log-type">${types.map((t) => `<option value="${esc(t.value)}" ${t.value === defaultType ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Date</label><input id="log-date" type="date" value="${esc(todayYMD())}"></div>
      <div class="field" id="log-end-wrap" style="display:none;"><label>End date (optional)</label><input id="log-end" type="date"></div>
      <div class="field field-wide"><label>Title</label><input id="log-title" type="text"></div>
      <div id="log-details"></div>
      <div id="log-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="log-save">Save</button>
        <button class="btn" data-act="cancel">Cancel</button>
      </div>
      ${recent.length ? `
        <h2 style="font-size:15px;">Recent</h2>
        ${recent.map((e) => `<div class="muted" style="font-size:13px;padding:2px 0;">${esc(e.event_date)} — ${esc(descriptor(EVENT_TYPES, e.event_type).label)}: ${esc(e.title || '')}${e.pending ? ' <em>(not sent yet)</em>' : ''}</div>`).join('')}` : ''}
    </div>`;
  document.body.appendChild(overlay);

  const typeSel = overlay.querySelector('#log-type');
  const titleInput = overlay.querySelector('#log-title');
  const detailsBox = overlay.querySelector('#log-details');
  const applyType = () => {
    const typeDef = descriptor(EVENT_TYPES, typeSel.value);
    // Auto-fill the title with the type label unless the kid typed their own.
    if (!titleInput.value || titleInput.value === titleInput.dataset.auto) {
      titleInput.value = typeDef.label;
    }
    titleInput.dataset.auto = typeDef.label;
    detailsBox.innerHTML = detailFieldsHtml(typeDef);
    overlay.querySelector('#log-end-wrap').style.display = typeDef.duration === 'span' ? '' : 'none';
  };
  applyType();
  typeSel.addEventListener('change', applyType);

  overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#log-save').addEventListener('click', async () => {
    const details = {};
    for (const el of detailsBox.querySelectorAll('[data-detail]')) {
      const val = el.value.trim();
      if (val !== '') details[el.dataset.detail] = el.type === 'number' ? Number(val) : val;
    }
    try {
      await createPendingEvent({
        subject_id: dog.id,
        event_type: typeSel.value,
        event_date: overlay.querySelector('#log-date').value,
        event_end_date: overlay.querySelector('#log-end').value || null,
        title: titleInput.value.trim(),
        details
      });
      overlay.remove();
      flash(`Saved — waiting to send.`);
      await Promise.all([renderPending(), renderSyncStatus()]);
    } catch (e) {
      overlay.querySelector('#log-error').innerHTML = `<div class="inline-error">${esc(e.message || String(e))}</div>`;
    }
  });
}

// --- Buttons ----------------------------------------------------------------

document.getElementById('dbx-connect').addEventListener('click', async () => {
  try {
    await beginDropboxAuth(document.getElementById('dbx-app-key').value);
  } catch (e) {
    flash(e.message || String(e), 'err');
  }
});

async function withBusy(buttonId, action) {
  const btn = document.getElementById(buttonId);
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    await action();
  } catch (e) {
    flash(e.message || String(e), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

document.getElementById('btn-sync').addEventListener('click', () => withBusy('btn-sync', async () => {
  const feed = await dropboxDownloadJson(DROPBOX_PATHS.feed);
  if (!feed) {
    flash('No dogs in Dropbox yet — ask the owner to "Push to Dropbox" first.', 'err');
    return;
  }
  const result = await syncFromFeed(feed);
  flash(`Synced ${result.dogs} dog(s) and ${result.events} event(s).`);
  await renderAll();
}));

document.getElementById('btn-send').addEventListener('click', () => withBusy('btn-send', async () => {
  const outbox = await buildOutbox();
  if (!outbox.events.length) {
    flash('Nothing to send.');
    return;
  }
  await dropboxUploadJson(DROPBOX_PATHS.outbox, outbox);
  flash(`Sent ${outbox.events.length} update(s). They stay listed until the owner imports them and pushes a fresh feed.`);
}));

// --- Boot -------------------------------------------------------------------

completeDropboxAuth()
  .then((handled) => { if (handled) flash('Dropbox connected.'); })
  .catch((e) => flash(e.message || String(e), 'err'))
  .finally(renderAll);
