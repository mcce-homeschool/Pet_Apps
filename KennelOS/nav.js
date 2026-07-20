// nav.js — single source of truth for the top navigation, injected into the
// <div id="app-nav"></div> that every page includes.
//
// The bar is organized by JOB, not by table: six workflow hubs in the main bar
// (Today / Dogs / Breeding / People / Placements & Contracts / Financials), and
// the back-of-house utilities (Reports, Companion, Import/Export) tucked behind a
// "More" corner menu. Detail, edit, and import pages are NOT nav entries — they're
// reached by clicking into a hub. Consolidated pages (Pairings, Litters, Roster,
// Board, Upcoming, Reminders, …) still exist and keep their URLs; the bar simply
// consolidates the doors to them.
export const NAV_ITEMS = [
  { label: 'Today',    path: 'pages/today.html' },    // dashboard + reminders + upcoming + board
  { label: 'Dogs',     path: 'pages/dogs.html' },
  { label: 'Breeding', path: 'pages/breeding.html' }, // pairings + litters + resulting puppies
  { label: 'People',   path: 'pages/contacts.html' }, // contacts + waitlist / buyers
  { label: 'Placements & Contracts', path: 'pages/sales.html' }, // sales + stud services + contracts
  { label: 'Financials', path: 'pages/financials.html' } // the expense ledger — where the money lives
];

// Back-of-house utilities — rarely opened, so they live behind a corner menu
// rather than costing a slot in the main bar.
export const MORE_ITEMS = [
  { label: 'Reports',       path: 'pages/reports.html' },
  { label: 'Companion',     path: 'pages/companion.html' },
  { label: 'Import/Export', path: 'pages/import-export.html' }
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

// Child pages that belong to a hub but aren't nav entries — used only to light
// up the right tab when the user is deep inside a consolidated workflow.
const HUB_CHILDREN = {
  'pages/today.html': ['dashboard.html', 'reminders.html', 'upcoming.html', 'board.html', 'scheduled-placements.html'],
  'pages/dogs.html': ['dog.html', 'roster.html', 'pedigree.html'],
  'pages/breeding.html': ['pairings.html', 'pairing.html', 'litters.html', 'litter.html', 'active-breeding.html', 'live-births.html'],
  'pages/contacts.html': ['contact.html', 'kennels.html', 'kennel.html'],
  'pages/sales.html': ['sale.html', 'stud-services.html', 'stud-service.html', 'contracts.html', 'contract.html']
};

function isActive(item, here) {
  const file = item.path.split('/').pop().split('?')[0];
  if (file === here) return true;
  return (HUB_CHILDREN[item.path] || []).includes(here);
}

export function renderNav(targetId = 'app-nav') {
  const host = document.getElementById(targetId);
  if (!host) return;
  const prefix = rootPrefix();
  const here = currentFile();

  const links = NAV_ITEMS.map((item) => {
    const active = isActive(item, here) ? ' active' : '';
    return `<a class="nav-link${active}" href="${prefix}${item.path}">${item.label}</a>`;
  }).join('');

  const moreActive = MORE_ITEMS.some((item) => isActive(item, here)) ? ' active' : '';
  const moreLinks = MORE_ITEMS.map((item) => {
    const active = isActive(item, here) ? ' active' : '';
    return `<a class="nav-link${active}" href="${prefix}${item.path}">${item.label}</a>`;
  }).join('');

  host.innerHTML = `
    <nav class="nav-inner">
      <a class="nav-brand" href="${prefix}index.html"><span class="paw">🐾</span> KennelOS</a>
      <button type="button" class="nav-toggle" aria-label="Menu" aria-expanded="false">☰</button>
      <div class="nav-links">
        ${links}
        <div class="nav-more">
          <button type="button" class="nav-link nav-more-btn${moreActive}" aria-haspopup="true" aria-expanded="false">More ▾</button>
          <div class="nav-more-menu">${moreLinks}</div>
        </div>
      </div>
    </nav>`;

  wireToggle(host);
  wireMoreMenu(host);
}

// Hamburger toggle for narrow (phone) widths: reveals the stacked links. On wide
// screens the button is hidden by CSS and the links show inline, so this listener
// is simply never triggered there.
function wireToggle(host) {
  const inner = host.querySelector('.nav-inner');
  const btn = host.querySelector('.nav-toggle');
  if (!inner || !btn) return;
  btn.addEventListener('click', () => {
    const open = inner.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

// The corner menu opens on click and closes on outside-click or Escape. Kept to
// vanilla listeners so nav.js stays dependency-free.
function wireMoreMenu(host) {
  const wrap = host.querySelector('.nav-more');
  const btn = host.querySelector('.nav-more-btn');
  if (!wrap || !btn) return;
  const close = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = wrap.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
