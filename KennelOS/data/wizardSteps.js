// wizardSteps.js — the guided tour's ordered step catalog (Wizard Runtime Spec
// v1 §3), authored from Tutorial_Coverage_Matrix_v1.md §F (hub order) and §B
// (in-hub order + per-stop teaching copy). Data only, like vocab.js — no DOM,
// no logic. wizardState.js and wizardUI.js both import WIZARD_STEPS from here.
//
// Each step:
//   id         stable string id (never array position).
//   hub        concise hub name; drives the "Next: {hub} →" button on the
//              step *before* a hub's first step.
//   page       bare page file (no path/query) — resolved to pages/<page> like
//              nav.js's HUB_CHILDREN. Detail pages carry a separate `anchor`.
//   anchor     (detail pages only) a slug key into the seed's manifest.named
//              map (data/sampleData.js) — wizardUI.js resolves it to the
//              *current* seed's real id at runtime and builds `?id=<id>`. The
//              seed uses crypto.randomUUID() ids (not build-time constants), so
//              the link can only be resolved per-seed; manifest.named is the
//              map the seed writes for exactly this (spec §3.2, reconciled to
//              the actual seed).
//   selector   CSS selector for the coach-mark target on that page. Container
//              ids (`#…-section`, `[data-card="…"]`) are stable mount points
//              that always resolve; a step whose selector matches nothing
//              degrades to a centered tooltip (spec §4.3), never throws.
//   beforeShow { openCard: '<key>' } for ui.js cardShell cards (today/companion)
//              that may start collapsed — reuses the delegated card-toggle
//              listener. dog/litter/etc. sections default to expanded when the
//              seed populates them, so they need no reveal.
//   title/body one idea per stop, from the matrix's "Teaches" column. Anchor
//              records are named inline in the copy (spec §3.1).
//   isHubEntry true on a hub's first step (drives the hub-boundary button copy).

export const WIZARD_STEPS = [
  // --- Today -------------------------------------------------------------
  {
    id: 'today-reminders', hub: 'Today', page: 'today.html',
    selector: '[data-card="reminders"]', beforeShow: { openCard: 'reminders' },
    title: 'Reminders', isHubEntry: true,
    body: 'Reminders live on events, bucketed overdue / due-soon / upcoming — Juniper is overdue, Percy due soon, Birch upcoming. “Snooze” just edits the reminder date; there is no separate snooze field.'
  },
  {
    id: 'today-active-litters', hub: 'Today', page: 'today.html',
    selector: '[data-card="active-litters"]', beforeShow: { openCard: 'active-litters' },
    title: 'Active litters',
    body: 'One block per litter with an available puppy, its roster ordered available → undecided → sold with a sold/total tally. The Autumn litter (Ivy × Gunnar) is 1 of 3 sold: Wren available, Aster undecided, Cedar placed.'
  },
  {
    id: 'today-due-outs', hub: 'Today', page: 'today.html',
    selector: '[data-card="upcoming"]', beforeShow: { openCard: 'upcoming' },
    title: 'Due outs & upcoming',
    body: 'Future-dated events surface here — Cedar’s scheduled pickup, Percy’s vet visit. “Open →” deep-links straight into the event to edit it in place.'
  },
  {
    id: 'today-away', hub: 'Today', page: 'today.html',
    selector: '[data-card="board"]', beforeShow: { openCard: 'board' },
    title: 'Away from home',
    body: 'Whereabouts is derived from boarding and in-person stud events — Birch is at Ellen’s in Burlington, the location read from the partner’s address. Tap the row to expand contact / drop-off / return.'
  },
  {
    id: 'today-overview', hub: 'Today', page: 'today.html',
    selector: '[data-card="overview"]', beforeShow: { openCard: 'overview' },
    title: 'Kennel overview',
    body: 'Status tiles by dog status — including a live “For sale” tile (Clover). Deceased is a status, not an archive: an archived record leaves the roster, a deceased dog stays on it.'
  },
  {
    id: 'today-nudges', hub: 'Today', page: 'today.html',
    selector: '[data-card="nudges"]', beforeShow: { openCard: 'nudges' },
    title: 'Nudges',
    body: 'Derived suggestions the app surfaces from your data — seven rules fire on this seed (Poppy is old enough to promote, Sage’s heat could become a pairing, …). Nothing changes until you act; Dismiss just hides one.'
  },

  // --- Dogs --------------------------------------------------------------
  {
    id: 'dogs-buckets', hub: 'Dogs', page: 'dogs.html',
    selector: '#dogs-bucket-tabs',
    title: 'The dog roster', isHubEntry: true,
    body: 'One Dog table holds puppies, breeding stock and external dogs — the seg-tabs bucket them (puppies / breeding by sex / not-breeding by status / external). A life-stage change is a status update on the same record, never a new one.'
  },
  {
    id: 'dogs-filters', hub: 'Dogs', page: 'dogs.html',
    selector: '#dog-list',
    title: 'Filter, sort, archive, export',
    body: 'Filter by status / disposition / sex / ownership / breed, click a column to sort, toggle “Show archived” (archive ≠ delete — Willow is archived, not gone), and export the roster to CSV right from the hub.'
  },
  {
    id: 'dog-identity', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#profile-body',
    title: 'Dog profile — identity',
    body: 'Juniper’s profile carries the full identity set: registered name, registry, registration number, microchip, colour/markings and a URL. Edit in place with the Edit button.'
  },
  {
    id: 'dog-ownership', hub: 'Dogs', page: 'dog.html', anchor: 'gunnar',
    selector: '#profile-body',
    title: 'Ownership & external dogs',
    body: 'Gunnar is an external dog owned by Dana Ruiz — an owner is required for external and leased dogs, and the “Kennel” field hides for them. The same profile handles your own dogs and outside ones.'
  },
  {
    id: 'dog-disposition', hub: 'Dogs', page: 'dog.html', anchor: 'fern',
    selector: '#profile-body',
    title: 'Disposition — keeping vs. offering',
    body: 'Disposition (Fern is “available”) is a puppy-only field: it shows only while status is Puppy and clears once the dog grows past it. It feeds the prospective-families view — keeping, available, placed, or undecided.'
  },
  {
    id: 'dog-coi', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#recorded-coi-section',
    title: 'Recorded COI',
    body: 'This is a user-attested value, never computed by the app — Juniper’s is recorded as genomic, with the method and source stored beside it. The method field is a combobox of common values.'
  },
  {
    id: 'dog-planned-tests', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#planned-tests-section',
    title: 'Planned tests',
    body: 'An undated intention, not a result — unioned with your kennel’s preferred tests. “+ Plan a test” adds or copies one. It’s advisory: nothing here is a logged health-test event.'
  },
  {
    id: 'dog-health-tests', hub: 'Dogs', page: 'dog.html', anchor: 'daisy',
    selector: '#health-tests-section',
    title: 'Health-test summary',
    body: 'A read-only roll-up of logged test events — no inference, just what you recorded. Daisy carries all twelve health-relevant event types, so her summary shows the full spread.'
  },
  {
    id: 'dog-timeline', hub: 'Dogs', page: 'dog.html', anchor: 'percy',
    selector: '#timeline-section',
    title: 'Event history',
    body: 'Every dated fact — vet visits, boarding, notes — goes through one timeline. Percy’s boarding stay is a span event (a start and an end date), distinct from an instant event; a 🔗 links any event to its expense. “+ Add Event” opens the shared event form.'
  },
  {
    id: 'dog-derived', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#pairings-section',
    title: 'Derived relationship panels',
    body: 'Pairings, Litters, Sales, Stud Services and Contracts appear here only when relevant, and they are all derived queries — the reverse of a stored link, never a mirror field. Juniper’s pairings and litters are read live from those tables.'
  },
  {
    id: 'dog-pedigree', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#pedigree-section',
    title: 'Pedigree & offspring',
    body: 'Ancestry runs up (Ash, Willow); offspring runs down (Fern, Birch, Hazel) — and offspring is a derived query, depth-capped, not a stored list. “Open full view →” for the standalone pedigree page.'
  },

  // --- Breeding ----------------------------------------------------------
  {
    id: 'breeding-chain', hub: 'Breeding', page: 'breeding.html',
    selector: '#breeding-body',
    title: 'The breeding chain', isHubEntry: true,
    body: 'One consolidated view of the pairing → litter → puppies chain, all derived. Five pairing cards show first; with six seeded, a “Show 1 more pairing” toggle appears (pagination lives only here). Litters without a recorded pairing list separately.'
  },
  {
    id: 'breeding-log-heat', hub: 'Breeding', page: 'breeding.html',
    selector: '#log-heat-btn',
    title: 'Log a heat cycle',
    body: 'Logging a heat picks a dam, then opens the shared event form to record the heat_cycle event. Sage’s concluded heat is what drives the “heat → pairing” nudge back on Today.'
  },
  {
    id: 'pairing-profile', hub: 'Breeding', page: 'pairing.html', anchor: 'pairingP2',
    selector: '#profile-section',
    title: 'A pairing',
    body: 'Juniper × Gunnar is a planned pairing. Sire ≠ dam is a hard block; a sex mismatch warns; and setting the planned date prefills the expected due date at +63 days. Its litter, timeline and expenses are all on this page.'
  },
  {
    id: 'litter-profile', hub: 'Breeding', page: 'litter.html', anchor: 'autumnLitter',
    selector: '#profile-section',
    title: 'A litter',
    body: 'The Autumn litter is priced per sex ($2,800 M / $3,000 F) with per-sex deposits and an accept-deposits date that feeds the prospective bundle. Whelp date prefills estimated-ready at +56 days.'
  },
  {
    id: 'litter-roster', hub: 'Breeding', page: 'litter.html', anchor: 'autumnLitter',
    selector: '#roster-section',
    title: 'Puppy roster',
    body: 'The roster is derived — every Dog whose litter_id is this litter — not a stored list. “+ Add Puppy” / “+ Add N Puppies” create them; “+ Log event for whole litter” cascades one event (like a weight check) across every pup.'
  },
  {
    id: 'litter-income', hub: 'Breeding', page: 'litter.html', anchor: 'autumnLitter',
    selector: '#income-section',
    title: 'Sales & income',
    body: 'Per-puppy total value (price + transport + deferred boarding) with a running total — Cedar → Jamal is $3,300 including $250 transport and $250 boarding. The earned/anticipated split and net live in Reporting, not here.'
  },

  // --- People ------------------------------------------------------------
  {
    id: 'contacts-groups', hub: 'People', page: 'contacts.html',
    selector: '#contacts-group-tabs',
    title: 'Contacts', isHubEntry: true,
    body: 'Buyers, breeders, partners and service providers are all Contacts — there is no separate Buyer table. The group seg-tabs sort them (Priya is a client, Ellen network); filters, sort and “Show archived” work as elsewhere.'
  },
  {
    id: 'contact-profile', hub: 'People', page: 'contact.html', anchor: 'priya',
    selector: '#profile-body',
    title: 'A contact',
    body: 'contact_type is multi-valued, and referred_by auto-tags a referrer role. The companion note is buyer-facing (it surfaces on share-outs) — separate from your private notes. Dogs owned and sales-as-buyer show as derived cards below.'
  },
  {
    id: 'kennels-list', hub: 'People', page: 'kennels.html',
    selector: '#k-name',
    title: 'Kennels',
    body: 'The kennels list is identity CRUD only — name, prefix, location, website and an “own kennel” flag (Thornfield is mine, Meadow Ridge outside). Program configuration lives on a kennel’s own detail page.'
  },
  {
    id: 'kennel-config', hub: 'People', page: 'kennel.html', anchor: 'thornfield',
    selector: '#kennel-config',
    title: 'Kennel program config',
    body: 'For your own kennels: a preferred-tests vocabulary (seven tests, feeding the planned-test combobox, with “Apply to dogs…”) and lifecycle-nudge thresholds — Thornfield promotes males at 14mo, females at 11mo, which is why Poppy’s promote nudge fires.'
  },
  {
    id: 'kennel-expenses', hub: 'People', page: 'kennel.html', anchor: 'thornfield',
    selector: '#expenses-section',
    title: 'Kennel expenses',
    body: 'Overhead costs that belong to the kennel itself (subject = kennel), kept in the same ledger component you’ll see on dogs, litters and pairings.'
  },

  // --- Placements --------------------------------------------------------
  {
    id: 'sales-list', hub: 'Placements', page: 'sales.html',
    selector: '#sale-list',
    title: 'Placements', isHubEntry: true,
    body: 'Sale cards grouped under the sold pup’s litter (dogs with no litter fall into “External acquisitions”). Placement type and sale status are badges; a Contract owns the link. Non-delivered sales can print a Puppy Record PDF.'
  },
  {
    id: 'sale-profile', hub: 'Placements', page: 'sale.html', anchor: 'cedarSale',
    selector: '#profile-section',
    title: 'A sale — fees then dates',
    body: 'Cedar’s sale: price $2,800, deposit $500, a $250 transport fee and deferred boarding ($25/day × 10), with a balance due date. Deposit → balance drives the lifecycle; post-save prompts chain co-owner, delivery, disposition and boarding follow-ups.'
  },
  {
    id: 'stud-list', hub: 'Placements', page: 'stud-services.html',
    selector: '#stud-service-list',
    title: 'Stud services',
    body: 'Cards grouped by your own dog on either side — Birch outgoing, Juno incoming. Direction and type distinguish them, with an inline contract link on each.'
  },
  {
    id: 'stud-profile', hub: 'Placements', page: 'stud-service.html', anchor: 'studServiceBirch',
    selector: '#profile-section',
    title: 'A stud service',
    body: 'Birch is outgoing, in-person, flat-plus-pick — fee_structure gates both pick_status and a pick_value estimate ($1,500 non-cash, kept out of the cash totals). An in-person, sent service also books the dog “away”. “+ Create Pairing” links one.'
  },
  {
    id: 'contracts-list', hub: 'Placements', page: 'contracts.html',
    selector: '#contract-list',
    title: 'Contracts — the fallout list',
    body: 'Sale and stud contracts live inline on their cards; this page lists only the rest — co-ownership, lease, other and unlinked. Sage’s breeding lease (signed) and Percy’s co-ownership (sent) are here.'
  },
  {
    id: 'contract-profile', hub: 'Placements', page: 'contract.html', anchor: 'sageLeaseContract',
    selector: '#profile-section',
    title: 'A contract',
    body: 'Type-conditional fields: a lease hides sale/stud fields and shows lease dates and the counterparty (Dana). document_url surfaces on the share-out, and status moves freely — signed, sent, void, declined.'
  },

  // --- Financials --------------------------------------------------------
  {
    id: 'fin-overview', hub: 'Financials', page: 'financials.html',
    selector: '#financials-view-tabs',
    title: 'Financials — overview', isHubEntry: true,
    body: 'Four net tiles: earned income, anticipated income, total expenses, and Net (earned − spent). Toggle Overview / Income / Expenses up here. Income is entirely derived — there is no income table; it’s read from Sales and outgoing Stud Services.'
  },
  {
    id: 'fin-breakdown', hub: 'Financials', page: 'financials.html',
    selector: '#summary-section',
    title: 'Income & expense breakdown',
    body: 'Income by component (deposits, balance, transport, deferred boarding, stud fees, pick value) beside expenses by category. In the Income view, a row → Adjust modal writes money/status/paid-date back; a component is earned once paid or advanced, else anticipated.'
  },
  {
    id: 'fin-expenses', hub: 'Financials', page: 'financials.html',
    selector: '#add-expense',
    title: 'The expense ledger',
    body: 'A category tab for each expense type plus All, over one ledger filterable by category / subject-type / year, newest first. “+ Add Expense” logs a cost against any subject — kennel, dog, litter, pairing or event.'
  },
  {
    id: 'fin-invoice', hub: 'Financials', page: 'financials.html',
    selector: '#gen-document',
    title: 'Invoice / receipt',
    body: 'Pick any income record (a sale or outgoing stud) to open a print-only invoice — per-line full/partial, due dates and accepted methods. Print → Save as PDF from the browser.'
  },

  // --- More: Reports / Companion / Import-Export --------------------------
  {
    id: 'reports', hub: 'More', page: 'reports.html',
    selector: 'main',
    title: 'Reports', isHubEntry: true,
    body: 'Six analytics reports (litters over time, live-birth %, placements, litter P&L, stud services, health-test events) plus operational roster/scheduled views. Each is a filterable report with its own CSV export.'
  },
  {
    id: 'companion', hub: 'More', page: 'companion.html',
    selector: '#companion-type-tabs',
    title: 'Companion share-outs',
    body: 'Read-only, no-account links for buyers and partners — the seg-tab is the bundle type (prospective, current families, partners). “What to include” only ever subtracts from the defaults; recipients derive from live waitlist, open sales and contracts.'
  },
  {
    id: 'import-export', hub: 'More', page: 'import-export.html',
    selector: '#btn-backup',
    title: 'Back up your data',
    body: 'Everything lives in this browser — so before you start adding your own records, export a JSON backup here. Restore previews every change before committing, and seven CSV importers match-or-create by natural key with a dry-run preview. That’s the tour!'
  }
];
