// eventRepo.js — all Dexie access for the single polymorphic Event table
// (vaccinations, heat cycles, surgeries, titles, notes… — one dated occurrence
// attached to a dog / pairing / litter via subject_type + subject_id).
//
// NOTE the module/variable naming: we use `eventRepo` / `HistoryEvent`, never a
// bare `Event`, which would collide with the DOM global (CLAUDE.md).
//
// Events are leaf records — nothing points at an Event — so there is no reference
// registry and hardDelete is always allowed.
import { db } from './db.js';
import { makeRepo } from './repoBase.js';
import { EVENT_TYPES, descriptor } from './vocab.js';
import { todayYMD } from './dateUtils.js';

const base = makeRepo('events', null);

const REQUIRED_FIELDS = ['subject_type', 'subject_id', 'event_type', 'event_date', 'title'];
const SUBJECT_TYPES = ['dog', 'pairing', 'litter'];

function validateEvent(candidate) {
  for (const f of REQUIRED_FIELDS) {
    if (candidate[f] == null || candidate[f] === '') {
      throw new Error(`Event: "${f}" is required.`);
    }
  }
  if (!SUBJECT_TYPES.includes(candidate.subject_type)) {
    throw new Error(`Event: subject_type must be one of ${SUBJECT_TYPES.join(', ')}.`);
  }
  // event_date MAY be in the future (e.g. a scheduled surgery) — not blocked.
  // reminder_date < event_date is a soft warning owned by the Stage 2 UI.
  // event_end_date (Stage 4.5 Addendum §C1) is an ordinary nullable field — null
  // for instants, the end date for spans (boarding, heat_cycle, medication).
  // It rides through create/update like any other field; a non-null value on an
  // `instant`-duration type is a soft warning owned by the CSV importer, not a
  // hard block here.
}

export const HistoryEvent = {
  ...base,

  async create(data) {
    validateEvent(data);
    return base.create(data);
  },

  async update(id, changes) {
    const existing = await db.events.get(id);
    if (!existing) throw new Error(`events: no record with id ${id}`);
    validateEvent({ ...existing, ...changes });
    return base.update(id, changes);
  },

  // Timeline for one subject, newest first — the core read this table exists for.
  // Uses the [subject_type+subject_id] compound index.
  async getForSubject(subjectType, subjectId, { includeArchived = false } = {}) {
    const rows = await db.events
      .where('[subject_type+subject_id]')
      .equals([subjectType, subjectId])
      .toArray();
    const visible = includeArchived ? rows : rows.filter((r) => !r.is_archived);
    // Sort by event_date desc (YYYY-MM-DD lexicographic), then created_at desc as
    // a stable tiebreak for same-day events.
    return visible.sort((a, b) => {
      if (a.event_date !== b.event_date) return a.event_date < b.event_date ? 1 : -1;
      return (a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1;
    });
  },

  // Location/Status Board (Stage4.5 Addendum §C4) — dogs currently away from
  // home. Filters on event_type ∈ {boarding} — deliberately NOT on `duration`,
  // since medication/heat_cycle are spans too but aren't whereabouts. Past
  // stays fall off automatically and stay visible on the dog's own timeline.
  async getBoardRows() {
    const today = todayYMD();
    const rows = await db.events
      .where('event_type').equals('boarding')
      .and((e) => !e.is_archived)
      .and((e) => e.event_end_date == null || e.event_end_date >= today)
      .toArray();
    // Soonest return first; open-ended ("ongoing") stays sort last.
    return rows.sort((a, b) => {
      if (!a.event_end_date && !b.event_end_date) return 0;
      if (!a.event_end_date) return 1;
      if (!b.event_end_date) return -1;
      return a.event_end_date < b.event_end_date ? -1 : 1;
    });
  },

  // Upcoming Deliverables (Stage4.5 Addendum §D2) — a SEPARATE read from the
  // board: instant-duration events (drop-offs, scheduled vet visits, scheduled
  // surgeries, …) at or after today, across every subject type. This never
  // fuses with getBoardRows — that's the load-bearing distinction (§C4/§D2).
  async getUpcoming() {
    const today = todayYMD();
    const rows = await db.events
      .where('event_date').aboveOrEqual(today)
      .and((e) => !e.is_archived)
      .and((e) => descriptor(EVENT_TYPES, e.event_type).duration === 'instant')
      .toArray();
    return rows.sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0));
  },

  // Scheduled Placements report (Stage4.5 Addendum §D3) — future-dated
  // `placement` events only. A sibling read, not a filter over getUpcoming()'s
  // result, so it stays a one-line, obviously-correct query on its own.
  async getScheduledPlacements() {
    const today = todayYMD();
    const rows = await db.events
      .where('event_type').equals('placement')
      .and((e) => !e.is_archived)
      .and((e) => e.event_date >= today)
      .toArray();
    return rows.sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0));
  }
};

// Alias so pages that prefer the generic name can import either.
export { HistoryEvent as eventRepo };
