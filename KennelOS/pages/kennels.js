// kennels.js — minimal kennel management (add / edit / archive / delete).
// Delete is blocked while any contact or dog still points at the kennel (KENNEL_REFERENCES).
import { kennelRepo } from '../data/kennelRepo.js';
import { dogRepo } from '../data/dogRepo.js';
import { esc, confirmAction } from '../assets/ui.js';

const listEl = document.getElementById('kennel-list');
const errEl = document.getElementById('page-error');

let editingId = null;   // id of the kennel currently shown as an inline edit row, or null
let testsOpenId = null;  // id of the kennel whose preferred-tests panel is expanded, or null
let applyOpenId = null;  // id of the kennel whose "Apply to dogs" picker is expanded, or null
let allDogs = [];        // loaded alongside kennels, for the Apply-to-dogs picker

function showError(msg) { errEl.innerHTML = `<div class="inline-error">${esc(msg)}</div>`; }
function clearError() { errEl.innerHTML = ''; }

function displayRow(k, blocked) {
  const title = blocked.length ? 'Referenced by ' + blocked.map((b) => `${b.label} (${b.count})`).join(', ') : 'Delete kennel';
  return `<tr class="${k.is_archived ? 'row-archived' : ''}">
    <td><strong>${esc(k.kennel_name)}</strong>${k.is_own_kennel ? ' <span class="badge badge-green">My kennel</span>' : ''}</td>
    <td class="col-collapse">${k.prefix ? esc(k.prefix) : '<span class="faint">—</span>'}</td>
    <td class="col-collapse">${k.location ? esc(k.location) : '<span class="faint">—</span>'}</td>
    <td class="pill-row" style="justify-content:flex-end;">
      <a class="btn btn-sm" href="kennel.html?id=${encodeURIComponent(k.id)}">Open →</a>
      ${k.is_own_kennel ? `<button class="btn btn-sm" data-act="toggle-tests" data-id="${esc(k.id)}">${testsOpenId === k.id ? 'Hide tests' : 'Preferred tests'}</button>` : ''}
      <button class="btn btn-sm" data-act="edit" data-id="${esc(k.id)}">Edit</button>
      <button class="btn btn-sm" data-act="archive" data-id="${esc(k.id)}">${k.is_archived ? 'Unarchive' : 'Archive'}</button>
      <button class="btn btn-danger btn-sm" data-act="delete" data-id="${esc(k.id)}"${blocked.length ? ' disabled' : ''} title="${esc(title)}">Delete</button>
    </td>
  </tr>`;
}

// Preferred-tests editor (Test Planning Addendum §6.1) — own-kennels only.
// The checkbox list reflects current panel membership; unchecking removes
// panel membership going forward only, never the vocabulary token itself.
function testsPanelRow(k) {
  const tests = k.preferred_tests || [];
  const checklist = tests.length
    ? tests.map((t) => `
        <label class="check-inline" style="display:block; margin:4px 0;">
          <input type="checkbox" data-remove-test="${esc(t)}" checked> ${esc(t)}
        </label>`).join('')
    : `<p class="faint" style="margin:4px 0;">No preferred tests yet.</p>`;
  return `<tr>
    <td colspan="4">
      <div class="card" style="margin:8px 0;">
        <h3 style="margin-top:0;">Preferred tests — ${esc(k.kennel_name)}</h3>
        <p class="field-hint">Changes apply to newly added dogs only. Existing dogs keep their current plans — use "Apply to dogs" to update them.</p>
        <div>${checklist}</div>
        <div class="form-grid" style="margin-top:8px;">
          <div class="field"><label>Add a test</label>
            <input id="tp-new-${esc(k.id)}" type="text" placeholder="Type a test, then press Enter">
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-sm" data-act="tp-add" data-id="${esc(k.id)}">Add</button>
          <button class="btn btn-sm" data-act="tp-apply" data-id="${esc(k.id)}">Apply to dogs…</button>
          <button class="btn btn-sm" data-act="tp-close">Close</button>
        </div>
        ${applyOpenId === k.id ? applyToDogsPanel(k) : ''}
      </div>
    </td>
  </tr>`;
}

// "Apply to dogs" (§5) — additive: adds every test currently in the panel to
// each selected owned/co-owned dog's plan. Never removes a test the breeder
// pruned from an individual dog; adding an already-present token is a no-op.
function applyToDogsPanel(k) {
  const eligible = allDogs.filter((d) => ['owned', 'co_owned'].includes(d.ownership_type));
  if (!eligible.length) return `<p class="faint" style="margin-top:8px;">No owned/co-owned dogs to apply to.</p>`;
  const rows = eligible.map((d) => `
    <label class="check-inline" style="display:block; margin:4px 0;">
      <input type="checkbox" data-apply-dog="${esc(d.id)}"> ${esc(d.call_name)}${d.registered_name ? ' — ' + esc(d.registered_name) : ''}
    </label>`).join('');
  return `<div style="margin-top:10px; border-top:1px solid var(--border); padding-top:10px;">
    <p class="field-hint">Adds every test currently in the panel above to each selected dog's plan.</p>
    ${rows}
    <div class="form-actions">
      <button class="btn btn-primary btn-sm" data-act="tp-apply-confirm" data-id="${esc(k.id)}">Apply</button>
    </div>
  </div>`;
}

// Lifecycle nudges (Data Integrity Brief §3.2) — opt-in, per-kennel. Only
// meaningful for own kennels (promote-to-breeding is about our own puppies),
// same gating as the preferred-tests panel above.
function lifecycleNudgeFields(k) {
  if (!k.is_own_kennel) return '';
  return `
    <div class="field field-wide"><label class="check-inline"><input id="e-promote-enabled" type="checkbox"${k.promote_nudge_enabled ? ' checked' : ''}> Nudge me to promote kept puppies to active breeding once they're old enough</label></div>
    <div class="field"><label>Promote age — males (months)</label><input id="e-promote-male" type="number" min="0" step="1" value="${esc(k.promote_age_male_months ?? 6)}"></div>
    <div class="field"><label>Promote age — females (months)</label><input id="e-promote-female" type="number" min="0" step="1" value="${esc(k.promote_age_female_months ?? 12)}"></div>`;
}

function editRow(k) {
  return `<tr>
    <td colspan="4">
      <div class="form-grid">
        <div class="field"><label>Kennel name <span class="req">*</span></label><input id="e-name" type="text" value="${esc(k.kennel_name)}"></div>
        <div class="field"><label>Prefix</label><input id="e-prefix" type="text" value="${esc(k.prefix || '')}"></div>
        <div class="field"><label>Location</label><input id="e-location" type="text" value="${esc(k.location || '')}"></div>
        <div class="field field-wide"><label class="check-inline"><input id="e-own" type="checkbox"${k.is_own_kennel ? ' checked' : ''}> This is one of my own kennels</label></div>
        ${k.is_own_kennel ? `<div class="field field-wide"><h3 style="margin:8px 0 0;">Lifecycle nudges</h3></div>` : ''}
        ${lifecycleNudgeFields(k)}
      </div>
      <div class="form-actions">
        <button class="btn btn-primary btn-sm" data-act="save" data-id="${esc(k.id)}">Save</button>
        <button class="btn btn-sm" data-act="cancel-edit">Cancel</button>
      </div>
    </td>
  </tr>`;
}

async function render() {
  const [kennels, dogs] = await Promise.all([
    kennelRepo.getAll({ includeArchived: true }),
    dogRepo.getAll()
  ]);
  allDogs = dogs;
  if (!kennels.length) {
    listEl.innerHTML = `<div class="card empty-state">No kennels yet.</div>`;
    return;
  }
  // Compute delete-blockers per kennel so the Delete button can be disabled.
  const blockers = await Promise.all(kennels.map((k) => kennelRepo.getDeleteBlockers(k.id)));
  listEl.innerHTML = `<div class="table-scroll"><table class="data"><thead><tr><th>Name</th><th class="col-collapse">Prefix</th><th class="col-collapse">Location</th><th></th></tr></thead><tbody>${
    kennels.map((k, i) => {
      const rowHtml = k.id === editingId ? editRow(k) : displayRow(k, blockers[i]);
      const testsHtml = (k.is_own_kennel && testsOpenId === k.id) ? testsPanelRow(k) : '';
      return rowHtml + testsHtml;
    }).join('')
  }</tbody></table></div>`;

  listEl.querySelectorAll('[data-act="edit"], [data-act="archive"], [data-act="delete"]').forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => onAction(btn.dataset.act, kennels.find((k) => k.id === btn.dataset.id)));
  });
  const saveBtn = listEl.querySelector('[data-act="save"]');
  if (saveBtn) saveBtn.addEventListener('click', () => saveEdit(kennels.find((k) => k.id === saveBtn.dataset.id)));
  const cancelBtn = listEl.querySelector('[data-act="cancel-edit"]');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { editingId = null; render(); });

  listEl.querySelectorAll('[data-act="toggle-tests"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      testsOpenId = testsOpenId === btn.dataset.id ? null : btn.dataset.id;
      applyOpenId = null;
      render();
    });
  });
  listEl.querySelectorAll('[data-act="tp-close"]').forEach((btn) => {
    btn.addEventListener('click', () => { testsOpenId = null; applyOpenId = null; render(); });
  });
  listEl.querySelectorAll('[data-remove-test]').forEach((cb) => {
    cb.addEventListener('change', async (e) => {
      if (e.target.checked || !testsOpenId) return; // only act on uncheck
      try {
        await kennelRepo.removePreferredTest(testsOpenId, e.target.dataset.removeTest);
        render();
      } catch (err) { showError(err.message || String(err)); }
    });
  });
  async function addTest(kennelId, inputEl) {
    const val = inputEl.value.trim();
    if (!val) return;
    try {
      await kennelRepo.addPreferredTest(kennelId, val);
      render();
    } catch (err) { showError(err.message || String(err)); }
  }
  listEl.querySelectorAll('[data-act="tp-add"]').forEach((btn) => {
    btn.addEventListener('click', () => addTest(btn.dataset.id, document.getElementById(`tp-new-${btn.dataset.id}`)));
  });
  listEl.querySelectorAll('[id^="tp-new-"]').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      addTest(input.id.replace('tp-new-', ''), input);
    });
  });
  listEl.querySelectorAll('[data-act="tp-apply"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyOpenId = applyOpenId === btn.dataset.id ? null : btn.dataset.id;
      render();
    });
  });
  listEl.querySelectorAll('[data-act="tp-apply-confirm"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const kennel = kennels.find((k) => k.id === btn.dataset.id);
      const checked = [...listEl.querySelectorAll('[data-apply-dog]:checked')].map((el) => el.dataset.applyDog);
      if (!checked.length) return;
      try {
        await Promise.all(checked.map((dogId) => dogRepo.addPlannedTests(dogId, kennel.preferred_tests || [])));
        applyOpenId = null;
        render();
      } catch (err) { showError(err.message || String(err)); }
    });
  });
}

async function onAction(act, kennel) {
  clearError();
  try {
    if (act === 'edit') {
      editingId = kennel.id;
      render();
    } else if (act === 'archive') {
      kennel.is_archived ? await kennelRepo.unarchive(kennel.id) : await kennelRepo.archive(kennel.id);
      render();
    } else if (act === 'delete') {
      if (confirmAction(`Delete kennel “${kennel.kennel_name}”? This cannot be undone.`)) {
        await kennelRepo.hardDelete(kennel.id);
        render();
      }
    }
  } catch (e) {
    showError(e.message || String(e));
  }
}

async function saveEdit(kennel) {
  clearError();
  const kennel_name = document.getElementById('e-name').value.trim();
  const prefix = document.getElementById('e-prefix').value.trim();
  const location = document.getElementById('e-location').value.trim();
  const is_own_kennel = document.getElementById('e-own').checked;
  const changes = { kennel_name, prefix, location, is_own_kennel };
  const promoteEnabledEl = document.getElementById('e-promote-enabled');
  if (promoteEnabledEl) {
    changes.promote_nudge_enabled = promoteEnabledEl.checked;
    changes.promote_age_male_months = Number(document.getElementById('e-promote-male').value) || 0;
    changes.promote_age_female_months = Number(document.getElementById('e-promote-female').value) || 0;
  }
  try {
    await kennelRepo.update(kennel.id, changes);
    editingId = null;
    render();
  } catch (e) {
    showError(e.message || String(e));
  }
}

document.getElementById('k-add').addEventListener('click', async () => {
  clearError();
  const name = document.getElementById('k-name').value.trim();
  const prefix = document.getElementById('k-prefix').value.trim();
  const location = document.getElementById('k-location').value.trim();
  const is_own_kennel = document.getElementById('k-own').checked;
  try {
    await kennelRepo.create({ kennel_name: name, prefix, location, is_own_kennel });
    document.getElementById('k-name').value = '';
    document.getElementById('k-prefix').value = '';
    document.getElementById('k-location').value = '';
    document.getElementById('k-own').checked = false;
    render();
  } catch (e) {
    showError(e.message || String(e));
  }
});

render();
