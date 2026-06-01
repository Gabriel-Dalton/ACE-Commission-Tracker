#!/usr/bin/env node
// Queue pending "is this client still with us?" checks into Supabase.
//
// One row per (deal, billing month) ends up in `pending_verifications`. The
// dashboard reads that queue on load, shows a verification modal per row,
// and deletes the row once Gabriel confirms / cancels. INSERT uses
// `on_conflict=deal_id,period_month` so re-runs are idempotent.
//
// Triggered by .github/workflows/queue-verifications.yml on the 1st of each
// month (UTC). Reads two env vars set as GitHub Actions secrets:
//   SUPABASE_URL                — same value the dashboard uses
//   SUPABASE_SERVICE_ROLE_KEY   — service-role key. RLS is locked to the
//                                 `authenticated` role, so this server-side
//                                 job authenticates with the service-role key,
//                                 which bypasses RLS. Keep it secret: it must
//                                 NEVER be shipped to the browser / committed.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var.');
  process.exit(1);
}

async function supa(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const EXCLUDED_PLANS = new Set(['lite', 'starter', 'growth']);

function isManaged(plan) {
  return plan === 'managed' || plan === 'custom_managed' ||
         (typeof plan === 'string' && plan.startsWith('managed_'));
}

// Mirror dealMaxUnits() in index.html so the queueing logic agrees with the UI.
function maxUnits(deal) {
  if (!deal || !deal.plan) return 0;
  if (EXCLUDED_PLANS.has(deal.plan)) return 0;
  if (isManaged(deal.plan)) return 1;          // managed: one-shot $300 flat
  if (deal.billing === 'annual') return 1;     // annual upfront: one-shot
  return 12;                                   // monthly: paid as client pays
}

// YYYY-MM that payment N (1-indexed) lands in, based on first_payment_date or
// the deal's close date. Matches paymentMonthFor() in the dashboard.
function periodForPayment(deal, n) {
  const src = deal.first_payment_date || deal.date;
  if (!src) return null;
  const [y, m] = src.slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + (n - 1), 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function todayPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

const deals = await supa('deals?select=id,name,plan,billing,date,first_payment_date,payments_collected,cancelled');
const existing = await supa('pending_verifications?select=deal_id,period_month');
const already = new Set(existing.map(r => `${r.deal_id}|${r.period_month}`));

const current = todayPeriod();
const toQueue = [];

for (const d of deals) {
  if (d.cancelled) continue;

  const max = maxUnits(d);
  if (max <= 1) continue;   // one-shot deals don't recur; nothing to verify monthly

  const collected = Number(d.payments_collected || 0);
  if (collected >= max) continue;   // fully paid out

  // Queue every uncollected month from the next-due one up through the
  // current calendar month. Catches up after a long gap, but never schedules
  // a verification for a future month.
  for (let n = collected + 1; n <= max; n++) {
    const period = periodForPayment(d, n);
    if (!period || period > current) break;
    const key = `${d.id}|${period}`;
    if (already.has(key)) continue;
    toQueue.push({ deal_id: d.id, period_month: period });
    already.add(key);
  }
}

if (toQueue.length === 0) {
  console.log('No new verifications to queue.');
  process.exit(0);
}

// Batch upsert. on_conflict makes the run safe to retry — duplicates are
// dropped at the DB level rather than erroring the workflow.
await supa('pending_verifications?on_conflict=deal_id,period_month', {
  method: 'POST',
  headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
  body: JSON.stringify(toQueue),
});

console.log(`Queued ${toQueue.length} verification(s):`);
for (const v of toQueue) console.log(`  ${v.deal_id}  ${v.period_month}`);
