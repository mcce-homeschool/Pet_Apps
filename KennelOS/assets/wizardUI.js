// wizardUI.js — the guided-tour overlay/spotlight/tooltip, the nav "Take the
// tour" entry, and the "Resume tour" pill (Wizard Runtime Spec v1 §4-§7).
// The only module that touches wizard DOM; app.js's shared boot is the only
// caller (no page file imports anything from here — §7).
import {
  isTourAvailable, getWizardStatus, getWizardStepIndex, currentStep,
  startWizard, advanceWizard, retreatWizard, dismissWizard
} from '../data/wizardState.js';
import { WIZARD_STEPS } from '../data/wizardSteps.js';
import { getSampleDataManifest } from '../data/settings.js';
import { confirmModal, alertModal, esc } from './ui.js';

function rootPrefix() {
  return location.pathname.includes('/pages/') ? '../' : '';
}

function currentFile() {
  const parts = location.pathname.split('/');
  return parts[parts.length - 1] || 'index.html';
}

function currentId() {
  return new URLSearchParams(location.search).get('id');
}

// Detail-page steps carry an `anchor` slug (e.g. 'juniper'); resolve it to the
// current seed's real id via the manifest.named map the seed writes (spec §3.2,
// reconciled to the actual runtime-UUID seed). Null for list/hub steps.
function resolvedAnchorId(step) {
  if (!step.anchor) return null;
  return getSampleDataManifest()?.named?.[step.anchor] || null;
}

// Is the browser already on this step's page? File must match, and for an
// anchored detail step the ?id= must be the resolved anchor id too, so
// advancing between two different dogs (both dog.html) still navigates.
function isOnStepPage(step) {
  if (step.page.split('?')[0] !== currentFile()) return false;
  const wantId = resolvedAnchorId(step);
  return wantId ? currentId() === wantId : true;
}

function resolveStepUrl(step) {
  const base = `${rootPrefix()}pages/${step.page.split('?')[0]}`;
  const id = resolvedAnchorId(step);
  return id ? `${base}?id=${id}` : base;
}

function goToStep(step) {
  location.href = resolveStepUrl(step);
}

// --- First offer -------------------------------------------------------
export async function maybeOfferWizardStart() {
  if (getWizardStatus() !== 'unseen') return;
  const start = await confirmModal({
    title: 'Take a guided tour?',
    message: 'Take a 2-minute guided tour of Thornfield Kennels — one idea per stop, ' +
      'across every hub. You can skip it any time and pick it back up later from the More menu.',
    confirmLabel: 'Start tour', cancelLabel: 'Not now'
  });
  if (!start) {
    dismissWizard();
    return;
  }
  startWizard();
  const step = currentStep();
  if (isOnStepPage(step)) runWizardStep();
  else goToStep(step);
}

// --- Nav menu entry ------------------------------------------------------
export function renderWizardMenuEntry() {
  if (!isTourAvailable()) return;
  const menu = document.querySelector('.nav-more-menu');
  if (!menu) return;

  const status = getWizardStatus();
  const label = status === 'completed' ? '🧭 Retake the tour'
    : (status === 'active' && getWizardStepIndex() > 0) ? '🧭 Resume tour'
    : '🧭 Take the tour';

  const a = document.createElement('a');
  a.href = '#';
  a.className = 'nav-link';
  a.textContent = label;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    if (status !== 'active') startWizard();
    const step = currentStep();
    if (!step) return;
    if (isOnStepPage(step)) runWizardStep();
    else goToStep(step);
  });
  menu.appendChild(a);
}

// --- Overlay / spotlight / tooltip ---------------------------------------
let mountedNodes = [];
let spotlightEl = null;

function teardown() {
  renderToken++; // invalidate any in-flight target poll
  mountedNodes.forEach((n) => n.remove());
  mountedNodes = [];
  if (spotlightEl) {
    spotlightEl.classList.remove('wizard-spotlight-target');
    spotlightEl = null;
  }
}

function revealTarget(step) {
  if (!step.beforeShow?.openCard) return;
  const key = step.beforeShow.openCard;
  const btn = document.querySelector(`[data-card="${CSS.escape(key)}"] .card-toggle-btn`);
  const body = btn?.closest('.card-collapsible')?.querySelector('.card-body');
  if (btn && body && body.hidden) btn.click();
}

function positionTooltip(tip, target) {
  const rect = target.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let top = rect.bottom + 12;
  if (top + tipRect.height > window.innerHeight - 12) top = rect.top - tipRect.height - 12;
  top = Math.max(top, 12);
  let left = rect.left;
  left = Math.min(Math.max(left, 12), window.innerWidth - tipRect.width - 12);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

const CLOSING_MESSAGE = 'That’s the whole spine, Reminders to Reports. Take the tour again any ' +
  'time from the More menu — and before you start adding your own records, back up your data from ' +
  'Import / Export.';

function goNext() {
  advanceWizard();
  if (getWizardStatus() !== 'active') {
    teardown();
    alertModal({ title: 'Tour complete', message: CLOSING_MESSAGE });
    return;
  }
  const step = currentStep();
  if (isOnStepPage(step)) runWizardStep();
  else goToStep(step);
}

function goBack() {
  retreatWizard();
  const step = currentStep();
  if (isOnStepPage(step)) runWizardStep();
  else goToStep(step);
}

function skip() {
  dismissWizard();
  teardown();
}

function mountTooltip(step, target) {
  const index = getWizardStepIndex();
  const total = WIZARD_STEPS.length;
  const isLast = index === total - 1;
  const next = WIZARD_STEPS[index + 1];
  const nextLabel = isLast ? 'Finish' : (next?.isHubEntry ? `Next: ${esc(next.hub)} →` : 'Next');

  const tip = document.createElement('div');
  tip.className = target ? 'wizard-tooltip' : 'wizard-tooltip wizard-tooltip-centered';
  tip.innerHTML = `
    <div class="wizard-step-count">Step ${index + 1} of ${total}</div>
    <h3 class="wizard-tooltip-title">${esc(step.title)}</h3>
    <p class="wizard-tooltip-body">${esc(step.body)}</p>
    <div class="wizard-tooltip-actions">
      ${index > 0 ? '<button type="button" class="btn btn-sm" data-act="back">Back</button>' : ''}
      <button type="button" class="btn btn-sm" data-act="skip">Skip tour</button>
      <button type="button" class="btn btn-primary btn-sm" data-act="next">${nextLabel}</button>
    </div>`;
  document.body.appendChild(tip);
  mountedNodes.push(tip);

  tip.querySelector('[data-act="back"]')?.addEventListener('click', goBack);
  tip.querySelector('[data-act="skip"]').addEventListener('click', skip);
  tip.querySelector('[data-act="next"]').addEventListener('click', goNext);

  if (target) positionTooltip(tip, target);
}

// Bumped on every runWizardStep()/teardown() so a pending target poll from a
// superseded step bails instead of mounting a stale, duplicate tooltip.
let renderToken = 0;

function mountStep(step) {
  const overlay = document.createElement('div');
  overlay.className = 'wizard-overlay';
  document.body.appendChild(overlay);
  mountedNodes.push(overlay);
  waitForTarget(step, renderToken, 0);
}

// app.js's shared boot() runs runWizardStep() synchronously, but each page
// renders its own content asynchronously (repo reads → innerHTML), so a step's
// target often isn't in the DOM yet on the first tick. Poll briefly for it
// before falling back to the centered non-spotlit tooltip (§4.3), so the
// fallback is reserved for genuinely-absent targets, not slow renders.
function waitForTarget(step, token, attempt) {
  if (token !== renderToken) return; // superseded by a newer step/teardown
  if (!step.selector) { mountTooltip(step, null); return; }
  revealTarget(step); // open a collapsed card once it exists
  const target = document.querySelector(step.selector);
  if (target) {
    target.classList.add('wizard-spotlight-target');
    spotlightEl = target;
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    requestAnimationFrame(() => { if (token === renderToken) mountTooltip(step, target); });
    return;
  }
  if (attempt >= 40) { mountTooltip(step, null); return; } // ~2s, then fall back
  setTimeout(() => waitForTarget(step, token, attempt + 1), 50);
}

function renderResumePill(step) {
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'wizard-resume-pill';
  pill.textContent = '🧭 Resume tour →';
  pill.addEventListener('click', () => goToStep(step));
  document.body.appendChild(pill);
  mountedNodes.push(pill);
}

// The per-page hook: app.js's shared boot() calls this unconditionally on every
// page load (§7). No page file imports anything wizard-related.
export function runWizardStep() {
  teardown();
  if (!isTourAvailable()) return;
  if (getWizardStatus() !== 'active') return;
  const step = currentStep();
  if (!step) return;
  if (!isOnStepPage(step)) {
    renderResumePill(step);
    return;
  }
  mountStep(step);
}
