#!/usr/bin/env node
// Verification harness for the "Growth counts toward the goal" feature.
//
// Mirrors the pure commission math from index.html (getCloseMonthContext +
// dealMonthlyShare + dealTotalPotential) so the worked examples in
// docs/feature-request-growth-counts-toward-goal.md are machine-checked.
// This is intentionally a standalone copy (same convention as the maxUnits()
// mirror in queue-verifications.mjs) — no DOM, no Supabase, just the numbers.
//
// Run:  node scripts/verify-goal-contribution.mjs

const TARGET = 1000;
const COMMISSION_RATE = 0.10;
const MANAGED_FLAT = 300;
const EXCLUDED_PLANS = ['lite', 'starter'];
const GOAL_CONTRIBUTOR_PLANS = ['growth'];

const isExcluded        = (p) => EXCLUDED_PLANS.includes(p);
const isGoalContributor = (p) => GOAL_CONTRIBUTOR_PLANS.includes(p);
const isManaged         = (p) => p === 'managed' || p === 'custom_managed' ||
                                 (typeof p === 'string' && p.startsWith('managed_'));
const isPlatform        = (p) => !isExcluded(p) && !isGoalContributor(p) && !isManaged(p);
const isCommissionable  = (p) => isPlatform(p) || isManaged(p);

function dealMaxUnits(d) {
  if (!d || !d.plan) return 0;
  if (!isCommissionable(d.plan)) return 0;
  if (isManaged(d.plan)) return 1;
  if (d.billing === 'annual') return 1;
  return 12;
}

// Single close-month cohort → per-deal above-line $ (mirror of getCloseMonthContext).
function closeMonthContext(monthDeals) {
  const platformDeals = monthDeals.filter(d => isPlatform(d.plan));
  const managedDeals  = monthDeals.filter(d => isManaged(d.plan));
  const goalDeals     = monthDeals.filter(d => isGoalContributor(d.plan));
  const platformMRR = platformDeals.reduce((s, d) => s + Number(d.mrr), 0);
  const managedMRR  = managedDeals.reduce((s, d) => s + Number(d.mrr), 0);
  const goalMRR     = goalDeals.reduce((s, d) => s + Number(d.mrr), 0);

  const eligibleMRR = platformMRR + managedMRR + goalMRR;
  const overage = Math.max(0, eligibleMRR - TARGET);
  const aboveLineByDealId = {};

  if (overage > 0 && platformMRR > 0) {
    const filledByOthers = managedMRR + goalMRR;
    const targetToFill = Math.max(0, TARGET - filledByOthers);
    const sorted = [...platformDeals].sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    for (const d of sorted) {
      const mrr = Number(d.mrr);
      const before = running, after = running + mrr;
      let aboveLine = 0;
      if (after <= targetToFill) aboveLine = 0;
      else if (before >= targetToFill) aboveLine = mrr;
      else aboveLine = after - targetToFill;
      aboveLineByDealId[d.id] = aboveLine;
      running = after;
    }
  }
  return { platformMRR, managedMRR, goalMRR, eligibleMRR, overage, aboveLineByDealId };
}

function dealMonthlyShare(d, ctx) {
  if (!d || !isCommissionable(d.plan)) return 0;
  if (isManaged(d.plan)) return MANAGED_FLAT;
  const aboveLine = ctx.aboveLineByDealId[d.id] || 0;
  if (aboveLine <= 0) return 0;
  if (d.billing === 'annual') return aboveLine * 12 * COMMISSION_RATE;
  return aboveLine * COMMISSION_RATE;
}

// 12-month forecast for a cohort: sum of per-deal (monthlyShare × maxUnits).
function cohortForecast(monthDeals) {
  const ctx = closeMonthContext(monthDeals);
  let total = 0;
  for (const d of monthDeals) total += dealMonthlyShare(d, ctx) * dealMaxUnits(d);
  return { ctx, total };
}

// ── Assertions ────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function approx(a, b) { return Math.abs(a - b) < 0.005; }
function check(label, got, want) {
  const ok = approx(got, want);
  console.log(`${ok ? '✓' : '✗'} ${label}: got ${got.toFixed(2)}, want ${want.toFixed(2)}`);
  ok ? pass++ : fail++;
}

const P = (id, mrr, billing = 'monthly') => ({ id, name: id, plan: 'scale', mrr, billing, date: '2026-06-01' });
const G = (id, mrr = 299) => ({ id, name: id, plan: 'growth', mrr, billing: 'monthly', date: '2026-06-01' });
const M = (id, mrr) => ({ id, name: id, plan: 'managed_medium', mrr, billing: 'monthly', date: '2026-06-01' });

console.log('\n— Scenario A: Growth rescues a near-miss —');
check('A before ($899 platform alone)', cohortForecast([P('a', 899)]).total, 0);
check('A after  (+$299 Growth)',        cohortForecast([P('a', 899), G('g')]).total, 237.60);

console.log('\n— Scenario B: stacking above an already-passing month —');
check('B before ($1200 platform alone)', cohortForecast([P('b', 1200)]).total, 240);
check('B after  (+$299 Growth)',         cohortForecast([P('b', 1200), G('g')]).total, 598.80);

console.log('\n— Scenario C: Growth alone, below target —');
{
  const { ctx, total } = cohortForecast([G('g')]);
  check('C commission', total, 0);
  check('C eligible MRR counts the Growth $299', ctx.eligibleMRR, 299);
}

console.log('\n— Scenario D: two Growth subs + a platform deal —');
check('D ($750 platform + 299 + 299)', cohortForecast([P('d', 750), G('g1'), G('g2')]).total, 417.60);

console.log('\n— Scenario E: Growth + Managed both fill the target —');
check('E ($600 plat + $569 mgd + $299 growth)',
      cohortForecast([P('e', 600), M('m', 569), G('g')]).total, 561.60 + 300);

console.log('\n— Edge E1: no platform deal (managed + growth above target) —');
{
  const { total, ctx } = cohortForecast([M('m', 800), G('g')]);
  check('E1 total = managed flat only', total, 300);
  check('E1 overage exists but earns nothing extra', ctx.overage, 99);
}

console.log('\n— Edge E2: managed + growth already ≥ target → all platform above line —');
check('E2 ($400 plat, $800 mgd, $299 growth) platform 12mo',
      cohortForecast([P('e2', 400), M('m', 800), G('g')]).total - 300, 480);

console.log('\n— Growth itself always earns $0 —');
{
  const deals = [P('p', 1200), G('g')];
  const { ctx } = cohortForecast(deals);
  check('Growth per-unit share', dealMonthlyShare(deals[1], ctx), 0);
  check('Growth max units', dealMaxUnits(deals[1]), 0);
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed.\n`);
process.exit(fail === 0 ? 0 : 1);
