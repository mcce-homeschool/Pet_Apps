// import-export.js — wires the Import/Export page to the backup engine.
import { downloadBackup, readBackupFile, inspectBackup, restoreBackup } from '../data/importExport.js';
import { getLastBackupDate } from '../data/settings.js';
import { hasSampleData } from '../data/sampleData.js';
import { promptClearSampleData } from '../assets/sampleDataUI.js';
import { hasMyKennelSetup, getMyKennelName } from '../data/kennelSetup.js';
import { showKennelSetupModal, maybeShowKennelSetupPrompt } from '../assets/kennelSetupUI.js';
import { getResetCounts, resetApp } from '../data/appReset.js';
import { esc, confirmAction } from '../assets/ui.js';

const msg = document.getElementById('page-msg');
function flash(text, kind = 'ok') {
  msg.innerHTML = `<div class="${kind === 'ok' ? 'inline-warn' : 'inline-error'}" style="${kind === 'ok' ? 'color:var(--accent-dark);background:var(--accent-soft);border-color:#bfe0cd;' : ''}">${esc(text)}</div>`;
  msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderLastBackup() {
  const iso = getLastBackupDate();
  const el = document.getElementById('last-backup');
  el.textContent = iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
}

document.getElementById('btn-backup').addEventListener('click', async () => {
  try {
    const data = await downloadBackup();
    const total = Object.values(data.collections).reduce((n, rows) => n + rows.length, 0);
    renderLastBackup();
    flash(`Backup downloaded — ${total} record(s) across ${Object.keys(data.collections).length} tables.`);
  } catch (e) {
    flash(e.message || String(e), 'err');
  }
});

const fileInput = document.getElementById('restore-file');
const preview = document.getElementById('restore-preview');
let pendingBackup = null;

fileInput.addEventListener('change', async () => {
  preview.innerHTML = '';
  pendingBackup = null;
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const obj = await readBackupFile(file);
    const info = inspectBackup(obj);
    pendingBackup = obj;
    const rows = Object.entries(info.counts)
      .map(([name, n]) => `<tr><td>${esc(name)}</td><td>${n}</td></tr>`).join('');
    const warnUnknown = info.unknownTables.length
      ? `<div class="inline-warn">Ignoring unknown tables not in this app version: ${esc(info.unknownTables.join(', '))}.</div>`
      : '';
    preview.innerHTML = `
      <p class="muted">Exported ${info.exported_at ? esc(new Date(info.exported_at).toLocaleString()) : 'unknown date'} (schema v${esc(info.schema_version ?? '?')}).</p>
      <table class="data" style="max-width:320px;"><thead><tr><th>Table</th><th>Rows</th></tr></thead><tbody>${rows}</tbody></table>
      ${warnUnknown}
      <div class="form-actions">
        <button class="btn" id="btn-merge">Merge into current data</button>
        <button class="btn btn-danger" id="btn-replace">Replace all data</button>
      </div>`;
    document.getElementById('btn-merge').onclick = () => doRestore('merge');
    document.getElementById('btn-replace').onclick = () => doRestore('replace');
  } catch (e) {
    flash(e.message || String(e), 'err');
  }
});

async function doRestore(mode) {
  if (!pendingBackup) return;
  const warning = mode === 'replace'
    ? 'Replace ALL current records with the file’s contents? This cannot be undone.'
    : 'Merge the file’s records into your current data (updating any with matching ids)?';
  if (!confirmAction(warning)) return;
  try {
    const result = await restoreBackup(pendingBackup, mode);
    const total = result.reduce((n, r) => n + r.count, 0);
    flash(`Restore complete (${mode}) — ${total} record(s) loaded. Reloading…`);
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    flash(e.message || String(e), 'err');
  }
}

renderLastBackup();

function renderSampleDataStatus() {
  const status = document.getElementById('sample-data-status');
  const btn = document.getElementById('btn-clear-sample');
  if (hasSampleData()) {
    status.textContent = 'Sample "Thornfield Kennels" demo data is currently loaded.';
    btn.style.display = '';
  } else {
    status.textContent = 'No sample data is loaded.';
    btn.style.display = 'none';
  }
}

document.getElementById('btn-clear-sample').addEventListener('click', async () => {
  const result = await promptClearSampleData();
  if (result?.cleared) {
    flash(`Sample data cleared — ${result.counts.dogs} dog(s), ${result.counts.events} event(s), ${result.counts.contacts} contact(s), ${result.counts.kennels} kennel(s) removed.`);
    renderSampleDataStatus();
    renderKennelSetupStatus();
    maybeShowKennelSetupPrompt(); // offer it right away, same as a fresh page load would
  }
});

renderSampleDataStatus();

async function renderKennelSetupStatus() {
  const status = document.getElementById('kennel-setup-status');
  const btn = document.getElementById('btn-kennel-setup');
  const name = hasMyKennelSetup() ? await getMyKennelName() : null;
  status.textContent = name
    ? `Your kennel is set to "${name}".`
    : 'Not set up yet — dogs won’t prefill an owner until this is done.';
  btn.textContent = name ? 'Change kennel / owner' : 'Set up your kennel';
}

document.getElementById('btn-kennel-setup').addEventListener('click', () => {
  showKennelSetupModal({ skippable: false });
});

renderKennelSetupStatus();

async function renderResetAppStatus() {
  const status = document.getElementById('reset-app-status');
  const counts = await getResetCounts();
  const parts = Object.entries(counts).map(([name, n]) => `${n} ${name}`);
  status.textContent = `Currently stored: ${parts.join(', ')}.`;
}

const RESET_PHRASE = 'RESET';

function showResetAppModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:440px;">
      <h2 style="margin-top:0;">⚠️ Reset app to start</h2>
      <p class="muted">This permanently deletes <strong>all</strong> dogs, contacts, kennels, and events, and clears
        all app settings. You'll land back on the first-run setup screen. This cannot be undone.</p>
      <div class="field field-wide">
        <label>Type <strong>${RESET_PHRASE}</strong> to confirm</label>
        <input id="reset-confirm-input" type="text" autocomplete="off" placeholder="${RESET_PHRASE}">
      </div>
      <div id="reset-error"></div>
      <div class="form-actions">
        <button class="btn btn-danger" id="reset-confirm-btn" disabled>Delete everything</button>
        <button class="btn" data-act="cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#reset-confirm-input');
  const confirmBtn = overlay.querySelector('#reset-confirm-btn');
  const errorBox = overlay.querySelector('#reset-error');

  input.addEventListener('input', () => {
    confirmBtn.disabled = input.value !== RESET_PHRASE;
  });

  overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => overlay.remove());

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    try {
      await resetApp();
      overlay.querySelector('.modal').innerHTML = `<h2 style="margin-top:0;">Reset complete</h2>
        <p class="muted">Reloading…</p>`;
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      errorBox.innerHTML = `<div class="inline-error">${esc(e.message || String(e))}</div>`;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete everything';
    }
  });

  input.focus();
}

document.getElementById('btn-reset-app').addEventListener('click', showResetAppModal);

renderResetAppStatus();
