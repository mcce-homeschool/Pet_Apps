// dateUtils.js — the single implementation of "what is today" as a date-only
// YYYY-MM-DD string (CLAUDE.md: date-only fields compare lexicographically as
// local calendar strings; only created_at/updated_at are full ISO/UTC). Lives
// in the data layer so both repos and assets/ui.js (which re-exports todayYMD
// for pages) share one definition instead of four independent copies.
//
// Deliberately LOCAL time (getFullYear/getMonth/getDate), not UTC — "today"
// should match the breeder's own wall clock, not a server's.
export function formatYMD(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayYMD() {
  return formatYMD(new Date());
}

// n days from today (negative = past) — sample-data dates that should stay
// "still relevant" regardless of when the packet is seeded.
export function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return formatYMD(d);
}

// n months from today — same purpose, coarser grain.
export function monthsFromToday(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return formatYMD(d);
}
