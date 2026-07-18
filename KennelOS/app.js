// app.js — shared shell bootstrap imported by every page. Injects the nav and,
// on first run, asks the browser to keep this origin's data durable.
//
// Imports here resolve relative to THIS module's URL (the app root), so they are
// correct no matter which page (root or /pages/) pulls app.js in.
import { renderNav } from './nav.js';
import { requestPersistentStorage } from './data/db.js';
import { wasPersistRequested, markPersistRequested } from './data/settings.js';
import { expenseRepo } from './data/expenseRepo.js';
import { maybeShowFirstRunPrompt, renderSampleBanner } from './assets/sampleDataUI.js';
import { maybeShowKennelSetupPrompt, renderKennelBanner } from './assets/kennelSetupUI.js';

async function firstRunPersistence() {
  if (wasPersistRequested()) return;
  markPersistRequested(); // record the attempt so we only prompt once
  await requestPersistentStorage();
}

// Registered against this module's own URL (not the page's) so it resolves to
// the same sw.js/scope from both index.html and /pages/*.html. A service
// worker with a fetch handler is required by Chrome/Android before it will
// offer to install the app, and it's what makes offline-after-first-load work.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const swUrl = new URL('./sw.js', import.meta.url);
  navigator.serviceWorker.register(swUrl, { scope: new URL('./', import.meta.url) });
}

// The kennel-setup wizard follows the sample-data choice, not precedes it:
// picking "Explore with sample data" reloads the page (Thornfield Kennels
// already fills that role), so only the "blank kennel" branch — or a later
// reload right after sample data gets cleared — ever reaches it.
async function firstRunFlow() {
  const choice = await maybeShowFirstRunPrompt();
  if (choice !== 'seeded') maybeShowKennelSetupPrompt();
}

function boot() {
  renderNav();
  registerServiceWorker();
  firstRunPersistence();
  // One-time fold of legacy Event.cost values into the Financials ledger. Guarded
  // by a settings flag inside the repo, so it's a cheap no-op after the first run.
  expenseRepo.migrateEventCosts().catch(() => { /* non-fatal */ });
  renderSampleBanner();
  renderKennelBanner();
  firstRunFlow();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
