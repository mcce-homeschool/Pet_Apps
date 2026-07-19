// litterFinances.js — the per-litter P&L for the litter-finances report. Fully
// derived (no table, no stored aggregate), same posture as incomeView.js: it
// joins income and expenses onto each litter and returns one row per litter.
//
// Income comes from incomeView's per-sale rows (already classified earned vs
// anticipated), grouped by the puppy's `litter_id`. Cost is the FULL litter cost
// (owner decision, "option b"): the litter's own `subject_type='litter'` expenses
// PLUS every puppy's own `subject_type='dog'` expenses. (The litter *detail* page
// deliberately shows neither the earned/anticipated split nor this rolled-up
// cost — that simplicity is intentional; the whole P&L lives here.)
import { getIncomeRows } from './incomeView.js';
import { expenseRepo } from './expenseRepo.js';
import { litterRepo } from './litterRepo.js';
import { dogRepo } from './dogRepo.js';

// One row per non-archived litter: income (earned/anticipated) from its puppy
// sales, its full cost (litter + puppy expenses), and net (earned − cost).
export async function getLitterFinances() {
  const [rows, expenses, litters, dogs] = await Promise.all([
    getIncomeRows({ includeArchived: false }),
    expenseRepo.getAll({ includeArchived: false }),
    litterRepo.getAll({ includeArchived: false }),
    dogRepo.getAll({ includeArchived: true })
  ]);
  const dogById = new Map(dogs.map((d) => [d.id, d]));

  const acc = new Map(); // litterId -> accumulator
  const get = (id) => {
    if (!acc.has(id)) acc.set(id, { earned: 0, anticipated: 0, litterExpenses: 0, puppyExpenses: 0, puppiesSold: 0 });
    return acc.get(id);
  };

  // Income: only sale rows carry a litter_id (stud income is never litter-scoped).
  for (const r of rows) {
    if (r.source_type !== 'sale' || !r.litter_id) continue;
    const a = get(r.litter_id);
    a.earned += r.earned;
    a.anticipated += r.anticipated;
    a.puppiesSold += 1;
  }

  // Cost (option b): litter-subject expenses + each puppy's dog-subject expenses.
  for (const e of expenses) {
    const amt = Number(e.amount) || 0;
    if (e.subject_type === 'litter') {
      get(e.subject_id).litterExpenses += amt;
    } else if (e.subject_type === 'dog') {
      const litterId = dogById.get(e.subject_id)?.litter_id;
      if (litterId) get(litterId).puppyExpenses += amt;
    }
  }

  return litters.map((l) => {
    const a = acc.get(l.id) || { earned: 0, anticipated: 0, litterExpenses: 0, puppyExpenses: 0, puppiesSold: 0 };
    const totalExpenses = a.litterExpenses + a.puppyExpenses;
    return {
      litter: l,
      earned: a.earned,
      anticipated: a.anticipated,
      litterExpenses: a.litterExpenses,
      puppyExpenses: a.puppyExpenses,
      totalExpenses,
      net: a.earned - totalExpenses,
      puppiesSold: a.puppiesSold
    };
  });
}
