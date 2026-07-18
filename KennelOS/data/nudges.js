// nudges.js — the derived-nudge engine (Data Integrity Brief §2). Computes a
// prompt from current record state ONLY — the dismissal ledger is a separate
// concern (data/nudgeState.js) that today.js applies when it renders: filter
// out isDismissed(key), render the rest, wire each action button, and add a
// generic "Dismiss" affordance next to each nudge's own action(s). Dismiss is
// NOT part of a nudge's `actions` here — it's the same mechanism for every
// nudge, so the renderer owns it, not each rule. The one exception is the
// stud→pairing rule's auto-dismiss (§4.7): that's derived from `pairing_id`
// being set, not the ledger, so it belongs here, not in the renderer.
//
// Nothing here mutates a record on its own; every action is a user-confirmed
// button click.
//
// Five rules (§4.2, §4.3, §4.5, §4.7, plus the overdue-pairing rule below),
// each producing zero or more nudges:
//   { key, title, detail, subjectHref, actions: [{ label, run: async () => {} }] }
import { studServiceRepo } from './studServiceRepo.js';
import { dogRepo } from './dogRepo.js';
import { kennelRepo } from './kennelRepo.js';
import { pairingRepo } from './pairingRepo.js';
import { litterRepo } from './litterRepo.js';
import { eventRepo } from './eventRepo.js';
import { todayYMD, monthsBetween } from './dateUtils.js';
import { descriptor, PAIRING_STATUS } from './vocab.js';

const TERMINAL_PAIRING_STATUSES = ['cancelled', 'failed'];

// Pre-whelp: still expecting a litter, not yet resolved one way or the other.
const PRE_WHELP_STATUSES = ['planned', 'bred', 'confirmed_pregnant'];

// Shared dedup (§4.5/§4.7): is there already a live pairing for this dam,
// opened on/after `sinceYMD`? "Opened" prefers planned_date, falling back to
// created_at for a pairing entered without one — either way, a pairing that
// predates the window in question doesn't count as "already handled."
function pairingExistsForDam(pairings, damId, sinceYMD) {
  return pairings.some((p) => {
    if (p.dam_id !== damId || TERMINAL_PAIRING_STATUSES.includes(p.status)) return false;
    if (!sinceYMD) return true;
    const openedOn = p.planned_date || (p.created_at || '').slice(0, 10);
    return !openedOn || openedOn >= sinceYMD;
  });
}

function studPartnerLabel(s, dogsById) {
  return `${dogsById.get(s.our_dog_id)?.call_name || 'Our dog'} × ${dogsById.get(s.partner_dog_id)?.call_name || 'partner'}`;
}

function pairingLabel(p, dogsById) {
  return `${dogsById.get(p.dam_id)?.call_name || 'Dam'} × ${dogsById.get(p.sire_id)?.call_name || 'Sire'}`;
}

// §4.2 — stud-service status nudges. Never both at once for the same record:
// if the return date has already passed, prefer the "completed" nudge over
// "in progress" (checked first in the caller's loop).
function studCompletedNudge(s, dogsById) {
  return {
    key: `studstatus:${s.id}:completed`,
    title: 'Mark this stud service completed?',
    detail: `${studPartnerLabel(s, dogsById)} — returned ${s.returned_date}.`,
    subjectHref: `stud-service.html?id=${encodeURIComponent(s.id)}`,
    actions: [
      { label: 'Mark completed', run: async () => { await studServiceRepo.update(s.id, { status: 'completed' }); } }
    ]
  };
}

function studInProgressNudge(s, dogsById) {
  return {
    key: `studstatus:${s.id}:in_progress`,
    title: 'Mark this stud service in progress?',
    detail: `${studPartnerLabel(s, dogsById)} — sent ${s.sent_date}.`,
    subjectHref: `stud-service.html?id=${encodeURIComponent(s.id)}`,
    actions: [
      { label: 'Mark in progress', run: async () => { await studServiceRepo.update(s.id, { status: 'in_progress' }); } }
    ]
  };
}

export async function computeNudges() {
  const today = todayYMD();
  const [studServices, dogs, kennels, pairings, events] = await Promise.all([
    studServiceRepo.getAll(),
    dogRepo.getAll(),
    kennelRepo.getAll(),
    pairingRepo.getAll(),
    eventRepo.getAll()
  ]);
  const dogsById = new Map(dogs.map((d) => [d.id, d]));
  const kennelsById = new Map(kennels.map((k) => [k.id, k]));

  const nudges = [];

  // §4.2 — stud-service status nudges.
  for (const s of studServices) {
    let n = null;
    if (s.returned_date && s.returned_date < today && ['arranged', 'in_progress'].includes(s.status)) {
      n = studCompletedNudge(s, dogsById);
    } else if (s.sent_date && s.sent_date <= today && s.status === 'arranged') {
      n = studInProgressNudge(s, dogsById);
    }
    if (n) nudges.push(n);
  }

  // §4.3 — promote-lifecycle nudge: opt-in per kennel, decide-not-auto-promote.
  for (const d of dogs) {
    if (d.status !== 'puppy' || d.disposition !== 'keeping' || !d.date_of_birth) continue;
    const kennel = d.kennel_id ? kennelsById.get(d.kennel_id) : null;
    if (!kennel || kennel.promote_nudge_enabled !== true) continue;
    const threshold = d.sex === 'male' ? kennel.promote_age_male_months
      : d.sex === 'female' ? kennel.promote_age_female_months : null;
    if (threshold == null) continue;
    const ageMonths = monthsBetween(d.date_of_birth, today);
    if (ageMonths < threshold) continue;
    const key = `promote:${d.id}`;
    nudges.push({
      key,
      title: `${d.call_name} is old enough — promote to active breeding?`,
      detail: `${ageMonths} months old, kept for breeding (threshold: ${threshold}).`,
      subjectHref: `dog.html?id=${encodeURIComponent(d.id)}`,
      actions: [
        { label: 'Promote', run: async () => { await dogRepo.update(d.id, { status: 'active_breeding', status_date: today }); } }
      ]
    });
  }

  // §4.7 — stud service completed/overdue with no linked pairing yet.
  // Auto-dismiss: once pairing_id is set the rule produces nothing at all —
  // no ledger entry needed, the link itself is the done-signal.
  for (const s of studServices) {
    if (s.pairing_id) continue;
    const isDone = s.status === 'completed' || (s.returned_date && s.returned_date < today);
    if (!isDone) continue;
    const key = `studpair:${s.id}`;
    const damId = s.direction === 'incoming' ? s.our_dog_id : s.partner_dog_id;
    if (damId && pairingExistsForDam(pairings, damId, s.sent_date)) continue;
    nudges.push({
      key,
      title: 'Record the pairing for this stud service?',
      detail: studPartnerLabel(s, dogsById),
      subjectHref: `stud-service.html?id=${encodeURIComponent(s.id)}`,
      actions: [
        { label: 'Create pairing', run: async () => { location.href = `pairing.html?new=1&stud_service=${encodeURIComponent(s.id)}`; } }
      ]
    });
  }

  // §4.5 — concluded heat cycle with no matching pairing since it started.
  const concludedHeats = events.filter((e) =>
    e.event_type === 'heat_cycle' && e.subject_type === 'dog' && e.event_end_date && e.event_end_date < today
  );
  for (const ev of concludedHeats) {
    const key = `heatpair:${ev.id}`;
    const damId = ev.subject_id;
    if (pairingExistsForDam(pairings, damId, ev.event_date)) continue;
    const dam = dogsById.get(damId);
    nudges.push({
      key,
      title: `${dam?.call_name || 'This dam'} finished a heat — record a pairing?`,
      detail: `Heat concluded ${ev.event_end_date}.`,
      subjectHref: `dog.html?id=${encodeURIComponent(damId)}`,
      actions: [
        { label: 'Create pairing', run: async () => { location.href = `pairing.html?new=1&dam=${encodeURIComponent(damId)}`; } }
      ]
    });
  }

  // Overdue pairing — still pre-whelp status past its own expected due date,
  // with no litter recorded against it yet. Suggests both fixes: sync the
  // status, or go record the litter (deep-links to the same
  // litter.html?new=1&pairing=<id> prefill the pairing page's own "Create
  // Litter" button uses).
  for (const p of pairings) {
    if (!PRE_WHELP_STATUSES.includes(p.status) || !p.expected_due_date || p.expected_due_date >= today) continue;
    const litter = await litterRepo.getForPairing(p.id);
    if (litter) continue;
    nudges.push({
      key: `pairingoverdue:${p.id}`,
      title: `${pairingLabel(p, dogsById)} is past its expected due date`,
      detail: `Expected ${p.expected_due_date} — still marked "${descriptor(PAIRING_STATUS, p.status).label}".`,
      subjectHref: `pairing.html?id=${encodeURIComponent(p.id)}`,
      actions: [
        { label: 'Mark whelped', run: async () => { await pairingRepo.update(p.id, { status: 'whelped' }); } },
        { label: 'Create litter', run: async () => { location.href = `litter.html?new=1&pairing=${encodeURIComponent(p.id)}`; } }
      ]
    });
  }

  return nudges;
}
