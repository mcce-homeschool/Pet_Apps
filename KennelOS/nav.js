// nav.js — single source of truth for the top navigation, injected into the
// <div id="app-nav"></div> that every page includes. Adding a section in a later
// stage means adding one entry to NAV_ITEMS — no per-page HTML edits.
//
// Entries carry `stageIntroduced` so it's trivial to see what belongs to which
// stage and to gate future sections. Only Stages 1–2 sections appear now:
// Dogs, Contacts, Import/Export, Settings.

export const NAV_ITEMS = [
  { label: 'Dogs',          path: 'pages/dogs.html',          stageIntroduced: 2 },
  { label: 'Pairings',      path: 'pages/pairings.html',      stageIntroduced: 3 },
  { label: 'Litters',       path: 'pages/litters.html',       stageIntroduced: 3 },
  { label: 'Contacts',      path: 'pages/contacts.html',      stageIntroduced: 2 },
  { label: 'Waitlist / Buyers', path: 'pages/contacts.html?buyer=1', stageIntroduced: '4.5' },
  { label: 'Sales',         path: 'pages/sales.html',         stageIntroduced: 4 },
  { label: 'Stud Services', path: 'pages/stud-services.html', stageIntroduced: 4 },
  { label: 'Contracts',     path: 'pages/contracts.html',     stageIntroduced: 4 },
  { label: 'Pedigree',      path: 'pages/pedigree.html',      stageIntroduced: 2 },
  { label: 'Roster',        path: 'pages/roster.html',        stageIntroduced: 2 },
  { label: 'Active Breeding', path: 'pages/active-breeding.html', stageIntroduced: 3 },
  { label: 'Location Board', path: 'pages/board.html',        stageIntroduced: '4.5' },
  { label: 'Upcoming',      path: 'pages/upcoming.html',       stageIntroduced: '4.5' },
  { label: 'Scheduled Placements', path: 'pages/scheduled-placements.html', stageIntroduced: '4.5' },
  { label: 'Import/Export', path: 'pages/import-export.html', stageIntroduced: 1 }
];

// Pages live one directory deep (/pages/*.html); index.html sits at the app root.
// Links are stored app-root-relative and prefixed at render time so they resolve
// from either level (and from any GitHub Pages sub-path).
function rootPrefix() {
  return location.pathname.includes('/pages/') ? '../' : '';
}

function currentFile() {
  const parts = location.pathname.split('/');
  return parts[parts.length - 1] || 'index.html';
}

export function renderNav(targetId = 'app-nav') {
  const host = document.getElementById(targetId);
  if (!host) return;
  const prefix = rootPrefix();
  const here = currentFile();

  const links = NAV_ITEMS.map((item) => {
    const file = item.path.split('/').pop();
    const active = file === here ? ' active' : '';
    return `<a class="nav-link${active}" href="${prefix}${item.path}">${item.label}</a>`;
  }).join('');

  host.innerHTML = `
    <nav class="nav-inner">
      <a class="nav-brand" href="${prefix}index.html"><span class="paw">🐾</span> KennelOS</a>
      ${links}
    </nav>`;
}
